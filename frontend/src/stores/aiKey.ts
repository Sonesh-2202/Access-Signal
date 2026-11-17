import { create } from 'zustand'
import type { CloudProvider } from '@/types'

/**
 * A personal AI key for the hosted demo ("bring your own key").
 *
 * Held in memory and in this tab's sessionStorage only: it survives a page refresh but
 * is gone when the tab closes, and it is never written to localStorage or sent to the
 * server for storage. It goes out as X-AI-Provider / X-AI-Key on classification and
 * route-description and translation requests only. Anyone with access to this browser tab can read it, which is
 * acceptable for a judge's demo session and not for public users.
 */
const KEY = 'accesssignal.aiKey'

interface AIKeyState {
  provider: CloudProvider
  key: string
}

function load(): AIKeyState | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as AIKeyState) : null
    return v && typeof v.key === 'string' && ['gemini', 'groq', 'nebius'].includes(v.provider) ? v : null
  } catch {
    return null
  }
}

export const useAIKey = create<{ value: AIKeyState | null }>(() => ({ value: typeof sessionStorage === 'undefined' ? null : load() }))

export function setAIKey(provider: CloudProvider, key: string) {
  const value = { provider, key: key.trim() }
  sessionStorage.setItem(KEY, JSON.stringify(value))
  useAIKey.setState({ value })
}

export function clearAIKey() {
  sessionStorage.removeItem(KEY)
  useAIKey.setState({ value: null })
}

export function aiKeyHeaders(): Record<string, string> {
  const v = useAIKey.getState().value
  return v?.key ? { 'X-AI-Provider': v.provider, 'X-AI-Key': v.key } : {}
}

/** Last four characters, for "key ending in …". */
export function maskedKey(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '…'
}
