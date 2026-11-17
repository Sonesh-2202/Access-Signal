import { aiKeyHeaders } from '@/stores/aiKey'
import { beginWaking, configureWake, isDemo, markDemo, markLive, useDataSource, whenAwake } from '@/stores/dataSource'
import { readRefreshToken, useAuth } from '@/stores/auth'
import * as local from './mockApi'
import type {
  DescribeReply,
  AlertCorridor,
  AlertCorridorInput,
  PreflightBrief,
  TranslateReply,
  AlertPreferences,
  AlertPushStatus,
  DispatcherDraft,
  Inbox,
  NearbyOut,
  NearbySettings,
  RideDraftRequest,
  RideOption,
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
  AIStatus,
} from '@/types'

/** API origin. Empty means same origin (/api through the Vite or nginx proxy). */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
const BASE = API_BASE

/** Absolute URL for an API path such as an evidence file, for <img src> and links. */
export function apiUrl(path: string): string
export function apiUrl(path: string | null | undefined): string | undefined
export function apiUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  return path.startsWith('/api/') ? `${BASE}${path}` : path
}

/**
 * A separately hosted API (VITE_API_BASE set) is assumed to be on a free tier that
 * sleeps when idle. Then an outage first means "waking up": show the banner, ping
 * /api/health with backoff, and hold write requests until it answers.
 */
let coldStart = BASE !== ''
/** Test hook. */
export function setColdStart(on: boolean) {
  coldStart = on
}
/** A request still unanswered after this long, before the API has answered once, means the host is starting. */
const SLOW_MS = 4000

configureWake(async () => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
    return res.ok && (res.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
})

function asleepError() {
  return new ApiError(503, 'The demo server is still asleep. Wait a minute and try again.', false)
}

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
/** Hosted demo: show local data sooner while the sleeping server starts. */
const COLD_TIMEOUT_MS = 4000

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
      timer = setTimeout(
        () => reject(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })),
        coldStart && useDataSource.getState().mode !== 'live' ? COLD_TIMEOUT_MS : LIVE_TIMEOUT_MS,
      )
    })
    const value = await Promise.race([live(), timeout])
    markLive()
    return value
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || !isOutage(e)) throw e
    const reason = `${label}: ${(e as Error).message || 'unreachable'}`
    if (coldStart) void beginWaking(reason)
    else markDemo(reason)
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

/** Only these endpoints can call a model, so only they ever see a personal AI key. */
const AI_PATHS = [/^\/api\/reports\/classify$/, /^\/api\/routing\/describe$/, /^\/api\/reports\/translate$/]

type RequestOpts = { body?: unknown; query?: Query; form?: FormData; signal?: AbortSignal }

