import { isDemo, markDemo, markLive, useDataSource } from '@/stores/dataSource'
import { readRefreshToken, useAuth } from '@/stores/auth'
import * as local from './mockApi'
import type {
  Classification,
  DuplicateCandidate,
  Evidence,
  GeocodeResult,
  Hotspot,
  Issue,
  IssueDetail,
  Overview,
  PlaceDetail,
  PlaceSummary,
  Profile,
  ReportDetail,
  ReportPage,
  RouteResponse,
  Taxonomy,
  TokenPair,
  User,
} from '@/types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

export interface Resolution {
  overall_median_hours: number | null
  overall_p90_hours: number | null
  by_category: { category: string; label: string; count: number; median_hours: number }[]
  /** Present in the local dataset; derived from categories when the live API omits it. */
  by_agency?: { agency: string; label: string; count: number; median_hours: number; p90_hours?: number }[]
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** True when the error body came from the API itself (JSON), not a proxy or static host. */
    public fromApi = true,
  ) {
    super(message)
  }
}

/* ------------------------------------------------------------------ demo fallback */

/** A hung connection counts as an outage after this long. Fast failures fall back at once. */
const LIVE_TIMEOUT_MS = 8000

function isOutage(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500 || (!e.fromApi && e.status >= 400 && e.status !== 401 && e.status !== 403)
  const name = (e as Error | undefined)?.name
  // TypeError: fetch could not connect. SyntaxError: a 200 that wasn't JSON (e.g. an SPA host's index.html).
  return e instanceof TypeError || e instanceof SyntaxError || name === 'TimeoutError'
}

/**
 * Runs the live request; if the API is down (network error, 5xx, non-API response or
 * timeout) answers from the local Manhattan dataset instead and flips the session into
 * demo mode. Client errors such as 404 or 422 are real answers and are rethrown.
 */
async function withFallback<T>(live: () => Promise<T>, local: () => T, label: string): Promise<T> {
  const fromLocal = () => {
    try {
      return local()
    } catch (e) {
      throw new ApiError((e as { status?: number }).status ?? 500, (e as Error).message)
    }
  }
  if (isDemo()) return fromLocal()
  // Until the first request settles, later ones wait for it (at most 300 ms), so an outage
  // costs one failed request instead of one per component.
  if (useDataSource.getState().mode === 'unknown') {
    if (firstProbe) {
      await Promise.race([firstProbe, new Promise((r) => setTimeout(r, 300))])
      if (isDemo()) return fromLocal()
    } else {
      let settle!: () => void
      firstProbe = new Promise<void>((r) => (settle = r))
      try {
        return await runLive(live, fromLocal, label)
      } finally {
        settle()
      }
    }
  }
  return runLive(live, fromLocal, label)
}

let firstProbe: Promise<void> | null = null

/** Test hook: forget the outcome of the first request. */
export function resetDataSourceProbe() {
  firstProbe = null
}

async function runLive<T>(live: () => Promise<T>, fromLocal: () => T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })), LIVE_TIMEOUT_MS)
    })
    const value = await Promise.race([live(), timeout])
    markLive()
    return value
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || !isOutage(e)) throw e
    markDemo(`${label}: ${(e as Error).message || 'unreachable'}`)
    return fromLocal()
  } finally {
    clearTimeout(timer)
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>

function qs(q?: Query): string {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x))
    else p.append(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function parseError(res: Response): Promise<ApiError> {
  let msg = res.statusText || 'Request failed'
  if (!(res.headers.get('content-type') ?? '').includes('json')) return new ApiError(res.status, msg, false)
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') msg = body.detail
    else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
      msg = body.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('. ')
    }
  } catch {
    /* non-JSON error */
  }
  return new ApiError(res.status, msg)
}

let refreshing: Promise<boolean> | null = null

