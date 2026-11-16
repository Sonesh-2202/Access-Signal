/**
 * Local fallback dataset for Midtown & Lower Manhattan.
 *
 * Used when the AccessSignal API is unreachable (network error or 5xx), so the public
 * pages keep working as a self-contained demo. Shapes match the API types exactly; the
 * query logic that filters this data lives in `services/mockApi.ts`.
 *
 * Coordinates are approximate street-corner positions (±20 m). Timestamps are relative
 * to page load so "3 hours ago" stays true whenever the demo is opened.
 */
import type {
  FeatureStatus,
  Hotspot,
  IssueStatus,
  Overview,
  PlaceSummary,
  Profile,
  ReportSummary,
  RouteOption,
  RouteResponse,
  RouteSegment,
  Taxonomy,
  Verification,
} from '@/types'

const NOW = Date.now()
const HOUR = 3_600_000
export const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString()

/* ------------------------------------------------------------------ taxonomy */

const sub = (key: string, label: string, severity: number, blocks_wheelchair: boolean) => ({ key, label, severity, blocks_wheelchair })

export const TAXONOMY: Taxonomy = {
  categories: [
    { key: 'entrance', label: 'Entrance', subcategories: [sub('step_at_entrance', 'Step at entrance', 0.85, true), sub('heavy_door', 'Heavy or manual door', 0.45, false), sub('narrow_doorway', 'Narrow doorway', 0.7, true), sub('entrance_closed', 'Accessible entrance closed', 0.8, true)] },
    { key: 'ramp', label: 'Ramp', subcategories: [sub('blocked_ramp', 'Ramp blocked', 0.9, true), sub('steep_ramp', 'Ramp too steep', 0.6, false), sub('damaged_ramp', 'Ramp damaged', 0.65, false), sub('missing_handrail', 'Missing handrail', 0.4, false)] },
    { key: 'elevator', label: 'Elevator', subcategories: [sub('out_of_service', 'Out of service', 0.95, true), sub('no_elevator', 'No elevator', 0.8, true), sub('small_cabin', 'Cabin too small', 0.5, false)] },
    { key: 'sidewalk', label: 'Sidewalk', subcategories: [sub('missing_curb_cut', 'Missing curb cut', 0.85, true), sub('broken_pavement', 'Broken pavement', 0.5, false), sub('obstruction', 'Obstruction on path', 0.6, false), sub('construction', 'Construction blocking path', 0.75, true), sub('narrow_sidewalk', 'Sidewalk too narrow', 0.45, false)] },
    { key: 'crossing', label: 'Crossing', subcategories: [sub('no_audible_signal', 'No audible signal', 0.6, false), sub('short_signal', 'Signal too short', 0.5, false), sub('missing_tactile_paving', 'Missing tactile paving', 0.55, false)] },
    { key: 'transit', label: 'Transit', subcategories: [sub('station_elevator_outage', 'Station elevator outage', 0.95, true), sub('platform_gap', 'Large platform gap', 0.6, false), sub('no_level_boarding', 'No level boarding', 0.65, false)] },
    { key: 'restroom', label: 'Restroom', subcategories: [sub('no_accessible_restroom', 'No accessible restroom', 0.55, false), sub('restroom_locked', 'Accessible restroom locked', 0.5, false)] },
    { key: 'wayfinding', label: 'Wayfinding', subcategories: [sub('no_braille_signage', 'No braille signage', 0.4, false), sub('poor_lighting', 'Poor lighting', 0.35, false), sub('confusing_layout', 'Confusing layout', 0.3, false)] },
    { key: 'other', label: 'Other', subcategories: [sub('other', 'Other barrier', 0.4, false)] },
  ],
  features: [
    { key: 'step_free_entrance', label: 'Step-free entrance' },
    { key: 'ramp', label: 'Ramp' },
    { key: 'elevator', label: 'Elevator' },
    { key: 'automatic_door', label: 'Automatic door' },
    { key: 'accessible_restroom', label: 'Accessible restroom' },
    { key: 'tactile_paving', label: 'Tactile paving' },
    { key: 'audible_signals', label: 'Audible crossing signals' },
    { key: 'hearing_loop', label: 'Hearing loop' },
    { key: 'accessible_parking', label: 'Accessible parking' },
  ],
  issue_statuses: ['reported', 'under_review', 'confirmed', 'assigned', 'in_progress', 'resolved', 'reverification'],
  service_area: { min_lat: 40.695, max_lat: 40.77, min_lng: -74.025, max_lng: -73.96 },
}

export function subInfo(category: string, subcategory: string) {
  const c = TAXONOMY.categories.find((x) => x.key === category)
  return c?.subcategories.find((s) => s.key === subcategory) ?? TAXONOMY.categories[8].subcategories[0]
}

/* ------------------------------------------------------------------ places */

type F = Record<string, FeatureStatus>
interface PlaceSeed {
  id: string
  name: string
  type: string
  lat: number
  lng: number
  address: string
  v: Verification
  checkedH: number | null
  features: F
}

