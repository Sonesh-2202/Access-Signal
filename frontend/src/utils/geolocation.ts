/**
 * One reading of the device's position, for alerts near me and the Nearby check. It asks the browser
 * for permission the first time, and it never repeats by itself: there is no watch and no timer.
 */

export type LocationFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

export class LocationError extends Error {
  constructor(public reason: LocationFailure) {
    super(reason)
  }
}

export interface LatLng {
  lat: number
  lng: number
}

export function currentPosition(timeoutMs = 10_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(new LocationError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** The permission state, read without asking the person anything. */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  if (!navigator.permissions?.query) return 'prompt'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'prompt'
  }
}

/** A short, plain explanation of a failed location request and how to fix it. */
export function locationHelp(reason: LocationFailure): string {
  switch (reason) {
    case 'denied':
      return 'Location is blocked for this site. Allow location for AccessSignal in your browser’s site settings, then try again.'
    case 'timeout':
      return 'Your device took too long to give a location. Try again, or search for a place on the Plan a route page.'
    case 'unsupported':
      return 'This browser can’t share a location. Search for a place on the Plan a route page instead.'
    default:
      return 'Your device could not give a location. Try again, or search for a place on the Plan a route page.'
  }
}
