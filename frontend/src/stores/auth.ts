import { create } from 'zustand'
import type { TokenPair, User } from '@/types'

/**
 * Session storage policy:
 * - The short-lived access token lives in memory only.
 * - The refresh token goes to localStorage when "keep me signed in" is checked,
 *   otherwise sessionStorage (cleared when the tab closes). Refresh tokens rotate on
 *   every use and a replayed token revokes the whole session family server-side.
 */
const KEY = 'accesssignal.refresh'

interface AuthState {
  user: User | null
  accessToken: string | null
  ready: boolean
  setSession: (pair: TokenPair, persist?: boolean) => void
  clear: () => void
  markReady: () => void
}

export function readRefreshToken(): { token: string; persist: boolean } | null {
  const local = localStorage.getItem(KEY)
  if (local) return { token: local, persist: true }
  const session = sessionStorage.getItem(KEY)
  return session ? { token: session, persist: false } : null
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  ready: false,
  setSession: (pair, persist) => {
    const keep = persist ?? readRefreshToken()?.persist ?? true
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    ;(keep ? localStorage : sessionStorage).setItem(KEY, pair.refresh_token)
    set({ user: pair.user, accessToken: pair.access_token, ready: true })
  },
  clear: () => {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    set({ user: null, accessToken: null, ready: true })
  },
  markReady: () => set({ ready: true }),
}))

export const isStaff = (u: User | null) => u?.role === 'infrastructure_manager' || u?.role === 'admin'