const PLACE_SEEDS: PlaceSeed[] = [
  { id: 'plc-gct', name: 'Grand Central Terminal', type: 'transit_station', lat: 40.7527, lng: -73.9772, address: '89 E 42nd St', v: 'partially_verified', checkedH: 30, features: { step_free_entrance: 'available', elevator: 'available', ramp: 'limited', accessible_restroom: 'available', tactile_paving: 'limited' } },
  { id: 'plc-penn', name: 'Penn Station', type: 'transit_station', lat: 40.7506, lng: -73.9935, address: '7th Ave & W 33rd St', v: 'disputed', checkedH: 9, features: { step_free_entrance: 'unavailable', elevator: 'limited', accessible_restroom: 'available', tactile_paving: 'available' } },
  { id: 'plc-usq', name: '14 St–Union Sq Station', type: 'transit_station', lat: 40.7353, lng: -73.9906, address: 'Union Sq W & E 14th St', v: 'disputed', checkedH: 3, features: { elevator: 'unavailable', step_free_entrance: 'limited', tactile_paving: 'available' } },
  { id: 'plc-herald', name: '34 St–Herald Sq Station', type: 'transit_station', lat: 40.7497, lng: -73.9877, address: '6th Ave & W 34th St', v: 'disputed', checkedH: 14, features: { elevator: 'unavailable', step_free_entrance: 'available', tactile_paving: 'available' } },
  { id: 'plc-tsq', name: 'Times Sq–42 St Station', type: 'transit_station', lat: 40.7557, lng: -73.9871, address: '7th Ave & W 42nd St', v: 'verified', checkedH: 52, features: { elevator: 'available', step_free_entrance: 'available', tactile_paving: 'available' } },
  { id: 'plc-23st', name: '23 St Station (F/M)', type: 'transit_station', lat: 40.7429, lng: -73.9928, address: '6th Ave & W 23rd St', v: 'disputed', checkedH: 20, features: { elevator: 'unavailable', step_free_entrance: 'limited' } },
  { id: 'plc-astor', name: 'Astor Pl Station', type: 'transit_station', lat: 40.7300, lng: -73.9910, address: 'Lafayette St & Astor Pl', v: 'partially_verified', checkedH: 120, features: { elevator: 'unavailable', step_free_entrance: 'unavailable' } },
  { id: 'plc-fulton', name: 'Fulton Center', type: 'transit_station', lat: 40.7104, lng: -74.0092, address: 'Broadway & Fulton St', v: 'disputed', checkedH: 6, features: { elevator: 'unavailable', step_free_entrance: 'available', accessible_restroom: 'limited', tactile_paving: 'available' } },
  { id: 'plc-chambers', name: 'Chambers St Station (1/2/3)', type: 'transit_station', lat: 40.7155, lng: -74.0094, address: 'W Broadway & Chambers St', v: 'partially_verified', checkedH: 70, features: { elevator: 'available', step_free_entrance: 'available' } },
  { id: 'plc-bbch', name: 'Brooklyn Bridge–City Hall Station', type: 'transit_station', lat: 40.7130, lng: -74.0040, address: 'Centre St & Chambers St', v: 'partially_verified', checkedH: 96, features: { elevator: 'limited', step_free_entrance: 'available' } },
  { id: 'plc-oculus', name: 'World Trade Center Oculus', type: 'transit_station', lat: 40.7116, lng: -74.0110, address: '185 Greenwich St', v: 'verified', checkedH: 26, features: { elevator: 'available', step_free_entrance: 'available', accessible_restroom: 'available', automatic_door: 'available' } },
  { id: 'plc-pabt', name: 'Port Authority Bus Terminal', type: 'transit_station', lat: 40.7570, lng: -73.9910, address: '625 8th Ave', v: 'disputed', checkedH: 11, features: { elevator: 'unavailable', step_free_entrance: 'available', accessible_restroom: 'available' } },
  { id: 'plc-nypl', name: 'Stephen A. Schwarzman Building (NYPL)', type: 'library', lat: 40.7532, lng: -73.9822, address: '476 5th Ave', v: 'disputed', checkedH: 18, features: { step_free_entrance: 'unavailable', elevator: 'available', accessible_restroom: 'available', hearing_loop: 'available' } },
  { id: 'plc-snfl', name: 'Stavros Niarchos Foundation Library', type: 'library', lat: 40.7525, lng: -73.9810, address: '455 5th Ave', v: 'verified', checkedH: 40, features: { step_free_entrance: 'available', elevator: 'available', automatic_door: 'available', accessible_restroom: 'available', hearing_loop: 'available' } },
  { id: 'plc-jefferson', name: 'Jefferson Market Library', type: 'library', lat: 40.7346, lng: -73.9990, address: '425 6th Ave', v: 'partially_verified', checkedH: 33, features: { step_free_entrance: 'available', elevator: 'available', accessible_restroom: 'limited' } },
  { id: 'plc-seward', name: 'Seward Park Library', type: 'library', lat: 40.7146, lng: -73.9876, address: '192 E Broadway', v: 'unverified', checkedH: null, features: { step_free_entrance: 'unknown' } },
  { id: 'plc-bellevue', name: 'NYC Health + Hospitals/Bellevue', type: 'hospital', lat: 40.7392, lng: -73.9757, address: '462 1st Ave', v: 'verified', checkedH: 60, features: { step_free_entrance: 'available', automatic_door: 'available', elevator: 'available', accessible_restroom: 'available', accessible_parking: 'available' } },
  { id: 'plc-langone', name: 'NYU Langone Tisch Hospital', type: 'hospital', lat: 40.7421, lng: -73.9739, address: '550 1st Ave', v: 'partially_verified', checkedH: 150, features: { step_free_entrance: 'available', automatic_door: 'available', elevator: 'available' } },
  { id: 'plc-bryant', name: 'Bryant Park', type: 'park', lat: 40.7536, lng: -73.9832, address: '6th Ave & W 42nd St', v: 'disputed', checkedH: 22, features: { ramp: 'unavailable', step_free_entrance: 'limited', accessible_restroom: 'available' } },
  { id: 'plc-wsp', name: 'Washington Square Park', type: 'park', lat: 40.7308, lng: -73.9973, address: '5th Ave & Washington Sq N', v: 'verified', checkedH: 44, features: { ramp: 'available', step_free_entrance: 'available', tactile_paving: 'limited' } },
  { id: 'plc-madsq', name: 'Madison Square Park', type: 'park', lat: 40.7420, lng: -73.9880, address: '5th Ave & E 23rd St', v: 'partially_verified', checkedH: 64, features: { ramp: 'available', tactile_paving: 'unavailable' } },
  { id: 'plc-cityhall', name: 'City Hall', type: 'townhall', lat: 40.7128, lng: -74.0060, address: 'City Hall Park', v: 'partially_verified', checkedH: 84, features: { ramp: 'limited', step_free_entrance: 'available', hearing_loop: 'available' } },
  { id: 'plc-essex', name: 'Essex Market', type: 'place', lat: 40.7184, lng: -73.9882, address: '88 Essex St', v: 'partially_verified', checkedH: 48, features: { automatic_door: 'unavailable', step_free_entrance: 'available', elevator: 'available', accessible_restroom: 'available' } },
  { id: 'plc-tenement', name: 'Tenement Museum', type: 'museum', lat: 40.7188, lng: -73.9900, address: '103 Orchard St', v: 'unverified', checkedH: null, features: { step_free_entrance: 'limited' } },
  { id: 'plc-morgan', name: 'The Morgan Library & Museum', type: 'museum', lat: 40.7492, lng: -73.9813, address: '225 Madison Ave', v: 'verified', checkedH: 210, features: { step_free_entrance: 'available', elevator: 'available', accessible_restroom: 'available', hearing_loop: 'available' } },
  { id: 'plc-newmuseum', name: 'New Museum', type: 'museum', lat: 40.7224, lng: -73.9929, address: '235 Bowery', v: 'verified', checkedH: 300, features: { step_free_entrance: 'available', elevator: 'available', automatic_door: 'available' } },
  { id: 'plc-moma', name: 'Museum of Modern Art', type: 'museum', lat: 40.7614, lng: -73.9776, address: '11 W 53rd St', v: 'verified', checkedH: 180, features: { step_free_entrance: 'available', elevator: 'available', accessible_restroom: 'available', hearing_loop: 'available' } },
]

