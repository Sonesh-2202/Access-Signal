// Web Push for AccessSignal route alerts. The message is generic: the server never puts an
// address, a name or report text in a push. The link opens the Settings page, resolved against
// this worker's scope so it also works on a project-page base path such as /<repo>/.

self.addEventListener('push', (event) => {
  let data = { title: 'AccessSignal', body: 'You have a new route alert.', url: 'settings#alerts', kind: 'alert' }
  try {
    data = { ...data, ...event.data.json() }
  } catch {
    // Keep the default text when the payload is not JSON.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.kind,
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || 'settings#alerts', self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => 'focus' in w)
      if (open) {
        return open.navigate(target).then(() => open.focus())
      }
      return self.clients.openWindow(target)
    }),
  )
})
