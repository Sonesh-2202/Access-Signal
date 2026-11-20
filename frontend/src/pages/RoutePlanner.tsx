import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Checkbox, Segmented } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { RiskBreakdown } from '@/components/routing/RiskBreakdown'
import { Skeleton } from '@/components/common/Skeleton'
import { SaveRoute } from '@/components/alerts/SaveRoute'
import { DescribeRoute } from '@/components/routing/DescribeRoute'
import { RideHandoffCard } from '@/components/rides/RideHandoffCard'
import { Container, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { COLORS } from '@/components/map/config'
import { LocationSearch } from '@/components/map/LocationSearch'
import { fitTo, MapView } from '@/components/map/MapView'
import { addReportLayers, set3D, setData } from '@/components/map/layers'
import { PerspectiveToggle } from '@/components/map/PerspectiveToggle'
import { placeMarkers, syncReportMarkers } from '@/components/map/pulseMarkers'
import { DEMO_TRIPS } from '@/data/mockManhattanData'
import { prefersReducedMotion } from '@/utils/webgl'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { ApiError, api } from '@/services/api'
import type { GeocodeResult, Profile, RouteOption, RoutePlanResult, RouteResponse } from '@/types'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { distance, humanize, minutes, pct, PROFILE_LABEL } from '@/utils/format'

type Pt = { lat: number; lng: number; label: string }

function parsePt(s: string | null): Pt | null {
  if (!s) return null
  const [lat, lng] = s.split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` } : null
}

const PROFILES: { value: Profile; label: string; hint: string }[] = [
  { value: 'wheelchair', label: 'Wheelchair', hint: 'No stairs or raised kerbs. Avoids steep slopes, rough surfaces and reported blockages.' },
  { value: 'power_wheelchair', label: 'Power wheelchair', hint: 'No stairs or raised kerbs. Tolerates steeper slopes than manual, but needs wider paths.' },
  { value: 'reduced_effort', label: 'Reduced effort', hint: 'Prefers flat, smooth paths. Stairs allowed but costly.' },
  { value: 'low_vision', label: 'Low vision', hint: 'Prefers crossings with audible signals and tactile paving, and lit paths.' },
  { value: 'mobility_aid', label: 'Mobility aid', hint: 'For cane, walker or limited stamina. Avoids rough surfaces and steep slopes. Slower pace.' },
  { value: 'stroller', label: 'Stroller / luggage', hint: 'Step-free preferred. Curb cuts and smooth surfaces. Stairs very costly but passable.' },
  { value: 'standard', label: 'Walking', hint: 'Shortest path. Reported barriers count only slightly.' },
]

/** The engine's refusal when no path meets the profile. Returns the barrier it names, or null for any other error. */
function noStepFreeRouteBarrier(e: Error): string | null {
  if (!(e instanceof ApiError) || e.status !== 422 || !e.message.startsWith('No route meets')) return null
  const m = e.message.match(/Blocked by: (.*)$/)
  return m ? m[1] : 'no step-free path between these points'
}

let drawRaf = 0

/** Draws the clear (emerald) route on from start to end, like a pen stroke. */
function drawOn(map: MLMap) {
  cancelAnimationFrame(drawRaf)
  const full = ['step', ['line-progress'], COLORS.ok, 1, COLORS.ok]
  if (!map.getLayer('route-line')) return
  if (prefersReducedMotion()) {
    map.setPaintProperty('route-line', 'line-gradient', full)
    return
  }
  const start = performance.now()
  const D = 950
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / D)
    const p = Math.min(0.9999, Math.max(0.0001, 1 - Math.pow(1 - t, 3)))
    if (!map.getLayer('route-line')) return
    map.setPaintProperty('route-line', 'line-gradient', t < 1 ? ['step', ['line-progress'], COLORS.ok, p, 'rgba(31,110,67,0)'] : full)
    if (t < 1) drawRaf = requestAnimationFrame(tick)
  }
  drawRaf = requestAnimationFrame(tick)
}

function markerEl(letter: string) {
  const el = document.createElement('div')
  el.style.cssText = `width:26px;height:26px;border-radius:2px;background:${COLORS.ink};color:${COLORS.paper};display:flex;align-items:center;justify-content:center;font:600 12px "IBM Plex Mono",monospace;border:2px solid ${COLORS.paper}`
  el.textContent = letter
  el.setAttribute('aria-hidden', 'true')
  return el
}

export default function RoutePlanner() {
  useDocumentTitle('Plan a route')
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = useState<Pt | null>(parsePt(params.get('from')))
  const [to, setTo] = useState<Pt | null>(parsePt(params.get('to')))
  const [profile, setProfile] = useState<Profile>((params.get('profile') as Profile) || 'wheelchair')
  const [avoidUnknown, setAvoidUnknown] = useState(false)
  const [preferReliable, setPreferReliable] = useState(false)
  const [pick, setPick] = useState<'from' | 'to' | null>(null)
  const [result, setResult] = useState<RouteResponse | null>(null)
  /** The inputs that produced `result`, which can differ from the form if the user edited it since. */
  const [ran, setRan] = useState<{ f: Pt; t: Pt; p: Profile; au: boolean } | null>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const markers = useRef<{ from?: Marker; to?: Marker }>({})
  const barrierMarkers = useRef<Marker[]>([])
  const [is3D, setIs3D] = useState(false)
  const pickRef = useRef(pick)
  pickRef.current = pick

  const places = useAsync(() => api.places({ type: ['transit_station', 'hospital', 'library'], limit: 200 }), [])
  const presets: GeocodeResult[] = useMemo(() => (places.data ?? []).map((p) => ({ label: p.name, lat: p.lat, lng: p.lng })), [places.data])

  async function run(f = from, t = to, p = profile, au = avoidUnknown) {
    if (!f || !t) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.route([f.lat, f.lng], [t.lat, t.lng], p, au, preferReliable)
      setResult(r)
      setRan({ f, t, p, au })
      setSelected(0)
      announce(`${r.routes.length} route${r.routes.length > 1 ? 's' : ''} found. Recommended: ${distance(r.routes[0].distance_m)}, ${minutes(r.routes[0].duration_min)}.`)
      const q = new URLSearchParams({ from: `${f.lat.toFixed(5)},${f.lng.toFixed(5)}`, to: `${t.lat.toFixed(5)},${t.lng.toFixed(5)}`, profile: p })
      setParams(q, { replace: true })
    } catch (e) {
      setResult(null)
      setError(e as Error)
      announce((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Show a route planned from plain words: fill the form from it and run it, so the map shows the same route. */
  function showPlan(plan: RoutePlanResult) {
    if (plan.status !== 'planned' || !plan.start || !plan.end) return
    const f = { lat: plan.start.lat, lng: plan.start.lng, label: plan.start.name }
    const t = { lat: plan.end.lat, lng: plan.end.lng, label: plan.end.name }
    const p = plan.intent.profile
    const au = plan.intent.avoid_features.includes('unknown_data')
    setFrom(f)
    setTo(t)
    setProfile(p)
    setAvoidUnknown(au)
    run(f, t, p, au)
  }

  // Auto-run when arriving with both ends in the URL.
  useEffect(() => {
    if (from && to) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const [k, p] of [['from', from], ['to', to]] as const) {
      if (!p) {
        markers.current[k]?.remove()
        markers.current[k] = undefined
        continue
      }
      if (!markers.current[k]) markers.current[k] = new maplibregl.Marker({ element: markerEl(k === 'from' ? 'A' : 'B') }).setLngLat([p.lng, p.lat]).addTo(map)
      else markers.current[k]!.setLngLat([p.lng, p.lat])
    }
  }, [from, to])

  // Route lines (re-run once the map finishes loading, in case the route arrived first).
  // Blocked routes draw as a dashed terracotta line; clear routes as solid emerald.
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !map.getSource('routes')) return
    const feats = (result?.routes ?? []).map((r, i) => ({
      type: 'Feature' as const,
      geometry: r.geometry,
      properties: { i, selected: i === selected, blocked: r.barriers_on_route > 0 },
    }))
    feats.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected))
    setData(map, 'routes', { type: 'FeatureCollection', features: feats })
    barrierMarkers.current.forEach((m) => m.remove())
    // Barriers from every option, so the blocked route's pin stays visible while the detour is selected.
    const seen = new Set<string>()
    const pins = (result?.routes ?? []).flatMap((r) =>
      r.segments.flatMap((s) => s.barriers.map((b) => ({ ...b, at: s.coords[Math.floor(s.coords.length / 2)] }))),
    ).filter((b) => !seen.has(b.report_id) && !!seen.add(b.report_id))
    barrierMarkers.current = placeMarkers(
      map,
      { type: 'FeatureCollection', features: pins.map((b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: b.at }, properties: { id: b.report_id, severity: Math.max(b.severity, 0.85), confidence: b.confidence, status: 'open' } })) },
      () => true,
    )
    if (result?.routes[selected]) {
      fitTo(map, result.routes.flatMap((x) => x.geometry.coordinates as [number, number][]), 80)
      if (result.routes.some((x) => x.barriers_on_route === 0)) drawOn(map)
    }
  }, [result, selected, mapReady])

  function setPerspective(next: boolean) {
    const map = mapRef.current
    if (!map || next === is3D) return
    set3D(map, next)
    setIs3D(next)
    announce(next ? '3D street perspective on' : 'Flat map view')
  }

  function tryTrip(t: (typeof DEMO_TRIPS)[number]) {
    setFrom(t.from)
    setTo(t.to)
    run(t.from, t.to)
  }

  function onReady(map: MLMap) {
    mapRef.current = map
    addReportLayers(map)
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true })
    map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLORS.paper, 'line-width': ['case', ['get', 'selected'], 10, 6], 'line-opacity': 0.9 } })
    map.addLayer({
      id: 'route-line-blocked',
      type: 'line',
      source: 'routes',
      filter: ['==', ['get', 'blocked'], true],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': COLORS.signal,
        'line-width': ['case', ['get', 'selected'], 4.5, 3],
        'line-opacity': ['case', ['get', 'selected'], 1, 0.7],
        'line-dasharray': [1.6, 1.2],
      },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'routes',
      filter: ['==', ['get', 'blocked'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': ['case', ['get', 'selected'], 6, 3.5],
        'line-opacity': ['case', ['get', 'selected'], 1, 0.6],
        'line-gradient': ['step', ['line-progress'], COLORS.ok, 1, COLORS.ok],
      },
    })
    // Open reports nearby, quieter than the barriers on the route itself.
    api.reportsGeoJSON({}).then((fc) => setData(map, 'reports', fc)).catch(() => undefined)
    syncReportMarkers(map, () => undefined)
    map.on('click', (e) => {
      const which = pickRef.current
      if (!which) return
      const p = { lat: e.lngLat.lat, lng: e.lngLat.lng, label: `Map point ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}` }
      if (which === 'from') setFrom(p)
      else setTo(p)
      setPick(null)
      announce(`${which === 'from' ? 'Start' : 'Destination'} set from map`)
    })
    // Re-sync if markers were set before the map loaded.
    setFrom((f) => (f ? { ...f } : f))
    setTo((t) => (t ? { ...t } : t))
    setMapReady(true)
  }

  useEffect(() => {
    const c = mapRef.current?.getCanvas()
    if (c) c.style.cursor = pick ? 'crosshair' : ''
  }, [pick])

  const route = result?.routes[selected]

  return (
    <Container>
      <PageHeader eyebrow="Routing" title="Plan a route">
        Routes use OpenStreetMap paths and every open barrier report. Choose the profile that matches how you travel.
      </PageHeader>

      <div className="grid gap-4 py-4 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-5">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              run()
            }}
            aria-label="Route options"
          >
            <div className="grid grid-cols-[1fr_auto] items-end gap-1">
              <LocationSearch label="From" placeholder="Start address or station" value={from?.label} presets={presets} onSelect={(r) => setFrom(r)} />
              <Button variant={pick === 'from' ? 'primary' : 'ghost'} onClick={() => setPick(pick === 'from' ? null : 'from')} aria-pressed={pick === 'from'} aria-label="Pick start on map" icon={<Icon name="pin" size={16} />} />
              <LocationSearch label="To" placeholder="Destination" value={to?.label} presets={presets} onSelect={(r) => setTo(r)} />
              <Button variant={pick === 'to' ? 'primary' : 'ghost'} onClick={() => setPick(pick === 'to' ? null : 'to')} aria-pressed={pick === 'to'} aria-label="Pick destination on map" icon={<Icon name="pin" size={16} />} />
            </div>
            {pick && <p className="text-sm text-signal" role="status">Click the map to set the {pick === 'from' ? 'start' : 'destination'}.</p>}
            <button
              type="button"
              className="self-start text-sm underline decoration-rule underline-offset-[3px] min-h-touch"
              onClick={() => {
                setFrom(to)
                setTo(from)
              }}
            >
              Swap start and destination
            </button>
            <Segmented legend="Travel profile" value={profile} onChange={setProfile} options={PROFILES.map((p) => ({ value: p.value, label: p.label, hint: p.hint }))} />
            <p className="text-sm text-muted">{PROFILES.find((p) => p.value === profile)?.hint}</p>
            <Checkbox
              label="Avoid segments with missing data"
              description="Prefers paths where surface and kerb height are known, even if longer."
              checked={avoidUnknown}
              onChange={(e) => setAvoidUnknown(e.target.checked)}
            />
            <Checkbox
              label="Prefer reliable routes"
              description="Also keeps away from streets with hotspots and open reports, which can add distance. Shows why."
              checked={preferReliable}
              onChange={(e) => setPreferReliable(e.target.checked)}
            />
            <div>
              <Button type="submit" variant="primary" busy={busy} disabled={!from || !to}>
                Find routes
              </Button>
            </div>
          </form>

          <DescribeRoute onShow={showPlan} />
          <div className="border-t border-hair pt-2">
            <p className="meta">Or try a trip with a known barrier</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {DEMO_TRIPS.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => tryTrip(t)}
                    className="min-h-touch rounded-full border border-stone-300/80 bg-paper-raised px-2 text-sm transition-[background-color,transform] duration-150 ease-out hover:bg-paper-sunk active:scale-[0.97]"
                  >
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && <ErrorNote error={error} />}
          {error && from && to && noStepFreeRouteBarrier(error) && (
            <RideHandoffCard pickup={from.label} dropoff={to.label} barrier={noStepFreeRouteBarrier(error) ?? ''} />
          )}
          {busy && !result && (
            <div aria-hidden>
              <Skeleton className="h-[120px] w-full" />
            </div>
          )}
          {result && (
            <RouteResults result={result} selected={selected} setSelected={setSelected} />
          )}
          {result && ran && result.routes.length > 0 && (
            <div className="border-t border-hair pt-2">
              <SaveRoute from={ran.f} to={ran.t} profile={ran.p} />
            </div>
          )}
        </div>

        <div className="lg:col-span-7">
          <div className="lg:sticky lg:top-[88px]">
            <MapView label="Route map" onReady={onReady} className="h-[360px] border border-hair lg:h-[calc(100vh-180px)]">
              {mapReady && <PerspectiveToggle value={is3D} onChange={setPerspective} className="absolute left-1 top-1" />}
              {result && <RouteLegend />}
            </MapView>
          </div>
        </div>

        {route && (
          <section className="lg:col-span-5" aria-labelledby="dir-h">
            <h2 id="dir-h" className="text-2xl">Directions</h2>
            <p className="text-sm text-muted">{route.label} · {distance(route.distance_m)} · {minutes(route.duration_min)}</p>
            <Directions route={route} />
          </section>
        )}
      </div>
    </Container>
  )
}

function RouteLegend() {
  return (
    <div className="absolute bottom-1 left-1 z-10 flex flex-col gap-0.5 rounded-sm border border-stone-300/80 bg-paper-raised/90 px-1 py-0.5 text-xs" aria-hidden>
      <span className="inline-flex items-center gap-1">
        <svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke={COLORS.ok} strokeWidth="4" strokeLinecap="round" /></svg>
        Step-free
      </span>
      <span className="inline-flex items-center gap-1">
        <svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke={COLORS.signal} strokeWidth="3" strokeDasharray="5 4" /></svg>
        Passes a reported barrier
      </span>
    </div>
  )
}

/** "+170 m · +3 min" against the shortest option, so the cost of the detour is explicit. */
function Delta({ r, base }: { r: RouteOption; base: RouteOption }) {
  const dm = r.distance_m - base.distance_m
  const dt = Math.round(r.duration_min - base.duration_min)
  if (r === base || dm <= 0) return <span className="tabular font-mono text-xs text-muted">shortest</span>
  return (
    <span className="tabular font-mono text-xs text-muted">
      +{distance(dm)} · +{dt < 1 ? '<1' : dt} min vs shortest
    </span>
  )
}

function RouteResults({ result, selected, setSelected }: { result: RouteResponse; selected: number; setSelected: (i: number) => void }) {
  const base = result.routes.reduce((a, b) => (b.distance_m < a.distance_m ? b : a), result.routes[0])
  return (
    <section aria-labelledby="routes-h" className="fade-up">
      <h2 id="routes-h" className="meta">
        {result.routes.length} option{result.routes.length > 1 ? 's' : ''} for {PROFILE_LABEL[result.profile].toLowerCase()}
      </h2>
      {result.warnings.map((w) => (
        <p key={w} className="mt-1 text-sm text-signal">{w}</p>
      ))}
      <fieldset className="mt-1">
        <legend className="sr-only">Choose a route</legend>
        {result.routes.map((r, i) => (
          <label key={i} className={cx('grid cursor-pointer grid-cols-[24px_1fr] gap-x-1 border-t border-hair py-2 last:border-b', i === selected && 'bg-tint/50')}>
            <input type="radio" name="route" checked={i === selected} onChange={() => setSelected(i)} className="mt-[4px] h-[18px] w-[18px] accent-signal" />
            <span>
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="inline-flex items-center gap-1 font-medium">
                  <svg width="20" height="6" aria-hidden className="shrink-0">
                    {r.barriers_on_route > 0 ? (
                      <line x1="1" y1="3" x2="19" y2="3" stroke={COLORS.signal} strokeWidth="3" strokeDasharray="4 3" />
                    ) : (
                      <line x1="1" y1="3" x2="19" y2="3" stroke={COLORS.ok} strokeWidth="4" strokeLinecap="round" />
                    )}
                  </svg>
                  {r.label}
                </span>
                <span className="tabular font-mono text-sm">{distance(r.distance_m)} · {minutes(r.duration_min)}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                <Delta r={r} base={base} />
                {r.barriers_on_route === 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-sm bg-ok-wash px-0.5 text-xs font-medium text-ok">Step-free</span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-sm bg-signal-wash px-0.5 text-xs font-medium text-signal-deep">Barrier on route</span>
                )}
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                <span>Path quality {Math.round(r.accessibility_score * 100)}</span>
                <span>Missing data {pct(r.unknown_share)}</span>
                {r.barriers_avoided > 0 && <span className="text-ink">Avoids {r.barriers_avoided} barrier{r.barriers_avoided > 1 ? 's' : ''}</span>}
                {r.barriers_on_route > 0 && <span className="text-signal-deep">{r.barriers_on_route} reported issue{r.barriers_on_route > 1 ? 's' : ''} on route</span>}
              </span>
              {i === selected && (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {r.explanation.map((e) => (
                    <li key={e} className="flex gap-1">
                      <span aria-hidden className="mt-[10px] h-px w-1 shrink-0 bg-ink" />
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <RiskBreakdown risk={result.routes[selected]?.risk} />
    </section>
  )
}

function Directions({ route }: { route: RouteOption }) {
  return (
    <ol className="mt-2 flex flex-col">
      {route.segments.map((s, i) => (
        <li key={i} className="grid grid-cols-[32px_1fr] border-t border-hair py-1">
          <span className="tabular pt-[2px] font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <p className={cx(s.barriers.length > 0 && 'font-medium')}>{s.instruction}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
              {s.surface && <span>Surface: {s.surface.replace(/_/g, ' ')}</span>}
              {s.kerb && <span>Kerb: {s.kerb}</span>}
              {s.incline != null && s.incline > 0 && <span>Slope {pct(s.incline)}</span>}
              {s.has_steps && <span className="text-signal-deep">Stairs</span>}
              {s.unknown_attributes.length > 0 && <span>Not mapped: {s.unknown_attributes.map(humanize).join(', ').toLowerCase()}</span>}
            </p>
            {s.barriers.map((b) => (
              <p key={b.report_id} className="mt-0.5 flex items-center gap-0.5 text-sm text-signal-deep">
                <Icon name="alert" size={16} />
                <Link to={`/reports/${b.report_id}`}>{b.label}</Link>
                <span className="text-muted">(confidence {Math.round(b.confidence * 100)})</span>
              </p>
            ))}
          </div>
        </li>
      ))}
      <li className="grid grid-cols-[32px_1fr] border-t border-hair py-1">
        <span aria-hidden className="pt-[2px] font-mono text-xs text-muted">B</span>
        <p>Arrive at your destination</p>
      </li>
    </ol>
  )
}