/* ------------------------------------------------------------------ reports */

interface ReportSeed {
  id: string
  lat: number
  lng: number
  address: string
  cat: string
  sub: string
  status: 'open' | 'resolved'
  conf: number
  h: number
  issue: IssueStatus
  text: string
  place?: string
  sev?: number
  evidence?: number
  corroborations?: number
  reporter?: string
  resolvedH?: number
  aiConf?: number
}

/** Hand-written reports. IDs are stable so links survive reloads. */
const NAMED: ReportSeed[] = [
  { id: 'rpt-0001', lat: 40.7353, lng: -73.9906, address: '14 St–Union Sq, elevator EL204 (street to downtown 4/5/6)', cat: 'transit', sub: 'station_elevator_outage', status: 'open', conf: 0.91, h: 3, issue: 'in_progress', place: 'plc-usq', evidence: 3, corroborations: 4, reporter: 'Maya R.', aiConf: 0.96, text: 'Elevator EL204 at the SE corner of Union Sq W is dark and the call button does nothing. The MTA screen says “in service”. Third time this month.' },
  { id: 'rpt-0002', lat: 40.7427, lng: -73.9928, address: '6th Ave & W 23rd St, NE corner', cat: 'sidewalk', sub: 'construction', status: 'open', conf: 0.84, h: 7, issue: 'confirmed', evidence: 2, corroborations: 3, reporter: 'Devon K.', aiConf: 0.94, sev: 0.82, text: 'Curb cut is covered by a steel road plate from the Con Ed dig. There’s a 3-inch lip on the plate edge. I had to go into the street to get around it.' },
  { id: 'rpt-0003', lat: 40.7527, lng: -73.9772, address: 'Grand Central Terminal, Track 102 ramp', cat: 'ramp', sub: 'steep_ramp', status: 'open', conf: 0.62, h: 20, issue: 'under_review', place: 'plc-gct', evidence: 1, corroborations: 1, reporter: 'Sam T.', aiConf: 0.81, text: 'The ramp down to Track 102 on the lower level is steeper than the others. My chair started rolling on the way down and there is no landing halfway.' },
  { id: 'rpt-0004', lat: 40.7187, lng: -73.9897, address: 'Orchard St & Delancey St, SW corner', cat: 'crossing', sub: 'missing_tactile_paving', status: 'open', conf: 0.48, h: 14, issue: 'reported', evidence: 1, corroborations: 0, reporter: 'Lena P.', aiConf: 0.88, text: 'Tactile warning strip is cracked and half missing at the crossing toward the Delancey St subway entrance. Cane doesn’t pick up the edge.' },
  { id: 'rpt-0005', lat: 40.7350, lng: -73.9909, address: 'Broadway & E 14th St, SW corner', cat: 'sidewalk', sub: 'missing_curb_cut', status: 'open', conf: 0.88, h: 118, issue: 'assigned', evidence: 3, corroborations: 5, reporter: 'Andre W.', aiConf: 0.94, text: 'The sidewalk renovation took out the curb cut on the southwest corner. New curb is full height, about 7 inches, with no temporary ramp. Workers said it would be back “soon” five days ago, and since then everyone in a chair or pushing a stroller has had to cross mid-block in traffic.' },
  { id: 'rpt-0006', lat: 40.7497, lng: -73.9877, address: '34 St–Herald Sq, 6th Ave mezzanine elevator', cat: 'transit', sub: 'station_elevator_outage', status: 'open', conf: 0.86, h: 41, issue: 'assigned', place: 'plc-herald', evidence: 2, corroborations: 3, reporter: 'Priya N.', aiConf: 0.95, text: 'Mezzanine-to-downtown-platform elevator has a “planned work” sign taped to it, no end date. Nearest working one is at 42nd St.' },
  { id: 'rpt-0007', lat: 40.7505, lng: -73.9878, address: 'Broadway & W 35th St, east sidewalk', cat: 'sidewalk', sub: 'narrow_sidewalk', status: 'open', conf: 0.55, h: 26, issue: 'reported', evidence: 1, corroborations: 1, aiConf: 0.79, text: 'Café seating plus a sandwich board leaves about 30 inches of clear path. Not enough for a wheelchair to pass anyone.' },
  { id: 'rpt-0008', lat: 40.7502, lng: -73.9918, address: 'Penn Station, 7th Ave & W 33rd St entrance', cat: 'entrance', sub: 'entrance_closed', status: 'open', conf: 0.79, h: 9, issue: 'confirmed', place: 'plc-penn', evidence: 2, corroborations: 2, reporter: 'Jordan L.', aiConf: 0.9, text: 'The accessible entrance on 33rd is gated. Only the escalators on 7th Ave are open. Staff pointed us to 31st St, which is another two blocks.' },
  { id: 'rpt-0009', lat: 40.7488, lng: -73.9913, address: '7th Ave & W 32nd St, west sidewalk', cat: 'sidewalk', sub: 'broken_pavement', status: 'open', conf: 0.52, h: 66, issue: 'reported', evidence: 1, corroborations: 1, aiConf: 0.83, text: 'Large heaved slab by the tree pit, about two inches higher than the next one. Easy to catch a front caster.' },
  { id: 'rpt-0010', lat: 40.7557, lng: -73.9871, address: 'Times Sq–42 St, 7th Ave street elevator', cat: 'transit', sub: 'station_elevator_outage', status: 'resolved', conf: 0.81, h: 220, issue: 'resolved', place: 'plc-tsq', evidence: 2, corroborations: 2, resolvedH: 196, aiConf: 0.95, text: 'Street elevator at 42nd & 7th stuck at mezzanine level, doors open.' },
  { id: 'rpt-0011', lat: 40.7527, lng: -73.9817, address: 'NYPL Schwarzman, 42nd St accessible entrance', cat: 'entrance', sub: 'entrance_closed', status: 'open', conf: 0.71, h: 18, issue: 'under_review', place: 'plc-nypl', evidence: 1, corroborations: 2, reporter: 'Ruth A.', aiConf: 0.87, text: 'The 42nd Street ground-level entrance was closed for a private event. Security said use 5th Ave, which is the stairs.' },
  { id: 'rpt-0012', lat: 40.7536, lng: -73.9840, address: 'Bryant Park, 6th Ave & W 40th St ramp', cat: 'ramp', sub: 'blocked_ramp', status: 'open', conf: 0.76, h: 22, issue: 'confirmed', place: 'plc-bryant', evidence: 2, corroborations: 2, reporter: 'Chris M.', aiConf: 0.93, text: 'Delivery pallets for the winter village kiosks are stacked on the 40th St ramp. No other step-free way into the park from this side.' },
  { id: 'rpt-0013', lat: 40.7104, lng: -74.0092, address: 'Fulton Center, Dey St elevator', cat: 'transit', sub: 'station_elevator_outage', status: 'open', conf: 0.89, h: 6, issue: 'in_progress', place: 'plc-fulton', evidence: 2, corroborations: 3, reporter: 'Tomás G.', aiConf: 0.96, text: 'Dey St elevator to the R/W platform is out. A technician is on site and said a door sensor failed.' },
  { id: 'rpt-0014', lat: 40.7102, lng: -74.0087, address: 'Broadway & Fulton St crossing', cat: 'crossing', sub: 'no_audible_signal', status: 'open', conf: 0.58, h: 50, issue: 'reported', evidence: 1, corroborations: 1, aiConf: 0.85, text: 'Accessible pedestrian signal button on the NW corner clicks but never announces the walk phase.' },
  { id: 'rpt-0015', lat: 40.7155, lng: -74.0094, address: 'Chambers St (1/2/3), downtown platform', cat: 'transit', sub: 'platform_gap', status: 'open', conf: 0.5, h: 75, issue: 'reported', place: 'plc-chambers', evidence: 1, corroborations: 0, aiConf: 0.77, text: 'The curved section near the front of the train leaves a gap of four inches or more. The boarding area marker is at the worst spot.' },
  { id: 'rpt-0016', lat: 40.7133, lng: -74.0083, address: 'City Hall Park, Broadway & Murray St ramp', cat: 'ramp', sub: 'damaged_ramp', status: 'open', conf: 0.64, h: 90, issue: 'assigned', place: 'plc-cityhall', evidence: 2, corroborations: 1, aiConf: 0.89, text: 'Ramp surface is spalling at the bottom and water pools there. Ice forms in the morning.' },
  { id: 'rpt-0017', lat: 40.7130, lng: -74.0040, address: 'Brooklyn Bridge–City Hall, Centre St elevator', cat: 'elevator', sub: 'small_cabin', status: 'open', conf: 0.46, h: 140, issue: 'reported', place: 'plc-bbch', evidence: 1, corroborations: 0, aiConf: 0.72, text: 'Cabin fits one power chair with no room to turn. Companions have to take the next trip.' },
  { id: 'rpt-0018', lat: 40.7184, lng: -73.9882, address: 'Essex Market, Delancey St doors', cat: 'entrance', sub: 'heavy_door', status: 'open', conf: 0.57, h: 36, issue: 'under_review', place: 'plc-essex', evidence: 1, corroborations: 1, aiConf: 0.84, text: 'The automatic door opener on the Delancey side has been disconnected. The door is very heavy to pull.' },
  { id: 'rpt-0019', lat: 40.7194, lng: -73.9910, address: 'Delancey St & Allen St crossing', cat: 'crossing', sub: 'short_signal', status: 'open', conf: 0.53, h: 60, issue: 'reported', evidence: 0, corroborations: 1, aiConf: 0.8, text: 'Walk signal gives about 18 seconds to cross the full width of Delancey including the median. Not possible at walker speed.' },
  { id: 'rpt-0020', lat: 40.7180, lng: -73.9936, address: 'Grand St & Bowery, south sidewalk', cat: 'sidewalk', sub: 'broken_pavement', status: 'resolved', conf: 0.44, h: 102, issue: 'resolved', resolvedH: 31, evidence: 1, corroborations: 0, aiConf: 0.82, text: 'Sunken utility cover with a ring of broken concrete around it, right in the main path.' },
  { id: 'rpt-0021', lat: 40.7300, lng: -73.9910, address: 'Astor Pl Station, downtown side', cat: 'elevator', sub: 'no_elevator', status: 'open', conf: 0.74, h: 160, issue: 'confirmed', place: 'plc-astor', evidence: 1, corroborations: 3, aiConf: 0.9, text: 'No elevator on either side. Signage at street level doesn’t say so until you are at the top of the stairs.' },
  { id: 'rpt-0022', lat: 40.7316, lng: -73.9970, address: 'Washington Sq N & 5th Ave ramp', cat: 'ramp', sub: 'damaged_ramp', status: 'resolved', conf: 0.7, h: 300, issue: 'resolved', place: 'plc-wsp', evidence: 2, corroborations: 1, resolvedH: 212, aiConf: 0.88, text: 'Cracked ramp at the arch entrance, edge has crumbled.' },
  { id: 'rpt-0023', lat: 40.7412, lng: -73.9893, address: '5th Ave & E 23rd St crossing', cat: 'crossing', sub: 'missing_tactile_paving', status: 'open', conf: 0.51, h: 84, issue: 'reported', place: 'plc-madsq', evidence: 1, corroborations: 0, aiConf: 0.86, text: 'New pedestrian plaza edge has no tactile warning where it meets the roadway on the Broadway side.' },
  { id: 'rpt-0024', lat: 40.7406, lng: -73.9898, address: 'Broadway & E 22nd St, Flatiron', cat: 'sidewalk', sub: 'construction', status: 'open', conf: 0.68, h: 30, issue: 'confirmed', evidence: 2, corroborations: 2, aiConf: 0.92, text: 'Sidewalk shed plus a dumpster closes the west sidewalk. The detour sign points to a crosswalk with no curb cut.' },
  { id: 'rpt-0025', lat: 40.7454, lng: -73.9826, address: 'Park Ave S & E 32nd St, west sidewalk', cat: 'sidewalk', sub: 'narrow_sidewalk', status: 'open', conf: 0.42, h: 110, issue: 'reported', evidence: 0, corroborations: 1, aiConf: 0.78, text: 'Scaffolding poles leave a pinch point of about 32 inches for half the block.' },
  { id: 'rpt-0026', lat: 40.7392, lng: -73.9757, address: 'Bellevue, 1st Ave main entrance', cat: 'entrance', sub: 'heavy_door', status: 'resolved', conf: 0.66, h: 260, issue: 'resolved', place: 'plc-bellevue', evidence: 1, corroborations: 1, resolvedH: 238, aiConf: 0.86, text: 'Automatic door on the left side of the main entrance stopped opening.' },
  { id: 'rpt-0027', lat: 40.7429, lng: -73.9928, address: '23 St (F/M), 6th Ave street elevator', cat: 'transit', sub: 'station_elevator_outage', status: 'open', conf: 0.87, h: 12, issue: 'confirmed', place: 'plc-23st', evidence: 2, corroborations: 3, reporter: 'Keisha B.', aiConf: 0.95, text: 'Street elevator on the NE corner is out. Combined with the plated curb cut on the same corner, there’s no step-free way in from the north side.' },
  { id: 'rpt-0028', lat: 40.7346, lng: -73.9990, address: 'Jefferson Market Library, lower level', cat: 'restroom', sub: 'restroom_locked', status: 'open', conf: 0.49, h: 46, issue: 'reported', place: 'plc-jefferson', evidence: 0, corroborations: 1, aiConf: 0.81, text: 'Accessible restroom locked. Desk said the key is “upstairs” but nobody could find it.' },
  { id: 'rpt-0029', lat: 40.7570, lng: -73.9910, address: 'Port Authority, 8th Ave & W 41st St elevator', cat: 'elevator', sub: 'out_of_service', status: 'open', conf: 0.82, h: 11, issue: 'under_review', place: 'plc-pabt', evidence: 2, corroborations: 2, reporter: 'Ben O.', aiConf: 0.94, text: 'Elevator from the 8th Ave concourse to the gate level is out. The only other one is at the far north wing.' },
  { id: 'rpt-0030', lat: 40.7116, lng: -74.0110, address: 'WTC Oculus, PATH concourse elevator', cat: 'transit', sub: 'station_elevator_outage', status: 'resolved', conf: 0.78, h: 180, issue: 'reverification', place: 'plc-oculus', evidence: 2, corroborations: 1, resolvedH: 150, aiConf: 0.93, text: 'Elevator to the PATH platforms out of service, staff escorting people through the freight lift.' },
  { id: 'rpt-0031', lat: 40.7188, lng: -74.0003, address: 'Canal St & Lafayette St, NW corner', cat: 'sidewalk', sub: 'obstruction', status: 'open', conf: 0.6, h: 54, issue: 'under_review', evidence: 1, corroborations: 1, aiConf: 0.87, text: 'Curb cut has a deep puddle at the bottom after every rain. The drain is blocked with debris.' },
  { id: 'rpt-0032', lat: 40.7238, lng: -73.9898, address: 'E Houston St & 2nd Ave crossing', cat: 'crossing', sub: 'no_audible_signal', status: 'open', conf: 0.47, h: 130, issue: 'reported', evidence: 0, corroborations: 0, aiConf: 0.83, text: 'No accessible pedestrian signal on the north side. Houston is eight lanes here.' },
]

