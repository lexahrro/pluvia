// Réception des alertes de pluie (Web Push). Ce fichier est chargé par le service worker de l'application.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pluvia', {
      body: data.body || '',
      // Une nouvelle alerte remplace l'ancienne au lieu de s'empiler.
      tag: data.tag || 'pluvia',
      icon: 'pwa-192.png',
      // Petite icône monochrome (barre d'état Android) : seule la forme compte, la couleur est ignorée.
      badge: 'badge-96.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    })(),
  );
});
