import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { AlertCorridor, AlertPreferences, AlertPushStatus } from '@/types'
import { announce } from '@/utils/announce'
import { PROFILE_LABEL } from '@/utils/format'
import { pushSupported, SW_PATH, urlBase64ToUint8Array } from '@/utils/push'

const PREFS: { key: keyof AlertPreferences; label: string }[] = [
  { key: 'notify_reports', label: 'New confirmed barriers' },
  { key: 'notify_outages', label: 'Out-of-service features' },
  { key: 'notify_route_changes', label: 'Route changes' },
]

/**
 * Turns push alerts on or off for this browser, and manages the saved routes. Push is optional:
 * without it, alerts still reach the inbox. Nothing is sent to anyone else.
 */
export function AlertSettings() {
  const user = useAuth((s) => s.user)
  const headingId = useId()
  const supported = pushSupported()
  const [server, setServer] = useState<AlertPushStatus | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [corridors, setCorridors] = useState<AlertCorridor[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    api.alertPush().then(setServer).catch(() => setServer({ enabled: false, public_key: null }))
    api.corridors().then(setCorridors).catch(() => setCorridors([]))
  }, [user])

  useEffect(() => {
    if (!user || !supported) return
    navigator.serviceWorker
      .getRegistration(SW_PATH)
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false))
  }, [user, supported])

  if (!user) {
    return (
      <p className="text-sm">
        <Link to="/login" className="underline">
          Sign in
        </Link>{' '}
        to save routes and receive alerts.
      </p>
    )
  }

  async function turnOn() {
    if (!server?.public_key) return
    setBusy(true)
    setMessage(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage('Notifications are blocked for this site. Alerts still appear in your inbox below.')
        return
      }
      const reg = await navigator.serviceWorker.register(SW_PATH)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(server.public_key) as BufferSource,
      })
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('The browser gave an incomplete subscription.')
      await api.alertSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
      setSubscribed(true)
      setMessage('Push alerts are on for this browser.')
      announce('Push alerts on')
    } catch (e) {
      setMessage(`Push alerts could not be turned on. ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    setMessage(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await api.alertUnsubscribe(sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
      setMessage('Push alerts are off for this browser. Your inbox still keeps past alerts.')
      announce('Push alerts off')
    } catch (e) {
      setMessage(`Push alerts could not be turned off. ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function setPref(c: AlertCorridor, key: keyof AlertPreferences, value: boolean) {
    try {
      const updated = await api.updateCorridor(c.id, { [key]: value })
      setCorridors((list) => (list ?? []).map((x) => (x.id === c.id ? updated : x)))
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  async function remove(c: AlertCorridor) {
    try {
      await api.deleteCorridor(c.id)
      setCorridors((list) => (list ?? []).filter((x) => x.id !== c.id))
      announce(`${c.name} removed`)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-2">
      <h3 id={headingId} className="text-lg">
        Alerts for saved routes
      </h3>

      <div className="mt-1 text-sm">
        {!supported && <p>This browser can’t receive push alerts. Alerts still appear in your inbox.</p>}
        {supported && server && !server.enabled && (
          <p>Push isn’t set up on this server. Alerts still appear in your inbox.</p>
        )}
        {supported && server?.enabled && (
          <div className="flex flex-wrap items-center gap-1">
            <p>{subscribed ? 'Push alerts are on for this browser.' : 'Push alerts are off for this browser.'}</p>
            {subscribed ? (
              <Button type="button" variant="ghost" size="sm" busy={busy} onClick={turnOff}>
                Turn off push alerts
              </Button>
            ) : (
              <Button type="button" variant="primary" size="sm" busy={busy} onClick={turnOn}>
                Turn on push alerts
              </Button>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="mt-0.5 text-sm">
            {message}
          </p>
        )}
      </div>

      <h4 className="meta mt-2">Saved routes</h4>
      {corridors === null && <p className="mt-0.5 text-sm text-muted">Loading saved routes…</p>}
      {corridors?.length === 0 && (
        <p className="mt-0.5 text-sm text-muted">No saved routes. Plan a route, then choose Save this route for alerts.</p>
      )}
      <ul className="mt-1 flex flex-col gap-2">
        {(corridors ?? []).map((c) => (
          <li key={c.id} className="border-t border-hair pt-1 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted">{PROFILE_LABEL[c.profile]} profile</p>
            </div>
            <fieldset className="mt-0.5">
              <legend className="sr-only">Alerts for {c.name}</legend>
              <div className="flex flex-col gap-0.5 text-sm">
                {PREFS.map((p) => (
                  <label key={p.key} className="flex min-h-touch items-center gap-1">
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] accent-signal"
                      checked={c[p.key]}
                      onChange={(e) => setPref(c, p.key, e.target.checked)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-0.5">
              <Button type="button" variant="quiet" size="sm" onClick={() => remove(c)}>
                Remove {c.name}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