/** Background reports: ordinary, real intersections that fill out the map. */
const BACKGROUND: [string, number, number, string, string, number, string][] = [
  ['8th Ave & W 38th St', 40.7552, -73.9917, 'sidewalk', 'obstruction', 0.41, 'Food cart parked across the curb ramp during lunch hours.'],
  ['Lexington Ave & E 41st St', 40.7505, -73.9763, 'sidewalk', 'narrow_sidewalk', 0.38, 'Newsstand and a bike rack leave a narrow gap.'],
  ['3rd Ave & E 14th St', 40.7329, -73.9875, 'crossing', 'missing_tactile_paving', 0.45, 'Tactile strip missing after repaving on the SE corner.'],
  ['Varick St & W Houston St', 40.7282, -74.0054, 'crossing', 'short_signal', 0.5, 'Walk phase is too short to clear the Holland Tunnel approach lanes.'],
  ['Church St & Worth St', 40.7173, -74.0059, 'sidewalk', 'broken_pavement', 0.36, 'Deep crack across the whole sidewalk by the hydrant.'],
  ['Water St & Wall St', 40.7053, -74.0074, 'ramp', 'damaged_ramp', 0.52, 'Curb ramp edge broken off, leaves a sharp lip.'],
  ['Broad St & Beaver St', 40.7050, -74.0115, 'sidewalk', 'construction', 0.63, 'Security bollard installation has the corner fenced off.'],
  ['2nd Ave & E 9th St', 40.7290, -73.9878, 'sidewalk', 'obstruction', 0.4, 'Restaurant shed and trash bags block half the sidewalk at night.'],
  ['Park Ave & E 46th St', 40.7546, -73.9759, 'crossing', 'no_audible_signal', 0.55, 'Audible signal on the median island is silent.'],
  ['9th Ave & W 34th St', 40.7533, -73.9978, 'sidewalk', 'broken_pavement', 0.37, 'Patched trench has settled and the asphalt is rutted.'],
  ['Broadway & W 28th St', 40.7455, -73.9887, 'sidewalk', 'obstruction', 0.43, 'Wholesale deliveries stacked on the sidewalk most mornings.'],
  ['Clinton St & Grand St', 40.7151, -73.9871, 'ramp', 'missing_handrail', 0.39, 'Handrail missing on the building ramp to the senior center.'],
  ['1st Ave & E 6th St', 40.7254, -73.9867, 'sidewalk', 'narrow_sidewalk', 0.35, 'Planters plus a sidewalk café narrow the path to one person.'],
  ['W Broadway & Spring St', 40.7255, -74.0016, 'entrance', 'step_at_entrance', 0.48, 'Post office annex entrance has a single 6-inch step, no ramp.'],
  ['Lafayette St & E 4th St', 40.7276, -73.9925, 'wayfinding', 'poor_lighting', 0.42, 'Street lights out under the scaffolding, hard to see the curb edge.'],
]

