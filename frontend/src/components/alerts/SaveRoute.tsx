import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Field, Input } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { Profile } from '@/types'
import { announce } from '@/utils/announce'

interface Point {
  lat: number
  lng: number
  label: string
}

/**
 * Saves the route being planned so AccessSignal can tell the person when it changes. Saving is
 * the person's choice, and the route is only checked while it is saved.
 */
export function SaveRoute({ from, to, profile }: { from: Point; to: Point; profile: Profile }) {
  const user = useAuth((s) => s.user)
  const [name, setName] = useState('My route')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) {
    return (
      <p className="text-sm text-muted">
        <Link to="/login" className="underline">
          Sign in
        </Link>{' '}
        to save this route and get alerts when it changes.
      </p>
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.saveCorridor({
        name: name.trim() || 'My route',
        origin: [from.lat, from.lng],
        destination: [to.lat, to.lng],
        profile,
      })
      setDone(true)
      announce('Route saved for alerts')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm">
        Route saved. Its alerts appear in your{' '}
        <Link to="/settings#alerts" className="underline">
          inbox
        </Link>
        .
      </p>
    )
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-1" aria-label="Save this route for alerts">
      <Field label="Name this route">
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="ghost" size="sm" busy={busy}>
          Save this route for alerts
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </form>
  )
}
