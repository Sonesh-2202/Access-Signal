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
  source: 'lmstudio' | 'heuristic'
  model: string | null
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