const ISSUE_ROTATION: IssueStatus[] = ['reported', 'under_review', 'reported', 'confirmed', 'reported']

const SEEDS: ReportSeed[] = [
  ...NAMED,
  ...BACKGROUND.map(([address, lat, lng, cat, s, conf, text], i): ReportSeed => ({
    id: `rpt-${String(101 + i).padStart(4, '0')}`,
    lat,
    lng,
    address,
    cat,
    sub: s,
    status: 'open',
    conf,
    h: 40 + i * 37,
    issue: ISSUE_ROTATION[i % ISSUE_ROTATION.length],
    text,
    evidence: i % 3 === 0 ? 0 : 1,
    corroborations: i % 4 === 0 ? 1 : 0,
    aiConf: 0.74 + ((i * 7) % 20) / 100,
  })),
]

export const PLACES: PlaceSummary[] = PLACE_SEEDS.map((p) => ({
  id: p.id,
  name: p.name,
  place_type: p.type,
  lat: p.lat,
  lng: p.lng,
  address: p.address,
  verification_status: p.v,
  last_verified: p.checkedH === null ? null : hoursAgo(p.checkedH),
  open_reports: SEEDS.filter((r) => r.place === p.id && r.status === 'open').length,
  feature_status: p.features,
}))

export interface MockReport extends ReportSummary {
  reporter: string | null
  corroborations: number
  resolved_at: string | null
  ai_confidence: number
}

