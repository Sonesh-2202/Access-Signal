import type { ConfidenceBreakdown } from '@/types'
import { confidenceWord } from '@/utils/format'

const FACTOR_LABEL: Record<string, string> = {
  evidence: 'Evidence',
  corroboration: 'Independent reports',
  recency: 'Recency',
  credibility: 'Reporter history',
}

/** Compact meter: a single hairline track with a filled portion and a numeric readout. */
export function ConfidenceMeter({ value, compact }: { value: number; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" title={confidenceWord(value)}>
      <span className="relative inline-block h-[4px] w-6 bg-hair" aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="tabular font-mono text-xs text-ink">{Math.round(value * 100)}</span>
      {!compact && <span className="text-sm text-muted">{confidenceWord(value).toLowerCase()}</span>}
      {compact && <span className="sr-only">{confidenceWord(value)}</span>}
    </span>
  )
}

/** Full breakdown: each weighted factor with its reason, so people see why a report is trusted. */
export function ConfidenceBreakdownView({ data }: { data: ConfidenceBreakdown }) {
  const entries = Object.entries(data.factors) as [keyof typeof data.factors, { value: number; weight: number }][]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-4xl leading-none tabular">{Math.round(data.score * 100)}</p>
        <p className="text-sm text-muted">{confidenceWord(data.score)}</p>
      </div>
      <dl className="mt-3 flex flex-col">
        {entries.map(([k, f], i) => (
          <div key={k} className="grid grid-cols-[1fr_auto] gap-x-2 border-t border-hair py-1">
            <dt className="text-sm font-medium">{FACTOR_LABEL[k]}</dt>
            <dd className="tabular font-mono text-xs text-muted">
              {Math.round(f.value * 100)} × {f.weight}
            </dd>
            <dd className="col-span-2 mt-0.5">
              <span className="relative block h-[3px] bg-hair" aria-hidden>
                <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${f.value * 100}%` }} />
              </span>
              <span className="mt-0.5 block text-sm text-muted">{data.explanation[i]}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
