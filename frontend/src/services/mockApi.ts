/**
 * In-browser implementation of the read-only API, backed by `data/mockManhattanData`.
 * Each function mirrors the query semantics of the matching FastAPI endpoint closely
 * enough for the public pages (filters, sort, paging, bbox).
 */
import {
  CATEGORY_STATS,
  HOTSPOTS,
  hoursAgo,
  MANHATTAN_OUTLINE,
  OVERVIEW,
  PLACE_NAMES,
  PLACES,
  REPORTS,
  RESOLUTION,
  ROUTE_BARRIERS,
  TAXONOMY,
  TRENDS,
  buildRoutePair,
  subInfo,
  type MockReport,
} from '@/data/mockManhattanData'
import type { AIStatus, Evidence, PlaceDetail, PlaceFeature, Profile, ReportDetail, ReportPage, ReportSummary, RouteResponse, TimelineEntry } from '@/types'

type Query = Record<string, string | number | boolean | string[] | undefined | null>

const list = (v: Query[string]): string[] => (v == null || v === '' ? [] : Array.isArray(v) ? v : [String(v)])

/** Session-local confirmations from the "still broken / fixed" buttons. */
const votes = new Map<string, { still: number; fixed: number }>()

function summary(r: MockReport): ReportSummary {
  return {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    category: r.category,
    subcategory: r.subcategory,
    status: r.status,
    severity_score: r.severity_score,
    confidence_score: r.confidence_score,
    description: r.description,
    reported_at: r.reported_at,
    place_id: r.place_id,
    evidence_count: r.evidence_count,
    issue_status: r.issue_status,
  }
}

/* ------------------------------------------------------------------ reports */

export function reports(q: Query = {}): ReportPage {
  const statuses = list(q.status)
  const cats = list(q.category)
  const text = String(q.q ?? '').trim().toLowerCase()
  const bbox = q.bbox ? String(q.bbox).split(',').map(Number) : null
  let rows = REPORTS.filter((r) => {
    if (statuses.length && !statuses.includes(r.status)) return false
    if (cats.length && !cats.includes(r.category)) return false
    if (bbox && (r.lng < bbox[0] || r.lat < bbox[1] || r.lng > bbox[2] || r.lat > bbox[3])) return false
    if (text && !`${r.description} ${r.address} ${subInfo(r.category, r.subcategory).label}`.toLowerCase().includes(text)) return false
    return true
  })
  const sort = String(q.sort ?? 'recent')
  rows = [...rows].sort((a, b) =>
    sort === 'severity'
      ? b.severity_score - a.severity_score || b.confidence_score - a.confidence_score
      : sort === 'confidence'
        ? b.confidence_score - a.confidence_score
        : b.reported_at.localeCompare(a.reported_at),
  )
  const offset = Number(q.offset ?? 0)
  const limit = Number(q.limit ?? 20)
  const page = rows.slice(offset, offset + limit)
  return { items: page.map(summary), total: rows.length, next_offset: offset + limit < rows.length ? offset + limit : null }
}

export function reportsGeoJSON(q: Query = {}): GeoJSON.FeatureCollection {
  const cats = list(q.category)
  const withResolved = q.include_resolved === true || q.include_resolved === 'true'
  return {
    type: 'FeatureCollection',
    features: REPORTS.filter((r) => (withResolved || r.status === 'open') && (!cats.length || cats.includes(r.category))).map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        label: subInfo(r.category, r.subcategory).label,
        address: r.address,
        category: r.category,
        severity: r.severity_score,
        confidence: r.confidence_score,
        status: r.status,
        issue_status: r.issue_status,
      },
    })),
  }
}

const FOLLOW_UPS = [
  'Still the same this morning.',
  'Confirmed, came past on the way to work.',
  'Same problem, took a photo.',
  'Still there. Had to go around through the street.',
  'Checked again at lunch, no change.',
]

function corroborating(r: MockReport): ReportSummary[] {
  const n = Math.min(r.corroborations, 5)
  return Array.from({ length: n }, (_, i) => ({
    ...summary(r),
    id: `${r.id}-c${i + 1}`,
    status: 'duplicate' as const,
    description: FOLLOW_UPS[i % FOLLOW_UPS.length],
    reported_at: new Date(new Date(r.reported_at).getTime() + (i + 1) * 2.5 * 3_600_000).toISOString(),
    confidence_score: Math.max(0.2, r.confidence_score - 0.2),
    evidence_count: i % 2,
    issue_status: null,
  }))
}

