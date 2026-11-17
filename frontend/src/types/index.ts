export type Role = 'user' | 'infrastructure_manager' | 'admin'

export interface User {
  id: string
  email: string
  display_name: string
  role: Role
  created_at: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface Subcategory {
  key: string
  label: string
  severity: number
  blocks_wheelchair: boolean
}

export interface Category {
  key: string
  label: string
  subcategories: Subcategory[]
}

export interface Taxonomy {
  categories: Category[]
  features: { key: string; label: string }[]
  issue_statuses: string[]
  service_area: { min_lat: number; max_lat: number; min_lng: number; max_lng: number }
}

export interface Classification {
  category: string
  subcategory: string
  severity: number
  summary: string
  detected_features: string[]
  confidence: number
  /** Which tier produced the result. Always shown next to the reading. */
  source: AISource
  model: string | null
  images_reviewed?: boolean
  /** Why a higher tier didn't answer, e.g. "Gemini quota or rate limit reached". */
  fallback_reason?: string | null
}

export type AISource = 'gemini' | 'groq' | 'nebius' | 'heuristic'
export type CloudProvider = 'gemini' | 'groq' | 'nebius'

export interface AITier {
  provider: AISource
  label: string
  available: boolean
  model: string | null
  base_url: string | null
  vision: boolean
}

export interface AIStatus {
  available: boolean
  provider?: AISource
  label?: string
  model: string | null
  vision?: boolean
  fallback_enabled: boolean
  mode?: 'cloud' | 'none'
  tiers?: AITier[]
  byok?: { enabled: boolean; providers: CloudProvider[] }
  /** Server tier only. Describing a route and translating a draft use this tier, or a user's own key. */
  text_ai?: TextAIStatus
}

export interface TextAIStatus {
  available: boolean
  tier: CloudProvider | null
  rate_limit_per_minute: number
}

/* ------------------------------------------------------------------ describe a route in plain words (AI) */

/** The planned route, plus the explanation a cloud model wrote. The route is the router's output. */
export interface DescribeReply {
  answer: string
  /** Null when no model wrote the explanation. The route summary is then the router's own text. */
  source: CloudProvider | null
  model: string | null
  route: RoutePlanResult
}

export type AvoidFeature = 'reported_barriers' | 'construction' | 'unknown_data' | 'stairs' | 'steep_slopes' | 'rough_surfaces'

/** A route request as the model extracted it. Place names only, never coordinates. */
export interface RouteIntent {
  profile: Profile
  start: string
  end: string
  avoid_features: AvoidFeature[]
  max_detour_pct: number | null
  /** A fraction: 0.05 means 5 %. */
  max_incline: number | null
}

export interface RoutePlace {
  id: string
  name: string
  lat: number
  lng: number
}

export interface RoutePlanResult {
  status: 'planned' | 'place_not_found' | 'no_route'
  intent: RouteIntent
  start: RoutePlace | null
  end: RoutePlace | null
  route: RouteOption | null
  /** Outcome of each limit the user set, plus routing warnings. */
  notes: string[]
  /** Avoid features this profile does not enforce. */
  unsupported: string[]
  message: string
}

export interface Evidence {
  id: string
  type: 'photo' | 'voice' | 'text'
  url: string | null
  mime_type: string | null
  transcription: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface ReportSummary {
  id: string
  lat: number
  lng: number
  address: string | null
  category: string
  subcategory: string
  status: 'open' | 'duplicate' | 'resolved' | 'rejected'
  severity_score: number
  confidence_score: number
  description: string
  reported_at: string
  place_id: string | null
  evidence_count: number
  issue_status: IssueStatus | null
}

export interface ConfidenceBreakdown {
  score: number
  factors: Record<'evidence' | 'corroboration' | 'recency' | 'credibility', { value: number; weight: number }>
  explanation: string[]
  corroborating_ids: string[]
  computed_at: string
}

export interface ReportDetail extends ReportSummary {
  confidence_breakdown: ConfidenceBreakdown
  ai_analysis: Classification | null
  user_confirmed: boolean
  duplicate_of: string | null
  resolved_at: string | null
  reporter: string | null
  evidence: Evidence[]
  corroborating: ReportSummary[]
  place_name: string | null
}

export interface ReportPage {
  items: ReportSummary[]
  total: number
  next_offset: number | null
}

export interface DuplicateCandidate {
  report: ReportSummary
  distance_m: number
  text_similarity: number
  category_match: boolean
  score: number
}

export type FeatureStatus = 'available' | 'limited' | 'unavailable' | 'unknown'
export type Verification = 'verified' | 'partially_verified' | 'unverified' | 'disputed'

export interface PlaceFeature {
  id: string
  feature_type: string
  label: string
  status: FeatureStatus
  source: 'osm' | 'report' | 'manager'
  source_report_id: string | null
  confidence: number
  notes: string | null
  assessed_at: string
}

export interface PlaceSummary {
  id: string
  name: string
  place_type: string
  lat: number
  lng: number
  address: string | null
  verification_status: Verification
  last_verified: string | null
  open_reports: number
  feature_status: Record<string, FeatureStatus>
}

export interface TimelineEntry {
  at: string
  kind: 'feature' | 'report' | 'resolved' | 'issue'
  title: string
  detail: string | null
  report_id: string | null
}

export interface PlaceDetail extends PlaceSummary {
  osm_id: string | null
  features: PlaceFeature[]
  reports: ReportSummary[]
  timeline: TimelineEntry[]
}

export type Profile = 'wheelchair' | 'reduced_effort' | 'low_vision' | 'standard'

export interface RouteSegment {
  name: string
  length_m: number
  instruction: string
  surface: string | null
  incline: number | null
  kerb: string | null
  has_steps: boolean
  unknown_attributes: string[]
  barriers: { report_id: string; label: string; severity: number; confidence: number }[]
  coords: [number, number][]
}

export interface RouteRiskEdge {
  street: string
  risk: number
  breakdown: { hotspots: number; open_issues: number; mean_confidence: number; time_multiplier: number; risk: number }
}

/** Set when the route was planned with prefer_reliable. Scores come from services/intelligence/risk.py. */
export interface RouteRisk {
  enabled: boolean
  threshold: number
  high_risk_avoided: number
  avoided_streets: string[]
  extra_m: number
  summary: string
  formula: string
  on_route: RouteRiskEdge[]
}

export interface RouteOption {
  label: string
  distance_m: number
  duration_min: number
  cost: number
  accessibility_score: number
  unknown_share: number
  barriers_avoided: number
  barriers_on_route: number
  explanation: string[]
  geometry: GeoJSON.LineString
  segments: RouteSegment[]
  risk?: RouteRisk | null
}

export interface RouteResponse {
  profile: Profile
  routes: RouteOption[]
  warnings: string[]
}

export type IssueStatus =
  | 'reported'
  | 'under_review'
  | 'confirmed'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'reverification'

export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface Issue {
  id: string
  status: IssueStatus
  priority: Priority
  assigned_to: string | null
  assignee_name: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  report: ReportSummary
}

export interface IssueHistory {
  id: string
  old_status: string | null
  new_status: string
  notes: string | null
  changed_at: string
  actor_name: string | null
}

export interface IssueDetail extends Issue {
  history: IssueHistory[]
  report_detail: ReportDetail
  allowed_transitions: IssueStatus[]
}

export interface Hotspot {
  id: string
  lat: number
  lng: number
  radius_m: number
  area: GeoJSON.Polygon
  severity_index: number
  report_count: number
  dominant_category: string
  trend: 'rising' | 'stable' | 'falling'
  calculated_at: string
  label: string | null
}

export interface Overview {
  open_reports: number
  critical_open: number
  resolved_total: number
  reports_last_30d: number
  reports_prev_30d: number
  median_resolution_hours: number | null
  places_total: number
  places_with_data: number
  high_confidence_open: number
  contributors: number
}

export interface GeocodeResult {
  label: string
  lat: number
  lng: number
}

/* ------------------------------------------------------------------ accessible rides (AI-3) */

export interface RideOption {
  id: string
  name: string
  kind: 'taxi' | 'paratransit'
  /** Formatted for people, e.g. 877-337-2017. */
  phone: string | null
  /** For tel: links, e.g. +18773372017. */
  tel: string | null
  url: string | null
  notes: string
  source_url: string
}

export interface RideDraftRequest {
  pickup: string
  dropoff: string
  barrier: string
  passengers?: number
}

export interface DispatcherDraft {
  text: string
  source: 'template'
  preview: true
  label: string
}

/* ------------------------------------------------------------------ route alerts (AI-4) */

export interface AlertCorridor {
  id: string
  name: string
  origin: [number, number]
  destination: [number, number]
  profile: Profile
  notify_reports: boolean
  notify_outages: boolean
  notify_route_changes: boolean
  last_checked_at: string | null
  created_at: string
}

export interface AlertCorridorInput {
  name: string
  origin: [number, number]
  destination: [number, number]
  profile?: Profile
  notify_reports?: boolean
  notify_outages?: boolean
  notify_route_changes?: boolean
}

export interface AlertPreferences {
  notify_reports?: boolean
  notify_outages?: boolean
  notify_route_changes?: boolean
}

export interface AlertPushStatus {
  /** The server has VAPID keys, so it can send push. */
  enabled: boolean
  public_key: string | null
}

export type AlertKind = 'report' | 'outage' | 'route_change' | 'reverify' | 'nearby_report' | 'nearby_outage'

export interface InboxItem {
  id: string
  kind: AlertKind
  title: string
  body: string
  corridor_id: string | null
  corridor_name: string | null
  created_at: string
  read: boolean
}

export interface Inbox {
  unread: number
  items: InboxItem[]
}

/* ------------------------------------------------------------------ preflight brief (AI-5) */

export type PreflightStatus = 'good' | 'caution' | 'blocked'

/** Rules-based status for a place. Reasons carry their citation tags, e.g. "[R1] Open report: ...". */
export interface PreflightSource {
  tag: string
  kind: 'report' | 'place'
  label: string
  url: string
}

export interface PreflightBrief {
  place_id: string
  place_name: string
  status: PreflightStatus
  status_label: string
  reasons: string[]
  summary: string
  source: 'rules'
  sources: PreflightSource[]
  screen_reader: string
}

/* ------------------------------------------------------------------ multilingual reporting (AI-6) */

export interface TranslateReply {
  original: string
  translation: string
  target: string
  source: CloudProvider
  model: string | null
  /** Shown beside the translation: a draft to review before filing. */
  label: string
}

/** A translation the reporter reviewed and chose to file. The original text is kept with the report. */
export interface TranslationRecord {
  language: string
  original: string
  source: string
  model: string | null
  reviewed: true
}

/* ------------------------------------------------------------------ alerts near me (no AI) */

export type NearbyRadius = 100 | 250 | 500

/** One open barrier or one out-of-service feature near a point. Labels are never report text. */
export interface NearbyItem {
  id: string
  kind: 'barrier' | 'outage'
  label: string
  place_name: string | null
  distance_m: number
  url: string
  when: string | null
}

export interface NearbyOut {
  radius_m: number
  checked_at: string
  barriers: NearbyItem[]
  outages: NearbyItem[]
}

export interface NearbySettings {
  enabled: boolean
  radius_m: number
  has_location: boolean
  location_expires_at: string | null
}
