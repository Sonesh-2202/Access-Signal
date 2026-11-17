import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { PreflightBrief, PreflightSummary } from '@/types'
import { aiSourceShort } from '@/utils/aiSource'
import { announce } from '@/utils/announce'
import { cx } from '@/utils/cx'

const STATUS_NOTE: Record<PreflightBrief['status'], string> = {
  good: 'No open reports, and the recorded entrance, ramp and elevator are available.',
  caution: 'Check before you go. Something here may slow you down or need a detour.',
  blocked: 'A wheelchair user may not be able to get through. Plan another route or ask ahead.',
}

/**
 * The preflight brief: one status, its reasons with the record each one comes from, and an
 * optional AI summary. The status and the reasons come from the rules and are public. The AI
 * summary is written only from the same records, and it says which source wrote it.
 */
export function PreflightCard({ placeId }: { placeId: string }) {
  const user = useAuth((s) => s.user)
  const headingId = useId()
  const srId = useId()
  const [brief, setBrief] = useState<PreflightBrief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<PreflightSummary | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setBrief(null)
    setSummary(null)
    api
      .preflight(placeId)
      .then(setBrief)
      .catch((e: Error) => setError(e.message))
  }, [placeId])

  async function writeSummary() {
    setBusy(true)
    try {
      const s = await api.preflightSummary(placeId)
      setSummary(s)
      announce('Summary ready')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <section aria-labelledby={headingId} className="mt-4 border border-hair p-2">
        <h2 id={headingId} className="text-lg">
          Before you go
        </h2>
        <p role="alert" className="mt-1 text-sm text-signal">
          {error}
        </p>
      </section>
    )
  }
  if (!brief) {
    return (
      <div role="status" className="mt-4 text-sm text-muted">
        Checking this place…
      </div>
    )
  }

  return (
    <section aria-labelledby={headingId} aria-describedby={srId} className="mt-4 border border-hair bg-paper-raised p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h2 id={headingId} className="text-lg">
          Before you go
        </h2>
        <p className={cx('text-sm font-medium', brief.status === 'blocked' && 'text-signal-deep')}>
          Status: {brief.status_label}
        </p>
      </div>
      <p className="mt-0.5 text-sm text-muted">{STATUS_NOTE[brief.status]}</p>
      <p id={srId} className="sr-only">
        {brief.screen_reader}
      </p>

      <ul className="mt-1 flex flex-col gap-0.5 text-sm">
        {brief.reasons.map((r) => (
          <li key={r} className="flex gap-1">
            <span aria-hidden className="mt-[10px] h-px w-1 shrink-0 bg-ink" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {brief.sources.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Sources:{' '}
          {brief.sources.map((s, i) => (
            <span key={`${s.kind}-${s.url}`}>
              {i > 0 && ', '}
              <span className="font-mono">[{s.tag}]</span>{' '}
              <Link to={s.url} className="underline">
                {s.label}
              </Link>
            </span>
          ))}
        </p>
      )}

      <div className="mt-2 border-t border-hair pt-1">
        {summary ? (
          <div>
            <p className="meta">
              Summary · {summary.source === 'rules' ? 'Rule-based (no cloud AI answered)' : aiSourceShort(summary.source)}
            </p>
            <p className="mt-0.5 text-sm">{summary.summary}</p>
          </div>
        ) : user ? (
          <Button type="button" variant="ghost" size="sm" busy={busy} onClick={writeSummary}>
            Write a short summary with AI
          </Button>
        ) : (
          <p className="text-sm text-muted">
            <Link to="/login" className="underline">
              Sign in
            </Link>{' '}
            for a short AI summary of these records.
          </p>
        )}
      </div>
    </section>
  )
}
