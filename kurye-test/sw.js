// JetTakip Kurye — web uygulamasının service worker'ı (iPhone: ana ekrana eklenmiş uygulama; iPhone adım 5, 09.11).
// SADECE Web Push: önbellek tutmaz (uygulama her açılışta güncel sürümü yükler). Android APK'da kaydedilmez (orada FCM var).
// Yük (merkezdeki gönderici, mantik.mjs kuryePushYuku = Android'e giden veri mesajının aynısı):
//   { tur: 'yeni_siparis' | 'iptal' | 'kurye_uyari' | 'deneme', uyari?, asama?, siparis_id, baslik, metin, dukkan, ... }
//   Müşteri bilgisi yok. iOS her push için bildirim gösterilmesini ister: yük okunamasa da genel bir bildirim gösterilir.
// Bildirime dokununca uygulama o siparişle açılır (#siparis=<id>); uygulama zaten açıksa öne gelir ve siparişi açar.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARSAYILAN = { yeni_siparis: 'JetTakip: yeni sipariş', iptal: 'JetTakip: İPTAL', kurye_uyari: 'JetTakip Kurye', deneme: 'JetTakip: deneme bildirimi' };

// Deneme bildirimi (panel → "Deneme gönder"; 09.11): gelince merkeze "geldi" yazılır (Android'deki gibi; yol 'fcm' = anlık
// bildirim yolu). Merkez adresi, herkese açık anahtar ve cihaz anahtarı uygulamanın Cache Storage'a koyduğu ayardan okunur
// (AYAR_ONBELLEK; sayfa önbelleği değil, sadece bu ayar). Ayar yoksa (çıkış yapılmış) bir şey yazılmaz.
const AYAR_ONBELLEK = 'jt-kurye-ayar', AYAR_YOL = './__jt-ayar';
async function ayarOku() {
  try {
    const c = await self.caches.open(AYAR_ONBELLEK);
    const r = await c.match(new URL(AYAR_YOL, self.registration.scope).href);
    const a = r ? await r.json() : null;
    return a && /^https?:\/\//.test(a.merkez || '') && /^[0-9a-f]{64}$/.test(a.cihaz || '') ? a : null;
  } catch (x) { return null; }
}
async function denemeGeldi(denemeId) {
  const a = await ayarOku();
  if (!a) return;
  let onde = false;
  try { onde = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).some((c) => c.url.startsWith(self.registration.scope) && c.visibilityState === 'visible'); } catch (x) { /* yok */ }
  try {
    await fetch(String(a.merkez).replace(/\/+$/, '') + '/rest/v1/rpc/defter_bildirim_alindi', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: a.anahtar || '', authorization: `Bearer ${a.anahtar || ''}` },
      body: JSON.stringify({ p_anahtar: a.cihaz, p_deneme: Number(denemeId), p_yol: 'fcm', p_onde: onde }),
    });
  } catch (x) { /* internet yok: deneme "gelmedi" görünür */ }
}

self.addEventListener('push', (e) => {
  let y = {};
  try { y = e.data ? e.data.json() : {}; } catch (x) { y = {}; }
  if (!y || typeof y !== 'object') y = {};
  const tur = Object.prototype.hasOwnProperty.call(VARSAYILAN, y.tur) ? y.tur : '';
  const id = typeof y.siparis_id === 'string' && UUID.test(y.siparis_id) ? y.siparis_id.toLowerCase() : '';
  const etiket = id ? `${tur || 'siparis'}-${y.uyari || ''}-${id}` : tur || 'jettakip';
  const deneme = tur === 'deneme' && /^\d{1,15}$/.test(String(y.deneme_id || '')) ? String(y.deneme_id) : '';
  if (deneme) e.waitUntil(denemeGeldi(deneme)); // bildirim gösterilemese de "geldi" yazılır
  e.waitUntil((async () => {
    await self.registration.showNotification(String(y.baslik || VARSAYILAN[tur] || 'JetTakip Kurye').slice(0, 120), {
      body: String(y.metin || 'Uygulamayı açın.').slice(0, 200),
      tag: etiket,
      renotify: true, // "kimse almadı" tekrarı (120 sn) aynı etiketle yeniden çalar
      requireInteraction: tur === 'yeni_siparis' || tur === 'iptal',
      icon: 'ikon-192.png',
      badge: 'ikon-192.png',
      data: { url: id ? './#siparis=' + id : './' },
    });
    // Uygulama açıksa hemen yenilensin (15 sn beklemesin)
    try {
      const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of pencereler) if (c.url.startsWith(self.registration.scope)) c.postMessage({ tur: 'yenile' });
    } catch (x) { /* yok */ }
  })());
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
