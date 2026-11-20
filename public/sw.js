/* Zordaq service worker — receives Web Push and opens the right page on tap. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Zordaq';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url && w.url.indexOf(self.location.origin) === 0) {
        try { await w.focus(); } catch (e) {}
        // iOS Safari/PWA does NOT support WindowClient.navigate(), so focusing alone
        // leaves the app where it was. postMessage the open app so it routes itself
        // (PwaRegister listens). Desktop/Android honour both this and navigate().
        try { w.postMessage({ type: 'notification-navigate', url: target }); } catch (e) {}
        if ('navigate' in w) { try { await w.navigate(target); } catch (e) {} }
        return;
      }
    }
    // No open window → open one at the target (desktop/Android land straight there;
    // iOS may open the PWA at its start_url — an Apple cold-start limitation).
    if (self.clients.openWindow) { try { return await self.clients.openWindow(target); } catch (e) {} }
  })());
});

// Take control quickly so a freshly-registered SW can receive pushes without a reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