export const REPORTS: MockReport[] = SEEDS.map((s) => ({
  id: s.id,
  lat: s.lat,
  lng: s.lng,
  address: s.address,
  category: s.cat,
  subcategory: s.sub,
  status: s.status,
  severity_score: s.sev ?? subInfo(s.cat, s.sub).severity,
  confidence_score: s.conf,
  description: s.text,
  reported_at: hoursAgo(s.h),
  place_id: s.place ?? null,
  evidence_count: s.evidence ?? 1,
  issue_status: s.issue,
  reporter: s.reporter ?? null,
  corroborations: s.corroborations ?? 0,
  resolved_at: s.resolvedH ? hoursAgo(s.resolvedH) : null,
  ai_confidence: s.aiConf ?? 0.85,
}))

export const PLACE_NAMES: Record<string, string> = Object.fromEntries(PLACES.map((p) => [p.id, p.name]))

/* ------------------------------------------------------------------ hotspots */

function circle(lat: number, lng: number, radius_m: number, steps = 28): GeoJSON.Polygon {
  const k = Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    ring.push([lng + (Math.cos(a) * radius_m) / (111_320 * k), lat + (Math.sin(a) * radius_m) / 110_540])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

const HOTSPOT_SEEDS: [string, string, number, number, number, number, number, Hotspot['trend'], string][] = [
  ['hs-herald', 'Herald Square 34th St Corridor', 40.7499, -73.9884, 170, 0.82, 9, 'rising', 'transit'],
  ['hs-usq', 'Union Square & 14th St', 40.7351, -73.9907, 130, 0.88, 7, 'rising', 'sidewalk'],
  ['hs-fulton', 'Fulton Center & Broadway', 40.7104, -74.0090, 120, 0.79, 6, 'stable', 'transit'],
  ['hs-gct', 'Grand Central & E 42nd St', 40.7529, -73.9795, 190, 0.66, 5, 'stable', 'entrance'],
  ['hs-delancey', 'Delancey St & Essex Crossing', 40.7188, -73.9896, 140, 0.58, 4, 'falling', 'crossing'],
  ['hs-flatiron', 'Flatiron & 23rd St Plaza', 40.7417, -73.9910, 150, 0.71, 5, 'rising', 'sidewalk'],
]

export const HOTSPOTS: Hotspot[] = HOTSPOT_SEEDS.map(([id, label, lat, lng, r, sev, n, trend, cat]) => ({
  id,
  label,
  lat,
  lng,
  radius_m: r,
  area: circle(lat, lng, r),
  severity_index: sev,
  report_count: n,
  dominant_category: cat,
  trend,
  calculated_at: hoursAgo(2),
}))

/* ------------------------------------------------------------------ aggregates */

export const OVERVIEW: Overview = {
  open_reports: REPORTS.filter((r) => r.status === 'open').length, // 42
  critical_open: REPORTS.filter((r) => r.status === 'open' && r.severity_score >= 0.85).length,
  resolved_total: 612,
  reports_last_30d: 318,
  reports_prev_30d: 287,
  median_resolution_hours: 18.4,
  places_total: 918,
  places_with_data: 214,
  high_confidence_open: 29,
  contributors: 167,
}

function mondays(n: number): string[] {
  const d = new Date(NOW)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
  return Array.from({ length: n }, (_, i) => {
    const w = new Date(d)
    w.setDate(d.getDate() - (n - 1 - i) * 7)
    return w.toISOString().slice(0, 10)
  })
}

const REPORTED = [58, 61, 66, 63, 71, 69, 74, 78, 72, 81, 79, 86] // last 4 weeks = 318
const RESOLVED = [41, 44, 47, 52, 49, 55, 58, 57, 61, 64, 66, 69]
const SHARE: [string, number][] = [['transit', 0.21], ['elevator', 0.08], ['sidewalk', 0.29], ['crossing', 0.12], ['ramp', 0.11], ['entrance', 0.1], ['restroom', 0.03], ['wayfinding', 0.03], ['other', 0.03]]

function splitWeek(total: number, w: number): Record<string, number> {
  const out: Record<string, number> = {}
  let used = 0
  SHARE.forEach(([k, s], i) => {
    // A small weekly wobble so the stacks don't look machine-perfect.
    const wobble = ((w * 7 + i * 3) % 5) - 2
    out[k] = Math.max(0, Math.round(total * s) + (k === 'sidewalk' ? 0 : Math.sign(wobble)))
    used += out[k]
  })
  out.sidewalk += total - used
  return out
}

export const TRENDS = (() => {
  const weeks = mondays(12)
  const by_category: Record<string, number[]> = Object.fromEntries(SHARE.map(([k]) => [k, [] as number[]]))
  REPORTED.forEach((t, w) => {
    const s = splitWeek(t, w)
    for (const k of Object.keys(by_category)) by_category[k].push(s[k])
  })
  return { weeks, reported: REPORTED, resolved: RESOLVED, by_category }
})()

export const CATEGORY_STATS = TAXONOMY.categories
  .map((c) => {
    const rs = REPORTS.filter((r) => r.category === c.key)
    const total = TRENDS.by_category[c.key]?.reduce((a, b) => a + b, 0) ?? 0
    return {
      category: c.key,
      label: c.label,
      total,
      open: rs.filter((r) => r.status === 'open').length,
      mean_severity: rs.length ? rs.reduce((a, r) => a + r.severity_score, 0) / rs.length : 0,
    }
  })
  .filter((c) => c.total > 0)
  .sort((a, b) => b.total - a.total)

/** Median hours to repair, by the agency that owns the fix. */
export const AGENCY_RESOLUTION = [
  { agency: 'mta', label: 'MTA Elevators & Escalators', count: 214, median_hours: 11.6, p90_hours: 52 },
  { agency: 'parks', label: 'Parks Dept Ramps', count: 63, median_hours: 26.5, p90_hours: 120 },
  { agency: 'dot', label: 'DOT Curb Cuts & Signals', count: 241, median_hours: 38.2, p90_hours: 190 },
  { agency: 'private', label: 'Private Building Entrances', count: 94, median_hours: 64.0, p90_hours: 310 },
]

export const RESOLUTION = {
  overall_median_hours: 18.4,
  overall_p90_hours: 96,
  by_category: [
    { category: 'transit', label: 'Transit', count: 171, median_hours: 10.9 },
    { category: 'elevator', label: 'Elevator', count: 43, median_hours: 14.5 },
    { category: 'ramp', label: 'Ramp', count: 63, median_hours: 26.5 },
    { category: 'crossing', label: 'Crossing', count: 72, median_hours: 33.0 },
    { category: 'sidewalk', label: 'Sidewalk', count: 169, median_hours: 40.4 },
    { category: 'entrance', label: 'Entrance', count: 94, median_hours: 64.0 },
  ],
  by_agency: AGENCY_RESOLUTION,
}

/* ------------------------------------------------------------------ routing */

/**
 * Midtown and Lower Manhattan avenues run about 29° east of true north. Routes are built
 * in that rotated grid so they follow avenues and cross streets instead of cutting
 * diagonally through blocks.
 */
const GRID = (29 * Math.PI) / 180
const AV: [number, number] = [Math.sin(GRID), Math.cos(GRID)] // along an avenue, uptown
const ST: [number, number] = [Math.cos(GRID), -Math.sin(GRID)] // along a cross street, east side

type LL = { lat: number; lng: number }
type V = [number, number] // [street, avenue] metres in the rotated grid

function project(o: LL, p: LL): V {
  const k = Math.cos((o.lat * Math.PI) / 180)
  const x = (p.lng - o.lng) * 111_320 * k
  const y = (p.lat - o.lat) * 110_540
  return [x * ST[0] + y * ST[1], x * AV[0] + y * AV[1]]
}

function unproject(o: LL, [s, a]: V): [number, number] {
  const k = Math.cos((o.lat * Math.PI) / 180)
  const x = s * ST[0] + a * AV[0]
  const y = s * ST[1] + a * AV[1]
  return [+(o.lng + x / (111_320 * k)).toFixed(6), +(o.lat + y / 110_540).toFixed(6)]
}

const len = (a: V, b: V) => Math.hypot(b[0] - a[0], b[1] - a[1])

export interface RouteBarrier {
  report_id: string
  label: string
  lat: number
  lng: number
  severity: number
  confidence: number
}

const SPEED: Record<Profile, number> = { wheelchair: 62, reduced_effort: 55, low_vision: 66, standard: 80 } // m/min

function compass(from: V, to: V): string {
  // Bearing in true degrees, from grid vector.
  const ds = to[0] - from[0]
  const da = to[1] - from[1]
  const x = ds * ST[0] + da * AV[0]
  const y = ds * ST[1] + da * AV[1]
  const b = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(b / 45) % 8]
}

