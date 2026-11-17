import { useCallback, useEffect, useId, useState } from 'react'
import { Button } from '@/components/common/Button'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { AlertKind, Inbox as InboxData, InboxItem } from '@/types'
import { announce } from '@/utils/announce'

const KIND_LABEL: Record<AlertKind, string> = {
  report: 'New barrier',
  outage: 'Out of service',
  route_change: 'Route changed',
  reverify: 'Please check',
  nearby_report: 'Nearby barrier',
  nearby_outage: 'Nearby outage',
}

type Filter = 'all' | 'nearby' | 'routes'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'nearby', label: 'Nearby' },
  { value: 'routes', label: 'Saved routes' },
]

function inFilter(item: InboxItem, filter: Filter): boolean {
  if (filter === 'all') return true
  const nearby = item.kind === 'nearby_report' || item.kind === 'nearby_outage'
  return filter === 'nearby' ? nearby : !nearby
}

/**
 * The in-app inbox. Every push is also kept here, so an alert is never only on one channel.
 * Items are read-only text; marking one read changes only this list.
 */
export function Inbox() {
  const user = useAuth((s) => s.user)
  const headingId = useId()
  const [box, setBox] = useState<InboxData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(() => {
    api
      .inbox()
      .then((b) => {
        setBox(b)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (!user) {
    return <p className="text-sm">Sign in to see your alerts.</p>
  }

  async function markRead(item: InboxItem) {
    try {
      await api.markRead(item.id)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function markAll() {
    try {
      await api.markAllRead()
      announce('All alerts marked read')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h3 id={headingId} className="text-lg">
          Inbox
        </h3>
        {box && <p className="text-sm text-muted">{box.unread === 0 ? 'Nothing new' : `${box.unread} unread`}</p>}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-signal">
          {error}
        </p>
      )}
      {box && box.items.length > 0 && (
        <div role="group" aria-label="Filter alerts" className="mt-1 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.value} type="button" variant={filter === f.value ? 'primary' : 'ghost'} size="sm" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
      )}
      {box && box.items.length === 0 && (
        <p className="mt-1 text-sm text-muted">No alerts yet. Save a route to start watching it.</p>
      )}
      {box && box.items.length > 0 && (
        <>
          <div className="mt-1">
            <Button type="button" variant="quiet" size="sm" onClick={markAll} disabled={box.unread === 0}>
              Mark all as read
            </Button>
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {box.items.filter((item) => inFilter(item, filter)).map((item) => (
              <li key={item.id} className="border-t border-hair pt-1 first:border-t-0 first:pt-0">
                <p className="text-sm">
                  <span className="meta mr-1">{KIND_LABEL[item.kind]}</span>
                  {!item.read && <span className="sr-only">Unread: </span>}
                  <span className={item.read ? '' : 'font-medium'}>{item.title}</span>
                </p>
                <p className="text-sm text-muted">{item.body}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {item.corridor_name ? `Saved route: ${item.corridor_name}. ` : ''}
                  {new Date(item.created_at).toLocaleString()}
                </p>
                {!item.read && (
                  <div className="mt-0.5">
                    <Button type="button" variant="ghost" size="sm" onClick={() => markRead(item)}>
                      Mark as read
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
