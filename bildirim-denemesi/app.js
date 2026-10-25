// Bildirim denemesi — telefon sayfası. Sadece herkese açık bilgiler kullanılır (config.js).
(function () {
  const C = window.BD_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const KEY = 'bd-kayit';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* özel pencerede kaydedilmeyebilir */ }
  }

  function show(kind, text) {
    const el = $('sonuc');
    el.className = `msg ${kind}`;
    el.textContent = text;
  }

  async function rpc(name, body) {
    const headers = { apikey: C.supabaseKey, 'content-type': 'application/json' };
    if (!String(C.supabaseKey || '').startsWith('sb_')) headers.Authorization = `Bearer ${C.supabaseKey}`;
    const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) {
      let m = t;
      try { m = JSON.parse(t).message || t; } catch (e) { /* düz metin */ }
      throw new Error(m || `HTTP ${r.status}`);
    }
    return t ? JSON.parse(t) : null;
  }

  function keyBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function renderStatus() {
    const k = load();
    $('dDestek').innerHTML = supported() ? '<span class="ok">Var</span>' : '<span class="err">Yok — Chrome kullanın</span>';
    const p = 'Notification' in window ? Notification.permission : 'yok';
    $('dIzin').innerHTML = p === 'granted' ? '<span class="ok">Verildi</span>' : p === 'denied' ? '<span class="err">Reddedildi — site ayarlarından açın</span>' : '<span class="warn">Sorulmadı</span>';
    $('dAna').innerHTML = standalone() ? '<span class="ok">Evet</span>' : '<span class="warn">Hayır (tarayıcıda açık)</span>';
    $('dKayit').innerHTML = k.aboneId ? `<span class="ok">${escapeHtml(k.etiket || '')}</span>` : '<span class="warn">Yok</span>';
    $('dSon').textContent = k.son ? `Deneme ${k.son.no} · ${new Date(k.son.at).toLocaleTimeString('tr-TR')}` : '-';
    if (k.etiket && !$('etiket').value) $('etiket').value = k.etiket;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  async function register() {
    const etiket = $('etiket').value.trim();
    if (!etiket) return show('err', 'Önce telefonun adını yazın (ör. "Murat Samsung").');
    if (!supported()) return show('err', 'Bu tarayıcı bildirimleri desteklemiyor. Android\'de Chrome ile açın.');
    if (!C.supabaseUrl || !C.vapidPublicKey) return show('err', 'Sayfa ayarları eksik (config.js).');
    $('btnIzin').disabled = true;
    try {
      show('info', 'İzin isteniyor...');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Bildirim izni verilmedi. Chrome → Site ayarları → Bildirimler\'den açın.');
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(C.vapidPublicKey) });
      const id = await rpc('push_deneme_abone_ol', { p_etiket: etiket, p_sub: sub.toJSON(), p_user_agent: navigator.userAgent });
      save({ ...load(), etiket, aboneId: id });
      show('ok', `Kaydedildi: "${etiket}". Bilgisayardan deneme bildirimi gönderilebilir.`);
    } catch (err) {
      show('err', `Olmadı: ${err.message}`);
    } finally {
      $('btnIzin').disabled = false;
      renderStatus();
    }
  }

  async function localTest() {
    if (!supported() || Notification.permission !== 'granted') return show('err', 'Önce "Bildirimlere izin ver"e basın.');
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Yeni sipariş – Ses denemesi', {
      body: 'Bu bildirim telefonun kendisinde oluşturuldu.',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      tag: 'ses-denemesi',
      renotify: true,
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'push') {
        save({ ...load(), son: { no: e.data.no, at: e.data.at } });
        renderStatus();
      }
    });
    // Sayfa her açılışta service worker'ı günceller
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }

  $('btnIzin').addEventListener('click', register);
  $('btnSes').addEventListener('click', () => localTest().catch((e) => show('err', e.message)));
  document.addEventListener('visibilitychange', renderStatus);
  renderStatus();
})();