function breakdown(r: MockReport, still: number): ReportDetail['confidence_breakdown'] {
  const hours = (Date.now() - new Date(r.reported_at).getTime()) / 3_600_000
  const evidence = Math.min(1, 0.3 + 0.25 * r.evidence_count)
  const corro = Math.min(1, (r.corroborations + still) * 0.22)
  const recency = Math.max(0.1, 1 - hours / 240)
  const cred = Math.min(1, Math.max(0.2, (r.confidence_score - 0.35 * evidence - 0.3 * corro - 0.2 * recency) / 0.15))
  const n = r.corroborations + still
  return {
    score: Math.min(0.99, r.confidence_score + still * 0.02),
    factors: {
      evidence: { value: +evidence.toFixed(2), weight: 0.35 },
      corroboration: { value: +corro.toFixed(2), weight: 0.3 },
      recency: { value: +recency.toFixed(2), weight: 0.2 },
      credibility: { value: +cred.toFixed(2), weight: 0.15 },
    },
    explanation: [
      r.evidence_count ? `${r.evidence_count} evidence item${r.evidence_count > 1 ? 's' : ''} attached, including a description the model could classify.` : 'Text description only. A photo would raise this the most.',
      n ? `${n} independent report${n > 1 ? 's' : ''} within 50 m in the last 30 days.` : 'No one else has reported this yet.',
      hours < 24 ? 'Reported in the last day.' : `Reported ${Math.round(hours / 24)} day${hours >= 48 ? 's' : ''} ago; older reports count for less.`,
      cred > 0.7 ? 'Reporter’s earlier reports were confirmed by staff.' : 'Reporter has few confirmed reports so far.',
    ],
    corroborating_ids: corroborating(r).map((c) => c.id),
    computed_at: hoursAgo(0.3),
  }
}

function evidence(r: MockReport): Evidence[] {
  const out: Evidence[] = []
  if (r.evidence_count >= 2) {
    out.push({ id: `${r.id}-ev-voice`, type: 'voice', url: null, mime_type: null, transcription: r.description.split('. ')[0] + '.', meta: {}, created_at: r.reported_at })
  }
  return out
}

export function report(id: string): ReportDetail {
  const parentId = id.replace(/-c\d+$/, '')
  const base = REPORTS.find((r) => r.id === parentId)
  if (!base) throw Object.assign(new Error('Report not found'), { status: 404 })
  const still = votes.get(base.id)?.still ?? 0
  const s = subInfo(base.category, base.subcategory)
  const detail: ReportDetail = {
    ...summary(base),
    confidence_breakdown: breakdown(base, still),
    ai_analysis: {
      category: base.category,
      subcategory: base.subcategory,
      severity: base.severity_score,
      summary: `${s.label} at ${base.address?.split(',')[0]}. ${s.blocks_wheelchair ? 'Likely impassable for wheelchair users.' : 'Passable with difficulty for most users.'}`,
      detected_features: [base.category, base.subcategory],
      confidence: base.ai_confidence,
      source: 'lmstudio',
      model: 'gemma-3-4b-it (local)',
    },
    user_confirmed: true,
    duplicate_of: null,
    resolved_at: base.resolved_at,
    reporter: base.reporter,
    evidence: evidence(base),
    corroborating: corroborating(base),
    place_name: base.place_id ? PLACE_NAMES[base.place_id] ?? null : null,
  }
  if (id !== parentId) {
    const c = detail.corroborating.find((x) => x.id === id)!
    return { ...detail, ...c, duplicate_of: base.id, corroborating: [], evidence: [], reporter: null }
  }
  return detail
}

export function verifyReport(id: string, stillPresent: boolean): ReportDetail {
  const v = votes.get(id) ?? { still: 0, fixed: 0 }
  if (stillPresent) v.still += 1
  else v.fixed += 1
  votes.set(id, v)
  return report(id)
}

/* ------------------------------------------------------------------ places */

export function places(q: Query = {}) {
  const types = list(q.type)
  const verif = list(q.verification)
  const feature = q.feature ? String(q.feature) : ''
  const text = String(q.q ?? '').trim().toLowerCase()
  const withIssues = q.with_issues === true || q.with_issues === 'true'
  return PLACES.filter(
    (p) =>
      (!types.length || types.includes(p.place_type)) &&
      (!verif.length || verif.includes(p.verification_status)) &&
      (!feature || p.feature_status[feature] === 'available') &&
      (!withIssues || p.open_reports > 0) &&
      (!text || `${p.name} ${p.address}`.toLowerCase().includes(text)),
  )
    .sort((a, b) => b.open_reports - a.open_reports || a.name.localeCompare(b.name))
    .slice(0, Number(q.limit ?? 120))
}

