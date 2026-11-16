import maplibregl, { type Map as MLMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { VerificationBadge } from '@/components/common/Badge'
import { ButtonLink } from '@/components/common/Button'
import { Checkbox, Field, Input, Select } from '@/components/common/Field'
import { ReportRowSkeleton, Skeleton } from '@/components/common/Skeleton'
import { Container, EmptyState, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { COLORS } from '@/components/map/config'
import { MapView } from '@/components/map/MapView'
import { setData } from '@/components/map/layers'
import { FeatureStrip, placeType } from '@/components/places/PlaceBits'
import { FeatureStatusMark } from '@/components/common/Badge'
import { useAsync, useDebounced, useDocumentTitle, useMediaQuery } from '@/hooks/useAsync'
import { useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { PlaceSummary } from '@/types'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { PLACE_TYPE_LABEL, timeAgo, VERIFICATION_LABEL } from '@/utils/format'

export default function PlacesPage() {
  useDocumentTitle('Places')
  const t = useTaxonomy()
  const wide = useMediaQuery('(min-width: 1024px)')
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [feature, setFeature] = useState('')
  const [verification, setVerification] = useState('')
  const [withIssues, setWithIssues] = useState(false)
  const [selected, setSelected] = useState<PlaceSummary | null>(null)
  const dq = useDebounced(q, 300)
  const mapRef = useRef<MLMap | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)

  const types = useAsync(() => api.placeTypes(), [])
  const list = useAsync(
    () => api.places({ q: dq, type: type ? [type] : undefined, feature: feature || undefined, verification: verification ? [verification] : undefined, with_issues: withIssues, limit: 120 }),
    [dq, type, feature, verification, withIssues],
  )
  const listRef = useRef<PlaceSummary[] | undefined>(undefined)
  listRef.current = list.data

  useEffect(() => {
    if (list.data) announce(`${list.data.length} places`)
    const map = mapRef.current
    if (!map || !list.data) return
    setData(map, 'plist', {
      type: 'FeatureCollection',
      features: list.data.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, v: p.verification_status, open: p.open_reports } })),
    })
  }, [list.data])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected) return
    map.easeTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 16) })
    popup.current?.remove()
    popup.current = new maplibregl.Popup({ closeButton: false, offset: 10 }).setLngLat([selected.lng, selected.lat]).setText(selected.name).addTo(map)
    if (map.getLayer('plist-sel')) map.setFilter('plist-sel', ['==', ['get', 'id'], selected.id])
  }, [selected])

  function onReady(map: MLMap) {
    mapRef.current = map
    map.addSource('plist', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'plist',
      type: 'circle',
      source: 'plist',
      paint: {
        'circle-radius': ['case', ['>', ['get', 'open'], 0], 7, 5],
        'circle-color': ['match', ['get', 'v'], 'disputed', COLORS.signal, 'verified', COLORS.ink, COLORS.raised],
        'circle-stroke-color': ['match', ['get', 'v'], 'disputed', COLORS.paper, COLORS.ink],
        'circle-stroke-width': 1.5,
      },
    })
    map.addLayer({ id: 'plist-sel', type: 'circle', source: 'plist', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': COLORS.ink, 'circle-stroke-width': 2 } })
    map.on('click', 'plist', (e) => {
      const id = e.features?.[0]?.properties.id
      const p = listRef.current?.find((x) => x.id === id)
      if (p) setSelected(p)
    })
    if (list.data) setData(map, 'plist', { type: 'FeatureCollection', features: list.data.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, v: p.verification_status, open: p.open_reports } })) })
  }

  return (
    <Container>
      <PageHeader eyebrow="Places" title="Accessibility by place">
        Stations, hospitals, libraries and public buildings, with what OpenStreetMap says and what people have reported since.
      </PageHeader>

      <form role="search" aria-label="Filter places" onSubmit={(e) => e.preventDefault()} className="grid gap-2 border-b border-hair py-3 sm:grid-cols-2 lg:grid-cols-12">
        <Field label="Name or address" className="lg:col-span-4">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Grand Central" />
        </Field>
        <Field label="Type" className="lg:col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.data?.map((x) => (
              <option key={x.type} value={x.type}>{PLACE_TYPE_LABEL[x.type] ?? x.type} ({x.count})</option>
            ))}
          </Select>
        </Field>
        <Field label="Has working" className="lg:col-span-2">
          <Select value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">Any feature</option>
            {t?.features.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </Field>
        <Field label="Data status" className="lg:col-span-2">
          <Select value={verification} onChange={(e) => setVerification(e.target.value)}>
            <option value="">Any</option>
            {Object.entries(VERIFICATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <div className="flex items-end lg:col-span-2">
          <Checkbox label="Open reports only" checked={withIssues} onChange={(e) => setWithIssues(e.target.checked)} />
        </div>
      </form>

      <div className="grid gap-4 py-4 lg:grid-cols-12">
        <section className="lg:col-span-5" aria-labelledby="pl-h" aria-busy={list.loading}>
          <h2 id="pl-h" className="meta pb-1">{list.data ? `${list.data.length} places` : 'Loading places'}</h2>
          {list.error && <ErrorNote error={list.error} onRetry={list.reload} />}
          {list.loading && !list.data && Array.from({ length: 6 }).map((_, i) => <ReportRowSkeleton key={i} />)}
          {list.data?.length === 0 && <EmptyState title="No places match">Try removing a filter.</EmptyState>}
          <ul>
            {list.data?.map((p) => (
              <li key={p.id} className={cx('relative border-b border-hair py-2', selected?.id === p.id && 'bg-tint/50')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="meta">{placeType(p)}</p>
                    <h3 className="mt-0.5 font-sans text-base font-medium leading-snug">
                      {wide ? (
                        <button type="button" onClick={() => setSelected(p)} className="text-left hover:underline">
                          {p.name}
                        </button>
                      ) : (
                        <Link to={`/places/${p.id}`} className="no-underline hover:underline">{p.name}</Link>
                      )}
                    </h3>
                    {p.address && <p className="text-sm text-muted">{p.address}</p>}
                  </div>
                  <VerificationBadge status={p.verification_status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                  <FeatureStrip status={p.feature_status} />
                  {p.open_reports > 0 && <span className="text-xs font-medium text-signal-deep">{p.open_reports} open report{p.open_reports > 1 ? 's' : ''}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {wide && (
          <div className="lg:col-span-7">
            <div className="sticky top-[88px] flex flex-col gap-2">
              <MapView label="Map of places" onReady={onReady} className="h-[420px] border border-hair" />
              {selected ? <PlaceSidebar id={selected.id} /> : <p className="text-sm text-muted">Select a place to see its accessibility profile here.</p>}
            </div>
          </div>
        )}
      </div>
    </Container>
  )
}

function PlaceSidebar({ id }: { id: string }) {
  const { data: p, loading } = useAsync(() => api.place(id), [id])
  if (loading || !p) {
    return (
      <div className="border border-hair bg-paper-raised p-2" aria-hidden>
        <Skeleton className="h-[24px] w-[60%]" />
        <Skeleton className="mt-1 h-[14px] w-[40%]" />
        <Skeleton className="mt-2 h-[80px] w-full" />
      </div>
    )
  }
  return (
    <aside className="fade-up border border-hair bg-paper-raised p-2" aria-label={`${p.name} summary`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl leading-snug">{p.name}</h2>
          <p className="text-sm text-muted">{placeType(p)}{p.last_verified && ` · last checked ${timeAgo(p.last_verified)}`}</p>
        </div>
        <ButtonLink to={`/places/${p.id}`} size="sm" variant="ghost">Full profile</ButtonLink>
      </div>
      {p.features.length ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-2">
          {p.features.map((f) => (
            <div key={f.id} className="flex items-center justify-between border-t border-hair py-0.5">
              <dt className="text-sm">{f.label}</dt>
              <dd><FeatureStatusMark status={f.status} /></dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">Nobody has recorded accessibility features here yet.</p>
      )}
      {p.reports.filter((r) => r.status === 'open').length > 0 && (
        <p className="mt-2 text-sm">
          <Link to={`/reports/${p.reports.find((r) => r.status === 'open')!.id}`}>Latest open report</Link>
        </p>
      )}
    </aside>
  )
}