function legKind(a: V, b: V) {
  return Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? 'avenue' : 'cross street'
}

function round(m: number) {
  return m < 100 ? `${Math.round(m / 5) * 5} m` : `${Math.round(m / 10) * 10} m`
}

function buildOption(
  o: LL,
  pts: V[],
  opts: { label: string; profile: Profile; barriersOn: RouteBarrier[]; barrierLeg: number; barrierAt?: V; avoided: number; stepFree: boolean; explanation: string[] },
): RouteOption {
  const segments: RouteSegment[] = []
  let total = 0
  let prevStart: V | null = null
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const d = len(a, b)
    if (d < 1) continue
    total += d
    const kind = legKind(a, b)
    let instruction: string
    if (!prevStart) instruction = `Head ${compass(a, b)} along the ${kind} for ${round(d)}`
    else {
      const p = prevStart
      const cross = (a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])
      instruction = `Turn ${cross > 0 ? 'left' : 'right'} onto the ${kind}, continue ${round(d)}`
    }
    prevStart = a
    const onBarrier = i === opts.barrierLeg ? opts.barriersOn : []
    if (onBarrier.length) instruction += ` past ${onBarrier[0].label.toLowerCase()}`
    segments.push({
      name: kind,
      length_m: Math.round(d),
      instruction,
      surface: i % 3 === 2 ? 'paving_stones' : 'concrete',
      incline: opts.stepFree ? 0.01 + (i % 3) * 0.008 : 0.012,
      kerb: onBarrier.length ? 'raised' : opts.stepFree ? 'lowered' : i % 2 ? 'lowered' : null,
      has_steps: false,
      unknown_attributes: !opts.stepFree && i % 2 === 1 ? ['kerb', 'width'] : i === pts.length - 2 && !opts.stepFree ? ['surface'] : [],
      barriers: onBarrier.map((x) => ({ report_id: x.report_id, label: x.label, severity: x.severity, confidence: x.confidence })),
      // The barrier is the middle vertex of its segment, which is where the map pins it.
      coords: onBarrier.length && opts.barrierAt ? [unproject(o, a), unproject(o, opts.barrierAt), unproject(o, b)] : [unproject(o, a), unproject(o, b)],
    })
  }
  const coords = segments.flatMap((s, i) => (i === 0 ? s.coords : s.coords.slice(1)))
  const unknown = segments.filter((s) => s.unknown_attributes.length).reduce((a, s) => a + s.length_m, 0) / Math.max(1, total)
  const blocked = opts.barriersOn.length
  return {
    label: opts.label,
    distance_m: Math.round(total),
    duration_min: +(total / SPEED[opts.profile]).toFixed(1),
    cost: Math.round(total * (1 + blocked * 4 + unknown)),
    accessibility_score: blocked ? 0.41 : opts.stepFree ? 0.93 : 0.78,
    unknown_share: +unknown.toFixed(2),
    barriers_avoided: opts.avoided,
    barriers_on_route: blocked,
    explanation: opts.explanation,
    geometry: { type: 'LineString', coordinates: coords },
    segments,
  }
}

/**
 * Builds the pair the route planner compares: the direct grid route and a step-free
 * detour that sidesteps one block around the nearest wheelchair-blocking report.
 */
