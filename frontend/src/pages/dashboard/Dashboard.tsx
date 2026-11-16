import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IssueStatusBadge, SeverityMark } from '@/components/common/Badge'
import { Button, ButtonLink } from '@/components/common/Button'
import { ConfidenceMeter } from '@/components/common/Confidence'
import { Field, Input, Select } from '@/components/common/Field'
import { Icon } from '@/components/common/Icon'
import { TableRowSkeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { CategoryGlyph } from '@/components/reports/ReportRow'
import { useAsync, useDebounced, useDocumentTitle } from '@/hooks/useAsync'
import { subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'
import type { IssueStatus } from '@/types'
import { cx } from '@/utils/cx'
import { ISSUE_STATUS_LABEL, timeAgo } from '@/utils/format'

const PIPELINE: IssueStatus[] = ['reported', 'under_review', 'confirmed', 'assigned', 'in_progress', 'resolved', 'reverification']
const LIMIT = 25

export default function Dashboard() {
  useDocumentTitle('Issue dashboard')
  const t = useTaxonomy()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'active'
  const priority = params.get('priority') ?? ''
  const category = params.get('category') ?? ''
  const assigned = params.get('assigned') ?? ''
  const sort = params.get('sort') ?? 'priority'
  const offset = Number(params.get('offset') ?? 0)
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q, 300)
  const [exporting, setExporting] = useState<string | null>(null)

  function set(k: string, v: string) {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    if (k !== 'offset') p.delete('offset')
    setParams(p, { replace: true })
  }
  useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set('q', dq)
  }, [dq]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useAsync(() => api.issueStats(), [])
  const statusFilter = status === 'active' ? PIPELINE.filter((s) => s !== 'resolved') : status === 'all' ? undefined : [status]
  const issues = useAsync(
    () => api.issues({ status: statusFilter, priority: priority ? [priority] : undefined, category: category ? [category] : undefined, assigned: assigned || undefined, q: dq, sort, offset, limit: LIMIT }),
    [status, priority, category, assigned, dq, sort, offset],
  )

  async function exportAs(fmt: 'csv' | 'json') {
    setExporting(fmt)
    try {
      const blob = await api.exportIssues(fmt)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `accesssignal-issues.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const total = issues.data?.total ?? 0

  return (
    <Container>
      <PageHeader
        eyebrow="Infrastructure management"
        title="Issue queue"
        aside={
          <div className="flex flex-wrap gap-1">
            <ButtonLink to="/analytics" variant="ghost" size="sm">Trends</ButtonLink>
          </div>
        }
      >
        Every non-duplicate report becomes an issue. Work the queue from the top: it’s ordered by priority, then confidence.
      </PageHeader>

      <nav aria-label="Issue pipeline" className="scroll-tray border-b border-hair">
        <ol className="flex min-w-[720px]">
          {PIPELINE.map((s, i) => {
            const n = stats.data?.by_status[s] ?? 0
            const active = status === s
            return (
              <li key={s} className="flex-1">
                <button
                  type="button"
                  onClick={() => set('status', active ? '' : s)}
                  aria-pressed={active}
                  className={cx('flex w-full flex-col items-start gap-0.5 border-r border-hair px-2 py-2 text-left transition-colors duration-150 last:border-r-0', active ? 'bg-ink text-paper' : 'hover:bg-hair')}
                >
                  <span className={cx('tabular font-mono text-xs', active ? 'text-paper/70' : 'text-muted')}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm">{ISSUE_STATUS_LABEL[s]}</span>
                  <span className="tabular font-display text-2xl leading-none">{stats.data ? n : '–'}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <form className="grid gap-2 py-3 sm:grid-cols-2 lg:grid-cols-12" role="search" aria-label="Filter issues" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" className="lg:col-span-3">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description or address" />
        </Field>
        <Field label="Status" className="lg:col-span-2">
          <Select value={status} onChange={(e) => set('status', e.target.value === 'active' ? '' : e.target.value)}>
            <option value="active">All unresolved</option>
            <option value="all">Everything</option>
            {PIPELINE.map((s) => <option key={s} value={s}>{ISSUE_STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Priority" className="lg:col-span-2">
          <Select value={priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Any</option>
            {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Category" className="lg:col-span-2">
          <Select value={category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Any</option>
            {t?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Assigned" className="lg:col-span-1">
          <Select value={assigned} onChange={(e) => set('assigned', e.target.value)}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Nobody</option>
          </Select>
        </Field>
        <Field label="Sort" className="lg:col-span-2">
          <Select value={sort} onChange={(e) => set('sort', e.target.value === 'priority' ? '' : e.target.value)}>
            <option value="priority">Priority</option>
            <option value="recent">Newest</option>
            <option value="updated">Recently updated</option>
            <option value="confidence">Confidence</option>
          </Select>
        </Field>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-1 pb-1">
        <p className="meta" aria-live="polite">{issues.loading ? 'Loading' : `${total} issue${total === 1 ? '' : 's'}`}</p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" busy={exporting === 'csv'} onClick={() => exportAs('csv')} icon={<Icon name="download" size={16} />}>CSV</Button>
          <Button size="sm" variant="ghost" busy={exporting === 'json'} onClick={() => exportAs('json')} icon={<Icon name="download" size={16} />}>JSON</Button>
        </div>
      </div>

      {issues.error && <ErrorNote error={issues.error} onRetry={issues.reload} />}

      <div className="scroll-tray border-y border-hair" tabIndex={0} role="region" aria-label="Issues table, scrolls horizontally on small screens">
        <table className="w-full min-w-[880px] text-left text-sm">
          <caption className="sr-only">Issues matching the filters</caption>
          <thead>
            <tr className="border-b border-hair">
              {['Priority', 'Barrier', 'Status', 'Assignee', 'Confidence', 'Updated'].map((h) => (
                <th key={h} scope="col" className="meta px-2 py-1 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.loading && !issues.data && Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={6} />)}
            {issues.data?.items.map((i) => (
              <tr
                key={i.id}
                className="cursor-pointer border-b border-hair transition-colors duration-150 last:border-0 hover:bg-hair"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return
                  nav(`/dashboard/issues/${i.id}`)
                }}
              >
                <td className="whitespace-nowrap px-2 py-2 align-top">
                  <SeverityMark value={{ critical: 0.9, high: 0.7, medium: 0.5, low: 0.2 }[i.priority]} />
                </td>
                <td className="px-2 py-2 align-top">
                  <div className="flex items-start gap-1">
                    <CategoryGlyph category={i.report.category} />
                    <div>
                      <Link to={`/dashboard/issues/${i.id}`} className="font-medium no-underline hover:underline">
                        {subLabel(t, i.report.category, i.report.subcategory)}
                      </Link>
                      <p className="text-muted">{i.report.address ?? `${i.report.lat.toFixed(4)}, ${i.report.lng.toFixed(4)}`}</p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 align-top"><IssueStatusBadge status={i.status} /></td>
                <td className="px-2 py-2 align-top">{i.assignee_name ?? <span className="text-muted">Unassigned</span>}</td>
                <td className="px-2 py-2 align-top"><ConfidenceMeter value={i.report.confidence_score} compact /></td>
                <td className="whitespace-nowrap px-2 py-2 align-top text-muted"><time dateTime={i.updated_at}>{timeAgo(i.updated_at)}</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <nav aria-label="Pagination" className="flex items-center justify-between py-2 text-sm">
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => set('offset', String(Math.max(0, offset - LIMIT)))} icon={<Icon name="chevronLeft" size={16} />}>Previous</Button>
          <span className="tabular text-muted">{offset + 1}–{Math.min(total, offset + LIMIT)} of {total}</span>
          <Button size="sm" variant="ghost" disabled={offset + LIMIT >= total} onClick={() => set('offset', String(offset + LIMIT))}>Next <Icon name="chevronRight" size={16} /></Button>
        </nav>
      )}
      <div className="pb-8" />
    </Container>
  )
}
