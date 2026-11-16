import maplibregl from 'maplibre-gl'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Badge, IssueStatusBadge, SeverityMark } from '@/components/common/Badge'
import { Button } from '@/components/common/Button'
import { ConfidenceBreakdownView } from '@/components/common/Confidence'
import { Dialog } from '@/components/common/Dialog'
import { Field, Textarea } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote } from '@/components/layout/Layout'
import { COLORS } from '@/components/map/config'
import { MapView } from '@/components/map/MapView'
import { CategoryGlyph, ReportRow } from '@/components/reports/ReportRow'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { catLabel, subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api, apiUrl } from '@/services/api'
import { isStaff, useAuth } from '@/stores/auth'
import type { Evidence, ReportDetail } from '@/types'
import { aiSourceShort } from '@/utils/aiSource'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { dateTime, ISSUE_STATUS_LABEL, timeAgo } from '@/utils/format'

const FLOW = ['reported', 'under_review', 'confirmed', 'assigned', 'in_progress', 'resolved'] as const

export default function ReportDetailPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const t = useTaxonomy()
  const { data: r, error, loading, reload, setData } = useAsync(() => api.report(id), [id])
  useDocumentTitle(r ? subLabel(t, r.category, r.subcategory) : 'Report')

  if (loading && !r) return <DetailSkeleton />
  if (error) return <Container className="py-8"><ErrorNote error={error} onRetry={reload} /></Container>
  if (!r) return null

  return (
    <Container className="py-4 md:py-8">
      {params.get('new') && (
        <div role="status" className="fade-up mb-3 border-l-2 border-ink bg-paper-raised px-2 py-1">
          <p className="font-medium">{r.status === 'duplicate' ? 'Thanks. Your confirmation was added to the existing report.' : 'Thanks. Your report is live.'}</p>
          <p className="text-sm text-muted">
            {r.status === 'duplicate' && r.duplicate_of ? <Link to={`/reports/${r.duplicate_of}`}>See the original report</Link> : 'Staff have been notified. Others nearby can now confirm it.'}
          </p>
        </div>
      )}
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/reports">Reports</Link> <span aria-hidden>/</span> {catLabel(t, r.category)}
      </nav>

      <div className="mt-2 grid gap-6 md:grid-cols-12">
        <article className="md:col-span-7" aria-labelledby="r-title">
          <header>
            <p className="meta flex items-center gap-1">
              <CategoryGlyph category={r.category} />
              {catLabel(t, r.category)} · reported {timeAgo(r.reported_at)}
              {r.reporter && <> by {r.reporter}</>}
            </p>
            <h1 id="r-title" className="mt-1 text-4xl leading-snug tracking-[-0.02em]">
              {subLabel(t, r.category, r.subcategory)}
            </h1>
            <p className="mt-1 text-lg text-muted">
              {r.address}
              {r.place_name && r.place_id && (
                <>
                  {r.address ? ' · ' : ''}
                  <Link to={`/places/${r.place_id}`}>{r.place_name}</Link>
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityMark value={r.severity_score} />
              {r.status === 'resolved' && <Badge tone="outline">Resolved {r.resolved_at && timeAgo(r.resolved_at)}</Badge>}
              {r.status === 'duplicate' && <Badge tone="tint">Confirmation of another report</Badge>}
              {r.issue_status && <IssueStatusBadge status={r.issue_status} />}
            </div>
          </header>

          {r.issue_status && <IssueProgress status={r.issue_status} />}

          {r.description && (
            <section className="mt-4" aria-labelledby="desc-h">
              <h2 id="desc-h" className="meta">Reporter’s description</h2>
              <p className="mt-1 max-w-prose text-lg leading-relaxed">{r.description}</p>
            </section>
          )}

          <EvidenceSection evidence={r.evidence} />

          {r.ai_analysis && (
            <section className="mt-4 border-t border-hair pt-2" aria-labelledby="ai-h">
              <h2 id="ai-h" className="meta">{aiSourceShort(r.ai_analysis.source)} reading{r.ai_analysis.model ? `, {r.ai_analysis.model}` : ''}</h2>
              <p className="mt-1">{r.ai_analysis.summary}</p>
              <p className="mt-0.5 text-sm text-muted">
                Suggested {subLabel(t, r.ai_analysis.category, r.ai_analysis.subcategory).toLowerCase()}
                {r.ai_analysis.subcategory === r.subcategory ? ', which the reporter accepted.' : `. The reporter chose ${subLabel(t, r.category, r.subcategory).toLowerCase()} instead.`}
              </p>
            </section>
          )}

          <VerifyBox report={r} onUpdate={setData} />

          {r.corroborating.length > 0 && (
            <section className="mt-6" aria-labelledby="corr-h">
              <h2 id="corr-h" className="text-2xl">Also reported by others</h2>
              <div className="mt-1">
                {r.corroborating.map((c) => <ReportRow key={c.id} report={c} compact />)}
              </div>
            </section>
          )}

          <OwnerActions report={r} />
        </article>

        <aside className="md:col-span-4 md:col-start-9" aria-label="Confidence and location">
          <div className="flex flex-col gap-3 md:sticky md:top-[96px]">
            <section className="border border-hair bg-paper-raised p-2" aria-labelledby="conf-h">
              <h2 id="conf-h" className="meta mb-1">Confidence</h2>
              <ConfidenceBreakdownView data={r.confidence_breakdown} />
              <p className="mt-1 text-xs text-muted">Recalculated {timeAgo(r.confidence_breakdown.computed_at)}. <Link to="/methodology#confidence">Method</Link></p>
            </section>
            <MapView
              label={`Location of the report at ${r.address ?? 'this point'}`}
              center={[r.lng, r.lat]}
              zoom={17}
              interactive={false}
              className="h-[220px] border border-hair"
              onReady={(m) => {
                const el = document.createElement('div')
                el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${COLORS.signal};border:2px solid ${COLORS.paper}`
                new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(m)
              }}
            />
            <p className="text-xs text-muted">
              {r.lat.toFixed(5)}, {r.lng.toFixed(5)} · <Link to={`/route?to=${r.lat},${r.lng}`}>Route here avoiding barriers</Link>
            </p>
          </div>
        </aside>
      </div>
    </Container>
  )
}

function DetailSkeleton() {
  return (
    <Container className="py-8">
      <div role="status" aria-label="Loading report" className="grid gap-6 md:grid-cols-12">
        <div className="md:col-span-7">
          <Skeleton className="h-[12px] w-[40%]" />
          <Skeleton className="mt-2 h-[44px] w-[75%]" />
          <Skeleton className="mt-1 h-[20px] w-[50%]" />
          <Skeleton className="mt-6 h-[80px] w-full" />
          <Skeleton className="mt-3 h-[160px] w-full" />
        </div>
        <div className="md:col-span-4 md:col-start-9">
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    </Container>
  )
}

function IssueProgress({ status }: { status: string }) {
  const idx = status === 'reverification' ? FLOW.length - 1 : FLOW.indexOf(status as (typeof FLOW)[number])
  return (
    <section className="mt-4" aria-label="Repair progress">
      <ol className="grid grid-cols-6 gap-0.5">
        {FLOW.map((s, i) => (
          <li key={s} className="flex flex-col gap-0.5" aria-current={i === idx ? 'step' : undefined}>
            <span className={cx('h-[3px]', i <= idx ? (i === idx ? 'bg-signal' : 'bg-ink') : 'bg-hair')} aria-hidden />
            <span className={cx('hidden text-xs sm:block', i === idx ? 'text-ink' : 'text-muted')}>{ISSUE_STATUS_LABEL[s]}</span>
          </li>
        ))}
      </ol>
      <p className="mt-0.5 text-sm text-muted sm:sr-only">
        Stage {idx + 1} of {FLOW.length}: {ISSUE_STATUS_LABEL[status]}
        {status === 'reverification' && ', waiting for community confirmation'}
      </p>
      {status === 'reverification' && <p className="mt-1 hidden text-sm text-muted sm:block">Marked fixed by staff. Waiting for someone on site to confirm.</p>}
    </section>
  )
}

function EvidenceSection({ evidence }: { evidence: Evidence[] }) {
  const [open, setOpen] = useState<Evidence | null>(null)
  const photos = evidence.filter((e) => e.type === 'photo' && e.url)
  const voices = evidence.filter((e) => e.type === 'voice')
  if (!photos.length && !voices.length) {
    return (
      <section className="mt-4 border-t border-hair pt-2">
        <h2 className="meta">Evidence</h2>
        <p className="mt-1 text-sm text-muted">No photo or voice note yet. A photo from someone nearby would raise confidence the most.</p>
      </section>
    )
  }
  return (
    <section className="mt-4 border-t border-hair pt-2" aria-labelledby="ev-h">
      <h2 id="ev-h" className="meta">Evidence</h2>
      {photos.length > 0 && (
        <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p)} className="block w-full border border-hair" aria-label={`Open photo ${i + 1} full size`}>
                <img src={apiUrl(p.url)} alt={(p.meta.alt_text as string) || `Evidence photo ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              </button>
              {(p.meta.role as string) === 'resolution' && <p className="mt-0.5 text-xs text-muted">Photo of the fix</p>}
            </li>
          ))}
        </ul>
      )}
      {voices.map((v) => (
        <figure key={v.id} className="mt-2 border-l-2 border-hair pl-2">
          {v.url ? <audio controls src={apiUrl(v.url)} className="h-5 max-w-full" aria-label="Voice note" /> : <p className="meta">Voice note transcript</p>}
          {v.transcription && <figcaption className="mt-0.5 text-sm italic">“{v.transcription}”</figcaption>}
        </figure>
      ))}
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Evidence photo" className="sm:max-w-[920px]">
        {open?.url && <img src={apiUrl(open.url)} alt={(open.meta.alt_text as string) || 'Evidence photo'} className="max-h-[70vh] w-full object-contain" />}
        {open && <p className="mt-1 text-sm text-muted">Uploaded {dateTime(open.created_at)}</p>}
      </Dialog>
    </section>
  )
}

