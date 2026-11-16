import type { Map as MLMap } from 'maplibre-gl'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CountUp } from '@/components/common/CountUp'
import { Segmented } from '@/components/common/Field'
import { Skeleton } from '@/components/common/Skeleton'
import { HBarChart, StackedBarLine, type StackGroup } from '@/components/charts/Charts'
import { Container, PageHeader } from '@/components/layout/Layout'
import { COLORS } from '@/components/map/config'
import { MapView } from '@/components/map/MapView'
import { addCoverageLayer, addHeatLayer, addHotspotLayer, setData, setVisible } from '@/components/map/layers'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { catLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api, type Resolution } from '@/services/api'
import type { Hotspot } from '@/types'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { hours } from '@/utils/format'
import { prefersReducedMotion } from '@/utils/webgl'

/** Report categories grouped the way agencies split the work. */
const GROUPS: { key: string; label: string; color: string; cats: string[] }[] = [
  { key: 'transit', label: 'Elevators & transit', color: COLORS.signal, cats: ['transit', 'elevator'] },
  { key: 'street', label: 'Curb cuts & crossings', color: COLORS.ink, cats: ['sidewalk', 'crossing'] },
  { key: 'building', label: 'Ramps & entrances', color: COLORS.warn, cats: ['ramp', 'entrance'] },
  { key: 'other', label: 'Other', color: '#BDB4A6', cats: ['restroom', 'wayfinding', 'other'] },
]

const AGENCY_OF: Record<string, { agency: string; label: string }> = {
  transit: { agency: 'mta', label: 'MTA Elevators & Escalators' },
  elevator: { agency: 'mta', label: 'MTA Elevators & Escalators' },
  sidewalk: { agency: 'dot', label: 'DOT Curb Cuts & Signals' },
  crossing: { agency: 'dot', label: 'DOT Curb Cuts & Signals' },
  ramp: { agency: 'parks', label: 'Parks Dept Ramps' },
}

/** The live API reports by category; fold that into agencies (count-weighted median of medians). */
function byAgency(res: Resolution) {
  if (res.by_agency?.length) return res.by_agency
  const acc = new Map<string, { label: string; count: number; weighted: number }>()
  for (const c of res.by_category) {
    const a = AGENCY_OF[c.category] ?? { agency: 'private', label: 'Private Building Entrances' }
    const cur = acc.get(a.agency) ?? { label: a.label, count: 0, weighted: 0 }
    cur.count += c.count
    cur.weighted += c.median_hours * c.count
    acc.set(a.agency, cur)
  }
  return [...acc].map(([agency, v]) => ({ agency, label: v.label, count: v.count, median_hours: v.count ? v.weighted / v.count : 0 })).sort((a, b) => a.median_hours - b.median_hours)
}

