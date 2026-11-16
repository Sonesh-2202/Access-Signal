import type { Map as MLMap } from 'maplibre-gl'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Segmented } from '@/components/common/Field'
import { Skeleton } from '@/components/common/Skeleton'
import { BarList, LineChart } from '@/components/charts/Charts'
import { Container, PageHeader } from '@/components/layout/Layout'
import { MapView } from '@/components/map/MapView'
import { addCoverageLayer, addHeatLayer, addHotspotLayer, setData, setVisible } from '@/components/map/layers'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { catLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { Hotspot } from '@/types'
import { cx } from '@/utils/cx'
import { hours } from '@/utils/format'

export default function Analytics() {
  useDocumentTitle('Trends')
  const t = useTaxonomy()
  const ov = useAsync(() => api.overview(), [])
  const trends = useAsync(() => api.trends(12), [])
  const cats = useAsync(() => api.categories(), [])
  const res = useAsync(() => api.resolution(), [])
  const hs = useAsync(() => api.hotspots(), [])
  const o = ov.data
  const change = o && o.reports_prev_30d ? Math.round(((o.reports_last_30d - o.reports_prev_30d) / o.reports_prev_30d) * 100) : null

  return (
    <Container>
      <PageHeader eyebrow="Open data" title="Trends, hotspots and gaps">
        Published for anyone to check: how many barriers are reported, how fast they get fixed, and where nobody is looking.
      </PageHeader>

      <section aria-label="Headline figures" className="grid grid-cols-2 gap-x-3 gap-y-4 border-b border-hair py-4 md:grid-cols-12">
        <Stat className="md:col-span-3" label="Open barriers" value={o?.open_reports} note={o && `${o.critical_open} critical`} />
        <Stat className="md:col-span-3" label="Reports, last 30 days" value={o?.reports_last_30d} note={change !== null ? `${change >= 0 ? '+' : ''}${change}% on the 30 days before` : undefined} />
        <Stat className="md:col-span-3" label="Median time to repair" value={o ? hours(o.median_resolution_hours) : undefined} note={res.data ? `90% within ${hours(res.data.overall_p90_hours)}` : undefined} />
        <Stat className="md:col-span-3" label="High-confidence open" value={o?.high_confidence_open} note="confidence 60 or above" />
      </section>

      <div className="grid gap-6 py-6 md:grid-cols-12">
        <section className="md:col-span-8" aria-labelledby="trend-h">
          <h2 id="trend-h" className="text-2xl">Reported and resolved, by week</h2>
          <p className="mt-0.5 text-sm text-muted">Confirmations of an existing barrier are not counted twice.</p>
          <div className="mt-2">
            {trends.data ? (
              <LineChart
                title="Weekly reported and resolved barriers over the last 12 weeks"
                labels={trends.data.weeks}
                series={[
                  { name: 'Reported', values: trends.data.reported, style: 'solid', accent: true },
                  { name: 'Resolved', values: trends.data.resolved, style: 'dashed' },
                ]}
              />
            ) : (
              <Skeleton className="h-[240px] w-full" />
            )}
          </div>
        </section>
        <section className="md:col-span-4" aria-labelledby="res-h">
          <h2 id="res-h" className="text-2xl">Time to repair</h2>
          <p className="mt-0.5 text-sm text-muted">Median hours from first report to resolution.</p>
          <div className="mt-2">
            {res.data ? (
              res.data.by_category.length ? (
                <BarList title="Median repair time by category" rows={res.data.by_category.map((c) => ({ key: c.category, label: c.label, value: c.median_hours, note: `n=${c.count}` }))} format={(v) => hours(v)} />
              ) : (
                <p className="text-muted">No resolved issues yet.</p>
              )
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 border-t border-hair py-6 md:grid-cols-12">
        <section className="md:col-span-5" aria-labelledby="cat-h">
          <h2 id="cat-h" className="text-2xl">What gets reported</h2>
          <div className="mt-2">
            {cats.data ? (
              <BarList
                title="Reports by category"
                accentKey={cats.data[0]?.category}
                rows={cats.data.map((c) => ({ key: c.category, label: c.label, value: c.total, note: `${c.open} open` }))}
              />
            ) : (
              <Skeleton className="h-[240px] w-full" />
            )}
          </div>
        </section>
        <section className="md:col-span-6 md:col-start-7" aria-labelledby="hs-h">
          <h2 id="hs-h" className="text-2xl">Hotspots</h2>
          <p className="mt-0.5 text-sm text-muted">Two or more open reports within 120 m of each other. <Link to="/methodology#hotspots">How they’re found</Link></p>
          <ol className="mt-2">
            {hs.loading && <Skeleton className="h-[160px] w-full" />}
            {hs.data?.map((h, i) => (
              <li key={h.id} className="grid grid-cols-[32px_1fr_auto] gap-x-1 border-t border-hair py-1">
                <span className="tabular font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="font-medium">{h.label ?? 'Unnamed area'}</p>
                  <p className="text-sm text-muted">
                    {h.report_count} reports · mostly {catLabel(t, h.dominant_category).toLowerCase()} ·{' '}
                    <span className={cx(h.trend === 'rising' && 'text-signal-deep')}>{h.trend}</span>
                  </p>
                </div>
                <span className="tabular self-center font-mono text-sm">{Math.round(h.severity_index * 100)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <GeoSection />
    </Container>
  )
}

function Stat({ label, value, note, className }: { label: string; value?: number | string | null; note?: string | null; className?: string }) {
  return (
    <div className={className}>
      <p className="meta">{label}</p>
      <p className="mt-1 font-display text-4xl leading-none tabular">{value ?? <Skeleton className="inline-block h-[40px] w-[80px]" />}</p>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  )
}

function GeoSection() {
  const [view, setView] = useState<'heat' | 'coverage'>('heat')
  const map = useRef<MLMap | null>(null)
  const cov = useAsync(() => api.coverage(), [])

  function apply(v: 'heat' | 'coverage') {
    setView(v)
    if (!map.current) return
    setVisible(map.current, ['heat', 'hotspot-fill', 'hotspot-line'], v === 'heat')
    setVisible(map.current, ['coverage-fill', 'coverage-line'], v === 'coverage')
  }

  return (
    <section id="coverage" className="scroll-mt-[96px] border-t border-hair py-6" aria-labelledby="geo-h">
      <div className="grid gap-2 md:grid-cols-12">
        <div className="md:col-span-5">
          <h2 id="geo-h" className="text-2xl">{view === 'heat' ? 'Where barriers concentrate' : 'Where we have no data'}</h2>
          <p className="mt-0.5 text-muted">
            {view === 'heat'
              ? 'Open reports weighted by severity and confidence, with hotspot outlines.'
              : cov.data
                ? `${cov.data.summary.cells_without_data} of ${cov.data.summary.cells} walkable blocks have no reports and no place data. Shaded cells are where a single report adds the most.`
                : 'Blocks of about 250 m with walkable paths but no reports or place data.'}
          </p>
        </div>
        <div className="flex items-end md:col-span-4 md:col-start-9 md:justify-end">
          <Segmented legend="Map view" hideLegend value={view} onChange={apply} options={[{ value: 'heat', label: 'Severity' }, { value: 'coverage', label: 'Data gaps' }]} />
        </div>
      </div>
      <MapView
        label={view === 'heat' ? 'Heat map of open barrier reports' : 'Map of blocks without accessibility data'}
        className="mt-2 h-[460px] border border-hair"
        onReady={async (m) => {
          map.current = m
          addHeatLayer(m)
          addHotspotLayer(m)
          addCoverageLayer(m)
          const [heat, hots, coverage] = await Promise.all([api.heat(), api.hotspots(), api.coverage()])
          setData(m, 'heat', heat)
          setData(m, 'hotspots', { type: 'FeatureCollection', features: hots.map((h: Hotspot) => ({ type: 'Feature', geometry: h.area, properties: { severity: h.severity_index } })) })
          setData(m, 'coverage', coverage)
          apply(location.hash === '#coverage' ? 'coverage' : 'heat')
        }}
      />
    </section>
  )
}