function VerifyBox({ report: r, onUpdate }: { report: ReportDetail; onUpdate: (r: ReportDetail) => void }) {
  const user = useAuth((s) => s.user)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'yes' | 'no'>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  if (r.status === 'duplicate') return null

  async function send(still: boolean) {
    setBusy(still ? 'yes' : 'no')
    setError(null)
    try {
      onUpdate(await api.verifyReport(r.id, still, note || undefined))
      const msg = still ? 'Thanks, we’ve recorded that it’s still there.' : 'Thanks, staff will check whether it’s cleared.'
      setDone(msg)
      announce(msg)
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  const question = r.status === 'resolved' ? 'Staff say this is fixed. Is it?' : 'Were you here recently? Is it still there?'
  return (
    <section className="mt-6 border border-rule p-2 sm:p-3" aria-labelledby="verify-h">
      <h2 id="verify-h" className="font-display text-xl">{question}</h2>
      {done ? (
        <p className="mt-1">{done}</p>
      ) : user ? (
        <>
          <Field label="Note" optional className="mt-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[72px]" />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="secondary" busy={busy === 'yes'} onClick={() => send(true)}>Still there</Button>
            <Button variant="ghost" busy={busy === 'no'} onClick={() => send(false)}>It’s cleared</Button>
          </div>
          {error && <div className="mt-1"><ErrorNote error={error} /></div>}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">
          <Link to={`/login?next=/reports/${r.id}`}>Sign in</Link> to confirm or dispute this report.
        </p>
      )}
    </section>
  )
}

function OwnerActions({ report: r }: { report: ReportDetail }) {
  const user = useAuth((s) => s.user)
  const nav = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!user || (r.reporter !== user.display_name && !isStaff(user))) return null
  return (
    <div className="mt-6 border-t border-hair pt-2">
      <Button variant="danger" size="sm" onClick={() => setConfirm(true)} icon={<Icon name="trash" size={16} />}>
        Remove this report
      </Button>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Remove this report?">
        <p>It will disappear from the map and lists. Staff can still see it in the audit trail.</p>
        <div className="mt-3 flex gap-1">
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true)
              await api.deleteReport(r.id).catch(() => undefined)
              announce('Report removed')
              nav('/reports')
            }}
          >
            Remove
          </Button>
          <Button variant="quiet" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  )
}
