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
  const path = (() => { try { return new URL(target, self.location.origin).pathname; } catch (e) { return '/'; } })();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Focus an already-open Zordaq tab if we have one, otherwise open a new window.
      for (const w of wins) {
        if (w.url && w.url.indexOf(self.location.origin) === 0 && 'focus' in w) {
          w.focus();
          if ('navigate' in w) { try { w.navigate(target); } catch (e) {} }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(path);
    })
  );
});

// Take control quickly so a freshly-registered SW can receive pushes without a reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
