import { create } from 'zustand'

/**
 * Where read data is coming from.
 *   unknown  no request has finished yet
 *   live     the AccessSignal API answered
 *   demo     the API was unreachable; pages are served from the local dataset
 *
 * Once a session drops to demo it stays there, so pages don't mix live and local rows.
 */
export type DataMode = 'unknown' | 'live' | 'demo'

export const useDataSource = create<{ mode: DataMode; reason: string | null }>(() => ({ mode: 'unknown', reason: null }))

export function markLive() {
  if (useDataSource.getState().mode === 'unknown') useDataSource.setState({ mode: 'live' })
}

export function markDemo(reason: string) {
  if (useDataSource.getState().mode !== 'demo') {
    useDataSource.setState({ mode: 'demo', reason })
    if (import.meta.env.DEV) console.info(`[AccessSignal] API unavailable (${reason}). Using the local demo dataset.`)
  }
}

export const isDemo = () => useDataSource.getState().mode === 'demo'
