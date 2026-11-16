import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { onAnnounce } from '@/utils/announce'
import { cx } from '@/utils/cx'
import { Footer } from './Footer'
import { Header } from './Header'

export function SkipLink() {
  return (
    <a
      href="#main"
      className="fixed left-2 top-2 z-50 -translate-y-[200%] rounded-sm bg-ink px-2 py-1 text-paper no-underline focus:translate-y-0"
    >
      Skip to content
    </a>
  )
}

function LiveRegion() {
  const [msg, setMsg] = useState('')
  useEffect(() => onAnnounce((m) => {
    setMsg('')
    setTimeout(() => setMsg(m), 50)
  }), [])
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {msg}
    </div>
  )
}

/** Moves focus to <main> on route change so screen reader users land on new content. */
function useRouteFocus(ref: React.RefObject<HTMLElement>) {
  const loc = useLocation()
  // Compare against the previous path rather than a "first render" flag: StrictMode
  // runs effects twice on mount, which would otherwise steal focus on initial load.
  const prev = useRef(loc.pathname)
  useEffect(() => {
    if (prev.current === loc.pathname) return
    prev.current = loc.pathname
    if (!loc.hash) {
      ref.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0 })
    }
  }, [loc.pathname, loc.hash, ref])

}

export function Layout({ fullBleed }: { fullBleed?: boolean }) {
  const main = useRef<HTMLElement>(null)
  useRouteFocus(main)
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <Header />
      <main id="main" ref={main} tabIndex={-1} className={cx('flex-1 focus:outline-none', fullBleed && 'flex flex-col')}>
        <Outlet />
      </main>
      {!fullBleed && <Footer />}
      <LiveRegion />
    </div>
  )
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-page px-2 sm:px-4', className)}>{children}</div>
}

export function PageHeader({ eyebrow, title, children, aside }: { eyebrow?: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-hair pb-4 pt-6 md:grid-cols-12 md:pt-8">
      <div className="md:col-span-8">
        {eyebrow && <p className="meta mb-1">{eyebrow}</p>}
        <h1 className="text-3xl leading-snug tracking-[-0.015em] md:text-4xl">{title}</h1>
        {children && <div className="mt-2 max-w-prose text-lg leading-relaxed text-muted">{children}</div>}
      </div>
      {aside && <div className="flex items-end md:col-span-4 md:justify-end">{aside}</div>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-y border-hair py-6">
      <p className="font-display text-xl">{title}</p>
      {children && <div className="mt-1 max-w-prose text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="border-l-2 border-signal bg-signal-wash px-2 py-1 text-sm">
      <p className="text-ink">{error.message || 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-0.5 min-h-touch underline">
          Try again
        </button>
      )}
    </div>
  )
}
