import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { Field, Select } from '@/components/common/Field'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { NearbyRadius, NearbySettings as Settings } from '@/types'
import { announce } from '@/utils/announce'
import { currentPosition, LocationError, locationHelp, locationPermission } from '@/utils/geolocation'

const RADII: NearbyRadius[] = [100, 250, 500]

/**
 * Alerts near me: opt in, choose a radius, and share a location for the alerts. Off by default. The
 * location is kept for 24 hours at most, and it is forgotten as soon as this is switched off.
 * Location is read on a button press, or silently only when the browser already allows it.
 */
export function NearbySettings() {
  const user = useAuth((s) => s.user)
  const headingId = useId()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    api
      .nearbySettings()
      .then(async (s) => {
        setSettings(s)
        // Refresh a saved location once per visit, and only when permission was already given.
        if (s.enabled && (await locationPermission()) === 'granted') {
          await shareHere({ quiet: true })
        }
      })
      .catch((e: Error) => setMessage(e.message))
  }, [user])

  async function shareHere(opts: { quiet?: boolean } = {}) {
    try {
      const here = await currentPosition()
      const updated = await api.shareNearbyLocation(here.lat, here.lng)
      setSettings(updated)
      if (!opts.quiet) {
        setMessage('Location saved. Alerts use it for 24 hours, then it is forgotten unless you update it.')
        announce('Location saved for alerts')
      }
    } catch (e) {
      const reason = e instanceof LocationError ? e.reason : 'unavailable'
      setMessage(`No location saved. ${locationHelp(reason)}`)
      if (!opts.quiet) announce(locationHelp(reason))
    }
  }

  if (!user) {
    return (
      <p className="text-sm">
        <Link to="/login" className="underline">
          Sign in
        </Link>{' '}
        to turn on alerts near me.
      </p>
    )
  }
  if (!settings) return <p className="text-sm text-muted">Loading…</p>

  async function setEnabled(enabled: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      if (!enabled) {
        const off = await api.setNearbySettings({ enabled: false, radius_m: settings!.radius_m })
        setSettings(off)
        setMessage('Alerts near me are off. Your location has been forgotten.')
        announce('Alerts near me off')
        return
      }
      const on = await api.setNearbySettings({ enabled: true, radius_m: settings!.radius_m })
      setSettings(on)
      await shareHere()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function setRadius(radius: NearbyRadius) {
    try {
      setSettings(await api.setNearbySettings({ enabled: settings!.enabled, radius_m: radius }))
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-4 border-t border-hair pt-3">
      <h3 id={headingId} className="text-lg">
        Alerts near me
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">
        Get an alert when an open barrier or an out-of-service feature is reported within your chosen distance. Alerts never
        contain an address, a place name or report text. Your location is used only to check nearby records. It is kept for 24
        hours at most, and it is forgotten when you turn this off. No AI is used.
      </p>

      <div className="mt-2 flex flex-col gap-2">
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-signal"
            checked={settings.enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Alerts near me
        </label>

        <div className="max-w-[260px]">
          <Field label="Distance">
            <Select value={settings.radius_m} onChange={(e) => setRadius(Number(e.target.value) as NearbyRadius)}>
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {r} m
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p className="text-sm">
          {settings.has_location && settings.location_expires_at
            ? `Location saved. It is used until ${new Date(settings.location_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
            : settings.enabled
              ? 'No location saved yet. Alerts need one.'
              : ''}
        </p>
        {settings.enabled && (
          <div>
            <Button type="button" variant="ghost" size="sm" busy={busy} onClick={() => shareHere()}>
              Update my location now
            </Button>
          </div>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
