import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Field, Textarea } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { DescribeReply, RoutePlanResult } from '@/types'
import { announce } from '@/utils/announce'
import { aiSourceShort, routeSourceNote } from '@/utils/aiSource'

/**
 * Describe a route in plain words. A cloud model reads the request into a route with place names,
 * the existing router plans it, and the model explains it. Nothing is drawn until the person asks.
 */
export function DescribeRoute({ onShow }: { onShow: (plan: RoutePlanResult) => void }) {
  const user = useAuth((s) => s.user)
  const headingId = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<DescribeReply | null>(null)

  async function describe(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setReply(null)
    try {
      const r = await api.describeRoute(text.trim())
      setReply(r)
      announce(r.route.status === 'planned' ? 'Route planned from your words' : r.route.message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-hair pt-2">
      <h2 id={headingId} className="meta">
        Describe your route
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        Say the trip in your own words. A cloud AI model reads the request and explains the route. The router plans it. Only
        places on the places list can be used as start and destination.
      </p>
      {!user ? (
        <p className="mt-1 text-sm">
          <Link to="/login" className="underline">
            Sign in
          </Link>{' '}
          to describe a route. The form above works without an account.
        </p>
      ) : (
        <form onSubmit={describe} className="mt-1 flex flex-col gap-1">
          <Field label="Your request">
            <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" variant="ghost" size="sm" busy={busy} disabled={!text.trim()}>
              Plan from my words
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-signal">
          {error}
        </p>
      )}
      {reply && <Reply reply={reply} onShow={onShow} />}
    </section>
  )
}

function Reply({ reply, onShow }: { reply: DescribeReply; onShow: (plan: RoutePlanResult) => void }) {
  const { route } = reply
  if (route.status !== 'planned' || !route.start || !route.end) {
    return <p className="mt-1 text-sm">{route.message}</p>
  }
  return (
    <div className="mt-2 flex flex-col gap-1 border border-hair bg-paper-raised p-2">
      <p className="meta">
        {reply.source ? `Explained by ${aiSourceShort(reply.source)}` : 'Route summary from the router (no model wrote an explanation)'}
      </p>
      <p className="text-sm">{reply.answer}</p>
      {route.notes.length > 0 && (
        <ul className="list-disc pl-4 text-sm">
          {route.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {route.unsupported.length > 0 && (
        <p className="text-sm">Not enforced for this profile: {route.unsupported.map((f) => f.replace(/_/g, ' ')).join(', ')}.</p>
      )}
      <p className="text-xs text-muted">{routeSourceNote}</p>
      <div>
        <Button type="button" variant="primary" size="sm" onClick={() => onShow(route)}>
          Show this route on the map
        </Button>
      </div>
    </div>
  )
}
