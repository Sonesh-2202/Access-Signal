/** Polite screen reader announcements via a single shared live region (see <LiveRegion/>). */
type Listener = (msg: string) => void
const listeners = new Set<Listener>()

export function announce(message: string) {
  listeners.forEach((l) => l(message))
}

export function onAnnounce(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
