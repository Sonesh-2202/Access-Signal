import { create } from 'zustand'

/**
 * Where read data is coming from.
 *   unknown  no request has finished yet
 *   live     the AccessSignal API answered
 *   waking   hosted demo only: the API is asleep (free hosting idles it). Pages read the
 *            local dataset while a background loop pings /api/health with backoff.
 *   demo     the API was unreachable; pages are served from the local dataset
 *
 * Once a session drops to demo it stays there, so pages don't mix live and local rows.
 * The exception is waking -> live: `epoch` goes up and every useAsync refetches.
 */
export type DataMode = 'unknown' | 'live' | 'waking' | 'demo'

interface DataSourceState {
  mode: DataMode
  reason: string | null
  /** Bumped when live data becomes available after a wake-up, so pages refetch. */
  epoch: number
  /** Health pings made in the current wake-up. */
  attempt: number
  /** Set briefly after a successful wake-up so the banner can say so. */
  wokeAt: number | null
}

export const useDataSource = create<DataSourceState>(() => ({ mode: 'unknown', reason: null, epoch: 0, attempt: 0, wokeAt: null }))

export function markLive() {
  if (useDataSource.getState().mode === 'unknown') useDataSource.setState({ mode: 'live' })
}

export function markDemo(reason: string) {
  if (useDataSource.getState().mode !== 'demo') {
    useDataSource.setState({ mode: 'demo', reason })
    if (import.meta.env.DEV) console.info(`[AccessSignal] API unavailable (${reason}). Using the local demo dataset.`)
  }
}

/** True while pages should read the local dataset (asleep or unreachable). */
export const isDemo = () => {
  const m = useDataSource.getState().mode
  return m === 'demo' || m === 'waking'
}

/* ------------------------------------------------------------------ cold-start handling */

/** Delays between health pings, in ms. About 2.5 minutes in total, enough for a free host. */
export const WAKE_SCHEDULE = [1500, 3000, 5000, 8000, 10_000, 12_000, 15_000, 15_000, 15_000, 15_000, 15_000, 15_000, 15_000]

let waking: Promise<boolean> | null = null
let pingImpl: () => Promise<boolean> = async () => false
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Wired up by the API module; tests replace these. */
export function configureWake(ping: () => Promise<boolean>, wait?: (ms: number) => Promise<void>) {
  pingImpl = ping
  if (wait) sleep = wait
}

/**
 * Start (or join) a wake-up loop. Resolves true once /api/health answers, false if the
 * server stays down for the whole schedule, in which case the session drops to demo.
 */
export function beginWaking(reason: string): Promise<boolean> {
  const s = useDataSource.getState()
  if (s.mode === 'live' && !waking) return Promise.resolve(true)
  if (waking) return waking
  useDataSource.setState({ mode: 'waking', reason, attempt: 0 })
  waking = (async () => {
    try {
      for (const delay of [0, ...WAKE_SCHEDULE]) {
        if (delay) await sleep(delay)
        useDataSource.setState((st) => ({ attempt: st.attempt + 1 }))
        if (await pingImpl().catch(() => false)) {
          useDataSource.setState((st) => ({ mode: 'live', reason: null, epoch: st.epoch + 1, wokeAt: Date.now() }))
          return true
        }
      }
      useDataSource.setState({ mode: 'demo', reason: `${reason}; no answer after ${WAKE_SCHEDULE.length + 1} tries` })
      return false
    } finally {
      waking = null
    }
  })()
  return waking
}

/** Resolves when a wake-up in progress finishes (true if the API is up). */
export function whenAwake(): Promise<boolean> {
  return waking ?? Promise.resolve(useDataSource.getState().mode !== 'demo')
}

/** Test hook. */
export function resetWake() {
  waking = null
}
