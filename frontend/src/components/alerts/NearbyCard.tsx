import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { api } from '@/services/api'
import type { NearbyOut } from '@/types'
import { announce } from '@/utils/announce'
import { currentPosition, LocationError, locationHelp, type LocationFailure } from '@/utils/geolocation'

const RADIUS_M = 250

type State =
  | { phase: 'idle' }
  | { phase: 'locating' }
  | { phase: 'done'; result: NearbyOut }
  | { phase: 'failed'; reason: LocationFailure | 'server'; message?: string }

/**
 * "Near you now": what is open within 250 metres of where the person is. One reading of their
 * location per press. Nothing is stored and nothing repeats on a timer.
 */
export function NearbyCard() {
  const headingId = useId()
  const [state, setState] = useState<State>({ phase: 'idle' })

  async function check() {
    setState({ phase: 'locating' })
    let here: { lat: number; lng: number }
    try {
      here = await currentPosition()
    } catch (e) {
      const reason = e instanceof LocationError ? e.reason : 'unavailable'
      setState({ phase: 'failed', reason })
      announce(locationHelp(reason))
      return
    }
    try {
      const result = await api.nearbyNow({ lat: here.lat, lng: here.lng, radius_m: RADIUS_M })
      setState({ phase: 'done', result })
      const n = result.barriers.length + result.outages.length
      announce(n === 0 ? 'Nothing open is recorded near you' : `${n} item${n === 1 ? '' : 's'} recorded near you`)
    } catch (e) {
      setState({ phase: 'failed', reason: 'server', message: (e as Error).message })
    }
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-hair bg-paper-raised">
      <div className="mx-auto max-w-[1200px] px-3 py-4 md:px-4">
        <h2 id={headingId} className="text-xl leading-snug">
          Near you now
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">
          See what is open within {RADIUS_M} m of where you are. Your location is read once, for this check, and is not saved.
          To be alerted when something changes near you, turn on alerts near me in Settings.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" busy={state.phase === 'locating'} onClick={check}>
            Check near me
          </Button>
          <Link to="/settings#alerts" className="text-sm underline">
            Get alerts near me
          </Link>
        </div>

        {state.phase === 'failed' && (
          <p role="alert" className="mt-2 text-sm text-signal">
            {state.reason === 'server'
              ? `The check could not be completed. ${state.message ?? ''}`.trim()
              : locationHelp(state.reason)}
          </p>
        )}

        {state.phase === 'done' && <NearbyResults result={state.result} />}
      </div>
    </section>
  )
}

function NearbyResults({ result }: { result: NearbyOut }) {
  const total = result.barriers.length + result.outages.length
  if (total === 0) {
    return (
      <p className="mt-2 text-sm">
        Nothing open is recorded within {result.radius_m} m of this spot. That is not a guarantee that the way is clear.
      </p>
    )
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      {result.barriers.length > 0 && (
        <div>
          <h3 className="meta">Open barriers</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {result.barriers.map((b) => (
              <li key={b.id}>
                <Link to={b.url} className="underline">
                  {b.label}
                </Link>{' '}
                <span className="text-muted">about {b.distance_m} m away</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.outages.length > 0 && (
        <div>
          <h3 className="meta">Out of service</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {result.outages.map((o) => (
              <li key={o.id}>
                <Link to={o.url} className="underline">
                  {o.label}
                </Link>
                {o.place_name && <span> at {o.place_name}</span>}{' '}
                <span className="text-muted">about {o.distance_m} m away</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