export function buildRoutePair(from: LL, to: LL, profile: Profile, candidates: RouteBarrier[]): RouteResponse {
  const end = project(from, to)
  // Long leg in the middle: staircase routes look like real walking routes.
  const longAxis = Math.abs(end[1]) >= Math.abs(end[0]) ? 1 : 0
  const shortAxis = 1 - longAxis
  const mk = (shortVal: number, longVal: number): V => (longAxis === 1 ? [shortVal, longVal] : [longVal, shortVal])
  const S = end[shortAxis]
  const L = end[longAxis]
  const lo = Math.min(0, L) + 25
  const hi = Math.max(0, L) - 25

  // Pick the closest candidate that sits along the long leg.
  let barrier: RouteBarrier | null = null
  let mid = S / 2
  let best = Infinity
  for (const c of candidates) {
    const p = project(from, c)
    if (p[longAxis] < lo || p[longAxis] > hi) continue
    // Distance outside the trip's footprint on the short axis; inside counts as 0.
    const outside = Math.max(0, Math.min(0, S) - p[shortAxis], p[shortAxis] - Math.max(0, S))
    if (outside > 110) continue
    const score = outside * 3 + Math.abs(p[shortAxis] - S / 2) * 0.2 + (1 - c.confidence) * 40
    if (score < best) {
      best = score
      barrier = c
      mid = p[shortAxis]
    }
  }

  const direct: V[] = [mk(0, 0), mk(mid, 0), mk(mid, L), mk(S, L)]
  const isStandard = profile === 'standard'

  if (!barrier) {
    const alt: V[] = [mk(0, 0), mk(S, 0), mk(S, L)]
    const main = buildOption(from, direct, { label: isStandard ? 'Shortest walking route' : 'Recommended route', profile, barriersOn: [], barrierLeg: -1, avoided: 0, stepFree: true, explanation: ['No open barrier reports on this route.', 'Curb cuts are mapped at every crossing.'] })
    const other = buildOption(from, alt, { label: 'Fewer crossings', profile, barriersOn: [], barrierLeg: -1, avoided: 0, stepFree: false, explanation: ['Two fewer street crossings.', 'Some segments have no mapped kerb height.'] })
    return { profile, routes: [main, other], warnings: [] }
  }

  const b = project(from, barrier)
  const dir = Math.sign(L) || 1
  const side = Math.sign(S - mid) || 1
  const clampLong = (v: number) => Math.min(Math.max(v, Math.min(0, L)), Math.max(0, L))
  const before = clampLong(b[longAxis] - dir * 60)
  const after = clampLong(b[longAxis] + dir * 60)
  // One block over (about 85 m), past the barrier, then on toward the destination.
  const sidestep = mid + side * 85
  const detour: V[] = [mk(0, 0), mk(mid, 0), mk(mid, before), mk(sidestep, before), mk(sidestep, after), mk(sidestep, L), mk(S, L)]
  const directLegWithBarrier = 1

  const blockedOpt = buildOption(from, direct, {
    label: isStandard ? 'Shortest walking route' : 'Direct route (blocked)',
    profile,
    barriersOn: [barrier],
    barrierLeg: directLegWithBarrier,
    barrierAt: mk(mid, b[longAxis]),
    avoided: 0,
    stepFree: false,
    explanation: [`Passes ${barrier.label.toLowerCase()} (confidence ${Math.round(barrier.confidence * 100)}).`, 'Not passable in a wheelchair until the report is resolved.'],
  })
  const stepFreeOpt = buildOption(from, detour, {
    label: 'Step-free route',
    profile,
    barriersOn: [],
    barrierLeg: -1,
    avoided: 1,
    stepFree: true,
    explanation: [`Goes one block around ${barrier.label.toLowerCase()}.`, 'Every crossing on this route has a lowered curb.', 'Uses the wider sidewalk on the far side of the block.'],
  })
  stepFreeOpt.explanation.unshift(
    `${Math.max(0, stepFreeOpt.distance_m - blockedOpt.distance_m)} m and ${Math.max(0, Math.round(stepFreeOpt.duration_min - blockedOpt.duration_min))} min longer than the direct route.`,
  )
  return {
    profile,
    routes: isStandard ? [blockedOpt, stepFreeOpt] : [stepFreeOpt, blockedOpt],
    warnings: isStandard ? [`The shortest route crosses an open barrier report. Choose “Step-free route” if you need level access.`] : [],
  }
}

/** Barrier candidates for the route builder: open reports that would stop a wheelchair. */
export const ROUTE_BARRIERS: RouteBarrier[] = REPORTS.filter(
  (r) => r.status === 'open' && ['sidewalk', 'ramp', 'entrance', 'crossing'].includes(r.category) && r.severity_score >= 0.6,
).map((r) => ({
  report_id: r.id,
  label: `${subInfo(r.category, r.subcategory).label} at ${r.address?.split(',')[0]}`,
  lat: r.lat,
  lng: r.lng,
  severity: r.severity_score,
  confidence: r.confidence_score,
}))

/** One-click demo trips, each crossing a well-documented barrier. */
export const DEMO_TRIPS: { id: string; label: string; from: LL & { label: string }; to: LL & { label: string } }[] = [
  { id: 'usq', label: 'Union Square, across 14th St', from: { lat: 40.7338, lng: -73.9925, label: 'University Pl & E 13th St' }, to: { lat: 40.7362, lng: -73.9893, label: 'Union Sq E & E 16th St' } },
  { id: 'chelsea', label: '23rd St, around the plated curb cut', from: { lat: 40.7405, lng: -73.9942, label: '6th Ave & W 20th St' }, to: { lat: 40.7452, lng: -73.9908, label: '6th Ave & W 26th St' } },
  { id: 'flatiron', label: 'Flatiron, past the sidewalk shed', from: { lat: 40.7383, lng: -73.9913, label: 'Broadway & E 19th St' }, to: { lat: 40.7431, lng: -73.9878, label: 'Madison Sq Park, E 25th St' } },
]

/** Pre-calculated step-free vs. standard polylines for the demo trips. */
export const PRESET_ROUTES: Record<string, { standard: RouteResponse; wheelchair: RouteResponse }> = Object.fromEntries(
  DEMO_TRIPS.map((t) => [t.id, { standard: buildRoutePair(t.from, t.to, 'standard', ROUTE_BARRIERS), wheelchair: buildRoutePair(t.from, t.to, 'wheelchair', ROUTE_BARRIERS) }]),
)

/* ------------------------------------------------------------------ service area outline */

/** Simplified shoreline of Manhattan below 59th St, used to keep coverage cells on land. */
export const MANHATTAN_OUTLINE: [number, number][] = [
  [-74.0170, 40.7005], [-74.0195, 40.7065], [-74.0145, 40.7200], [-74.0112, 40.7300], [-74.0100, 40.7400],
  [-74.0072, 40.7500], [-74.0025, 40.7600], [-73.9965, 40.7700], [-73.9600, 40.7700], [-73.9600, 40.7620],
  [-73.9680, 40.7520], [-73.9712, 40.7400], [-73.9738, 40.7300], [-73.9752, 40.7200], [-73.9780, 40.7130],
  [-73.9950, 40.7080], [-74.0020, 40.7060], [-74.0085, 40.7020], [-74.0170, 40.7005],
]
