/* Dose reminder notifications for the SparkyFitness service worker.
 * Loaded by the generated service worker through Workbox importScripts.
 * The server sends {title, body, tag, url}; tapping opens or focuses the app. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = {};
  }
  const url =
    typeof data.url === 'string' && data.url.startsWith('/')
      ? data.url
      : '/medications';
  event.waitUntil(
    self.registration.showNotification(data.title || 'SparkyFitness', {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : 'sparky-dose',
      renotify: true,
      icon: '/images/icons/icon-192x192.png',
      badge: '/images/icons/icon-192x192.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path =
    (event.notification.data && event.notification.data.url) || '/medications';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (new URL(client.url).origin === self.location.origin) {
            if ('navigate' in client) client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