export function placeTypes() {
  const counts = new Map<string, number>()
  PLACES.forEach((p) => counts.set(p.place_type, (counts.get(p.place_type) ?? 0) + 1))
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
}

export function place(id: string): PlaceDetail {
  const p = PLACES.find((x) => x.id === id)
  if (!p) throw Object.assign(new Error('Place not found'), { status: 404 })
  const rs = REPORTS.filter((r) => r.place_id === id)
  const features: PlaceFeature[] = Object.entries(p.feature_status).map(([k, status]) => {
    const fromReport = rs.find((r) => r.status === 'open' && status !== 'available')
    return {
      id: `${id}-${k}`,
      feature_type: k,
      label: TAXONOMY.features.find((f) => f.key === k)?.label ?? k,
      status,
      source: fromReport ? 'report' : 'osm',
      source_report_id: fromReport?.id ?? null,
      confidence: fromReport ? fromReport.confidence_score : 0.6,
      notes: null,
      assessed_at: fromReport?.reported_at ?? p.last_verified ?? hoursAgo(24 * 40),
    }
  })
  const timeline: TimelineEntry[] = rs
    .flatMap((r): TimelineEntry[] => {
      const label = subInfo(r.category, r.subcategory).label
      const items: TimelineEntry[] = [{ at: r.reported_at, kind: 'report', title: label, detail: r.description, report_id: r.id }]
      if (r.resolved_at) items.push({ at: r.resolved_at, kind: 'resolved', title: `${label} resolved`, detail: 'Marked fixed by the responsible agency.', report_id: r.id })
      return items
    })
    .concat([{ at: hoursAgo(24 * 60), kind: 'feature', title: 'Imported from OpenStreetMap', detail: 'Entrance and elevator tags.', report_id: null }])
    .sort((a, b) => b.at.localeCompare(a.at))
  return { ...p, osm_id: `node/${4_200_000_000 + id.length * 7919}`, features, reports: rs.map(summary), timeline }
}

/* ------------------------------------------------------------------ routing */

export function route(origin: [number, number], destination: [number, number], profile: Profile, avoidUnknown: boolean): RouteResponse {
  const res = buildRoutePair({ lat: origin[0], lng: origin[1] }, { lat: destination[0], lng: destination[1] }, profile, ROUTE_BARRIERS)
  if (avoidUnknown) res.routes.sort((a, b) => a.unknown_share - b.unknown_share || a.barriers_on_route - b.barriers_on_route)
  return res
}

/* ------------------------------------------------------------------ analytics */

export const overview = () => OVERVIEW
export const trends = () => TRENDS
export const categories = () => CATEGORY_STATS
export const resolution = () => RESOLUTION
export const hotspots = () => HOTSPOTS
export const taxonomy = () => TAXONOMY
export const aiStatus = (): AIStatus => ({
  available: true,
  provider: 'lmstudio',
  label: 'LM Studio',
  model: 'gemma-3-4b-it (local)',
  fallback_enabled: true,
})

export function heat(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: REPORTS.filter((r) => r.status === 'open').map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { weight: +(r.severity_score * r.confidence_score).toFixed(3) },
    })),
  }
}

function inside([x, y]: [number, number], poly: [number, number][]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

let coverageCache: (GeoJSON.FeatureCollection & { summary: { cells: number; cells_without_data: number } }) | null = null

/** ~250 m cells over land, levelled by how many reports and places fall inside. */
export function coverage() {
  if (coverageCache) return coverageCache
  const dLat = 0.00225
  const dLng = 0.003
  const points = [...REPORTS.map((r) => [r.lng, r.lat]), ...PLACES.map((p) => [p.lng, p.lat])]
  const features: GeoJSON.Feature[] = []
  let empty = 0
  for (let lat = 40.7; lat < 40.77; lat += dLat) {
    for (let lng = -74.02; lng < -73.96; lng += dLng) {
      const c: [number, number] = [lng + dLng / 2, lat + dLat / 2]
      if (!inside(c, MANHATTAN_OUTLINE)) continue
      const n = points.filter(([x, y]) => x >= lng && x < lng + dLng && y >= lat && y < lat + dLat).length
      const level = n === 0 ? 'none' : n === 1 ? 'low' : 'ok'
      if (level === 'none') empty++
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]]] },
        properties: { level, count: n },
      })
    }
  }
  coverageCache = { type: 'FeatureCollection', features, summary: { cells: features.length, cells_without_data: empty } }
  return coverageCache
}
