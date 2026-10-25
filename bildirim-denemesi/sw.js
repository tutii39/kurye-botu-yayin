// Bildirim denemesi — service worker. Bildirimi gösterir ve "alındı" saatini merkeze yazar.
importScripts('config.js');
const C = self.BD_CONFIG || {};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function rpc(name, body) {
  const headers = { apikey: C.supabaseKey, 'content-type': 'application/json' };
  if (!String(C.supabaseKey || '').startsWith('sb_')) headers.Authorization = `Bearer ${C.supabaseKey}`;
  // Telefon uyanırken ağ bir an gelmeyebilir: 3 deneme (0, 2, 5 sn)
  let last;
  for (const wait of [0, 2000, 5000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (r.ok) return r.json();
      last = new Error(`HTTP ${r.status}`);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

self.addEventListener('push', (event) => {
  const clientAt = new Date().toISOString();
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const no = data.no != null ? data.no : '?';
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = list.some((c) => c.visibilityState === 'visible');
      const shown = self.registration.showNotification(`Yeni sipariş – Deneme ${no}`, {
        body: data.body || 'Bildirim denemesi. Dokunun.',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: `deneme-${no}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 300],
        timestamp: Date.now(),
        data: { id: data.id, token: data.token, no },
      });
      const ack = data.id
        ? rpc('push_deneme_alindi', { p_id: data.id, p_token: data.token, p_client_at: clientAt, p_visible: visible }).catch(() => null)
        : Promise.resolve(null);
      for (const c of list) c.postMessage({ type: 'push', no, at: clientAt });
      await Promise.all([shown, ack]);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  const d = (event.notification && event.notification.data) || {};
  event.notification.close();
  event.waitUntil(
    (async () => {
      const ack = d.id ? rpc('push_deneme_acildi', { p_id: d.id, p_token: d.token }).catch(() => null) : Promise.resolve(null);
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      const win = open ? open.focus() : self.clients.openWindow('./');
      await Promise.all([ack, win]);
    })()
  );
});
