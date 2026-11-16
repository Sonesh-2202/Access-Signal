import type { ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { ISSUE_STATUS_LABEL, VERIFICATION_LABEL, severityBand } from '@/utils/format'
import type { FeatureStatus, Verification } from '@/types'

type Tone = 'neutral' | 'tint' | 'signal' | 'ink' | 'outline'

const tones: Record<Tone, string> = {
  neutral: 'bg-hair text-ink',
  tint: 'bg-tint text-ink',
  signal: 'bg-signal-wash text-signal-deep',
  ink: 'bg-ink text-paper',
  outline: 'border border-rule text-ink',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 whitespace-nowrap rounded-sm px-1 py-[2px] font-mono text-xs uppercase tracking-[0.06em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Severity mark: filled/outlined squares, so the level reads without colour.
 *   critical ■■■■  high ■■■□  medium ■■□□  low ■□□□
 */
export function SeverityMark({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const band = severityBand(value)
  const n = { critical: 4, high: 3, medium: 2, low: 1 }[band]
  return (
    <span className="inline-flex items-center gap-1" title={`Severity ${Math.round(value * 100)} of 100`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx(
              'h-[10px] w-[6px]',
              i < n ? (band === 'critical' ? 'bg-signal' : 'bg-ink') : 'border border-rule',
            )}
          />
        ))}
      </span>
      {showLabel ? (
        <span className={cx('text-sm capitalize', band === 'critical' && 'text-signal-deep font-medium')}>{band}</span>
      ) : (
        <span className="sr-only">{band} severity</span>
      )}
    </span>
  )
}

export function IssueStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === 'resolved' ? 'outline' : status === 'reverification' ? 'tint' : status === 'reported' ? 'neutral' : 'ink'
  return <Badge tone={tone}>{ISSUE_STATUS_LABEL[status] ?? status}</Badge>
}

export function VerificationBadge({ status }: { status: Verification }) {
  const tone: Tone = status === 'verified' ? 'ink' : status === 'disputed' ? 'signal' : status === 'unverified' ? 'outline' : 'tint'
  return <Badge tone={tone}>{VERIFICATION_LABEL[status] ?? status}</Badge>
}

const FEATURE_TEXT: Record<FeatureStatus, string> = {
  available: 'Working',
  limited: 'Limited',
  unavailable: 'Not working',
  unknown: 'Unknown',
}

export function FeatureStatusMark({ status }: { status: FeatureStatus }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-sm">
      <span
        aria-hidden
        className={cx(
          'inline-block h-[10px] w-[10px] shrink-0',
          status === 'available' && 'rounded-full bg-ink',
          status === 'limited' && 'rounded-full border-2 border-ink',
          status === 'unavailable' && 'rotate-45 bg-signal',
          status === 'unknown' && 'rounded-full border border-dashed border-muted',
        )}
      />
      <span className={cx(status === 'unavailable' && 'font-medium text-signal-deep', status === 'unknown' && 'text-muted')}>
        {FEATURE_TEXT[status]}
      </span>
    </span>
  )
}
