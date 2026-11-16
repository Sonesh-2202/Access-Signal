import { useEffect, useState } from 'react'
import { beginWaking, useDataSource } from '@/stores/dataSource'

/**
 * Hosted demo only. The free API host sleeps when idle and takes up to a minute to
 * start. While it does, pages show the bundled demo dataset and this banner says so,
 * instead of an error. When /api/health answers, pages reload live data by themselves.
 */
export function WakeBanner() {
  const { mode, attempt, wokeAt, reason } = useDataSource()
  const [showAwake, setShowAwake] = useState(false)

  useEffect(() => {
    if (!wokeAt) return
    setShowAwake(true)
    const t = setTimeout(() => setShowAwake(false), 6000)
    return () => clearTimeout(t)
  }, [wokeAt])

  const gaveUp = mode === 'demo' && !!reason?.includes('no answer after')
  if (mode !== 'waking' && !showAwake && !gaveUp) return null

  return (
    <div role="status" aria-live="polite" className="border-b border-hair bg-paper-sunk">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1 text-sm sm:px-4">
        {mode === 'waking' ? (
          <>
            <span aria-hidden className="h-1 w-1 animate-pulse rounded-full bg-signal" />
            <span className="font-medium">Demo server waking up — retrying…</span>
            <span className="text-muted">
              Free hosting sleeps when nobody is using it; this takes up to a minute. You’re seeing saved demo data until it answers
              {attempt > 1 ? ` (try ${attempt})` : ''}.
            </span>
          </>
        ) : gaveUp ? (
          <>
            <span className="font-medium">The demo server didn’t wake up.</span>
            <span className="text-muted">You’re seeing the saved demo dataset. Signing in and filing reports need the server.</span>
            <button type="button" className="min-h-touch underline" onClick={() => void beginWaking('retry requested')}>
              Try again
            </button>
          </>
        ) : (
          <span className="font-medium">Demo server is awake. Showing live data.</span>
        )}
      </div>
    </div>
  )
}
