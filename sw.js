// JetTakip yönetim paneli — service worker. SADECE Web Push: önbellek tutmaz (panel her açılışta güncel sürümü yükler).
// Yük (merkezdeki gönderici, mantik.mjs pushYuku): { tur: 'kimse_almadi', siparis_id, baslik, metin } — müşteri bilgisi yok.
// iOS her push için bildirim gösterilmesini ister: yük okunamasa da genel bir bildirim gösterilir.
// Bildirime dokununca panel o siparişle açılır (#siparis=<id>); panel zaten açıksa öne gelir ve siparişi açar.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let y = {};
  try { y = e.data ? e.data.json() : {}; } catch (x) { y = {}; }
  const id = typeof y.siparis_id === 'string' && /^[0-9a-f-]{36}$/i.test(y.siparis_id) ? y.siparis_id : '';
  e.waitUntil(self.registration.showNotification(String(y.baslik || 'JetTakip: kimse almadı').slice(0, 120), {
    body: String(y.metin || 'Paneli açın.').slice(0, 200),
    tag: id ? 'siparis-' + id : 'jettakip',
    renotify: true,
    requireInteraction: true,
    icon: 'ikon-192.png',
    badge: 'ikon-192.png',
    data: { url: id ? './#siparis=' + id : './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hedef = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const acik = pencereler.find((c) => c.url.startsWith(self.registration.scope));
    if (acik) {
      acik.postMessage({ tur: 'siparis_ac', url: hedef });
      if (acik.focus) await acik.focus();
      return;
    }
    await self.clients.openWindow(hedef);
  })());
});
