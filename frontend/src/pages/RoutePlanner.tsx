import maplibregl, { type Map as MLMap, type Marker } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Checkbox, Segmented } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { COLORS } from '@/components/map/config'
import { LocationSearch } from '@/components/map/LocationSearch'
import { fitTo, MapView } from '@/components/map/MapView'
import { setData } from '@/components/map/layers'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { api } from '@/services/api'
import type { GeocodeResult, Profile, RouteOption, RouteResponse } from '@/types'
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
  { value: 'reduced_effort', label: 'Reduced effort', hint: 'Prefers flat, smooth paths. Stairs allowed but costly.' },
  { value: 'low_vision', label: 'Low vision', hint: 'Prefers crossings with audible signals and tactile paving, and lit paths.' },
  { value: 'standard', label: 'Walking', hint: 'Shortest path. Reported barriers count only slightly.' },
]

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
  const [pick, setPick] = useState<'from' | 'to' | null>(null)
  const [result, setResult] = useState<RouteResponse | null>(null)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const markers = useRef<{ from?: Marker; to?: Marker }>({})
  const pickRef = useRef(pick)
  pickRef.current = pick

  const places = useAsync(() => api.places({ type: ['transit_station', 'hospital', 'library'], limit: 200 }), [])
  const presets: GeocodeResult[] = useMemo(() => (places.data ?? []).map((p) => ({ label: p.name, lat: p.lat, lng: p.lng })), [places.data])

  async function run(f = from, t = to, p = profile, au = avoidUnknown) {
    if (!f || !t) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.route([f.lat, f.lng], [t.lat, t.lng], p, au)
      setResult(r)
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

  // Route lines (re-run once the map finishes loading, in case the route arrived first)
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !map.getSource('routes')) return
    const feats = (result?.routes ?? []).map((r, i) => ({ type: 'Feature' as const, geometry: r.geometry, properties: { i, selected: i === selected } }))
    feats.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected))
    setData(map, 'routes', { type: 'FeatureCollection', features: feats })
    const barriers = (result?.routes[selected]?.segments ?? []).flatMap((s) => s.barriers.map((b) => ({ ...b, at: s.coords[Math.floor(s.coords.length / 2)] })))
    setData(map, 'route-barriers', { type: 'FeatureCollection', features: barriers.map((b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: b.at }, properties: { label: b.label } })) })
    if (result?.routes[selected]) fitTo(map, result.routes[selected].geometry.coordinates as [number, number][], 80)
  }, [result, selected, mapReady])

  function onReady(map: MLMap) {
    mapRef.current = map
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLORS.paper, 'line-width': 9 } })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'selected'], COLORS.ink, COLORS.muted],
        'line-width': ['case', ['get', 'selected'], 5, 3],
        'line-opacity': ['case', ['get', 'selected'], 1, 0.55],
        'line-dasharray': ['case', ['get', 'selected'], ['literal', [1, 0]], ['literal', [2, 1.5]]],
      },
    })
    map.addSource('route-barriers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'route-barriers', type: 'circle', source: 'route-barriers', paint: { 'circle-radius': 7, 'circle-color': COLORS.signal, 'circle-stroke-color': COLORS.paper, 'circle-stroke-width': 2 } })
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
            <div>
              <Button type="submit" variant="primary" busy={busy} disabled={!from || !to}>
                Find routes
              </Button>
            </div>
          </form>

          {error && <ErrorNote error={error} />}
          {busy && !result && (
            <div aria-hidden>
              <Skeleton className="h-[120px] w-full" />
            </div>
          )}
          {result && (
            <RouteResults result={result} selected={selected} setSelected={setSelected} />
          )}
        </div>

        <div className="lg:col-span-7">
          <div className="lg:sticky lg:top-[88px]">
            <MapView label="Route map" onReady={onReady} className="h-[360px] border border-hair lg:h-[calc(100vh-180px)]" />
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

function RouteResults({ result, selected, setSelected }: { result: RouteResponse; selected: number; setSelected: (i: number) => void }) {
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
                <span className="font-medium">{r.label}</span>
                <span className="tabular font-mono text-sm">{distance(r.distance_m)} · {minutes(r.duration_min)}</span>
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
