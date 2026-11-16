import maplibregl, { type Map as MLMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Checkbox, Segmented } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { ReportRowSkeleton } from '@/components/common/Skeleton'
import { EmptyState } from '@/components/layout/Layout'
import {
  addCoverageLayer,
  addHeatLayer,
  addHotspotLayer,
  addPlaceLayer,
  addReportLayers,
  set3D,
  setData,
  setVisible,
} from '@/components/map/layers'
import { LocationSearch } from '@/components/map/LocationSearch'
import { MapView } from '@/components/map/MapView'
import { CategoryGlyph, ReportRow } from '@/components/reports/ReportRow'
import { useDebounced, useDocumentTitle, useMediaQuery } from '@/hooks/useAsync'
import { useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { ReportSummary } from '@/types'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { severityBand, VERIFICATION_LABEL } from '@/utils/format'

type LayerKey = 'reports' | 'places' | 'heat' | 'hotspots' | 'coverage'
const LAYER_IDS: Record<LayerKey, string[]> = {
  reports: ['report-clusters', 'report-cluster-count', 'report-points', 'report-selected'],
  places: ['place-points', 'place-labels'],
  heat: ['heat'],
  hotspots: ['hotspot-fill', 'hotspot-line'],
  coverage: ['coverage-fill', 'coverage-line'],
}
const LAYER_LABEL: Record<LayerKey, [string, string]> = {
  reports: ['Barrier reports', 'Clustered when zoomed out'],
  places: ['Places', 'Hospitals, stations, libraries and more'],
  heat: ['Severity heat map', 'Weighted by severity and confidence'],
  hotspots: ['Hotspots', 'Clusters of two or more open reports'],
  coverage: ['Data gaps', 'Shaded blocks have no reports or place data'],
}

function popupNode(title: string, lines: string[], href: string, linkText: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'flex max-w-[240px] flex-col gap-0.5'
  const h = document.createElement('p')
  h.className = 'font-medium leading-snug'
  h.textContent = title
  root.append(h)
  for (const l of lines) {
    const p = document.createElement('p')
    p.className = 'text-xs text-muted'
    p.textContent = l
    root.append(p)
  }
  const a = document.createElement('a')
  a.href = href
  a.textContent = linkText
  a.className = 'mt-0.5 text-sm'
  a.dataset.spa = '1'
  root.append(a)
  return root
}

export default function MapPage() {
  useDocumentTitle('Map')
  const t = useTaxonomy()
  const [params] = useSearchParams()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<'map' | 'list'>(params.get('view') === 'list' ? 'list' : 'map')
  const [sheet, setSheet] = useState(false)
  const [cats, setCats] = useState<string[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ reports: true, places: true, heat: false, hotspots: true, coverage: false })
  const [is3D, setIs3D] = useState(false)
  const [bbox, setBbox] = useState<string>('-74.02,40.70,-73.96,40.77')
  const [hover, setHover] = useState<string | null>(null)
  const [list, setList] = useState<{ items: ReportSummary[]; total: number } | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const dBbox = useDebounced(bbox, 250)

  // ------------------------------------------------------------ list (accessible alternative to the map)
  useEffect(() => {
    const ctrl = new AbortController()
    setListLoading(true)
    api
      .reports({ bbox: mode === 'map' ? dBbox : undefined, category: cats, status: showResolved ? ['open', 'resolved'] : ['open'], sort: 'severity', limit: 50 }, ctrl.signal)
      .then((p) => {
        setList(p)
        announce(`${p.total} report${p.total === 1 ? '' : 's'} ${mode === 'map' ? 'in view' : 'found'}`)
      })
      .catch(() => undefined)
      .finally(() => setListLoading(false))
    return () => ctrl.abort()
  }, [dBbox, cats, showResolved, mode])

  // ------------------------------------------------------------ map data
  const loadReports = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const fc = await api.reportsGeoJSON({ category: cats, include_resolved: showResolved })
    setData(map, 'reports', fc)
  }, [cats, showResolved])

  useEffect(() => {
    if (ready) loadReports().catch(() => undefined)
  }, [ready, loadReports])

  const onReady = useCallback((map: MLMap) => {
    mapRef.current = map
    addReportLayers(map)
    addPlaceLayer(map)
    addHeatLayer(map)
    addHotspotLayer(map)
    addCoverageLayer(map)

    api.places({ limit: 500 }).then((ps) =>
      setData(map, 'places', {
        type: 'FeatureCollection',
        features: ps.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, verification: p.verification_status, open: p.open_reports } })),
      }),
    ).catch(() => undefined)
    api.heat().then((fc) => setData(map, 'heat', fc)).catch(() => undefined)
    api.hotspots().then((hs) =>
      setData(map, 'hotspots', { type: 'FeatureCollection', features: hs.map((h) => ({ type: 'Feature', geometry: h.area, properties: { severity: h.severity_index, label: h.label } })) }),
    ).catch(() => undefined)
    api.coverage().then((fc) => setData(map, 'coverage', fc)).catch(() => undefined)

    map.on('click', 'report-points', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as Record<string, string | number>
      new maplibregl.Popup({ closeButton: true, maxWidth: '260px', offset: 12 })
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setDOMContent(popupNode(String(p.label), [String(p.address ?? ''), `${severityBand(Number(p.severity))} severity · confidence ${Math.round(Number(p.confidence) * 100)}`], `/reports/${p.id}`, 'View report'))
        .addTo(map)
    })
    map.on('click', 'place-points', (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['report-points', 'report-clusters'] }).length) return
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as Record<string, string | number>
      new maplibregl.Popup({ maxWidth: '260px', offset: 8 })
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setDOMContent(popupNode(String(p.name), [VERIFICATION_LABEL[String(p.verification)] ?? '', Number(p.open) ? `${p.open} open report(s)` : ''].filter(Boolean), `/places/${p.id}`, 'Accessibility profile'))
        .addTo(map)
    })
    const sync = () => {
      const b = map.getBounds()
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(','))
    }
    map.on('moveend', sync)
    sync()
    setReady(true)
  }, [])

  // Popup links navigate through the SPA router instead of a full reload.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[data-spa]') as HTMLAnchorElement | null
      if (!a) return
      e.preventDefault()
      window.history.pushState({}, '', a.getAttribute('href')!)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // The map unmounts in list-only mode; reset so it re-initialises cleanly when shown again.
  useEffect(() => {
    if (mode === 'list') {
      mapRef.current = null
      setReady(false)
      setIs3D(false)
    }
  }, [mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(Object.keys(layers) as LayerKey[]).forEach((k) => setVisible(map, LAYER_IDS[k], layers[k]))
  }, [layers, ready])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready && map.getLayer('report-selected')) map.setFilter('report-selected', ['==', ['get', 'id'], hover ?? ''])
  }, [hover, ready])

  function toggle3D() {
    const map = mapRef.current
    if (!map) return
    const next = !is3D
    const ok = set3D(map, next)
    setIs3D(next)
    announce(next ? (ok ? '3D buildings on' : 'Tilted view on. This map style has no building heights.') : '3D view off')
  }

  function locate() {
    if (!navigator.geolocation) return announce('Location is not available in this browser')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 })
        announce('Moved map to your location')
      },
      () => announce('Could not get your location'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const panel = (
    <Panel
      t={t}
      cats={cats}
      setCats={setCats}
      showResolved={showResolved}
      setShowResolved={setShowResolved}
      layers={layers}
      setLayers={setLayers}
      list={list}
      loading={listLoading}
      mode={mode}
      setHover={setHover}
      hover={hover}
      onSearch={(r) => {
        mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 16 })
        setSheet(false)
      }}
    />
  )

  const controls = (
    <div className="flex flex-wrap items-center gap-1">
      <Segmented
        legend="View"
        hideLegend
        value={mode}
        onChange={(v) => setMode(v)}
        options={[
          { value: 'map', label: <span className="inline-flex items-center gap-0.5"><Icon name="map" size={16} />Map</span> },
          { value: 'list', label: <span className="inline-flex items-center gap-0.5"><Icon name="list" size={16} />List only</span> },
        ]}
      />
      {mode === 'map' && (
        <>
          <Button variant="ghost" size="sm" onClick={toggle3D} aria-pressed={is3D} icon={<Icon name="cube" size={16} />} className="bg-paper-raised">
            3D
          </Button>
          <Button variant="ghost" size="sm" onClick={locate} icon={<Icon name="locate" size={16} />} className="bg-paper-raised">
            <span className="sr-only sm:not-sr-only">Near me</span>
          </Button>
        </>
      )}
    </div>
  )

  return (
    <div className="relative flex flex-1 flex-col lg:h-[calc(100vh-65px)] lg:flex-none lg:flex-row lg:overflow-hidden">
      <h1 className="sr-only">Accessibility map of Midtown and Lower Manhattan</h1>
      {desktop && (
        <aside className="flex w-[400px] shrink-0 flex-col border-r border-hair" aria-label="Map filters and report list">
          <div className="border-b border-hair p-2">{controls}</div>
          <div className="flex-1 overflow-y-auto">{panel}</div>
        </aside>
      )}

      {mode === 'map' ? (
        <MapView
          label="Map of accessibility reports"
          onReady={onReady}
          className="h-[calc(100vh-65px)] flex-1 lg:h-auto"
          fallback={<div className="mt-2">{panel}</div>}
        >
          {!desktop && <div className="absolute left-1 right-[64px] top-1 z-10">{controls}</div>}
          <Legend />
        </MapView>
      ) : (
        !desktop && (
          <div className="flex-1">
            <div className="border-b border-hair p-2">{controls}</div>
            {panel}
          </div>
        )
      )}
      {desktop && mode === 'list' && (
        <div className="flex flex-1 items-center justify-center bg-paper-sunk p-4 text-center text-muted">
          <p className="max-w-[36ch]">Map hidden. All reports matching your filters are listed on the left, sorted by severity.</p>
        </div>
      )}

      {!desktop && mode === 'map' && (
        <div
          className={cx(
            'fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-md border-t border-hair bg-paper transition-[height] duration-300 ease-out',
            sheet ? 'h-[72vh]' : 'h-[88px]',
          )}
          role="region"
          aria-label="Reports and filters"
        >
          <button
            type="button"
            className="flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 border-b border-hair px-2"
            aria-expanded={sheet}
            onClick={() => setSheet((s) => !s)}
          >
            <span aria-hidden className="h-0.5 w-5 rounded-full bg-rule" />
            <span className="text-sm font-medium">
              {list ? `${list.total} report${list.total === 1 ? '' : 's'} in view` : 'Reports in view'} · {sheet ? 'Hide' : 'Show list and filters'}
            </span>
          </button>
          {sheet && <div className="flex-1 overflow-y-auto pb-4">{panel}</div>}
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <details className="absolute bottom-[104px] left-1 z-10 max-w-[240px] rounded-sm border border-hair bg-paper-raised text-sm lg:bottom-2 lg:left-2">
      <summary className="flex min-h-touch cursor-pointer items-center px-2">Legend</summary>
      <ul className="flex flex-col gap-0.5 px-2 pb-2">
        <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2 border-paper bg-signal" aria-hidden />Critical barrier</li>
        <li className="flex items-center gap-1"><span className="h-[14px] w-[14px] rounded-full border-2 border-signal bg-paper-raised" aria-hidden />High</li>
        <li className="flex items-center gap-1"><span className="h-[12px] w-[12px] rounded-full bg-ink" aria-hidden />Medium</li>
        <li className="flex items-center gap-1"><span className="h-[10px] w-[10px] rounded-full border-2 border-ink bg-paper-raised" aria-hidden />Low</li>
        <li className="flex items-center gap-1"><span className="h-[10px] w-[10px] rounded-full border-2 border-muted bg-paper-raised" aria-hidden />Resolved</li>
        <li className="flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full border border-muted bg-paper-raised" aria-hidden />Place (zoom in to see)</li>
      </ul>
    </details>
  )
}

interface PanelProps {
  t: ReturnType<typeof useTaxonomy>
  cats: string[]
  setCats: (c: string[]) => void
  showResolved: boolean
  setShowResolved: (b: boolean) => void
  layers: Record<LayerKey, boolean>
  setLayers: (l: Record<LayerKey, boolean>) => void
  list: { items: ReportSummary[]; total: number } | null
  loading: boolean
  mode: 'map' | 'list'
  hover: string | null
  setHover: (id: string | null) => void
  onSearch: (r: { lat: number; lng: number; label: string }) => void
}

function Panel({ t, cats, setCats, showResolved, setShowResolved, layers, setLayers, list, loading, mode, hover, setHover, onSearch }: PanelProps) {
  const categories = useMemo(() => t?.categories.filter((c) => c.key !== 'other') ?? [], [t])
  return (
    <div className="flex flex-col">
      {mode === 'map' && (
        <div className="border-b border-hair p-2">
          <LocationSearch label="Search for a place or address" hideLabel placeholder="Search an address or place" onSelect={onSearch} />
        </div>
      )}

      <details className="group border-b border-hair" open={mode === 'list'}>
        <summary className="flex min-h-[52px] cursor-pointer items-center justify-between px-2 text-sm font-medium">
          <span className="inline-flex items-center gap-1">
            <Icon name="filter" size={16} /> Filter by barrier type
            {cats.length > 0 && <span className="tabular rounded-sm bg-ink px-0.5 font-mono text-xs text-paper">{cats.length}</span>}
          </span>
          <Icon name="chevronDown" size={16} className="transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <fieldset className="grid grid-cols-2 gap-x-1 px-2 pb-2">
          <legend className="sr-only">Barrier types</legend>
          {categories.map((c) => (
            <label key={c.key} className="flex min-h-touch cursor-pointer items-center gap-1 text-sm">
              <input
                type="checkbox"
                className="h-[18px] w-[18px] accent-signal"
                checked={cats.includes(c.key)}
                onChange={(e) => setCats(e.target.checked ? [...cats, c.key] : cats.filter((x) => x !== c.key))}
              />
              <CategoryGlyph category={c.key} />
              {c.label}
            </label>
          ))}
          <div className="col-span-2 mt-0.5 border-t border-hair pt-0.5">
            <Checkbox label="Include resolved reports" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          </div>
          {cats.length > 0 && (
            <button type="button" className="col-span-2 min-h-touch text-left text-sm underline" onClick={() => setCats([])}>
              Clear filters
            </button>
          )}
        </fieldset>
      </details>

      {mode === 'map' && (
        <details className="group border-b border-hair">
          <summary className="flex min-h-[52px] cursor-pointer items-center justify-between px-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1">
              <Icon name="layers" size={16} /> Map layers
            </span>
            <Icon name="chevronDown" size={16} className="transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-2 pb-2">
            {(Object.keys(LAYER_LABEL) as LayerKey[]).map((k) => (
              <Checkbox key={k} label={LAYER_LABEL[k][0]} description={LAYER_LABEL[k][1]} checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
            ))}
          </div>
        </details>
      )}

      <section className="px-2" aria-labelledby="list-heading">
        <div className="flex items-baseline justify-between pt-2">
          <h2 id="list-heading" className="font-sans text-sm font-medium">
            {mode === 'map' ? 'In this map area' : 'All matching reports'}
          </h2>
          <span className="tabular font-mono text-xs text-muted">{list ? `${list.items.length} of ${list.total}` : ''}</span>
        </div>
        {loading && !list ? (
          Array.from({ length: 4 }).map((_, i) => <ReportRowSkeleton key={i} />)
        ) : list && list.items.length === 0 ? (
          <EmptyState title="No reports here yet">
            Nothing has been reported in this area with these filters. <Link to="/report">Report a barrier</Link> if you’ve seen one.
          </EmptyState>
        ) : (
          <div aria-busy={loading}>
            {list?.items.map((r) => <ReportRow key={r.id} report={r} compact active={hover === r.id} onHover={setHover} headingLevel="h3" />)}
            {list && list.total > list.items.length && (
              <p className="py-2 text-sm text-muted">
                Showing the {list.items.length} most severe. <Link to="/reports">Browse all reports</Link>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
