const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function distance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

export function minutes(min: number): string {
  if (min < 1) return 'under a minute'
  if (min < 60) return `${Math.round(min)} min`
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`
}

export function hours(h: number | null | undefined): string {
  if (h == null) return 'n/a'
  if (h < 48) return `${Math.round(h)} h`
  return `${(h / 24).toFixed(1)} days`
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`

export function humanize(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const ISSUE_STATUS_LABEL: Record<string, string> = {
  reported: 'Reported',
  under_review: 'Under review',
  confirmed: 'Confirmed',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  reverification: 'Reverification',
}

export const PROFILE_LABEL: Record<string, string> = {
  wheelchair: 'Wheelchair',
  power_wheelchair: 'Power wheelchair',
  reduced_effort: 'Reduced effort',
  low_vision: 'Low vision',
  mobility_aid: 'Mobility aid',
  stroller: 'Stroller / luggage',
  standard: 'Standard walking',
}

export const VERIFICATION_LABEL: Record<string, string> = {
  verified: 'Verified',
  partially_verified: 'Partly verified',
  unverified: 'No community data',
  disputed: 'Reported problem',
}

export const PLACE_TYPE_LABEL: Record<string, string> = {
  transit_station: 'Transit station',
  hospital: 'Hospital',
  clinic: 'Clinic',
  library: 'Library',
  museum: 'Museum',
  gallery: 'Gallery',
  park: 'Park',
  theatre: 'Theatre',
  pharmacy: 'Pharmacy',
  attraction: 'Attraction',
  university: 'University',
  community_centre: 'Community centre',
  post_office: 'Post office',
  townhall: 'Civic building',
  courthouse: 'Courthouse',
  place: 'Street location',
}

export function severityBand(s: number): 'critical' | 'high' | 'medium' | 'low' {
  if (s >= 0.85) return 'critical'
  if (s >= 0.65) return 'high'
  if (s >= 0.4) return 'medium'
  return 'low'
}

export function confidenceWord(c: number): string {
  if (c >= 0.7) return 'High confidence'
  if (c >= 0.45) return 'Moderate confidence'
  return 'Low confidence'
}