export default function Analytics() {
  useDocumentTitle('Trends')
  const t = useTaxonomy()
  const ov = useAsync(() => api.overview(), [])
  const trends = useAsync(() => api.trends(12), [])
  const cats = useAsync(() => api.categories(), [])
  const res = useAsync(() => api.resolution(), [])
  const hs = useAsync(() => api.hotspots(), [])
  const map = useRef<MLMap | null>(null)
  const geo = useRef<HTMLElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const o = ov.data
  const change = o && o.reports_prev_30d ? Math.round(((o.reports_last_30d - o.reports_prev_30d) / o.reports_prev_30d) * 100) : null

  const groups: StackGroup[] | null = trends.data
    ? GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        color: g.color,
        values: trends.data!.weeks.map((_, i) => g.cats.reduce((a, c) => a + (trends.data!.by_category[c]?.[i] ?? 0), 0)),
      }))
    : null

  function flyTo(h: Hotspot) {
    setActive(h.id)
    const still = prefersReducedMotion()
    geo.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
    const m = map.current
    if (m) {
      if (m.getLayer('hotspot-active')) m.setFilter('hotspot-active', ['==', ['get', 'id'], h.id])
      m.flyTo({ center: [h.lng, h.lat], zoom: 16, pitch: 40, bearing: -29, duration: still ? 0 : 2200, essential: true })
    }
    announce(`Map moved to ${h.label ?? 'hotspot'}`)
  }

  return (
    <Container>
      <PageHeader eyebrow="Open data" title="Trends, hotspots and gaps">
        Published for anyone to check: how many barriers are reported, how fast they get fixed, and where nobody is looking.
      </PageHeader>

      <section aria-label="Headline figures" className="grid grid-cols-2 border-b border-hair md:grid-cols-4">
        <Kpi label="Open barriers" value={o?.open_reports} note={o && `${o.critical_open} critical`} accent />
        <Kpi label="Reports, last 30 days" value={o?.reports_last_30d} note={change !== null ? `${change >= 0 ? '+' : ''}${change}% on the 30 days before` : undefined} />
        <Kpi label="Median time to repair" value={o?.median_resolution_hours ?? undefined} decimals={1} suffix=" hrs" note={res.data ? `90% within ${hours(res.data.overall_p90_hours)}` : undefined} />
        <Kpi label="High-confidence open" value={o?.high_confidence_open} note="confidence 60 or above" />
      </section>

      <div className="grid gap-6 py-6 lg:grid-cols-12">
        <section className="lg:col-span-8" aria-labelledby="trend-h">
          <h2 id="trend-h" className="text-2xl">Reported and resolved, by week</h2>
          <p className="mt-0.5 text-sm text-muted">Bars: new reports by type. Line: repairs confirmed by someone on site. Confirmations of an existing barrier are not counted twice.</p>
          <div className="mt-2">
            {trends.data && groups ? (
              <StackedBarLine title="Weekly reports by type and verified repairs over the last 12 weeks" weeks={trends.data.weeks} groups={groups} line={trends.data.resolved} lineLabel="Verified repairs" />
            ) : (
              <Skeleton className="h-[300px] w-full" />
            )}
          </div>
        </section>
        <section className="lg:col-span-4" aria-labelledby="res-h">
          <h2 id="res-h" className="text-2xl">Time to repair, by agency</h2>
          <p className="mt-0.5 text-sm text-muted">Median hours from first report to a fix confirmed on site.</p>
          <div className="mt-2">
            {res.data ? (
              res.data.by_category.length || res.data.by_agency?.length ? (
                <HBarChart
                  title="Median repair time by responsible agency"
                  rows={byAgency(res.data).map((a) => ({ key: a.agency, label: a.label, value: +a.median_hours.toFixed(1), note: `n=${a.count}` }))}
                  format={(v) => `${v.toFixed(1)} h`}
                  accentKey={byAgency(res.data).at(-1)?.agency}
                />
              ) : (
                <p className="text-muted">No resolved issues yet.</p>
              )
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 border-t border-hair py-6 lg:grid-cols-12">
        <section className="lg:col-span-5" aria-labelledby="cat-h">
          <h2 id="cat-h" className="text-2xl">What gets reported</h2>
          <p className="mt-0.5 text-sm text-muted">Last 12 weeks, with the number still open.</p>
          <div className="mt-2">
            {cats.data ? (
              <HBarChart title="Reports by category" accentKey={cats.data[0]?.category} rows={cats.data.map((c) => ({ key: c.category, label: c.label, value: c.total, note: `${c.open} open` }))} />
            ) : (
              <Skeleton className="h-[240px] w-full" />
            )}
          </div>
        </section>
        <section className="lg:col-span-6 lg:col-start-7" aria-labelledby="hs-h">
          <h2 id="hs-h" className="text-2xl">Hotspots</h2>
          <p className="mt-0.5 text-sm text-muted">
            Two or more open reports within 120 m of each other. Choose one to see it on the map. <Link to="/methodology#hotspots">How they’re found</Link>
          </p>
          <ol className="mt-2">
            {hs.loading && <Skeleton className="h-[160px] w-full" />}
            {hs.data?.map((h, i) => (
              <li key={h.id} className="border-t border-hair">
                <button
                  type="button"
                  onClick={() => flyTo(h)}
                  aria-pressed={active === h.id}
                  className={cx(
                    'group grid w-full grid-cols-[32px_1fr_auto] items-center gap-x-1 py-1 text-left transition-colors duration-150',
                    active === h.id ? 'bg-tint/50' : 'hover:bg-paper-sunk',
                  )}
                >
                  <span className="tabular pl-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="block font-medium">{h.label ?? 'Unnamed area'}</span>
                    <span className="block text-sm text-muted">
                      <span className="tabular">{h.report_count}</span> reports · mostly {catLabel(t, h.dominant_category).toLowerCase()} ·{' '}
                      <span className={cx(h.trend === 'rising' && 'text-signal-deep')}>{h.trend}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 pr-0.5">
                    <span className="relative hidden h-[4px] w-6 bg-hair sm:block" aria-hidden>
                      <span className="absolute inset-y-0 left-0 bg-signal" style={{ width: `${h.severity_index * 100}%` }} />
                    </span>
                    <span className="tabular font-mono text-sm">{Math.round(h.severity_index * 100)}</span>
                    <span aria-hidden className="text-muted transition-transform duration-150 group-hover:translate-x-[2px]">→</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <GeoSection sectionRef={geo} onMap={(m) => (map.current = m)} />
    </Container>
  )
}

function Kpi({ label, value, note, decimals = 0, suffix, accent }: { label: string; value?: number | null; note?: string | null; decimals?: number; suffix?: string; accent?: boolean }) {
  return (
    <div className="border-hair py-3 pr-2 odd:border-r md:border-r md:px-3 md:first:pl-0 md:last:border-r-0 [&:nth-child(n+3)]:border-t md:[&:nth-child(n+3)]:border-t-0">
      <p className="meta">{label}</p>
      <p className={cx('mt-1 font-display text-4xl leading-none', accent && 'text-signal-deep')}>
        {value == null ? <Skeleton className="inline-block h-[40px] w-[80px]" /> : <CountUp value={value} decimals={decimals} suffix={suffix} />}
      </p>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  )
}

function GeoSection({ sectionRef, onMap }: { sectionRef: React.RefObject<HTMLElement>; onMap: (m: MLMap) => void }) {
  const [view, setView] = useState<'heat' | 'coverage'>('heat')
  const map = useRef<MLMap | null>(null)
  const cov = useAsync(() => api.coverage(), [])

  function apply(v: 'heat' | 'coverage') {
    setView(v)
    if (!map.current) return
    setVisible(map.current, ['heat', 'hotspot-fill', 'hotspot-line', 'hotspot-active'], v === 'heat')
    setVisible(map.current, ['coverage-fill', 'coverage-line'], v === 'coverage')
  }

  return (
    <section ref={sectionRef} id="coverage" className="scroll-mt-[96px] border-t border-hair py-6" aria-labelledby="geo-h">
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
          onMap(m)
          addHeatLayer(m)
          addHotspotLayer(m)
          addCoverageLayer(m)
          m.addLayer({ id: 'hotspot-active', type: 'line', source: 'hotspots', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': COLORS.signal, 'line-width': 3 } })
          const [heat, hots, coverage] = await Promise.all([api.heat(), api.hotspots(), api.coverage()])
          setData(m, 'heat', heat)
          setData(m, 'hotspots', { type: 'FeatureCollection', features: hots.map((h: Hotspot) => ({ type: 'Feature', geometry: h.area, properties: { id: h.id, severity: h.severity_index } })) })
          setData(m, 'coverage', coverage)
          apply(location.hash === '#coverage' ? 'coverage' : 'heat')
        }}
      />
    </section>
  )
}
