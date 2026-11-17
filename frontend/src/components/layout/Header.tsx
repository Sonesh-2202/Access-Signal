import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/services/api'
import { openAssistant } from '@/stores/assistant'
import { isStaff, readRefreshToken, useAuth } from '@/stores/auth'
import { cx } from '@/utils/cx'
import { Button, ButtonLink } from '../common/Button'
import { Dialog } from '../common/Dialog'
import { DataSourcePill } from './DataSourcePill'
import { Icon } from '../common/Icon'
import { Wordmark } from './Wordmark'

const PUBLIC_NAV = [
  { to: '/map', label: 'Map' },
  { to: '/route', label: 'Plan a route' },
  { to: '/places', label: 'Places' },
  { to: '/reports', label: 'Reports' },
  { to: '/analytics', label: 'Trends' },
]

export function Header() {
  const user = useAuth((s) => s.user)
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!user) return setUnread(0)
    api
      .inbox()
      .then((b) => setUnread(b.unread))
      .catch(() => setUnread(0))
  }, [user])

  useEffect(() => setMenu(false), [loc.pathname])

  const links = [...PUBLIC_NAV, ...(isStaff(user) ? [{ to: '/dashboard', label: 'Dashboard' }] : [])]

  async function signOut() {
    const t = readRefreshToken()
    if (t) await api.logout(t.token).catch(() => undefined)
    useAuth.getState().clear()
    nav('/')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-hair bg-paper">
      <div className="mx-auto flex h-[64px] max-w-page items-center gap-3 px-2 sm:px-4">
        <Link to="/" className="no-underline" aria-label="AccessSignal home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="ml-2 hidden lg:block">
          <ul className="flex items-center">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  className={({ isActive }) =>
                    cx(
                      'relative flex min-h-touch items-center px-[12px] text-sm no-underline transition-colors duration-150',
                      isActive
                        ? 'text-ink after:absolute after:inset-x-[12px] after:bottom-0 after:h-[2px] after:bg-signal'
                        : 'text-muted hover:text-ink',
                    )
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <DataSourcePill />
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => openAssistant()}>
            Ask AccessSignal
          </Button>
          <ButtonLink to="/report" variant="primary" size="sm" className="hidden sm:inline-flex">
            Report a barrier
          </ButtonLink>
          {user ? (
            <div className="hidden items-center gap-1 lg:flex">
              <Link to="/settings#alerts" className="min-h-touch px-1 text-sm text-ink underline decoration-rule underline-offset-[3px] hover:decoration-ink">
                Alerts{unread > 0 ? ` (${unread} new)` : ''}
              </Link>
              <span className="max-w-[160px] truncate text-sm text-muted" title={user.email}>
                {user.display_name}
              </span>
              <button type="button" onClick={signOut} className="min-h-touch px-1 text-sm text-ink underline decoration-rule underline-offset-[3px] hover:decoration-ink">
                Sign out
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="hidden min-h-touch items-center px-1 text-sm lg:flex">
              Sign in
            </NavLink>
          )}
          <button
            type="button"
            className="flex min-h-touch min-w-touch items-center justify-center lg:hidden"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
          >
            <Icon name="menu" />
          </button>
        </div>
      </div>

      <Dialog open={menu} onClose={() => setMenu(false)} title="Menu" variant="sheet">
        <nav aria-label="Main (mobile)">
          <ul className="flex flex-col">
            <li>
              <Link to="/report" className="flex min-h-[52px] items-center justify-between border-b border-hair text-lg font-medium text-signal no-underline">
                Report a barrier <Icon name="arrowRight" />
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  // Close the menu first, so the assistant opens on top of the page and focus
                  // returns to the menu button when it closes.
                  setMenu(false)
                  setTimeout(() => openAssistant(), 0)
                }}
                className="flex min-h-[52px] w-full items-center border-b border-hair text-left text-lg text-ink"
              >
                Ask AccessSignal
              </button>
            </li>
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  className={({ isActive }) =>
                    cx('flex min-h-[52px] items-center border-b border-hair text-lg no-underline', isActive ? 'font-medium' : 'text-ink')
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3">
          {user ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Signed in as {user.display_name}</span>
              <button type="button" onClick={signOut} className="min-h-touch text-sm underline">
                Sign out
              </button>
            </div>
          ) : (
            <ButtonLink to="/login" variant="secondary" className="w-full">
              Sign in
            </ButtonLink>
          )}
        </div>
      </Dialog>
    </header>
  )
}
