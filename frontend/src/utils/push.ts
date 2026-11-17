/** Web Push support and key conversion. Pure helpers: no network. */

/** The service worker path under the app's base path, e.g. /repo/sw.js on a project page. */
export const SW_PATH = `${import.meta.env.BASE_URL}sw.js`

/** True when the browser can register a service worker, subscribe to push and show notifications. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Converts the server's URL-safe VAPID public key into the bytes a push subscription expects. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}