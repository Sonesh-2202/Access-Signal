import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IssueStatusBadge, SeverityMark } from '@/components/common/Badge'
import { Button } from '@/components/common/Button'
import { ConfidenceBreakdownView } from '@/components/common/Confidence'
import { Field, Select, Textarea } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { Skeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote } from '@/components/layout/Layout'
import { CategoryGlyph, ReportRow } from '@/components/reports/ReportRow'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api, apiUrl } from '@/services/api'
import type { Evidence, IssueDetail } from '@/types'
import { aiSourceShort } from '@/utils/aiSource'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { dateTime, ISSUE_STATUS_LABEL, timeAgo } from '@/utils/format'

export default function IssueDetailPage() {
  const { id = '' } = useParams()
  const t = useTaxonomy()
  const { data: issue, loading, error, reload, setData } = useAsync(() => api.issue(id), [id])
  const assignees = useAsync(() => api.assignees(), [])
  useDocumentTitle(issue ? `Issue: ${subLabel(t, issue.report.category, issue.report.subcategory)}` : 'Issue')

  if (loading && !issue) {
    return (
      <Container className="py-8">
        <div role="status" aria-label="Loading issue">
          <Skeleton className="h-[40px] w-[50%]" />
          <Skeleton className="mt-4 h-[300px] w-full" />
        </div>
      </Container>
    )
  }
  if (error) return <Container className="py-8"><ErrorNote error={error} onRetry={reload} /></Container>
  if (!issue) return null
  const r = issue.report_detail

  return (
    <Container className="py-4 md:py-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/dashboard">Issue queue</Link> <span aria-hidden>/</span> Issue
      </nav>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-2 border-b border-hair pb-3">
        <div>
          <p className="meta flex items-center gap-1"><CategoryGlyph category={r.category} />Opened {timeAgo(issue.created_at)} · {issue.priority} priority</p>
          <h1 className="mt-1 text-3xl leading-snug tracking-[-0.015em]">{subLabel(t, r.category, r.subcategory)}</h1>
          <p className="text-muted">{r.address}{r.place_name && ` · ${r.place_name}`}</p>
        </div>
        <div className="flex items-center gap-1">
          <IssueStatusBadge status={issue.status} />
          <Link to={`/reports/${r.id}`} className="text-sm">Public report</Link>
        </div>
      </header>

      <div className="grid gap-6 py-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <section aria-labelledby="sum-h">
            <h2 id="sum-h" className="sr-only">Report summary</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityMark value={r.severity_score} />
              <span className="text-sm text-muted">Reported by {r.reporter ?? 'unknown'} {timeAgo(r.reported_at)}</span>
            </div>
            {r.description && <p className="mt-2 max-w-prose text-lg leading-relaxed">{r.description}</p>}
            {r.ai_analysis && (
              <p className="mt-1 text-sm text-muted">
                {aiSourceShort(r.ai_analysis.source)}: {r.ai_analysis.summary}
              </p>
            )}
          </section>

          <EvidenceGrid evidence={r.evidence} />

          {r.corroborating.length > 0 && (
            <section aria-labelledby="cor-h">
              <h2 id="cor-h" className="meta">Corroborating reports ({r.corroborating.length})</h2>
              {r.corroborating.map((c) => <ReportRow key={c.id} report={c} compact />)}
            </section>
          )}

          <section aria-labelledby="hist-h">
            <h2 id="hist-h" className="text-2xl">Audit trail</h2>
            <ol className="mt-2 border-l border-rule">
              {[...issue.history].reverse().map((h) => (
                <li key={h.id} className="relative pb-2 pl-3">
                  <span aria-hidden className={cx('absolute -left-[4px] top-[8px] h-[7px] w-[7px] rounded-full', h.old_status !== h.new_status ? 'bg-ink' : 'border border-muted bg-paper')} />
                  <p className="meta"><time dateTime={h.changed_at}>{dateTime(h.changed_at)}</time> · {h.actor_name}</p>
                  {h.old_status !== h.new_status && (
                    <p className="font-medium">
                      {h.old_status ? `${ISSUE_STATUS_LABEL[h.old_status]} → ` : ''}{ISSUE_STATUS_LABEL[h.new_status]}
                    </p>
                  )}
                  {h.notes && <p className={cx('text-sm', h.notes.startsWith('Access Monitor:') ? 'font-mono text-xs text-muted' : '')}>{h.notes}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="lg:col-span-5" aria-label="Update issue">
          <div className="flex flex-col gap-3 lg:sticky lg:top-[88px]">
            <UpdateForm issue={issue} assignees={assignees.data ?? []} onSaved={setData} />
            <section className="border border-hair bg-paper-raised p-2" aria-labelledby="ic-h">
              <h2 id="ic-h" className="meta mb-1">Report confidence</h2>
              <ConfidenceBreakdownView data={r.confidence_breakdown} />
            </section>
          </div>
        </aside>
      </div>
    </Container>
  )
}

function EvidenceGrid({ evidence }: { evidence: Evidence[] }) {
  const photos = evidence.filter((e) => e.type === 'photo' && e.url)
  const voice = evidence.filter((e) => e.type === 'voice')
  if (!photos.length && !voice.length) return <p className="text-sm text-muted">No photo or voice evidence attached.</p>
  return (
    <section aria-labelledby="evi-h">
      <h2 id="evi-h" className="meta">Evidence</h2>
      <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
        {photos.map((p, i) => (
          <li key={p.id}>
            <a href={apiUrl(p.url)} target="_blank" rel="noreferrer" className="block border border-hair">
              <img src={apiUrl(p.url)} alt={(p.meta.alt_text as string) || `Evidence photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
            </a>
            {(p.meta.role as string) === 'resolution' && <p className="text-xs text-muted">Resolution photo</p>}
          </li>
        ))}
      </ul>
      {voice.map((v) => (
        <div key={v.id} className="mt-1 border-l-2 border-hair pl-2">
          {v.url && <audio controls src={apiUrl(v.url)} className="h-5" aria-label="Voice note" />}
          {v.transcription && <p className="text-sm italic">“{v.transcription}”</p>}
        </div>
      ))}
    </section>
  )
}

function UpdateForm({ issue, assignees, onSaved }: { issue: IssueDetail; assignees: { id: string; display_name: string }[]; onSaved: (i: IssueDetail) => void }) {
  const [status, setStatus] = useState('')
  const [assignee, setAssignee] = useState(issue.assigned_to ?? '')
  const [priority, setPriority] = useState(issue.priority)
  const [notes, setNotes] = useState('')
  const [resolution, setResolution] = useState(issue.resolution_notes ?? '')
  const [photo, setPhoto] = useState<{ file: File; url: string; ev?: Evidence; status: 'uploading' | 'done' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setStatus('')
    setAssignee(issue.assigned_to ?? '')
    setPriority(issue.priority)
    setNotes('')
  }, [issue])

  const resolving = status === 'resolved'
  const dirty = status || notes.trim() || priority !== issue.priority || assignee !== (issue.assigned_to ?? '')

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (status) body.status = status
      if (notes.trim()) body.notes = notes.trim()
      if (priority !== issue.priority) body.priority = priority
      if (assignee !== (issue.assigned_to ?? '')) {
        if (assignee) body.assigned_to = assignee
        else body.unassign = true
      }
      if (resolving) {
        body.resolution_notes = resolution
        if (photo?.ev) body.resolution_evidence_id = photo.ev.id
      }
      const updated = await api.updateIssue(issue.id, body)
      onSaved(updated)
      setPhoto(null)
      announce(status ? `Issue moved to ${ISSUE_STATUS_LABEL[status]}` : 'Issue updated')
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }

  function pickPhoto(f: File | undefined) {
    if (!f) return
    const p = { file: f, url: URL.createObjectURL(f), status: 'uploading' as const }
    setPhoto(p)
    api.uploadEvidence(f, f.name).then((ev) => setPhoto({ ...p, ev, status: 'done' })).catch(() => setPhoto({ ...p, status: 'error' }))
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 border border-rule p-2" aria-labelledby="upd-h">
      <h2 id="upd-h" className="font-display text-xl">Update</h2>
      {error && <ErrorNote error={error} />}
      <Field label="Move to" hint={issue.allowed_transitions.length ? undefined : 'No further transitions from this state.'}>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!issue.allowed_transitions.length}>
          <option value="">Keep as {ISSUE_STATUS_LABEL[issue.status].toLowerCase()}</option>
          {issue.allowed_transitions.map((s) => <option key={s} value={s}>{ISSUE_STATUS_LABEL[s]}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-1">
        <Field label="Assignee" hint={status === 'assigned' && !assignee ? 'Required to mark assigned' : undefined}>
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </Select>
        </Field>
      </div>
      {resolving && (
        <div className="fade-up flex flex-col gap-2 border-l-2 border-ink pl-2">
          <Field label="What was done" hint="Shown publicly on the report. At least 10 characters." error={resolution.trim().length > 0 && resolution.trim().length < 10 ? 'Add a little more detail' : null}>
            <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <div>
            <p className="text-sm font-medium">Photo of the fix <span className="font-normal text-muted">optional</span></p>
            {photo ? (
              <div className="mt-0.5 flex items-center gap-1">
                <img src={photo.url} alt="The completed fix, as selected for upload" className="h-8 w-8 border border-hair object-cover" />
                <span className="text-sm text-muted">{photo.status === 'uploading' ? 'Uploading…' : photo.status === 'error' ? 'Upload failed' : 'Attached'}</span>
                <button type="button" className="min-h-touch text-sm underline" onClick={() => setPhoto(null)}>Remove</button>
              </div>
            ) : (
              <label className="mt-0.5 inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-sm border border-hair px-2 text-sm hover:border-rule has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal">
                <Icon name="upload" size={16} /> Choose photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickPhoto(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
      )}
      <Field label="Note for the audit trail" optional>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[72px]" />
      </Field>
      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!dirty || photo?.status === 'uploading' || (resolving && resolution.trim().length < 10)}>
          Save
        </Button>
      </div>
    </form>
  )
}