export async function refreshSession(): Promise<boolean> {
  const stored = readRefreshToken()
  if (!stored) return false
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: stored.token }),
      })
      if (!res.ok) {
        useAuth.getState().clear()
        return false
      }
      useAuth.getState().setSession((await res.json()) as TokenPair, stored.persist)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData; signal?: AbortSignal } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {}
  const token = useAuth.getState().accessToken
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`${BASE}${path}${qs(opts.query)}`, { method, headers, body, signal: opts.signal })
  if (res.status === 401 && retry && readRefreshToken()) {
    if (await refreshSession()) return request<T>(method, path, opts, false)
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  // auth
  login: (email: string, password: string) => request<TokenPair>('POST', '/api/auth/login', { body: { email, password } }),
  register: (email: string, password: string, display_name: string) =>
    request<TokenPair>('POST', '/api/auth/register', { body: { email, password, display_name } }),
  logout: (refresh_token: string) => request<void>('POST', '/api/auth/logout', { body: { refresh_token } }),
  me: () => request<User>('GET', '/api/auth/me'),

  // meta
  taxonomy: () => withFallback(() => request<Taxonomy>('GET', '/api/meta/taxonomy'), local.taxonomy, 'taxonomy'),
  aiStatus: () =>
    withFallback(() => request<{ available: boolean; model: string | null; fallback_enabled: boolean }>('GET', '/api/meta/ai-status'), local.aiStatus, 'ai-status'),

  // evidence
  uploadEvidence: (file: Blob, filename: string, extra: { transcription?: string; alt_text?: string } = {}) => {
    const fd = new FormData()
    fd.append('file', file, filename)
    if (extra.transcription) fd.append('transcription', extra.transcription)
    if (extra.alt_text) fd.append('alt_text', extra.alt_text)
    return request<Evidence>('POST', '/api/evidence', { form: fd })
  },

  // reports
  classify: (description: string, evidence_ids: string[]) =>
    request<Classification>('POST', '/api/reports/classify', { body: { description, evidence_ids } }),
  duplicates: (body: { lat: number; lng: number; category: string; subcategory: string; description: string }) =>
    request<DuplicateCandidate[]>('POST', '/api/reports/duplicates', { body }),
  createReport: (body: unknown) => request<ReportDetail>('POST', '/api/reports', { body }),
  reports: (query: Query, signal?: AbortSignal) =>
    withFallback(() => request<ReportPage>('GET', '/api/reports', { query, signal }), () => local.reports(query), 'reports'),
  reportsGeoJSON: (query: Query) =>
    withFallback(() => request<GeoJSON.FeatureCollection>('GET', '/api/reports/geojson', { query }), () => local.reportsGeoJSON(query), 'reports'),
  report: (id: string) => withFallback(() => request<ReportDetail>('GET', `/api/reports/${id}`), () => local.report(id), 'report'),
  verifyReport: (id: string, still_present: boolean, note?: string) =>
    withFallback(
      () => request<ReportDetail>('POST', `/api/reports/${id}/verify`, { body: { still_present, note } }),
      () => local.verifyReport(id, still_present),
      'verify',
    ),
  deleteReport: (id: string) => request<void>('DELETE', `/api/reports/${id}`),

  // places
  places: (query: Query, signal?: AbortSignal) =>
    withFallback(() => request<PlaceSummary[]>('GET', '/api/places', { query, signal }), () => local.places(query), 'places'),
  placeTypes: () => withFallback(() => request<{ type: string; count: number }[]>('GET', '/api/places/types'), local.placeTypes, 'places'),
  place: (id: string) => withFallback(() => request<PlaceDetail>('GET', `/api/places/${id}`), () => local.place(id), 'place'),

  // routing
  route: (origin: [number, number], destination: [number, number], profile: Profile, avoid_unknown: boolean) =>
    withFallback(
      () => request<RouteResponse>('POST', '/api/routing/route', { body: { origin, destination, profile, avoid_unknown, alternatives: 2 } }),
      () => local.route(origin, destination, profile, avoid_unknown),
      'routing',
    ),

  // issues
  issues: (query: Query) => request<{ items: Issue[]; total: number }>('GET', '/api/issues', { query }),
  issue: (id: string) => request<IssueDetail>('GET', `/api/issues/${id}`),
  updateIssue: (id: string, body: Record<string, unknown>) => request<IssueDetail>('PATCH', `/api/issues/${id}`, { body }),
  assignees: () => request<{ id: string; display_name: string; role: string }[]>('GET', '/api/issues/assignees'),
  issueStats: () => request<{ by_status: Record<string, number>; open_by_priority: Record<string, number> }>('GET', '/api/issues/stats'),
  exportIssues: async (format: 'csv' | 'json') => {
    const token = useAuth.getState().accessToken
    const res = await fetch(`${BASE}/api/issues/export${qs({ format })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw await parseError(res)
    return res.blob()
  },

  // analytics
  overview: () => withFallback(() => request<Overview>('GET', '/api/analytics/overview'), local.overview, 'analytics'),
  trends: (weeks = 12) =>
    withFallback(
      () => request<{ weeks: string[]; reported: number[]; resolved: number[]; by_category: Record<string, number[]> }>('GET', '/api/analytics/trends', { query: { weeks } }),
      local.trends,
      'analytics',
    ),
  categories: () =>
    withFallback(
      () => request<{ category: string; label: string; total: number; open: number; mean_severity: number }[]>('GET', '/api/analytics/categories'),
      local.categories,
      'analytics',
    ),
  resolution: () => withFallback(() => request<Resolution>('GET', '/api/analytics/resolution'), local.resolution, 'analytics'),
  heat: () => withFallback(() => request<GeoJSON.FeatureCollection>('GET', '/api/analytics/heat'), local.heat, 'analytics'),
  coverage: () =>
    withFallback(
      () => request<GeoJSON.FeatureCollection & { summary: { cells: number; cells_without_data: number } }>('GET', '/api/analytics/coverage'),
      local.coverage,
      'analytics',
    ),
  hotspots: () => withFallback(() => request<Hotspot[]>('GET', '/api/analytics/hotspots'), local.hotspots, 'analytics'),
  recalcHotspots: () => request<Hotspot[]>('POST', '/api/analytics/hotspots/recalculate'),

  // agents
  agents: () => request<{ agents: Record<string, { title: string; needs_report: boolean; tools: string[] }>; tools: Record<string, { description: string }> }>('GET', '/api/agents'),
  runAgent: (agent: string, body: { report_id?: string; apply?: boolean; days?: number }) =>
    request<Record<string, unknown>>('POST', `/api/agents/${agent}/run`, { body }),
}

/** Forward and reverse geocoding through the public Nominatim service (OSM).
 *  Usage policy: max 1 request/second, results cached, bounded to the service area. */
const geoCache = new Map<string, GeocodeResult[]>()
let lastGeocode = 0

export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const cached = geoCache.get(q.toLowerCase())
  if (cached) return cached
  const wait = Math.max(0, 1000 - (Date.now() - lastGeocode))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  if (signal?.aborted) return []
  lastGeocode = Date.now()
  const url =
    'https://nominatim.openstreetmap.org/search' +
    qs({ q: `${q}, Manhattan, New York`, format: 'jsonv2', limit: 6, viewbox: '-74.025,40.77,-73.96,40.695', bounded: 1 })
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[]
  const out = rows.map((r) => ({
    label: r.display_name.split(', ').slice(0, 3).join(', '),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }))
  geoCache.set(q.toLowerCase(), out)
  return out
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const wait = Math.max(0, 1000 - (Date.now() - lastGeocode))
  if (wait) await new Promise((r) => setTimeout(r, wait))
  lastGeocode = Date.now()
  try {
    const res = await fetch(
      'https://nominatim.openstreetmap.org/reverse' + qs({ lat, lon: lng, format: 'jsonv2', zoom: 18 }),
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return null
    const j = await res.json()
    const a = j.address ?? {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    return street || j.display_name?.split(', ').slice(0, 2).join(', ') || null
  } catch {
    return null
  }
}
