import { Link } from 'react-router-dom'
import { catLabel, subLabel, useTaxonomy } from '@/hooks/useTaxonomy'
import type { ReportSummary } from '@/types'
import { cx } from '@/utils/cx'
import { timeAgo } from '@/utils/format'
import { IssueStatusBadge, SeverityMark } from '../common/Badge'
import { ConfidenceMeter } from '../common/Confidence'
import { Icon } from '../common/Icon'

export function CategoryGlyph({ category, className }: { category: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center text-ink', className)} aria-hidden>
      <Icon name={category} size={20} />
    </span>
  )
}

interface Props {
  report: ReportSummary
  active?: boolean
  onHover?: (id: string | null) => void
  compact?: boolean
  headingLevel?: 'h2' | 'h3'
}

export function ReportRow({ report: r, active, onHover, compact, headingLevel: H = 'h3' }: Props) {
  const t = useTaxonomy()
  return (
    <article
      className={cx(
        'group relative grid grid-cols-[32px_1fr] gap-x-1 border-b border-hair py-2 transition-colors duration-150',
        active && 'bg-tint/50',
      )}
      onMouseEnter={() => onHover?.(r.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <CategoryGlyph category={r.category} className="mt-[2px]" />
      <div className="min-w-0">
        <p className="meta flex flex-wrap items-center gap-x-1">
          <span>{catLabel(t, r.category)}</span>
          <span aria-hidden>·</span>
          <time dateTime={r.reported_at}>{timeAgo(r.reported_at)}</time>
          {r.status === 'resolved' && (
            <>
              <span aria-hidden>·</span>
              <span>Resolved</span>
            </>
          )}
        </p>
        <H className="mt-0.5 font-sans text-base font-medium leading-snug">
          <Link to={`/reports/${r.id}`} className="no-underline after:absolute after:inset-0 hover:underline">
            {subLabel(t, r.category, r.subcategory)}
            {r.address && <span className="font-normal text-muted">, {r.address}</span>}
          </Link>
        </H>
        {!compact && r.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{r.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <SeverityMark value={r.severity_score} />
          <ConfidenceMeter value={r.confidence_score} compact />
          {r.issue_status && r.issue_status !== 'reported' && <IssueStatusBadge status={r.issue_status} />}
          {r.evidence_count > 0 && (
            <span className="text-xs text-muted">
              {r.evidence_count} evidence item{r.evidence_count > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