async function request<T>(method: string, path: string, opts: RequestOpts = {}, retry = true, wakeRetry = true): Promise<T> {
  if (coldStart && useDataSource.getState().mode === 'waking' && !(await whenAwake())) throw asleepError()
  const headers: Record<string, string> = {}
  const token = useAuth.getState().accessToken
  if (token) headers.Authorization = `Bearer ${token}`
  if (AI_PATHS.some((re) => re.test(path))) Object.assign(headers, aiKeyHeaders())
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  // Before the API has answered once, a slow reply means the free host is starting:
  // show the banner (and start pinging) while this request keeps waiting.
  const slow = coldStart && useDataSource.getState().mode !== 'live' ? setTimeout(() => void beginWaking('slow first response'), SLOW_MS) : undefined
  let res: Response
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, { method, headers, body, signal: opts.signal })
  } catch (e) {
    // No response at all, so the request never reached the app: safe to send again once awake.
    if (coldStart && wakeRetry && e instanceof TypeError) {
      if (await beginWaking('network error')) return request<T>(method, path, opts, retry, false)
      throw asleepError()
    }
    throw e
  } finally {
    clearTimeout(slow)
  }
  // A gateway error page (not JSON from the app) while the host spins up: same as above.
  if (coldStart && wakeRetry && [502, 503, 504].includes(res.status) && !(res.headers.get('content-type') ?? '').includes('json')) {
    if (await beginWaking(`HTTP ${res.status} from host`)) return request<T>(method, path, opts, retry, false)
    throw asleepError()
  }
  if (res.status === 401 && retry && readRefreshToken()) {
    if (await refreshSession()) return request<T>(method, path, opts, false, wakeRetry)
  }
  if (!res.ok) throw await parseError(res)
  markLive()
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
  aiStatus: () => withFallback(() => request<AIStatus>('GET', '/api/meta/ai-status'), local.aiStatus, 'ai-status'),

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
  route: (origin: [number, number], destination: [number, number], profile: Profile, avoid_unknown: boolean, prefer_reliable = false) =>
    withFallback(
      () => request<RouteResponse>('POST', '/api/routing/route', { body: { origin, destination, profile, avoid_unknown, alternatives: 2, prefer_reliable } }),
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

  // accessible rides (AI-3). The list is public and works offline (empty in the demo). A draft is a preview; nothing is sent.
  rides: () => withFallback(() => request<RideOption[]>('GET', '/api/rides'), () => [] as RideOption[], 'rides'),
  rideDraft: (body: RideDraftRequest) => request<DispatcherDraft>('POST', '/api/rides/draft', { body }),
  // Preflight brief (AI-5). The status is rules-based and public; the summary is signed in and cited.
  preflight: (placeId: string) => request<PreflightBrief>('GET', `/api/places/${placeId}/preflight`),
  // Multilingual reporting (AI-6). A preview to review. Nothing is filed by this call.
  translate: (body: { text: string; target: string }) => request<TranslateReply>('POST', '/api/reports/translate', { body }),
  // route alerts (AI-4). Opt-in and signed in. Nothing is sent without a saved route and a push subscription.
  alertPush: () => request<AlertPushStatus>('GET', '/api/alerts/push'),
  alertSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ subscribed: boolean }>('POST', '/api/alerts/push-subscriptions', { body: sub }),
  alertUnsubscribe: (endpoint: string) =>
    request<void>('POST', '/api/alerts/push-subscriptions/unsubscribe', { body: { endpoint } }),
  corridors: () => request<AlertCorridor[]>('GET', '/api/alerts/corridors'),
  saveCorridor: (body: AlertCorridorInput) => request<AlertCorridor>('POST', '/api/alerts/corridors', { body }),
  updateCorridor: (id: string, body: AlertPreferences) =>
    request<AlertCorridor>('PATCH', `/api/alerts/corridors/${id}`, { body }),
  deleteCorridor: (id: string) => request<void>('DELETE', `/api/alerts/corridors/${id}`),
  inbox: () => request<Inbox>('GET', '/api/alerts/inbox'),
  markRead: (id: string) => request<void>('POST', `/api/alerts/inbox/${id}/read`),
  markAllRead: () => request<void>('POST', '/api/alerts/inbox/read-all'),
  // Alerts near me (no AI). The one-off check is public and stores nothing; the rest is signed in.
  nearbyNow: (body: { lat: number; lng: number; radius_m: number }) =>
    request<NearbyOut>('POST', '/api/alerts/nearby/now', { body }),
  nearbySettings: () => request<NearbySettings>('GET', '/api/alerts/nearby/settings'),
  setNearbySettings: (body: { enabled: boolean; radius_m: number }) =>
    request<NearbySettings>('PUT', '/api/alerts/nearby/settings', { body }),
  shareNearbyLocation: (lat: number, lng: number) =>
    request<NearbySettings>('PUT', '/api/alerts/nearby/location', { body: { lat, lng } }),
  forgetNearbyLocation: () => request<void>('DELETE', '/api/alerts/nearby/location'),
  // Describe a route in plain words (AI). Signed in. The router plans the route; the model only reads and explains it.
  describeRoute: (text: string) => request<DescribeReply>('POST', '/api/routing/describe', { body: { text } }),
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
