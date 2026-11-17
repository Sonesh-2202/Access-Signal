import { lazy, Suspense, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, FeatureStatusMark, VerificationBadge } from '@/components/common/Badge'
import { Button, ButtonLink } from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { AskButton } from '@/components/assistant/AskButton'
import { PreflightCard } from '@/components/places/PreflightCard'
import { Container, ErrorNote } from '@/components/layout/Layout'
import { placeType } from '@/components/places/PlaceBits'
import { ReportRow } from '@/components/reports/ReportRow'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { api } from '@/services/api'
import type { FeatureStatus, PlaceDetail, PlaceFeature } from '@/types'
import { cx } from '@/utils/cx'
import { dateTime, timeAgo } from '@/utils/format'
import { hasWebGL } from '@/utils/webgl'

const EntranceModel3D = lazy(() => import('@/components/places/EntranceModel3D'))

const SOURCE_LABEL: Record<string, string> = { osm: 'OpenStreetMap tag', report: 'Community report', manager: 'Staff update' }

export default function PlaceProfile() {
  const { id = '' } = useParams()
  const { data: p, loading, error, reload } = useAsync(() => api.place(id), [id])
  useDocumentTitle(p?.name ?? 'Place')

  if (loading && !p) {
    return (
      <Container className="py-8">
        <div role="status" aria-label="Loading place">
          <Skeleton className="h-[12px] w-[160px]" />
          <Skeleton className="mt-2 h-[48px] w-[60%]" />
          <div className="mt-6 grid gap-4 md:grid-cols-12">
            <Skeleton className="h-[280px] md:col-span-7" />
            <Skeleton className="h-[280px] md:col-span-5" />
          </div>
        </div>
      </Container>
    )
  }
  if (error) return <Container className="py-8"><ErrorNote error={error} onRetry={reload} /></Container>
  if (!p) return null

  const open = p.reports.filter((r) => r.status === 'open')
  return (
    <Container className="py-4 md:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/places">Places</Link> <span aria-hidden>/</span> {placeType(p)}
      </nav>
      <header className="mt-2 grid gap-3 border-b border-hair pb-4 md:grid-cols-12">
        <div className="md:col-span-8">
          <h1 className="text-4xl leading-snug tracking-[-0.02em]">{p.name}</h1>
          <p className="mt-1 text-lg text-muted">
            {placeType(p)}
            {p.address && ` · ${p.address}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <VerificationBadge status={p.verification_status} />
            <span className="text-muted">{p.last_verified ? `Last community update ${timeAgo(p.last_verified)}` : 'No community updates yet'}</span>
            {p.osm_id && (
              <a href={`https://www.openstreetmap.org/${p.osm_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted">
                OpenStreetMap record <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-1 md:col-span-4 md:justify-end">
          <ButtonLink to={`/report?lat=${p.lat}&lng=${p.lng}`} variant="primary">Report a problem here</ButtonLink>
          <ButtonLink to={`/route?to=${p.lat},${p.lng}`} variant="ghost">Route here</ButtonLink>
          <AskButton context={{ kind: 'place', id: p.id }} label={p.name}>Ask about this place</AskButton>
        </div>
      </header>
      <PreflightCard placeId={p.id} />

      {open.length > 0 && (
        <div role="note" className="mt-3 border-l-2 border-signal bg-signal-wash px-2 py-1">
          <p className="font-medium text-ink">{open.length} open problem{open.length > 1 ? 's' : ''} reported here</p>
          <p className="text-sm">
            Most recent: <Link to={`/reports/${open[0].id}`}>{open[0].description.slice(0, 120) || 'view report'}</Link>
          </p>
        </div>
      )}

      <div className="grid gap-6 py-4 md:grid-cols-12">
        <section className="md:col-span-7" aria-labelledby="feat-h">
          <h2 id="feat-h" className="text-2xl">Accessibility features</h2>
          <p className="mt-0.5 text-sm text-muted">Each entry shows where the information came from and how sure we are.</p>
          <FeatureList features={p.features} />
        </section>
        <div className="md:col-span-5">
          <ModelPanel place={p} />
        </div>
      </div>

      <div className="grid gap-6 border-t border-hair py-4 md:grid-cols-12">
        <section className="md:col-span-5" aria-labelledby="tl-h">
          <h2 id="tl-h" className="text-2xl">Verification timeline</h2>
          {p.timeline.length === 0 ? (
            <p className="mt-1 text-muted">Nothing yet. Features listed come from OpenStreetMap only.</p>
          ) : (
            <ol className="relative mt-2 border-l border-rule">
              {p.timeline.map((e, i) => (
                <li key={i} className="relative pb-2 pl-3">
                  <span
                    aria-hidden
                    className={cx(
                      'absolute -left-[5px] top-[7px] h-[9px] w-[9px] border border-paper',
                      e.kind === 'report' ? 'rotate-45 bg-signal' : e.kind === 'resolved' ? 'rounded-full bg-ink' : 'rounded-full bg-muted',
                    )}
                  />
                  <p className="meta"><time dateTime={e.at}>{dateTime(e.at)}</time></p>
                  <p className="font-medium">{e.report_id ? <Link to={`/reports/${e.report_id}`} className="no-underline hover:underline">{e.title}</Link> : e.title}</p>
                  {e.detail && <p className="text-sm text-muted">{e.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="md:col-span-6 md:col-start-7" aria-labelledby="rep-h">
          <h2 id="rep-h" className="text-2xl">Reports at this place</h2>
          {p.reports.length === 0 ? (
            <p className="mt-1 text-muted">No reports. If you’ve been here, tell people what works and what doesn’t.</p>
          ) : (
            <div className="mt-1">{p.reports.map((r) => <ReportRow key={r.id} report={r} compact />)}</div>
          )}
        </section>
      </div>
    </Container>
  )
}

function FeatureList({ features }: { features: PlaceFeature[] }) {
  if (!features.length) {
    return <p className="mt-2 border-y border-hair py-3 text-muted">No accessibility features recorded. OpenStreetMap has no wheelchair tags for this place and nobody has reported on it.</p>
  }
  return (
    <ul className="mt-2">
      {features.map((f) => (
        <li key={f.id} className="grid grid-cols-[1fr_auto] gap-x-2 border-t border-hair py-2 last:border-b">
          <h3 className="font-display text-xl leading-snug">{f.label}</h3>
          <FeatureStatusMark status={f.status} />
          <p className="col-span-2 mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{SOURCE_LABEL[f.source] ?? f.source}</span>
            <span>Confidence {Math.round(f.confidence * 100)}</span>
            <span>Assessed {timeAgo(f.assessed_at)}</span>
          </p>
          {f.notes && <p className="col-span-2 mt-0.5 text-sm">{f.notes}</p>}
          {f.source_report_id && (
            <p className="col-span-2 mt-0.5 text-sm">
              <Link to={`/reports/${f.source_report_id}`}>See the evidence</Link>
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function ModelPanel({ place }: { place: PlaceDetail }) {
  const [show3D, setShow3D] = useState(hasWebGL())
  const status = Object.fromEntries(place.features.map((f) => [f.feature_type, f.status])) as Record<string, FeatureStatus>
  return (
    <figure className="border border-hair bg-paper-raised">
      <div className="flex items-center justify-between border-b border-hair px-2 py-0.5">
        <p className="meta">Entrance schematic</p>
        {hasWebGL() && (
          <Button variant="quiet" size="sm" onClick={() => setShow3D((v) => !v)} aria-pressed={show3D}>
            {show3D ? '2D' : '3D'}
          </Button>
        )}
      </div>
      <div className="h-[280px]">
        {show3D ? (
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <EntranceModel3D features={status} />
          </Suspense>
        ) : (
          <Elevation features={status} />
        )}
      </div>
      <figcaption className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-hair px-2 py-1 text-xs text-muted">
        <span>Simplified, not to scale.</span>
        <Badge tone="outline">● working</Badge>
        <Badge tone="signal">◆ not working</Badge>
        <span>Drag to rotate.</span>
      </figcaption>
    </figure>
  )
}

/** 2D fallback: front elevation drawn as SVG. */
function Elevation({ features }: { features: Record<string, FeatureStatus> }) {
  const col = (s?: FeatureStatus) => (s === 'unavailable' ? '#B83A24' : s === 'available' ? '#1A1917' : s === 'limited' ? '#5F5A51' : '#D9CBA9')
  return (
    <svg viewBox="0 0 400 280" className="h-full w-full" aria-hidden>
      <rect x="40" y="40" width="320" height="190" fill="#F8F6F1" stroke="#1A1917" strokeOpacity="0.3" />
      <rect x="175" y="130" width="50" height="88" fill={col(features.step_free_entrance ?? features.automatic_door)} opacity="0.9" />
      <rect x="160" y="218" width="80" height="12" fill="#D9CBA9" />
      {'ramp' in features && <path d="M240 230 L330 230 L240 218 Z" fill={col(features.ramp)} />}
      {'elevator' in features && <rect x="70" y="90" width="40" height="140" fill={col(features.elevator)} opacity="0.85" />}
      <line x1="10" y1="230" x2="390" y2="230" stroke="#1A1917" strokeOpacity="0.4" />
    </svg>
  )
}
