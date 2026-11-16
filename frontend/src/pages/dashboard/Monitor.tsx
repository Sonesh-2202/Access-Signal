import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/common/Badge'
import { Button } from '@/components/common/Button'
import { Checkbox, Field, Input, Select } from '@/components/common/Field'
import { Skeleton } from '@/components/common/Skeleton'
import { Container, ErrorNote, PageHeader } from '@/components/layout/Layout'
import { useAsync, useDocumentTitle } from '@/hooks/useAsync'
import { subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import { api } from '@/services/api'

const DESCRIPTIONS: Record<string, string> = {
  intake: 'Checks a new report for missing evidence and nearby duplicates, then suggests a priority. Moves well-supported reports to review.',
  evidence_analysis: 'Runs the local model over the report’s photos and text and flags disagreement with the reporter’s category.',
  duplicate_investigation: 'Scans every open report for unlinked duplicates and proposes merges. Never merges on its own.',
  hotspot_analysis: 'Re-clusters open reports and writes a briefing for each hotspot with a recommended escalation.',
  stale_followup: 'Finds issues with no activity and resolved issues that were never reverified.',
}

type Result = Record<string, unknown> & { actions?: { issue_id: string; kind: string; detail: string; applied: boolean }[] }

export default function Monitor() {
  useDocumentTitle('Access Monitor')
  const t = useTaxonomy()
  const agents = useAsync(() => api.agents(), [])
  const open = useAsync(() => api.issues({ status: ['reported', 'under_review', 'confirmed'], sort: 'recent', limit: 50 }), [])
  const [results, setResults] = useState<Record<string, Result | Error>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [reportId, setReportId] = useState('')
  const [days, setDays] = useState(14)
  const [apply, setApply] = useState(false)

  async function run(name: string, needsReport: boolean) {
    setRunning(name)
    try {
      const r = await api.runAgent(name, { report_id: needsReport ? reportId : undefined, apply, days })
      setResults((x) => ({ ...x, [name]: r as Result }))
    } catch (e) {
      setResults((x) => ({ ...x, [name]: e as Error }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <Container>
      <PageHeader eyebrow="Automation" title="Access Monitor">
        Five narrow agents that do first-pass triage. They run as a dry run unless you allow changes, and every change they make is written to the issue’s audit trail under “Access Monitor”.
      </PageHeader>

      <div className="grid gap-6 py-4 lg:grid-cols-12">
        <aside className="lg:col-span-4" aria-labelledby="opts-h">
          <div className="flex flex-col gap-2 lg:sticky lg:top-[88px]">
            <h2 id="opts-h" className="meta">Run options</h2>
            <Field label="Report for intake and evidence agents">
              <Select value={reportId} onChange={(e) => setReportId(e.target.value)}>
                <option value="">Choose an open report…</option>
                {open.data?.items.map((i) => (
                  <option key={i.report.id} value={i.report.id}>
                    {subLabel(t, i.report.category, i.report.subcategory)} · {i.report.address ?? i.report.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stale after (days)">
              <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} />
            </Field>
            <Checkbox label="Allow changes" description="Off: agents only report what they would do." checked={apply} onChange={(e) => setApply(e.target.checked)} />
          </div>
        </aside>

        <section className="lg:col-span-8" aria-label="Agents">
          {agents.loading && <Skeleton className="h-[320px] w-full" />}
          {agents.error && <ErrorNote error={agents.error} onRetry={agents.reload} />}
          <ol>
            {agents.data &&
              Object.entries(agents.data.agents).map(([name, spec], idx) => {
                const res = results[name]
                return (
                  <li key={name} className="border-t border-hair py-3 last:border-b">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <div>
                        <p className="meta">Agent {String(idx + 1).padStart(2, '0')}</p>
                        <h3 className="mt-0.5 font-display text-xl">{spec.title}</h3>
                        <p className="mt-0.5 max-w-prose text-sm text-muted">{DESCRIPTIONS[name]}</p>
                        <p className="mt-1 flex flex-wrap gap-0.5">
                          {spec.tools.map((tool) => <Badge key={tool} tone="outline">{tool}</Badge>)}
                        </p>
                      </div>
                      <div className="self-start">
                        <Button
                          variant={apply ? 'primary' : 'secondary'}
                          busy={running === name}
                          disabled={spec.needs_report && !reportId}
                          onClick={() => run(name, spec.needs_report)}
                        >
                          {apply ? 'Run and apply' : 'Dry run'}
                        </Button>
                        {spec.needs_report && !reportId && <p className="mt-0.5 text-xs text-muted">Choose a report first</p>}
                      </div>
                    </div>
                    {res && (
                      <div className="fade-up mt-2" aria-live="polite">
                        {res instanceof Error ? <ErrorNote error={res} /> : <ResultView name={name} data={res} />}
                      </div>
                    )}
                  </li>
                )
              })}
          </ol>
        </section>
      </div>
    </Container>
  )
}

function ResultView({ name, data }: { name: string; data: Result }) {
  const summary = (() => {
    switch (name) {
      case 'intake':
        return `Completeness ${Math.round(Number(data.completeness) * 100)}%. Missing: ${(data.missing as string[]).join(', ') || 'nothing'}. Suggested priority ${data.suggested_priority}. ${(data.duplicate_candidates as unknown[]).length} possible duplicate(s).`
      case 'evidence_analysis':
        return `${data.model_source === 'lmstudio' ? 'Local AI' : 'Keyword classifier'} ${data.agrees ? 'agrees with' : 'disagrees with'} the reporter. ${data.model_summary}`
      case 'duplicate_investigation':
        return `Scanned ${data.scanned} open reports. Found ${(data.clusters as unknown[]).length} likely duplicate cluster(s).`
      case 'hotspot_analysis':
        return `${(data.hotspots as unknown[]).length} hotspot(s) briefed.`
      default:
        return `${(data.items as unknown[]).length} issue(s) need follow-up (threshold ${data.threshold_days} days).`
    }
  })()
  const actions = data.actions ?? []
  return (
    <div className="border-l-2 border-ink pl-2">
      <p>{summary}</p>
      {name === 'hotspot_analysis' && (
        <ul className="mt-1 text-sm">
          {(data.hotspots as { hotspot_id: string; label: string | null; report_count: number; trend: string; recommendation: string }[]).map((h) => (
            <li key={h.hotspot_id} className="border-t border-hair py-0.5">
              <span className="font-medium">{h.label ?? 'Unnamed area'}</span> · {h.report_count} reports, {h.trend}. {h.recommendation}
            </li>
          ))}
        </ul>
      )}
      {name === 'stale_followup' && (
        <ul className="mt-1 text-sm">
          {(data.items as { issue_id: string; reason: string; status: string }[]).slice(0, 8).map((i) => (
            <li key={i.issue_id} className="border-t border-hair py-0.5">
              <Link to={`/dashboard/issues/${i.issue_id}`}>{i.reason}</Link> <span className="text-muted">({i.status.replace('_', ' ')})</span>
            </li>
          ))}
        </ul>
      )}
      {actions.length > 0 && (
        <div className="mt-1">
          <p className="meta">{actions.some((a) => a.applied) ? 'Applied' : 'Would apply'} · {actions.length} action(s)</p>
          <ul className="mt-0.5 text-sm">
            {actions.slice(0, 10).map((a, i) => (
              <li key={i} className="flex gap-1">
                <span className="font-mono text-xs text-muted">{a.kind}</span>
                <Link to={`/dashboard/issues/${a.issue_id}`}>{a.detail}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="mt-1">
        <summary className="inline-flex min-h-touch cursor-pointer items-center text-sm text-muted underline">Structured output</summary>
        <pre tabIndex={0} role="region" aria-label="Agent output as JSON" className="scroll-tray mt-1 max-h-[320px] overflow-y-auto bg-paper-sunk p-1 font-mono text-xs">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  )
}
