// JetTakip Kurye — arayüz. Ortak defter: docs/kurye-uygulamasi/ORTAK-DEFTER.md, supabase/migrations-taslak/.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const AYAR = window.JT_AYAR || {};
  const C = window.JTC;

  // TEST derlemesi (derle.ps1 -Test): her ekranda kırmızı şerit; gerçek uygulamayla karışmasın
  if (AYAR.ortam === 'TEST') {
    const serit = document.createElement('div');
    serit.id = 'testSeridi';
    serit.className = 'testSeridi';
    serit.textContent = `TEST — deneme merkezi, gerçek sipariş yok · ${AYAR.surum || ''}`;
    document.body.prepend(serit);
    document.body.classList.add('ortamTest');
    document.title = 'JetTakip Kurye TEST';
  }

  // Telefonda kalıcı tutulanlar: cihaz anahtarı, kısa ad, kuyruk (müşteri bilgisi YOK; fotoğraf gönderilince silinir)
  const yerel = {
    al: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    yaz: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* yok */ } },
  };
  let anahtar = yerel.al('jt_anahtar');
  let rol = yerel.al('jt_rol') || 'kurye'; // 'kurye' | 'yonetici' (yönetici: panel yöneticisinin uyarı telefonu, sipariş almaz)
  const api = () => C.api({ merkez: AYAR.merkez, anahtar: AYAR.anahtar });
  const rpc = (fn, args) => api().rpc(fn, args);

  const kuyruk = C.kuyruk({
    depo: { oku: () => JSON.parse(yerel.al('jt_kuyruk') || '[]'), yaz: (l) => yerel.yaz('jt_kuyruk', JSON.stringify(l)) },
    rpc: (fn, args) => rpc(fn, { ...args, p_anahtar: anahtar }),
    bildir: (islem, sonuc) => {
      const ne = C.adimYazisi(sonuc);
      if (ne) mesaj(false, ne);
      if (islem.tur === 'foto') fotolar.delete(islem.siparis);
    },
  });

  let ozet = null;
  let liste = { yeni: [], benim: [] };
  let nakit = null; // 08.11: defter_nakit_durum (işletmelere borç); eski merkezde yok → null
  let saatSapma = 0; // merkez saati - telefon saati (ms); teklif geri sayımı için (06.11)
  let cevrimdisi = false;
  const fotolar = new Map(); // siparis -> true (bu oturumda çekilip kuyruğa eklendi)
  let fotoSiparis = null;
  let nedenSiparis = null; // "Teslim edemedim" kutusu hangi sipariş için açık
  // Tam ekran uyarılar (iptal / geri alındı / devredildi / sana devredildi). Anahtar: "iptal:<sipariş>" ya da "uyari:<no>".
  // gonderilecek: "GÖRDÜM" denmiş ama merkeze henüz gitmemiş (telefonda kalıcı; müşteri bilgisi yok).
  // kapatilan: bu oturumda kapatılanlar (merkez cevabı gelene kadar ekran tekrar açılmasın diye; silinmez).
  const gonderilecek = new Set(JSON.parse(yerel.al('jt_uyari_goruldu') || '[]'));
  const kapatilan = new Set(gonderilecek);
  const gorulenYaz = () => yerel.yaz('jt_uyari_goruldu', gonderilecek.size ? JSON.stringify([...gonderilecek].slice(-50)) : null);
  let calanIptal = null; // sesi çalınmış iptal (aynı iptal için ikinci kez çalınmaz)

  let sekme = 'gorev'; // arayüz v2: 'gorev' | 'bugun' | 'telefon'
  function goster(ekran) {
    // Kurye telefonunda Hazırlık ayrı ekran değil, "Telefon" sekmesi (içerik oraya taşınır)
    if (ekran === 'ekHazirlik' && rol === 'kurye') { ekran = 'ekAna'; sekmeSec('telefon'); }
    for (const e of ['ekGiris', 'ekAna', 'ekYonetici', 'ekHazirlik']) $(e).classList.toggle('hidden', e !== ekran);
    $('btnHazirlik').classList.toggle('hidden', ekran === 'ekGiris' || ekran === 'ekAna');
    $('ust').classList.toggle('hidden', ekran === 'ekAna');
    const ic = $('hazirlikIcerik'), yer = rol === 'kurye' ? $('sTelefon') : $('ekHazirlik');
    if (ic.parentNode !== yer) yer.appendChild(ic);
    temaDugmeleri();
  }
  function mesaj(ok, metin, kutu = ekranMesaj()) {
    const el = $(kutu);
    el.textContent = metin;
    el.className = 'mesaj ' + (ok ? 'ok' : 'err');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), ok ? 3500 : 6000); // başarı kısa: üst şeridi uzun örtmesin
  }
  const ekranMesaj = () => (!$('ekGiris').classList.contains('hidden') ? 'girisMsg' : !$('ekYonetici').classList.contains('hidden') ? 'yoMsg' : 'anaMsg');
  const anaEkran = () => (rol === 'yonetici' ? 'ekYonetici' : 'ekAna');

  // ------------------------------------------------------------------ giriş
  async function giris() {
    const kod = C.kodDuzelt($('kod').value);
    if (!kod) return mesaj(false, 'Kod 8 karakter olmalı (ör. K7PQ-4XMR).', 'girisMsg');
    const yeniAnahtar = C.rastgele(32);
    $('btnGiris').disabled = true;
    try {
      const r = await rpc('defter_cihaz_kaydol', { p_kod: kod, p_anahtar: yeniAnahtar, p_bilgi: { surum: AYAR.surum || '', model: navigator.userAgent.slice(0, 60) } });
      if (r && r.sonuc === 'tamam') {
        anahtar = yeniAnahtar;
        rol = r.rol === 'yonetici' ? 'yonetici' : 'kurye';
        yerel.yaz('jt_anahtar', anahtar);
        yerel.yaz('jt_rol', rol);
        yerel.yaz('jt_ad', r.kisa_ad || '');
        await bildirimKaydi();
        await yenile();
        goster(anaEkran());
        sihirbazGerekirse();
        webBildirimTazele();
      } else {
        const ne = { kod_yok: 'Kod bulunamadı. Yöneticinizden yeni kod isteyin.', kod_kullanilmis: 'Bu kod kullanılmış. Yöneticinizden yeni kod isteyin.', kod_suresi_doldu: 'Kodun süresi dolmuş (24 saat).', kurye_pasif: 'Hesabınız kapalı. Yöneticinizi arayın.', cok_deneme: 'Çok fazla hatalı deneme. 10 dakika bekleyin.' }[r && r.sonuc] || 'Giriş yapılamadı.';
        mesaj(false, ne, 'girisMsg');
      }
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok. Bağlanınca tekrar deneyin.' : 'Giriş yapılamadı: ' + e.message, 'girisMsg');
    } finally {
      $('btnGiris').disabled = false;
    }
  }

  // FCM jetonu (sadece uygulamanın içinde; tarayıcıda yok)
  async function bildirimKaydi() {
    try {
      const H = window.JTHazirlik && window.JTHazirlik.eklenti();
      if (H && anahtar) {
        const j = await H.jeton();
        if (j && j.jeton) await rpc(rol === 'yonetici' ? 'defter_yonetici_jeton' : 'defter_cihaz_jeton', { p_anahtar: anahtar, p_jeton: j.jeton });
      }
    } catch (e) {
      // Bildirim ayarlı değilse (Firebase yapılandırması yok) uygulama yine çalışır; Hazırlık ekranı söyler
    }
    await bildirimYoluKaydi();
  }

  // Bildirim yolu (04.11): telefon Google Play hizmetlerine bakar; "fcm+sorgu" ya da "sorgu" merkezdeki cihaz kaydına yazılır,
  // panelde Kuryeler satırında görünür. Vardiyada hizmet (defter_nabiz) de yazar. Eski merkezde fonksiyon yoksa sessizce geçilir.
  // Web uygulaması (09.11; iPhone'da ana ekrandan, Android eklentisi yok): "web" yazılır, panelde "iPhone (web)".
  async function bildirimYoluKaydi() {
    try {
      if (!anahtar || rol !== 'kurye') return;
      const H = window.JTHazirlik && window.JTHazirlik.eklenti();
      if (!H) { await rpc('defter_bildirim_yolu', { p_anahtar: anahtar, p_yol: 'web' }); return; }
      if (!H.bildirimYolu) return;
      // Deneme bildirimi (04.11): uygulama kapalıyken de "geldi" diyebilmek için merkez ayarı telefonun tercih dosyasına
      if (H.merkezAyari) await Promise.resolve(H.merkezAyari({ merkez: AYAR.merkez, anahtar: AYAR.anahtar, cihaz: anahtar })).catch(() => {});
      const y = await H.bildirimYolu();
      if (y && (y.yol === 'fcm+sorgu' || y.yol === 'sorgu')) await rpc('defter_bildirim_yolu', { p_anahtar: anahtar, p_yol: y.yol });
    } catch (e) { /* yok */ }
  }
  // ------------------------------------------------------------------ web bildirimi (iPhone adım 5, 09.11)
  // Sadece web uygulamasında (Android eklentisi yok; APK'da sw.js kaydedilmez, orada FCM var). İzin SADECE düğmeyle istenir
  // (iPhone başka türlü sormaz). Abonelik merkeze cihaz anahtarıyla yazılır (defter_kurye_push_kaydet). İzin önceden
  // verilmişse açılışta abonelik sessizce tazelenir (merkez pasif yaptıysa ya da yeni girişte).
  const webMi = () => !(window.JTHazirlik && window.JTHazirlik.eklenti());
  const swVar = () => 'serviceWorker' in navigator && !!navigator.serviceWorker && 'PushManager' in window && typeof Notification !== 'undefined';
  const standaloneMi = () => navigator.standalone === true || Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const b64uBayt = (s) => { const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
  let swKayit = null, pushAyar = null, webDurum = null;
  async function swHazir() {
    if (!webMi() || !swVar()) return null;
    try { swKayit = swKayit || (await navigator.serviceWorker.register('sw.js')); } catch (e) { swKayit = null; }
    return swKayit;
  }
  // Abone olmadan önce service worker etkin olmalı (ilk açılışta kurulum sürerken abonelik reddedilir); en çok 5 sn beklenir.
  // navigator.serviceWorker.ready KULLANILMAZ: yayında uygulama panelle aynı adreste alt yolda; ready üst yoldaki panelin
  // kaydını verebilir ve abonelik panelin service worker'ına yapılırdı. Bu yüzden kendi kaydımızın etkinleşmesi beklenir.
  async function swEtkin() {
    const r = await swHazir();
    if (!r || r.active) return r;
    const sw = r.installing || r.waiting;
    if (sw) {
      await new Promise((z) => {
        const t = setTimeout(z, 5000);
        sw.addEventListener('statechange', () => { if (sw.state === 'activated') { clearTimeout(t); z(); } });
      });
    }
    return r;
  }
  async function webOrtam() {
    const r = await swHazir();
    let abone = null;
    if (r) { try { abone = await r.pushManager.getSubscription(); } catch (e) { abone = null; } }
    if (!pushAyar && anahtar && rol === 'kurye') { try { pushAyar = await rpc('defter_kurye_push_ayar', { p_anahtar: anahtar }); } catch (e) { pushAyar = null; } }
    const ua = navigator.userAgent;
    return { destek: Boolean(r), ios: /iPhone|iPad|iPod/.test(ua), iosSurum: C.iosSurumu(ua), standalone: standaloneMi(), izin: r ? Notification.permission : 'default',
      vapid: pushAyar && pushAyar.vapid_acik, abone: Boolean(abone && pushAyar && pushAyar.abone), aboneNesne: abone };
  }
  async function aboneKaydet(abone) {
    const j = abone.toJSON ? abone.toJSON() : abone;
    await rpc('defter_kurye_push_kaydet', { p_anahtar: anahtar, p: { endpoint: j.endpoint, keys: j.keys } });
    if (pushAyar) pushAyar.abone = true;
  }
  // sw.js'in deneme bildirimini "geldi" diye yazabilmesi için (09.11): merkez adresi + herkese açık anahtar + cihaz anahtarı
  // Cache Storage'da (sw.js ayarOku). Sadece web'de; çıkışta silinir. Müşteri bilgisi yok.
  const SW_AYAR = { onbellek: 'jt-kurye-ayar', yol: '__jt-ayar' };
  async function swAyarYaz(acik) {
    try {
      if (!webMi() || !window.caches) return;
      const adres = new URL(SW_AYAR.yol, location.href).href;
      if (!acik) { await caches.delete(SW_AYAR.onbellek); return; }
      const c = await caches.open(SW_AYAR.onbellek);
      await c.put(adres, new Response(JSON.stringify({ merkez: AYAR.merkez, anahtar: AYAR.anahtar, cihaz: anahtar }), { headers: { 'content-type': 'application/json' } }));
    } catch (e) { /* depolama yok: deneme "gelmedi" görünür */ }
  }
  async function webBildirimTazele() {
    if (!anahtar || rol !== 'kurye' || !webMi()) { webDurum = null; webBildirimCiz(); return; }
    swAyarYaz(true);
    try {
      let o = await webOrtam();
      if (o.destek && o.izin === 'granted' && o.vapid && !o.abone) {
        try {
          const r = await swEtkin();
          const abone = o.aboneNesne || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBayt(o.vapid) }));
          await aboneKaydet(abone);
          o = await webOrtam();
        } catch (e) { /* internet yok / push servisi yok: düğme görünür */ }
      }
      webDurum = C.webBildirimDurumu(o);
    } catch (e) { webDurum = null; }
    webBildirimCiz();
  }
  async function webBildirimAc() {
    try {
      // İzin isteği dokunuşun hemen içinde (iPhone başka bir beklemeden sonra sormayabilir)
      const izin = swVar() ? await Notification.requestPermission() : 'default';
      if (izin !== 'granted') { mesaj(false, izin === 'denied' ? 'Bildirim izni verilmedi. Ayarlar → Bildirimler → JT Kurye\'den açabilirsiniz.' : 'Bildirim izni verilmedi.'); return webBildirimTazele(); }
      const r = await swEtkin();
      if (!r) throw new Error('Bu tarayıcıda web bildirimi yok.');
      if (!pushAyar || !pushAyar.vapid_acik) pushAyar = await rpc('defter_kurye_push_ayar', { p_anahtar: anahtar });
      if (!pushAyar || !pushAyar.vapid_acik) throw new Error('Merkezde web bildirimi ayarlı değil.');
      const abone = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBayt(pushAyar.vapid_acik) }));
      await aboneKaydet(abone);
      mesaj(true, 'Bildirimler açıldı.');
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok. Bağlanınca tekrar deneyin.' : 'Bildirim açılamadı: ' + e.message);
    }
    await webBildirimTazele();
  }
  function webBildirimCiz() {
    const el = $('webBildirim');
    const d = webDurum;
    const goster_ = Boolean(d && d.kod !== 'acik' && rol === 'kurye');
    el.classList.toggle('hidden', !goster_);
    yaz(el, goster_ ? `<div class="durum-serit kirmizi" role="alert" data-web-bildirim="${esc(d.kod)}"><span class="ik" aria-hidden="true">!</span><span>${esc(d.metin)}${d.dugme === 'ac' ? '<button type="button" class="btn ana" id="btnWebBildirim" data-web-bildirim-ac="1">Bildirimleri aç</button>' : ''}</span></div>` : '');
    if (window.JTHazirlik && window.JTHazirlik.webCiz) window.JTHazirlik.webCiz(d);
  }
  // Bildirime dokununca açılan sipariş (#siparis=<id>): görevdeyse o görev, teklifse o teklif açılır
  let acilacakSiparis = C.hashSiparis(location.hash);
  function acilacakUygula() {
    const id = acilacakSiparis;
    if (!id || !anahtar || rol !== 'kurye' || !ozet) return;
    acilacakSiparis = null;
    try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* yok */ }
    if ((liste.benim || []).some((x) => x.id === id)) { secili = id; sekmeSec('gorev'); gorevCiz(); return; }
    const yeniler = ozet.mesaide ? liste.yeni || [] : [];
    const i = yeniler.findIndex((x) => x.id === id);
    if (i >= 0) { gecilen.delete(id); teklifElle = true; teklifSira = i; teklifCalinan = null; teklifCiz(); gorevCiz(); }
    // iptal / uyarı: tam ekran uyarı kendiliğinden açılır (ozet); başkası aldıysa liste güncel haliyle kalır
  }
  window.addEventListener('hashchange', () => { const id = C.hashSiparis(location.hash); if (id) { acilacakSiparis = id; yenile(); } });
  if (swVar()) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const v = ev.data || {};
      if (v.tur === 'siparis_ac') { const id = C.hashSiparis(new URL(v.url, location.href).hash); if (id) acilacakSiparis = id; }
      if (v.tur === 'siparis_ac' || v.tur === 'yenile') yenile();
    });
  }

  // Kurulum sihirbazı (04.11): bu telefonda kurye ilk kez girdiyse Hazırlık adım adım açılır (sadece telefondaki uygulamada)
  function sihirbazGerekirse() {
    try {
      if (rol !== 'kurye' || yerel.al('jt_sihirbaz_tamam') || !window.JTHazirlik || !window.JTHazirlik.eklenti()) return;
      goster('ekHazirlik');
      window.JTHazirlik.sihirbaz(0);
    } catch (e) { /* tarayıcıda eklenti yok */ }
  }
  // Hazırlık'taki TEST deneme ayarı değişince jeton / yol yeniden kaydedilir
  document.addEventListener('jt-bildirim-yolu', () => { bildirimKaydi(); });

  // ------------------------------------------------------------------ ana ekran
  let yenilemeNo = 0;
  async function yenile() {
    if (!anahtar) return;
    if (rol === 'yonetici') return yenileYonetici();
    const k = await kuyruk.isle();
    const oncekiCevrimdisi = cevrimdisi;
    const no = ++yenilemeNo;
    try {
      // Nakit borcu (08.11) ayrı okuma: merkezde yoksa (eski kurulum) ekran yine çalışır
      const [o, l, n] = await Promise.all([rpc('defter_kurye_ozet', { p_anahtar: anahtar }), rpc('defter_siparisler', { p_anahtar: anahtar }),
        rpc('defter_nakit_durum', { p_anahtar: anahtar }).catch((e) => (e && e.cevrimdisi ? Promise.reject(e) : null))]);
      if (no !== yenilemeNo) return; // bu arada daha yeni bir yenileme başladı: eski cevap yeni durumun üstüne yazılmasın
      ozet = o;
      liste = l || { yeni: [], benim: [] };
      nakit = n;
      saatSapma = C.saatFarki(liste.saat);
      cevrimdisi = false;
    } catch (e) {
      if (e.cevrimdisi) cevrimdisi = true;
      else if (/cihaz tanimli degil/.test(e.message)) return cikis(true);
      else mesaj(false, 'Yenilenemedi: ' + e.message);
    }
    if (k.bekleyen) cevrimdisi = cevrimdisi || false;
    if (oncekiCevrimdisi && !cevrimdisi) { internetGeldi = Date.now(); setTimeout(durumCiz, 4200); }
    if (ozet && !cevrimdisi) { yerelSinyalAyarla(Boolean(ozet.mesaide)); sinyal(false); }
    await iptalGordumGonder();
    ciz();
    acilacakUygula();
  }

  // ------------------------------------------------------------------ vardiya sinyali (03.11)
  // Vardiyadayken 60 sn'de bir "buradayım" (defter_sinyal; konum YOK, pil varsa). Android'de yerel hizmet (SinyalServisi)
  // uygulama arkadayken de gönderir; uygulama açıkken burası da gönderir (tarayıcıda tek yol). 5 dk sinyal yoksa panelde
  // "telefon sessiz" ve yöneticiye bildirim. Vardiya kapanınca ikisi de durur.
  const SINYAL_MS = 60 * 1000;
  let sonSinyal = 0;
  let yerelSinyal = null; // yerel hizmete son söylenen: true (çalışsın) / false (dursun)
  async function pilBilgisi() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        if (b && typeof b.level === 'number') return { p_pil: Math.round(b.level * 100), p_sarjda: Boolean(b.charging) };
      }
    } catch (e) { /* yok */ }
    return {};
  }
  async function sinyal(zorla) {
    if (!anahtar || rol !== 'kurye' || !ozet || !ozet.mesaide) return;
    if (!zorla && Date.now() - sonSinyal < SINYAL_MS - 2000) return;
    sonSinyal = Date.now();
    try { await rpc('defter_sinyal', { p_anahtar: anahtar, ...(await pilBilgisi()) }); } catch (e) { sonSinyal = 0; /* internet yok: sonra */ }
  }
  function yerelSinyalAyarla(acik) {
    if (yerelSinyal === acik) return;
    try {
      const H = window.JTHazirlik && window.JTHazirlik.eklenti();
      if (!H || !H.sinyalBaslat) return;
      yerelSinyal = acik;
      const p = acik ? H.sinyalBaslat({ merkez: AYAR.merkez, anahtar: AYAR.anahtar, cihaz: anahtar }) : H.sinyalDurdur();
      Promise.resolve(p).catch(() => { yerelSinyal = null; });
    } catch (e) { yerelSinyal = null; /* tarayıcıda eklenti yok */ }
  }

  // ------------------------------------------------------------------ tam ekran uyarı (sesli; GÖRDÜM'e kadar)
  // Kaynak: defter_kurye_ozet.iptaller + .uyarilar. Bildirim (FCM) uygulama kapalıyken alarm kanalından çalar; uygulama
  // açıksa burada ekran açılır ve ses yerel eklentiyle çalınır.
  const eklentiUyari = (u) => ({ id: u.siparis_id, uyari: u.tur === 'iptal' ? '' : u.tur });
  const UI = {
    carpi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    geri: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    devir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>',
    paket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  };
  // Aynı tip hep aynı görünüm: iptal kırmızı, geri alındı mor, devredildi gri, sana atandı / devredildi mavi
  const UYARI_GORUNUM = {
    iptal: { sinif: 't-iptal', ikon: UI.carpi, onay: 'GÖRDÜM' },
    geri_alindi: { sinif: 't-geri', ikon: UI.geri, onay: 'GÖRDÜM' },
    devredildi: { sinif: 't-devir', ikon: UI.devir, onay: 'GÖRDÜM' },
    devralindi: { sinif: 't-atandi', ikon: UI.paket, onay: 'TAMAM' },
    atandi: { sinif: 't-atandi', ikon: UI.paket, onay: 'TAMAM' },
  };
  function iptalCiz() {
    const u = rol === 'kurye' ? C.ekranUyarisi(ozet, kapatilan) : null;
    const E = $('iptalEkran');
    if (!u) { E.classList.add('hidden'); webSesGuncelle(); return; }
    const g = UYARI_GORUNUM[u.tur] || UYARI_GORUNUM.iptal;
    E.dataset.anahtar = u.anahtar;
    E.dataset.tur = u.tur;
    E.className = `katman uyariEkran ${g.sinif}${u.renk === 'mavi' ? ' mavi' : ''}`;
    E.setAttribute('aria-label', u.baslik);
    $('iptalIkon').innerHTML = g.ikon;
    $('iptalBaslik').textContent = u.baslik;
    $('iptalMetin').textContent = u.alt;
    $('iptalOnay').textContent = g.onay;
    const no = C.siparisNo(u);
    $('iptalBilgi').innerHTML = `<div class="d"><span>${esc(u.dukkan || '')}</span>${no ? `<span class="rozet-no">${esc(no)}</span>` : ''}</div>${u.mahalle ? `<div class="m">${esc(u.mahalle)}</div>` : ''}`;
    if (calanIptal !== u.anahtar) {
      calanIptal = u.anahtar;
      try {
        const H = window.JTHazirlik && window.JTHazirlik.eklenti();
        if (H && H.iptalAlarm) H.iptalAlarm({ ...eklentiUyari(u), baslik: u.tur === 'iptal' ? 'İPTAL — bu siparişe gitmeyin' : u.alt, metin: u.dukkan || '' });
      } catch (e) { /* tarayıcıda eklenti yok */ }
      if (webMi()) titret([500, 200, 500, 200, 500]); // web: titreşim varsa titrer, yoksa (iPhone) kırmızı şerit
    }
    webSesGuncelle();
  }
  async function iptalGordum() {
    const a = $('iptalEkran').dataset.anahtar;
    if (!a) return;
    const u = C.ekranUyarilari(ozet).find((x) => x.anahtar === a);
    kapatilan.add(a);
    if (u && (u.tur === 'atandi' || u.tur === 'devralindi')) { secili = u.siparis_id; sekmeSec('gorev'); }
    if (u && u.tur === 'atandi') varisBekleyen = u.siparis_id; // 05.11: elle atamada varış süresi burada seçilir
    gonderilecek.add(a);
    gorulenYaz();
    try {
      const H = window.JTHazirlik && window.JTHazirlik.eklenti();
      if (H && H.iptalKapat && u) H.iptalKapat(eklentiUyari(u));
    } catch (e) { /* yok */ }
    iptalCiz();
    gorevCiz();
    varisBekleyeniAc();
    await iptalGordumGonder();
  }
  // "Gördüm" merkeze gidene kadar telefonda tutulur, her yenilemede tekrar denenir
  async function iptalGordumGonder() {
    if (!anahtar || rol !== 'kurye' || !gonderilecek.size) return;
    for (const a of [...gonderilecek]) {
      const c = C.gordumCagrisi(a);
      if (!c) { gonderilecek.delete(a); continue; }
      try {
        await rpc(c.fn, { p_anahtar: anahtar, ...c.args });
        gonderilecek.delete(a);
      } catch (e) {
        if (e.cevrimdisi) break;
        gonderilecek.delete(a); // sipariş / uyarı yok ya da zaten görülmüş: tekrar denemeye gerek yok
      }
    }
    gorulenYaz();
  }

  // ------------------------------------------------------------------ "Teslim edemedim" nedeni
  function nedenAc(id) {
    nedenSiparis = id;
    const l = (ozet && ozet.nedenler) || [];
    $('nedenListe').innerHTML = l.length
      ? l.map((n) => `<label><input type="radio" name="neden" value="${esc(n.kod)}"> ${esc(n.ad)}</label>`).join('')
      : '<p class="bos">Neden listesi alınamadı. İnternet gelince tekrar deneyin.</p>';
    $('nedenAciklama').value = '';
    $('nedenMsg').classList.add('hidden');
    $('nedenKutu').classList.remove('hidden');
  }
  function nedenKapat() {
    nedenSiparis = null;
    $('nedenKutu').classList.add('hidden');
  }
  async function nedenGonder() {
    const id = nedenSiparis;
    if (!id) return nedenKapat();
    const secili = document.querySelector('#nedenListe input[name="neden"]:checked');
    const kod = secili ? secili.value : null;
    const aciklama = $('nedenAciklama').value.trim();
    const d = C.nedenDogrula((ozet && ozet.nedenler) || [], kod, aciklama);
    if (!d.ok) return mesaj(false, d.hata, 'nedenMsg');
    nedenKapat();
    kuyruk.ekle({
      eylem: C.eylemKimligi(), fn: 'defter_durum', siparis: id, tur: 'teslim_edilemedi',
      args: { p_siparis: id, p_tur: 'teslim_edilemedi', p_neden: kod, p_aciklama: aciklama || null, p_istemci_zamani: new Date().toISOString() },
    });
    ciz();
    await yenile();
  }

  const sure = (t) => {
    if (!t) return '';
    const dk = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 60000));
    return dk < 1 ? 'şimdi' : `${dk} dk önce`;
  };

  // ------------------------------------------------------------------ arayüz v2 (05.11): çizim
  const IK = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    ara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
    yol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 21l8-4 8 4z"/></svg>',
    gorev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
  };
  const saatYaz = (t) => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
  const kaynakAdi = (k) => C.KAYNAK_ADI[k] || k || '';
  const kaydirici = (metin, tur, id, yesil) => `<div class="kaydir${yesil ? ' yesil' : ''}" data-kaydir="${esc(tur)}" data-islem="${esc(tur)}" data-siparis="${esc(id || '')}"
      role="slider" tabindex="0" aria-label="${esc(metin)}: sağa kaydırın (klavyede Enter)" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="iz"></div><div class="yazi">${esc(metin)}</div><div class="tutamak" aria-hidden="true">${IK.ok}</div></div>`;
  // 10.11 (arayüz kuralı): kaydırarak onay SADECE geri alınamaz adımlarda (Paketi aldım, Teslim ettim, POS'u iade ettim,
  // Parayı verdim). Diğer birincil eylemler (Restorandayım, Vardiyaya başla) tek dokunuşluk büyük düğme (en az 76 px).
  const eylemDugmesi = (metin, tur, id) => `<button class="btn ana eylem" type="button" data-islem="${esc(tur)}" data-siparis="${esc(id || '')}">${esc(metin)}</button>`;
  function paraHtml(s) {
    const p = C.paraKutusu(s);
    return `<div class="para ${p.tur}"><div class="tur">${esc(p.baslik)}<small>${esc(p.alt)}</small></div><b class="sayi">${esc(C.para(p.tutar))}</b></div>`;
  }
  const odemeKisa = (s) => (s.odeme === 'nakit' ? `<b class="nakit-yazi">${esc(C.para(C.paraKutusu(s).tutar))} nakit</b>` : esc(C.odemeAdi(s.odeme)));

  // İçerik değişmediyse yeniden çizilmez: düğmeler yerinde kalır (yenileme anında yapılan dokunuş boşa gitmez)
  function yaz(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }

  // Üst şerit (07.11): tutar kutusuna sığmazsa yazı küçülür (28 px'ten en az 14 px'e); ekran görünmüyorsa dokunulmaz.
  // enCok verilmezse öğenin ilk boyu (CSS / satır içi) esas alınır.
  function sigdir(el, enCok, enAz = 14) {
    if (!el || !el.clientWidth) return;
    if (enCok == null) { if (!el.dataset.boy) el.dataset.boy = parseFloat(getComputedStyle(el).fontSize) || 28; enCok = Number(el.dataset.boy); }
    let b = enCok;
    el.style.fontSize = b + 'px';
    while (b > enAz && el.scrollWidth > el.clientWidth + 0.5) el.style.fontSize = --b + 'px';
  }
  const seritSigdir = () => {
    sigdir($('ozNakit'), 28); sigdir($('ozTeslim'), 28);
    // etiketler de kesilmez, küçülür (12 / 11 px'ten en az 9 px'e)
    document.querySelectorAll('.ozetS small').forEach((x) => { x.style.fontSize = ''; sigdir(x, parseFloat(getComputedStyle(x).fontSize) || 12, 9); });
    // Bugün ve "Vardiyayı bitir"deki büyük rakamlar da kutusundan taşmaz
    document.querySelectorAll('.buyuk-rakamlar b').forEach((x) => sigdir(x, null, 18));
  };
  window.addEventListener('resize', seritSigdir);

  function ciz() {
    const ad = (ozet && ozet.kisa_ad) || yerel.al('jt_ad') || '';
    $('kuryeAd').textContent = ad;
    if (ozet) {
      const ac = Boolean(ozet.mesaide);
      $('btnMesai').setAttribute('aria-checked', String(ac));
      $('btnMesai').setAttribute('aria-label', `Vardiya ${ac ? 'açık' : 'kapalı'}`);
      $('mesaiYazi').textContent = ac ? 'Vardiyada' : 'Kapalı';
      $('mesaiAlt').textContent = ad || 'vardiya';
      $('ozTeslim').textContent = ozet.bugun && ozet.bugun.teslim != null ? String(ozet.bugun.teslim) : '-';
      // 08.11: eski nakit sayısı yerine "İşletmelere borcum". 09.11: yöneticiye nakit teslim akışı kalktı; merkez nakit
      // borcunu bilmiyorsa (eski kurulum) değer "-"
      $('ozNakit').textContent = nakit ? C.para(C.nakitToplam(nakitListesi())) : '-';
      $('ozNakitEtiket').textContent = $('bitirNakitEtiket').textContent = 'işletmelere borcum';
      seritSigdir();
    }
    durumCiz();
    gorevCiz();
    teklifCiz();
    if (sekme === 'bugun') { bugunCiz(); seritSigdir(); }
    iptalCiz();
    varisBekleyeniAc();
  }

  // Durum şeritleri: internet yok / gönderiliyor / kilit / fiş / nakit / paket sınırı; internet gelince 4 sn yeşil "İnternet geldi"
  let internetGeldi = 0;
  function durumCiz() {
    const l = C.uyarilar(ozet, { bekleyenSayi: kuyruk.bekleyen().length, cevrimdisi });
    if (!cevrimdisi && Date.now() - internetGeldi < 4000) l.unshift({ tur: 'tamam', metin: 'İnternet geldi' });
    const ik = { kirmizi: '!', sari: '!', tamam: '✓' };
    // POS şeritleri (06.11): turuncu "POS sende · <işletme> · X dk"; eşik aşılınca kırmızı + bir kez titreşim
    const esik = C.posEsigi(ozet);
    const pos = rol === 'kurye' ? posListesi().map((p) => {
      const r = C.posSeridi(p, esik);
      if (r.asti && !posCalinan.has(p.anahtar)) { posCalinan.add(p.anahtar); titret([600, 200, 600, 200, 600]); }
      return `<button type="button" class="durum-serit pos ${r.renk}" data-pos-serit="${esc(p.anahtar)}"><span class="ik" aria-hidden="true">▣</span><span>${esc(r.metin)}<small>${esc(r.alt)}</small></span></button>`;
    }) : [];
    // Nakit borcu şeritleri (08.11): turuncu "<işletme>'ye X TL borcun"; dokununca Görevler'de "Parayı verdim"
    const nk = rol === 'kurye' ? nakitListesi().map((b) => {
      const r = C.nakitSeridi(b);
      return `<button type="button" class="durum-serit nakit-borc turuncu" data-nakit-serit="${esc(b.dukkan_id)}"><span class="ik" aria-hidden="true">₺</span><span>${esc(r.metin)}<small>${esc(r.alt)}</small></span></button>`;
    }) : [];
    yaz($('uyarilar'), pos.join('') + nk.join('') + l.map((u) => `<div class="durum-serit ${esc(u.tur)}" role="status"><span class="ik" aria-hidden="true">${ik[u.tur] || '•'}</span><span>${esc(u.metin)}</span></div>`).join(''));
  }

  // ------------------------------------------------------------------ Görevler sekmesi: tek görev odaklı kart
  let secili = null; // seçili görev (sipariş kimliği)
  let cizBekliyor = false; // kaydırma sürerken çizim ertelenir
  function gorevCiz() {
    if (surukle) { cizBekliyor = true; return; }
    const benim = liste.benim || [], bekleyen = kuyruk.bekleyen();
    $('rozetGorev').textContent = String(benim.length);
    $('rozetGorev').classList.toggle('hidden', !benim.length);
    const yeniSayi = ozet && ozet.mesaide ? (liste.yeni || []).length : 0;
    const teklifAcik = !$('teklifEkran').classList.contains('hidden');
    const ust = [];
    const s = benim.find((x) => x.id === secili) || benim[0] || null;
    secili = s ? s.id : null;
    if (benim.length > 1) {
      const yer = ['dükkâna', 'dükkânda', 'teslime'];
      ust.push(`<div class="paket-sec">${benim.map((x) => `<button type="button" aria-pressed="${x.id === secili}" data-paket="${esc(x.id)}">${esc(x.mahalle || x.dukkan)}<small>${yer[C.GOREV_ADIM[C.tahminiDurum(x, bekleyen.filter((b) => b.siparis === x.id))]] || ''} · ${esc(C.siparisNo(x))}</small></button>`).join('')}</div>`);
    }
    if (yeniSayi && !teklifAcik) ust.push(`<button class="yeni-is" type="button" data-teklif-ac="1"><span>${benim.length ? 'Yeni sipariş teklifi' : 'Bekleyen teklif'}</span><b class="sayi">${yeniSayi}</b></button>`);
    // POS iadesi (06.11): o işletmenin kartlı siparişleri bittiyse görev; paket yoksa ana kart, varsa görevin üstünde
    const iadeler = rol === 'kurye' ? posListesi().filter((p) => !p.bekleyen.length) : [];
    const iadeHtml = iadeler.map((p) => posIadeKarti(p, C.posEsigi(ozet))).join('');
    // Nakit borcu kartı (08.11): paket varken sadece şeride dokunulan işletme; paket yoksa açık borçların hepsi
    const borclar = rol === 'kurye' ? nakitListesi().filter((b) => b.acik > 0) : [];
    const nakitHtml = (s ? borclar.filter((b) => b.dukkan_id === nakitAcik) : borclar).map(nakitKarti).join('');
    // 10.11: POS iadesi / nakit kartları (kaydırmalı onay) görevin ALTINDA: onay ekranın üst yarısında olmaz
    yaz($('gorevUst'), ust.join(''));
    if (!s && (iadeHtml || nakitHtml)) { yaz($('benim'), iadeHtml + nakitHtml); return; }
    if (!s) {
      yaz($('benim'), ozet && !ozet.mesaide
        ? `<div class="bos-alan"><div class="nabiz sonuk">${IK.gorev}</div><h2>Vardiya kapalı</h2><p>Sipariş almak için vardiyaya başla.${ozet.bugun ? `<br>Bugün ${esc(ozet.bugun.teslim)} teslim yaptın.` : ''}</p></div>
           <div class="alt">${eylemDugmesi('Vardiyaya başla', 'mesai', '')}</div>`
        : `<div class="bos-alan"><div class="nabiz">${IK.gorev}</div><h2>Sipariş bekleniyor</h2><p>Yeni sipariş gelince telefon çalar ve tam ekran teklif açılır.</p></div>`);
      return;
    }
    yaz($('benim'), gorevKarti(s, bekleyen.filter((x) => x.siparis === s.id), benim) + iadeHtml + nakitHtml);
  }

  function gorevKarti(s, bekleyen, benim) {
    const d = C.dugmeler(s, { bekleyen, fotoHazir: fotolar.has(s.id) });
    const durum = C.tahminiDurum(s, bekleyen), a = C.GOREV_ADIM[durum] != null ? C.GOREV_ADIM[durum] : 2;
    const adimlar = ['Dükkân', 'Paket', 'Teslim'].map((ad, i) => `<div class="${i < a ? 'tamam' : i === a ? 'simdi' : ''}"><i></i>${ad}</div>`).join('');
    const birak = d.some((x) => x.ad === 'birak') ? `<button class="bag" type="button" data-islem="birak" data-siparis="${esc(s.id)}">Paketi bırak</button>` : '';
    let govde;
    if (d.length === 1 && d[0].ad === 'bekliyor') {
      govde = `<div class="yer">${esc(s.mahalle || s.dukkan)}</div><div class="bekliyor-yazi">Gönderilmeyi bekliyor… internet gelince kendiliğinden gider</div>`;
    } else if (durum === 'alindi') {
      govde = `<div class="ne-yap">Şimdi: dükkâna git</div>
        <div class="yer">${esc(s.dukkan)}</div>
        <div class="not">Teslim: <b>${esc(s.mahalle || 'mahalle bilinmiyor')}</b> · ${odemeKisa(s)}</div>
        ${varisSatiri(s)}
        <div class="alt">${eylemDugmesi('Restorandayım', 'restoranda', s.id)}${birak}</div>`;
    } else if (durum === 'restoranda') {
      govde = `<div class="ne-yap">Şimdi: paketi teslim al</div>
        <div class="yer">${esc(s.dukkan)}</div>
        <div class="soyle"><div class="etiket">Dükkâna söyle</div><b>${esc(C.siparisNo(s))}</b><div class="not" style="margin-top:4px">${esc(kaynakAdi(s.kaynak))} siparişi</div></div>
        ${paraHtml(s)}
        <div class="alt">${kaydirici('Paketi aldım', 'dukkandan_aldi', s.id)}${birak}</div>`;
    } else {
      const yol = s.lat != null && s.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}` : null;
      const ed = d.some((x) => x.ad === 'teslim_edilemedi') ? `<button class="bag" type="button" data-islem="teslim_edilemedi" data-siparis="${esc(s.id)}">Teslim edemedim</button>` : '';
      const kim = [s.tarif, s.musteri_ad].filter(Boolean).map(esc).join(' · ');
      govde = `<div class="ne-yap">Şimdi: müşteriye teslim et</div>
        <div class="yer">${esc(s.mahalle || 'Mahalle bilinmiyor')}</div>
        ${s.adres ? `<div class="adres">${esc(s.adres)}</div>` : ''}
        ${kim ? `<div class="not">${kim}</div>` : ''}
        ${paraHtml(s)}
        ${C.posSorusu(s, posListesi()) ? `<button class="bag" type="button" data-pos-sor="${esc(s.id)}">POS cihazını aldıysan işaretle</button>` : ''}
        ${nakit && C.nakitSorusu(s, nakit, kuyruk.bekleyen()) ? `<button class="bag" type="button" data-nakit-sor="${esc(s.id)}">Parayı işletmeye verdin mi? (cevapla)</button>` : ''}
        <div class="ikili">${C.aramaBilgisi(s.musteri_tel) ? `<a class="btn ikincil tel" href="${esc(C.aramaBilgisi(s.musteri_tel).href)}">${IK.ara}Müşteriyi ara</a>` : '<span class="btn ikincil" aria-disabled="true">Numara yok</span>'}${yol ? `<a class="btn ikincil yol" href="${esc(yol)}">${IK.yol}Yol tarifi</a>` : '<span class="btn ikincil" aria-disabled="true">Konum yok</span>'}</div>
        ${s.fis_zorunlu ? fisBlok(s, d, ed) : `<div class="alt">${kaydirici('Teslim ettim', 'teslim', s.id, true)}${ed}</div>`}`;
    }
    const sira = benim.length > 1 ? `Görev ${benim.findIndex((x) => x.id === s.id) + 1} / ${benim.length}` : 'Görev';
    return `<section class="gorev" data-benim="${esc(s.id)}" aria-label="Şu anki görev">
      <div class="gorev-ust"><span class="etiket">${sira}</span><span class="kod" title="${esc(s.kaynak_no || '')}">${esc(C.siparisNo(s))}</span></div>
      <div class="adimlar" aria-label="İlerleme">${adimlar}</div>
      ${notHtml(s)}
      ${govde}
    </section>`;
  }

  // İşletmeden gelen son not (06.11): görev kartında küçük satır
  function notHtml(s) {
    const n = C.isletmeNotu(s);
    return n ? `<div class="isletme-not" role="note"><b>İşletme: ${esc(n.metin)}</b><small>${esc(n.saat)}${n.eski ? ` · önceki ${n.eski} not` : ''}</small></div>` : '';
  }

  // Kapıda kart: POS ile çek → fişin fotoğrafı → ancak sonra "Teslim ettim" kaydırması açılır (fis_zorunlu merkezden)
  function fisBlok(s, d, ed) {
    const foto = d.find((x) => x.ad === 'foto'), tes = d.find((x) => x.ad === 'teslim');
    const cekildi = Boolean(foto && foto.ikincil);
    const acik = Boolean(tes && tes.acik);
    return `<div class="fis-satir" aria-label="Kartla teslim adımları">
        <div class="sira tamam"><i>✓</i>POS ile çek</div>
        <div class="sira ${cekildi ? 'tamam' : 'simdi'}"><i>${cekildi ? '✓' : '2'}</i>Fiş fotoğrafı</div>
        <div class="sira ${cekildi ? 'simdi' : ''}"><i>3</i>Teslim</div></div>
      <div class="alt">${acik
        ? `${kaydirici('Teslim ettim', 'teslim', s.id, true)}<button class="bag" type="button" data-islem="foto" data-siparis="${esc(s.id)}">Fişi yeniden çek</button>`
        : `<button class="btn ana" type="button" data-islem="foto" data-siparis="${esc(s.id)}">📷 Fişin fotoğrafını çek</button>
           <div class="neden">🔒 ${esc((tes && tes.neden) || 'Kapıda kart: önce fiş fotoğrafı')} · "Teslim ettim" sonra açılır</div>`}${ed}</div>`;
  }

  // Varış: "Dükkâna söylediğin 14:32 · 7 dk kaldı" + "+5 dk gecikiyorum"; söz yoksa süre seçme düğmesi
  function varisSatiri(s) {
    const ic = varisIc(s);
    return `<div data-varis-satir="${esc(s.id)}" data-html="${esc(ic)}">${ic}</div>`;
  }
  function varislariGuncelle() {
    document.querySelectorAll('[data-varis-satir]').forEach((el) => {
      const s = (liste.benim || []).find((x) => x.id === el.dataset.varisSatir);
      if (!s) return;
      const ic = varisIc(s);
      if (el.dataset.html !== ic) { el.dataset.html = ic; el.innerHTML = ic; }
    });
  }
  function varisIc(s) {
    const V = C.varisAyari(ozet), v = C.varisDurumu(s, V, Date.now() + saatSapma);
    if (!v) return `<button class="btn ikincil" type="button" data-varis-sor="${esc(s.id)}">Dükkâna kaç dakikada varırsın? Seç</button>`;
    return `<div class="varis${v.gecKaldi ? ' gec' : ''}"><div><small>Dükkâna söylediğin</small><b class="sayi">${esc(saatYaz(s.varis_hedef))}</b> · <b class="${v.gecKaldi ? 'gec-yazi' : ''}">${esc(v.metin)}</b>${s.varis_gecikme ? `<small>+${esc(s.varis_gecikme)} dk gecikme bildirdin</small>` : ''}</div>
      <button class="btn ikincil" type="button" data-gecikiyorum="${esc(s.id)}">+${esc(V.adim)} dk<br>gecikiyorum</button></div>`;
  }

  // ------------------------------------------------------------------ yeni sipariş teklifi (tam ekran)
  // Alınabilir ve "Şimdi değil" denmemiş teklif varsa kendiliğinden açılır. "Bekleyen teklif"e basınca hepsi gezilir.
  // 07.11: "Şimdi değil" kalıcı değil: telefonun bir sonraki çaldığı ana kadar (merkezin tekrar aralığı) gizli kalır
  const gecilen = new Map(); // sipariş → "Şimdi değil" anı (merkez saatiyle ms)
  let teklifElle = false, teklifSira = 0;
  const gizliMi = (s) => C.teklifGizli(s, gecilen.get(s.id), Date.now() + saatSapma);
  function teklifCiz() {
    const yeniler = ozet && ozet.mesaide ? liste.yeni || [] : [];
    const neden = C.alamazNedeni(ozet, { cevrimdisi });
    const gosterilen = teklifElle ? yeniler : neden ? [] : yeniler.filter((s) => !gizliMi(s));
    if (!gosterilen.length) teklifElle = false;
    teklifSira = Math.max(0, Math.min(teklifSira, gosterilen.length - 1));
    const simdiki = gosterilen[teklifSira];
    const V = C.varisAyari(ozet), n = gosterilen.length;
    const P = posListesi();
    yaz($('yeni'), yeniler.map((s) => {
      const i = gosterilen.indexOf(s);
      const pu = C.teklifPosUyarisi(s, P); // başka işletmenin POS'u sende: uyarı, ALIYORUM engellenmez
      return `<section class="teklif-ic${s === simdiki ? '' : ' hidden'}" data-yeni="${esc(s.id)}">
        <div class="ust-k"><span class="etiket">Yeni sipariş${n > 1 && i >= 0 ? ` · ${i + 1} / ${n}` : ''}</span>${C.siparisNo(s) ? `<span class="kod">${esc(C.siparisNo(s))}</span>` : ''}</div>
        <div class="halka" data-halka="${esc(s.id)}">${halkaHtml(s)}</div>
        <div class="yer">${esc(s.mahalle || 'Mahalle bilinmiyor')}</div>
        <div class="dukkan">${esc(s.dukkan)}</div>
        ${pu ? `<div class="pos-uyari" role="note">${esc(pu)}</div>` : ''}
        ${paraHtml(s)}
        <div class="bilgi-satir"><span>${esc(kaynakAdi(s.kaynak))}</span><span>${esc(sure(s.olusturma))}</span>${s.genis || s.herkese_acik ? '<span>herkese açık</span>' : ''}</div>
        <div class="alt"><div class="etiket ortala">${esc(neden || 'Al · dükkâna kaç dakikada varırsın?')}</div>
          <div class="teklif-sure" style="--n:${V.secenekler.length}">${V.secenekler.map((dk, j) => `<button class="btn ana" type="button" data-al="${esc(s.id)}" data-dk="${dk}" ${neden ? 'disabled' : ''}
            aria-label="Al, ${dk}${j === V.secenekler.length - 1 ? ' dakikadan fazla' : ' dakikada dükkândayım'}">${dk}${j === V.secenekler.length - 1 ? '+' : ''}<small>dk</small></button>`).join('')}</div>
          <div class="teklif-gezin">${n > 1 ? '<button type="button" data-teklif-git="-1" aria-label="Önceki teklif">‹</button>' : ''}
            <button class="bag" type="button" data-teklif-gec="${esc(s.id)}">Şimdi değil</button>${n > 1 ? '<button type="button" data-teklif-git="1" aria-label="Sonraki teklif">›</button>' : ''}</div></div>
      </section>`;
    }).join(''));
    const acilacak = Boolean(simdiki);
    if (acilacak && $('teklifEkran').classList.contains('hidden') && teklifCalinan !== simdiki.id) { teklifCalinan = simdiki.id; titret([400, 150, 400]); }
    $('teklifEkran').classList.toggle('hidden', !acilacak);
    webSesGuncelle();
  }
  let teklifCalinan = null;
  // Geri sayım halkası (06.11): merkezin "kimse almazsa" sürelerine göre; alan yoksa (eski merkez) boş
  const HALKA_R = 74, HALKA_C = 2 * Math.PI * HALKA_R;
  function halkaHtml(s) {
    const g = C.teklifSayaci(s, Date.now() + saatSapma);
    if (!g) return '';
    return `<svg viewBox="0 0 168 168" aria-hidden="true"><circle cx="84" cy="84" r="${HALKA_R}" fill="none" stroke="var(--yuzey2)" stroke-width="12"/>
      <circle cx="84" cy="84" r="${HALKA_R}" fill="none" stroke="${g.kirmizi ? 'var(--kirmizi)' : 'var(--marka)'}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${HALKA_C.toFixed(1)}" stroke-dashoffset="${(HALKA_C * (1 - g.oran)).toFixed(1)}"/></svg>
      <div class="sure" role="timer" aria-live="off"><b class="sayi">${esc(g.bitti ? '!' : g.sayi)}</b><small>${esc(g.alt)}</small></div>`;
  }
  // Saniyede bir: "Şimdi değil"i biten teklif yeniden açılır (titreşim); varış yazısı ("süre doldu" → "6 dk geç kaldın") yenilenir
  function saniyelik() {
    for (const [id, t] of gecilen) {
      const s = (liste.yeni || []).find((x) => x.id === id);
      if (!s) { gecilen.delete(id); continue; }
      if (!C.teklifGizli(s, t, Date.now() + saatSapma)) { gecilen.delete(id); if (teklifCalinan === id) teklifCalinan = null; teklifSesBas.delete(id); teklifCiz(); }
    }
    webSesGuncelle(); // teklif sesi 30 sn'de durur
    varislariGuncelle();
    halkalariGuncelle();
  }
  function halkalariGuncelle() {
    if ($('teklifEkran').classList.contains('hidden')) return;
    const bul = new Map((liste.yeni || []).map((s) => [s.id, s]));
    document.querySelectorAll('[data-halka]').forEach((el) => { const s = bul.get(el.dataset.halka); el.innerHTML = s ? halkaHtml(s) : ''; el.classList.toggle('hidden', !el.innerHTML); });
  }
  // Titreşim yoksa (iPhone, 09.11) uyarı desenlerinde (dizi: teklif, POS eşiği) ekranın üstünde kırmızı şerit yanıp söner.
  // Kısa dokunuş titreşimleri (sayı) görsel uyarı vermez.
  const titret = (desen) => {
    try { if (navigator.vibrate) { navigator.vibrate(desen); return; } } catch (e) { /* yok */ }
    if (Array.isArray(desen)) gorselTitresim();
  };
  function gorselTitresim() {
    let s = $('titresimSeridi');
    if (!s) { s = document.createElement('div'); s.id = 'titresimSeridi'; s.className = 'titresimSeridi'; s.setAttribute('aria-hidden', 'true'); document.body.appendChild(s); }
    s.classList.remove('yanip');
    void s.offsetWidth; // animasyon baştan
    s.classList.add('yanip');
  }

  // ------------------------------------------------------------------ uygulama açıkken ses (web; iPhone adım 7, 09.11)
  // Android'de sesi eklenti çalar. Web'de: tam ekran uyarı (iptal / geri alındı / devir / atandı) açıkken "GÖRDÜM"e kadar,
  // kendiliğinden açılan yeni sipariş teklifi açıkken tarayıcı sesi (js/ses.js). Tarayıcı sesi ilk dokunuştan sonra açar.
  const webSes = () => (webMi() && window.JTSes) || null;
  const sesAc = () => { const S = webSes(); if (S) S.ac(); };
  document.addEventListener('pointerdown', sesAc, true);
  document.addEventListener('keydown', sesAc, true);
  // Teklif sesi teklif başına en çok 30 sn (Android ile aynı; 09.11 kararı). "Şimdi değil" süresi bitip teklif yeniden
  // açılınca (merkezin tekrarı) sayaç baştan başlar.
  const teklifSesBas = new Map(); // sipariş → teklif sesinin başladığı an (ms)
  function webSesGuncelle() {
    const S = webSes();
    if (!S) return;
    const uyari = $('iptalEkran'), teklif = $('teklifEkran');
    const acikTeklif = !teklif.classList.contains('hidden') && !teklifElle ? document.querySelector('#yeni section:not(.hidden)') : null;
    if (!uyari.classList.contains('hidden')) S.baslat(uyari.dataset.tur === 'iptal' ? 'iptal' : 'uyari');
    else if (acikTeklif) {
      const id = acikTeklif.dataset.yeni;
      if (!teklifSesBas.has(id)) teklifSesBas.set(id, Date.now());
      if (C.teklifSesiCalsin(teklifSesBas.get(id), Date.now(), window.JT_TEKLIF_SES_MS)) S.baslat('teklif'); else S.durdur();
    } else S.durdur();
  }

  // ------------------------------------------------------------------ Bugün sekmesi
  function bugunCiz() {
    const b = ozet && ozet.bugun;
    if (!b) { $('sBugun').innerHTML = '<p class="bos">Bugünün özeti henüz alınamadı.</p>'; return; }
    const odeme = (o) => (o === 'nakit' ? '<small class="nakit-yazi">NAKİT</small>' : ['kapida_kart', 'yemek_karti'].includes(o) ? '<small>KART</small>' : '<small>ONLINE</small>');
    const satir = (sol, alt, sag, sinif = '') => `<div class="satirK"><div class="sol"><b>${sol}</b>${alt ? `<small>${alt}</small>` : ''}</div><div class="sag sayi ${sinif}">${sag}</div></div>`;
    const tarih = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    $('sBugun').innerHTML = `<div class="baslikS"><h2>Bugün</h2><span>${esc(tarih)}</span></div>
      <div class="buyuk-rakamlar"><div><b class="sayi">${esc(b.teslim)}</b><small>teslim</small></div><div><b class="sayi nakit-yazi" style="font-size:28px;padding:6px 0">${esc(nakit ? C.para(C.nakitToplam(nakitListesi())) : '-')}</b><small>işletmelere borcum</small></div></div>
      ${nakit ? nakitBugunHtml(satir) : ''}
      <div class="kutu" aria-label="Kapıda toplanan">
        ${satir('Kapıda topladığın nakit', 'bugün, bilgi için', esc(C.para(b.nakit)), 'nakit-yazi')}
        ${satir('Kartla alınan · online', '', `${esc(C.para(b.kart))} · ${esc(C.para(b.online))}`)}
      </div>
      <div class="baslikS"><h2 style="font-size:19px">Teslimler</h2><span>en yeni üstte</span></div>
      <div class="kutu">${(b.liste || []).length
        ? b.liste.map((x) => `<div class="satirK"><div class="sol"><b>${esc(x.mahalle || '-')}</b><small>${esc(saatYaz(x.zaman))} · ${esc(C.siparisNo(x))}</small></div><div class="sag sayi">${esc(C.para(x.tutar))}${odeme(x.odeme)}</div></div>`).join('')
        : '<p class="bos">Bugün henüz teslim yok.</p>'}</div>
      ${(b.diger || []).length ? `<div class="baslikS soluk"><h2 style="font-size:16px">İptal · teslim edilemedi</h2><span>sayılmaz</span></div>
      <div class="kutu soluk" aria-label="İptal ve teslim edilemeyenler (tutara sayılmaz)">${b.diger.map((x) => `<div class="satirK"><div class="sol"><b>${esc(x.mahalle || '-')}</b><small>${esc(saatYaz(x.zaman))} · ${esc(C.siparisNo(x))} · ${x.durum === 'iptal' ? 'İptal' : 'Teslim edilemedi'}</small></div><div class="sag sayi"><s>${esc(C.para(x.tutar))}</s></div></div>`).join('')}</div>` : ''}`;
  }

  // ------------------------------------------------------------------ sekmeler, tema
  function sekmeSec(ad) {
    sekme = ad;
    for (const [id, s] of [['sGorev', 'gorev'], ['sBugun', 'bugun'], ['sTelefon', 'telefon']]) $(id).classList.toggle('hidden', s !== ad);
    document.querySelectorAll('.sekmeler [data-sekme]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sekme === ad)));
    if (ad === 'bugun') { bugunCiz(); seritSigdir(); }
    if (ad === 'telefon' && window.JTHazirlik) window.JTHazirlik.yenile();
  }
  function temaSec(t) {
    document.documentElement.dataset.tema = t === 'acik' ? 'acik' : 'koyu';
    yerel.yaz('jt_tema', document.documentElement.dataset.tema);
    temaDugmeleri();
  }
  const temaDugmeleri = () => document.querySelectorAll('[data-tema]').forEach((b) => { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.tema === document.documentElement.dataset.tema)); });

  // ------------------------------------------------------------------ kaydırarak onay (10.11: sadece Paketi aldım / Teslim ettim / POS'u iade ettim / Parayı verdim)
  // Sona kadar (%85) kaydırılınca işlem; erken bırakılırsa geri döner. Klavyede Enter / sağ ok.
  let surukle = null;
  function kaydirKoy(v) {
    const k = surukle.k, t = k.querySelector('.tutamak'), iz = k.querySelector('.iz');
    const max = Math.max(1, k.clientWidth - t.offsetWidth - 8);
    surukle.x = Math.max(0, Math.min(max, v));
    surukle.max = max;
    t.style.transform = `translateX(${surukle.x}px)`;
    iz.style.width = `${surukle.x + 68}px`;
    k.setAttribute('aria-valuenow', String(Math.round((surukle.x / max) * 100)));
  }
  function kaydirBitir() {
    if (!surukle) return;
    const { k, x, max } = surukle;
    surukle = null;
    if (max && x >= max * 0.85) {
      k.classList.add('tamam');
      titret(40);
      const { kaydir: tur, siparis } = k.dataset;
      setTimeout(() => { if (tur === 'mesai') mesaiDegistir(); else islem(tur, siparis); }, 150);
    } else {
      k.classList.add('donuyor');
      const t = k.querySelector('.tutamak'), iz = k.querySelector('.iz');
      t.style.transform = 'translateX(0)';
      iz.style.width = '0';
      k.setAttribute('aria-valuenow', '0');
      setTimeout(() => k.classList.remove('donuyor'), 260);
    }
    if (cizBekliyor) { cizBekliyor = false; setTimeout(ciz, 0); }
  }
  document.addEventListener('pointerdown', (e) => {
    const k = e.target.closest && e.target.closest('[data-kaydir]');
    if (!k) return;
    surukle = { k, bas: e.clientX, x: 0, max: 0 };
    k.classList.remove('donuyor');
    try { k.setPointerCapture(e.pointerId); } catch (x) { /* yok */ }
  });
  document.addEventListener('pointermove', (e) => { if (surukle) kaydirKoy(e.clientX - surukle.bas); });
  document.addEventListener('pointerup', kaydirBitir);
  document.addEventListener('pointercancel', kaydirBitir);
  document.addEventListener('keydown', (e) => {
    const k = e.target.closest && e.target.closest('[data-kaydir]');
    if (!k || (e.key !== 'Enter' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    surukle = { k, bas: 0, x: 0, max: 0 };
    kaydirKoy(1e5);
    kaydirBitir();
  });

  // ------------------------------------------------------------------ basılı tutarak onay (1 sn; erken bırakılırsa bir şey olmaz)
  function tutBagla(b, bitti) {
    let z = null;
    const bas = (e) => {
      if (e) e.preventDefault();
      if (z || b.disabled) return;
      b.classList.add('basiliyor');
      titret(15);
      z = setTimeout(() => { z = null; b.classList.remove('basiliyor'); titret(60); bitti(); }, 1000);
    };
    const birak = () => {
      if (!z) return;
      clearTimeout(z);
      z = null;
      b.classList.remove('basiliyor');
      mesaj(false, 'Onaylamak için 1 saniye basılı tutun.');
    };
    b.addEventListener('pointerdown', bas);
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, birak);
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) bas(e); });
    b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') birak(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ POS cihazı (06.11)
  // Kartlı siparişte "Paketi aldım"dan sonra "POS'u aldın mı?"; cevap internetsiz kuyruğa girer (defter_pos_aldi). Kuryede POS
  // varken her ekranın üstünde turuncu şerit (eşik aşılınca kırmızı + titreşim). Teslimden sonra "POS'u geri götür"; o işletmenin
  // kartlı siparişleri bitince Görevler'de "POS iadesi" kartı ve "POS'u iade ettim" kaydırması (defter_pos_iade).
  // Sorulan siparişler telefonda tutulur (aynı soru ikinci kez gelmesin; müşteri bilgisi yok).
  const posSorulan = new Set(JSON.parse(yerel.al('jt_pos_soruldu') || '[]'));
  const posSorulanYaz = () => yerel.yaz('jt_pos_soruldu', posSorulan.size ? JSON.stringify([...posSorulan].slice(-50)) : null);
  const posCalinan = new Set(); // eşik titreşimi bir kez
  let posSoru = null; // { mod: 'ilk' | 'ayni' | 'hatirlat', siparis, dukkan }
  const posListesi = () => C.poslar(ozet, kuyruk.bekleyen(), liste.benim || []);
  function posSoruAc(s) {
    const q = C.posSorusu(s, posListesi());
    posSorulan.add(s.id);
    posSorulanYaz();
    if (!q) return;
    posSoru = { mod: q.tur, siparis: s.id, dukkan: s.dukkan };
    $('posEtiket').textContent = `Kartlı sipariş · ${C.siparisNo(s)}`;
    $('posBaslik').textContent = q.tur === 'ayni' ? 'POS zaten sende' : 'İşletmenin POS cihazını aldın mı?';
    $('posBilgi').textContent = q.tur === 'ayni' ? `${s.dukkan}: bu sipariş de aynı POS ile mi?` : `${s.dukkan} · ${C.odemeAdi(s.odeme)}`;
    $('btnPosEvet').textContent = q.tur === 'ayni' ? 'Tamam, aynı POS' : 'Evet, POS bende';
    $('btnPosIkinci').classList.toggle('hidden', q.tur !== 'ayni');
    $('btnPosHayir').textContent = q.tur === 'ayni' ? 'Bu siparişte POS kullanmayacağım' : 'Hayır, almadım';
    $('btnPosHayir').classList.remove('hidden');
    $('posKutu').classList.remove('hidden');
  }
  function posHatirlat(p) {
    posSoru = { mod: 'hatirlat', siparis: null, dukkan: p.dukkan };
    $('posEtiket').textContent = 'Teslim tamam';
    $('posBaslik').textContent = `POS'u ${p.dukkan} dükkânına geri götür`;
    $('posBilgi').textContent = 'Görevler\'de "POS iadesi" kartı var; dükkânda "POS\'u iade ettim"i kaydır.';
    $('btnPosEvet').textContent = 'TAMAM';
    $('btnPosIkinci').classList.add('hidden');
    $('btnPosHayir').classList.add('hidden');
    $('posKutu').classList.remove('hidden');
  }
  const posKapat = () => { posSoru = null; $('posKutu').classList.add('hidden'); };
  function posCevap(ikinci) {
    const q = posSoru;
    posKapat();
    if (!q || q.mod === 'hatirlat' || !q.siparis) return;
    kuyruk.ekle({ eylem: C.eylemKimligi(), fn: 'defter_pos_aldi', args: { p_siparis: q.siparis, p_ikinci: Boolean(ikinci) }, siparis: q.siparis, tur: 'pos_aldi', dukkan: q.dukkan, ikinci: Boolean(ikinci) });
    mesaj(true, ikinci ? 'İkinci POS kaydedildi.' : q.mod === 'ayni' ? 'Aynı POS ile.' : 'POS sende: teslimden sonra dükkâna geri götür.');
    ciz();
    yenile();
  }
  // Şeride dokununca: paket hâlâ teslim edilmediyse önce teslim; yoksa POS iadesi kartı
  function posSeritTik(anahtar) {
    const p = posListesi().find((x) => x.anahtar === anahtar);
    if (!p) return;
    sekmeSec('gorev');
    if (p.bekleyen.length) { secili = p.bekleyen[0]; gorevCiz(); mesaj(false, 'Önce paketi teslim et, sonra POS\'u dükkâna geri götür.'); return; }
    gorevCiz();
    const k = document.querySelector(`[data-pos-iade="${CSS.escape(anahtar)}"]`);
    if (k && k.scrollIntoView) k.scrollIntoView({ block: 'center' });
  }
  function posIadeKarti(p, esik) {
    const r = C.posSeridi(p, esik);
    return `<section class="gorev pos-iade${r.asti ? ' gec' : ''}" data-pos-iade="${esc(p.anahtar)}" aria-label="POS iadesi">
      <div class="gorev-ust"><span class="etiket">POS iadesi</span><span class="kod">${esc(p.pos || 'POS')}</span></div>
      <div class="ne-yap">Şimdi: POS'u dükkâna geri götür</div>
      <div class="yer">${esc(p.dukkan)}</div>
      <div class="not">${esc(r.dk)} dk'dır sende${r.asti ? ' · <b class="gec-yazi">süre doldu</b>' : ''}</div>
      <div class="alt">${kaydirici('POS\'u iade ettim', 'pos_iade', p.anahtar, true)}</div>
    </section>`;
  }
  function posIade(anahtar) {
    const p = posListesi().find((x) => x.anahtar === anahtar);
    if (!p) return;
    kuyruk.ekle({ eylem: C.eylemKimligi(), fn: 'defter_pos_iade', args: C.posIadeArgs(p), siparis: p.siparisler[0], tur: 'pos_iade', pos_anahtar: p.anahtar });
    mesaj(true, `POS iade edildi · ${p.dukkan}`);
    ciz();
    yenile();
  }

  // ------------------------------------------------------------------ nakit borcu (08.11; NAKIT-PLANI.md)
  // Kapıda nakitte "Paketi aldım"dan sonra "Bu siparişin parasını (X TL) işletmeye şimdi verdin mi?". Hayır → kurye×işletme
  // borcu: turuncu şerit "<işletme>'ye X TL borcun"; işletmeye parayı verince "Parayı verdim" (kaydırma) → işletme programda
  // ya da yönetici panelde onaylayana kadar "onay bekliyor". Cevaplar internetsiz kuyruğa girer. Vardiya bitirmeyi ENGELLEMEZ.
  const nakitSorulan = new Set(JSON.parse(yerel.al('jt_nakit_soruldu') || '[]'));
  const nakitSorulanYaz = () => yerel.yaz('jt_nakit_soruldu', nakitSorulan.size ? JSON.stringify([...nakitSorulan].slice(-50)) : null);
  let nakitSoru = null; // { siparis, dukkan, dukkan_id, tutar }
  let nakitAcik = null; // şeride dokunulan işletme (Görevler'de kartı görünür)
  const nakitListesi = () => C.nakitBorclar(nakit, kuyruk.bekleyen());
  // Siparişin işletme kimliği: merkezin borç listesinde aynı adlı işletme (kuyruktaki cevap için; yoksa ad ile)
  const dukkanKimligi = (ad) => { const b = ((nakit && nakit.borclar) || []).find((x) => x.dukkan === ad); return b ? b.dukkan_id : null; };
  function nakitSoruAc(s) {
    nakitSorulan.add(s.id);
    nakitSorulanYaz();
    const tutar = Number(s.kapida_tahsil != null ? s.kapida_tahsil : s.tutar) || 0;
    nakitSoru = { siparis: s.id, dukkan: s.dukkan, dukkan_id: dukkanKimligi(s.dukkan), tutar };
    $('nakitEtiket').textContent = `Kapıda nakit · ${C.siparisNo(s)}`;
    $('nakitBaslik').textContent = `Bu siparişin parasını (${C.para(tutar)}) işletmeye şimdi verdin mi?`;
    $('nakitBilgi').textContent = `${s.dukkan}: vermediysen borcun olarak yazılır; parayı verince "Parayı verdim"i kaydırırsın.`;
    $('nakitKutu').classList.remove('hidden');
  }
  const nakitKapat = () => { nakitSoru = null; $('nakitKutu').classList.add('hidden'); };
  function nakitCevap(verdi) {
    const q = nakitSoru;
    nakitKapat();
    if (!q) return;
    kuyruk.ekle({ eylem: C.eylemKimligi(), fn: 'defter_nakit_yanit', args: { p_siparis: q.siparis, p_verdi: Boolean(verdi) }, siparis: q.siparis, tur: 'nakit_yanit',
      verdi: Boolean(verdi), tutar: q.tutar, dukkan: q.dukkan, dukkan_id: q.dukkan_id });
    mesaj(true, verdi ? 'Peşin verildi: borç yok.' : `${C.yeEki(q.dukkan)} ${C.para(q.tutar)} borcun yazıldı.`);
    ciz();
    yenile();
  }
  function nakitSeritTik(id) {
    sekmeSec('gorev');
    nakitAcik = id;
    gorevCiz();
    const k = document.querySelector(`[data-nakit-kart="${CSS.escape(id)}"]`);
    if (k && k.scrollIntoView) k.scrollIntoView({ block: 'center' });
    else { const b = nakitListesi().find((x) => x.dukkan_id === id); if (b) mesaj(false, C.nakitSeridi(b).alt); }
  }
  function nakitKarti(b) {
    return `<section class="gorev nakit-kart" data-nakit-kart="${esc(b.dukkan_id)}" aria-label="Nakit borcu">
      <div class="gorev-ust"><span class="etiket">Nakit borcu</span><span class="kod">${esc(C.para(b.acik))}</span></div>
      <div class="ne-yap">Parayı işletmeye ver</div>
      <div class="yer">${esc(b.dukkan)}</div>
      <div class="not">Borcun ${esc(C.para(b.bakiye))}${b.itirazli > 0 ? ` · ${esc(C.para(b.itirazli))} anlaşmazlık (yönetici çözecek)` : ''}${b.bekleyen - (b.itirazli || 0) > 0 ? ` · ${esc(C.para(b.bekleyen - (b.itirazli || 0)))} onay bekliyor` : ''}</div>
      <div class="alt">${kaydirici('Parayı verdim', 'nakit_verdim', b.dukkan_id, true)}</div>
    </section>`;
  }
  function nakitVerdim(id) {
    const b = nakitListesi().find((x) => x.dukkan_id === id);
    if (!b || b.acik <= 0) return;
    kuyruk.ekle({ eylem: C.eylemKimligi(), fn: 'defter_nakit_verdim', args: { p_dukkan: id }, tur: 'nakit_verdim', dukkan: b.dukkan, dukkan_id: id });
    nakitAcik = null;
    mesaj(true, `${C.para(b.acik)} bildirildi · ${b.dukkan} onaylayınca borç kapanır`);
    ciz();
    yenile();
  }
  // Bugün: işletme başına borç dökümü (bugünkü hareketler + kalan)
  function nakitBugunHtml(satir) {
    const kalan = new Map(nakitListesi().map((b) => [b.dukkan_id, b]));
    const bugun = (nakit && nakit.bugun) || [];
    const idler = [...new Set([...bugun.map((x) => x.dukkan_id), ...kalan.keys()])];
    if (!idler.length) return '';
    const ad = (id) => (bugun.find((x) => x.dukkan_id === id) || kalan.get(id) || {}).dukkan || '';
    return `<div class="kutu" aria-label="İşletmelere borç dökümü">${idler.map((id) => {
      const g = bugun.find((x) => x.dukkan_id === id) || {}, k = kalan.get(id);
      const alt = [Number(g.borc) > 0 ? `borç ${C.para(g.borc)}` : '', Number(g.pesin) > 0 ? `peşin ${C.para(g.pesin)}` : '', Number(g.odenen) > 0 ? `ödenen ${C.para(g.odenen)}` : '',
        Number(g.iptal) > 0 ? `iptal ${C.para(g.iptal)}` : '', k && k.itirazli > 0 ? `${C.para(k.itirazli)} anlaşmazlık` : '',
        k && k.bekleyen - (k.itirazli || 0) > 0 ? `${C.para(k.bekleyen - (k.itirazli || 0))} onay bekliyor` : ''].filter(Boolean).join(' · ');
      return satir(esc(ad(id)), esc(alt || 'bugün hareket yok'), k ? (k.bakiye < 0 ? `+ ${esc(C.para(-k.bakiye))}` : esc(C.para(k.bakiye))) : esc(C.para(0)), 'nakit-yazi');
    }).join('')}</div>`;
  }

  // ------------------------------------------------------------------ varış süresi (elle atamada) ve "gecikiyorum"
  let varisSiparis = null, varisBekleyen = null;
  function varisBekleyeniAc() {
    if (!varisBekleyen || !$('iptalEkran').classList.contains('hidden')) return;
    const id = varisBekleyen;
    varisBekleyen = null;
    varisSor(id);
  }
  function varisSor(id) {
    const s = (liste.benim || []).find((x) => x.id === id);
    if (!s || s.varis_ilk || C.tahminiDurum(s, kuyruk.bekleyen().filter((x) => x.siparis === id)) !== 'alindi') return;
    varisSiparis = id;
    const V = C.varisAyari(ozet);
    $('varisEtiket').textContent = `Sana atandı · ${C.siparisNo(s)}`;
    $('varisBilgi').textContent = `${s.dukkan}${s.mahalle ? ' · teslim ' + s.mahalle : ''} · söylediğin saat yöneticide görünür`;
    $('varisSecim').innerHTML = V.secenekler.map((dk, i) => `<button class="btn ikincil" type="button" data-varis="${dk}">${dk}${i === V.secenekler.length - 1 ? '+' : ''}<small>dk</small></button>`).join('');
    $('varisKutu').classList.remove('hidden');
  }
  function varisKapat() { varisSiparis = null; $('varisKutu').classList.add('hidden'); }
  async function varisSec(dk) {
    const id = varisSiparis;
    varisKapat();
    if (!id) return;
    try {
      const r = await rpc('defter_varis', { p_anahtar: anahtar, p_siparis: id, p_dk: Number(dk), p_eylem: C.eylemKimligi() });
      if (r && r.sonuc === 'tamam') mesaj(true, `Dükkâna ${dk} dk dedin · ${saatYaz(r.varis_hedef)}`);
      else if (!(r && r.sonuc === 'zaten_var')) mesaj(false, r && r.sonuc === 'gecersiz_sure' ? 'Süre seçenekleri değişti, tekrar seçin.' : 'Süre kaydedilemedi.');
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok — süre gönderilemedi.' : 'Süre kaydedilemedi: ' + e.message);
    }
    await yenile();
  }
  async function gecikiyorum(id, b) {
    b.disabled = true;
    try {
      const r = await rpc('defter_gecikiyorum', { p_anahtar: anahtar, p_siparis: id, p_eylem: C.eylemKimligi() });
      if (r && r.sonuc === 'tamam') mesaj(true, `+${r.adim} dk bildirildi · yeni saat ${saatYaz(r.varis_hedef)}`);
      else mesaj(false, 'Gecikme bildirilemedi.');
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok — gecikme bildirilemedi.' : 'Gecikme bildirilemedi: ' + e.message);
    }
    await yenile();
  }

  // ------------------------------------------------------------------ vardiyayı bitir (özet + 1 sn basılı tut)
  // Elinde paket varken (alındı / dükkânda / yolda) bitirme düğmesi YOK, açıklama + Tamam (06.11).
  // Karar 07.11: işletmenin POS'u sendeyken de bitmez ("Önce <işletme>'nin POS'unu iade et"); merkez de reddeder.
  let bitirEngel = 0;
  function bitirAc() {
    const b = ozet && ozet.bugun;
    const d = C.bitirDurumu(ozet, liste.benim || [], rol === 'kurye' ? posListesi() : []);
    bitirEngel = d.bitirilebilir ? 0 : 1;
    $('bitirTeslim').textContent = b ? String(b.teslim) : '-';
    $('bitirNakit').textContent = nakit ? C.para(C.nakitToplam(nakitListesi())) : '-';
    // Nakit borcu (08.11): vardiya bitmesini ENGELLEMEZ, sadece uyarı
    yaz($('bitirNakitUyari'), rol === 'kurye' ? nakitListesi().filter((x) => x.acik > 0).map((x) => `<div class="durum-serit turuncu" role="note"><span class="ik" aria-hidden="true">₺</span><span>${esc(C.yeEki(x.dukkan))} ${esc(C.para(x.acik))} borcun var<small>Parayı vermeyi unutma; verince "Parayı verdim"i kaydır.</small></span></div>`).join('') : '');
    yaz($('bitirEngel'), d.engel ? `<div class="durum-serit kirmizi" role="alert"><span class="ik" aria-hidden="true">▣</span><span>Elinde ${d.engel} paket var<small>Önce teslim et ya da yöneticini ara. Paket varken vardiya bitmez.</small></span></div>` : '');
    yaz($('bitirPos'), d.posEngel.map((ad) => `<div class="durum-serit kirmizi" role="alert"><span class="ik" aria-hidden="true">▣</span><span>Önce ${esc(ad)}'nin POS'unu iade et<small>POS sendeyken vardiya bitmez (işletme gün sonu için POS'a muhtaç). İade edemiyorsan yöneticini ara.</small></span></div>`).join(''));
    // 09.11: yöneticiye nakit teslim hatırlatması kalktı (para işletmeye verilir; borç varsa yukarıdaki turuncu uyarı)
    $('bitirNot').textContent = !d.bitirilebilir ? '' : 'Vardiya kapanınca yeni sipariş gelmez.';
    $('bitirNot').classList.toggle('hidden', !d.bitirilebilir);
    $('btnBitir').classList.toggle('hidden', !d.bitirilebilir);
    $('btnBitirVazgec').textContent = d.bitirilebilir ? 'Vazgeç' : 'Tamam';
    $('btnBitirVazgec').className = d.bitirilebilir ? 'bag' : 'btn ikincil';
    $('bitirKutu').classList.remove('hidden');
    seritSigdir();
  }
  const bitirKapat = () => $('bitirKutu').classList.add('hidden');

  // ------------------------------------------------------------------ yönetici ekranı
  // Panel adresi + #siparis=<id>. Panel adresi ayarlı değilse null (düğme kapalı).
  const panelAdresi = (id) => (/^https:\/\//.test(AYAR.panel || '') ? String(AYAR.panel).replace(/#.*$/, '') + (id ? '#siparis=' + encodeURIComponent(id) : '') : null);
  function panelAc(id) {
    const u = panelAdresi(id);
    if (!u) return mesaj(false, 'Panel adresi ayarlı değil (uygulama derlemesinde panel adresi yok).', 'yoMsg');
    window.open(u, '_blank'); // uygulamada telefonun tarayıcısında açılır
  }
  async function yenileYonetici() {
    try {
      const o = await rpc('defter_yonetici_ozet', { p_anahtar: anahtar });
      $('kuryeAd').textContent = (o && o.ad) || yerel.al('jt_ad') || '';
      $('yoBekleyen').textContent = String(o.bekleyen);
      $('yoMesaide').textContent = String(o.mesaide);
      $('yoAlarm').innerHTML = (o.alarm || []).length
        ? o.alarm.map((s) => `<div class="kart" data-alarm="${esc(s.id)}">
            <div class="ust2"><span class="dukkan">${esc(s.dukkan)}</span><span class="tutar">${esc(C.para(s.tutar))}</span></div>
            <div class="satir">${esc(s.mahalle || 'Mahalle bilinmiyor')} · ${esc(C.odemeAdi(s.odeme))} · <span class="kucuk">${esc(C.siparisNo(s))} · ${esc(sure(s.olusturma))}</span></div>
            <button class="buyuk" data-panel-ac="${esc(s.id)}" ${panelAdresi(s.id) ? '' : 'disabled'}>PANELDE AÇ</button></div>`).join('')
        : '<p class="bos">Şu an bekleyen uyarı yok.</p>';
      $('btnPanel').disabled = !panelAdresi();
    } catch (e) {
      if (/cihaz tanimli degil/.test(e.message)) return cikis(true);
      mesaj(false, e.cevrimdisi ? 'İnternet yok.' : 'Yenilenemedi: ' + e.message, 'yoMsg');
    }
  }
  // Bildirime dokunularak açıldıysa: yönetici → panelde o sipariş; kurye → liste yenilenir
  async function bildirimdenAcildiMi() {
    try {
      const H = window.JTHazirlik && window.JTHazirlik.eklenti();
      if (!H || !H.acilanSiparis || !anahtar) return;
      const r = await H.acilanSiparis();
      if (r && r.id && rol === 'yonetici') panelAc(r.id);
    } catch (e) { /* tarayıcıda / eski sürümde yok */ }
  }

  // ------------------------------------------------------------------ işlemler
  const eskiMerkez = (e) => /Could not find the function|PGRST202|does not exist/.test(String(e && e.message));
  async function al(id, dk) {
    document.querySelectorAll(`[data-al="${CSS.escape(id)}"]`).forEach((b) => { b.disabled = true; });
    try {
      // Alma kuyruğa alınmaz: internet yoksa alınamaz (alma o anki duruma göre bir yarış)
      const eylem = C.eylemKimligi();
      let r;
      try {
        r = await rpc('defter_al_varis', { p_anahtar: anahtar, p_siparis: id, p_dk: Number(dk), p_eylem: eylem });
      } catch (e) {
        if (!eskiMerkez(e)) throw e;
        r = await rpc('defter_al', { p_anahtar: anahtar, p_siparis: id, p_eylem: eylem });
      }
      const tamam = r && r.sonuc === 'aldiniz';
      if (r && r.sonuc === 'gecersiz_sure') mesaj(false, 'Süre seçenekleri değişti, tekrar seçin.');
      else mesaj(tamam, tamam ? `Aldınız · dükkâna ${dk} dk${r.varis_hedef ? ' (' + saatYaz(r.varis_hedef) + ')' : ''}` : C.almaYazisi(r));
      if (tamam) { secili = id; teklifElle = false; sekmeSec('gorev'); }
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok — alınamadı.' : 'Alınamadı: ' + e.message);
    }
    await yenile();
  }

  function konum() {
    return new Promise((coz) => {
      if (!navigator.geolocation) return coz(null);
      navigator.geolocation.getCurrentPosition((p) => coz(p.coords), () => coz(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
    });
  }

  async function islem(tur, id) {
    if (tur === 'foto') {
      fotoSiparis = id;
      $('fotoGirdi').value = '';
      $('fotoGirdi').click();
      return;
    }
    if (tur === 'mesai') return mesaiDegistir(); // 10.11: "Vardiyaya başla" tek dokunuş
    if (tur === 'teslim_edilemedi') return nedenAc(id);
    if (tur === 'pos_iade') return posIade(id); // id = POS anahtarı
    if (tur === 'nakit_verdim') return nakitVerdim(id); // id = işletme kimliği
    const sip = (liste.benim || []).find((x) => x.id === id);
    const posOnce = tur === 'teslim' ? posListesi().find((p) => p.siparisler.includes(id)) : null;
    const args = { p_siparis: id };
    let fn = 'defter_durum';
    if (tur === 'restoranda' || tur === 'dukkandan_aldi' || tur === 'birak') args.p_tur = tur;
    if (tur === 'birak' && !confirm('Paketi bırakıyorsunuz: sipariş diğer kuryelere tekrar düşer. Emin misiniz?')) return;
    if (tur === 'teslim') {
      args.p_tur = 'teslim';
      args.p_istemci_zamani = new Date().toISOString();
      const k = await konum(); // sadece uygulama açıkken, teslim anında (adres sözlüğü için)
      if (k) Object.assign(args, { p_lat: k.latitude, p_lng: k.longitude, p_dogruluk: k.accuracy });
    }
    kuyruk.ekle({ eylem: C.eylemKimligi(), fn, args, siparis: id, tur });
    ciz();
    // POS (06.11): kartlı siparişte paketi alınca soru; teslimde o POS'un son paketiyse "geri götür" hatırlatması
    if (tur === 'dukkandan_aldi' && sip && C.kartliMi(sip) && !posSorulan.has(id)) posSoruAc(sip);
    // Nakit (08.11): kapıda nakitte paketi alınca "parayı işletmeye şimdi verdin mi?" (merkez bu fonksiyonu biliyorsa)
    if (tur === 'dukkandan_aldi' && sip && nakit && C.nakitMi(sip) && !nakitSorulan.has(id)) nakitSoruAc(sip);
    if (tur === 'teslim' && posOnce) {
      const p = posListesi().find((x) => x.anahtar === posOnce.anahtar);
      if (p && !p.bekleyen.length) posHatirlat(p);
    }
    await yenile();
  }

  // Fiş fotoğrafı: en fazla 1280 px, JPEG; kuyruğa (internet yoksa sonra gider)
  async function fotoSecildi() {
    const f = $('fotoGirdi').files && $('fotoGirdi').files[0];
    const id = fotoSiparis;
    if (!f || !id) return;
    try {
      const veri = await kucult(f);
      fotolar.set(id, true);
      kuyruk.ekle({ eylem: C.eylemKimligi(), fn: 'defter_fis_foto', args: { p_siparis: id, p_veri_base64: veri }, siparis: id, tur: 'foto' });
      mesaj(true, 'Fiş fotoğrafı alındı.');
    } catch (e) {
      mesaj(false, 'Fotoğraf okunamadı, tekrar çekin.');
    }
    ciz();
    await yenile();
  }
  function kucult(dosya) {
    return new Promise((coz, red) => {
      const url = URL.createObjectURL(dosya);
      const img = new Image();
      img.onload = () => {
        const o = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * o));
        c.height = Math.max(1, Math.round(img.height * o));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        coz(c.toDataURL('image/jpeg', 0.6).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); red(new Error('resim')); };
      img.src = url;
    });
  }

  async function mesaiDegistir() {
    const onceki = Boolean(ozet && ozet.mesaide);
    try {
      const r = await rpc('defter_mesai', { p_anahtar: anahtar, p_mesaide: !(ozet && ozet.mesaide) });
      // Merkez de reddeder (07.11): POS sendeyken vardiya bitmez
      if (r && r.sonuc === 'pos_sende') mesaj(false, `Önce ${(r.dukkanlar || []).join(', ') || 'işletme'}'nin POS'unu iade et. POS sendeyken vardiya bitmez.`);
    } catch (e) {
      mesaj(false, e.cevrimdisi ? 'İnternet yok.' : e.message);
    }
    await yenile();
    // Web (iPhone, 09.11): telefon zili soramayız; vardiya açılınca hatırlatılır
    if (!onceki && ozet && ozet.mesaide && rol === 'kurye' && webMi()) mesaj(true, 'Vardiya açık · zil açık, Odak (Rahatsız Etme) kapalı olsun.');
  }

  function cikis(otomatik) {
    if (!otomatik && !confirm('Bu telefondan çıkış yapılsın mı? Tekrar girmek için yöneticinizden yeni kod gerekir.')) return;
    // Web bildirimi (09.11): bu cihazın aboneliği merkezde kapatılır (otomatik çıkışta cihaz zaten kapalı)
    if (!otomatik && anahtar && pushAyar && pushAyar.abone) rpc('defter_kurye_push_sil', { p_anahtar: anahtar }).catch(() => {});
    pushAyar = null;
    webDurum = null;
    swAyarYaz(false);
    webBildirimCiz();
    for (const k of ['jt_anahtar', 'jt_ad', 'jt_kuyruk', 'jt_rol', 'jt_iptal_goruldu', 'jt_uyari_goruldu', 'jt_pos_soruldu', 'jt_sihirbaz_tamam']) yerel.yaz(k, null);
    posSorulan.clear();
    posCalinan.clear();
    yerelSinyalAyarla(false);
    try { const H = window.JTHazirlik && window.JTHazirlik.eklenti(); if (H && H.merkezAyari) Promise.resolve(H.merkezAyari({})).catch(() => {}); } catch (e) { /* yok */ }
    yerelSinyal = null;
    gonderilecek.clear();
    kapatilan.clear();
    $('iptalEkran').classList.add('hidden');
    for (const k of ['teklifEkran', 'varisKutu', 'bitirKutu', 'nedenKutu', 'posKutu']) $(k).classList.add('hidden');
    posSoru = null;
    gecilen.clear();
    secili = null;
    varisBekleyen = null;
    sekmeSec('gorev');
    anahtar = null;
    rol = 'kurye';
    ozet = null;
    liste = { yeni: [], benim: [] };
    goster('ekGiris');
    webSesGuncelle(); // web: çalan uyarı sesi durur
    if (otomatik) mesaj(false, 'Bu telefonun kaydı kapatılmış. Yöneticinizden yeni kod isteyin.', 'girisMsg');
  }

  // ------------------------------------------------------------------ olaylar
  $('btnGiris').onclick = giris;
  $('kod').addEventListener('keydown', (e) => { if (e.key === 'Enter') giris(); });
  $('btnMesai').onclick = () => { if (!ozet) return; if (ozet.mesaide) bitirAc(); else mesaiDegistir(); };
  tutBagla($('btnBitir'), () => { bitirKapat(); if (!bitirEngel) mesaiDegistir(); });
  $('btnBitirVazgec').onclick = bitirKapat;
  $('btnVarisSonra').onclick = varisKapat;
  $('btnPosEvet').onclick = () => posCevap(false);
  $('btnPosIkinci').onclick = () => posCevap(true);
  $('btnPosHayir').onclick = posKapat;
  $('btnNakitEvet').onclick = () => nakitCevap(true);
  $('btnNakitHayir').onclick = () => nakitCevap(false);
  $('btnVarisDukkanda').onclick = () => { const id = varisSiparis; varisKapat(); if (id) islem('restoranda', id); };
  $('fotoGirdi').onchange = fotoSecildi;
  $('btnHazirlik').onclick = () => { goster('ekHazirlik'); if (window.JTHazirlik) window.JTHazirlik.yenile(); };
  $('btnGeri').onclick = () => { goster(anaEkran()); yenile(); };
  $('btnPanel').onclick = () => panelAc(null);
  $('btnCikis').onclick = () => cikis(false);
  $('btnNedenGonder').onclick = nedenGonder;
  $('btnNedenVazgec').onclick = nedenKapat;
  tutBagla($('btnIptalGordum'), iptalGordum);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const v = b.dataset;
    if (b.classList.contains('eylem')) b.disabled = true; // tek dokunuşluk eylem: çift basma iki kez göndermesin (yeniden çizimde açılır)
    if (v.panelAc) panelAc(v.panelAc);
    else if (v.al) al(v.al, v.dk || C.varisAyari(ozet).secenekler[0]);
    else if (v.sekme) sekmeSec(v.sekme);
    else if (v.paket) { secili = v.paket; gorevCiz(); }
    else if (v.teklifAc) { teklifElle = true; teklifSira = 0; teklifCiz(); gorevCiz(); }
    else if (v.teklifGec) { gecilen.set(v.teklifGec, Date.now() + saatSapma); teklifElle = false; teklifCiz(); gorevCiz(); }
    else if (v.teklifGit) { teklifSira += Number(v.teklifGit); teklifCiz(); }
    else if (v.varis) varisSec(v.varis);
    else if (v.varisSor) varisSor(v.varisSor);
    else if (v.gecikiyorum) gecikiyorum(v.gecikiyorum, b);
    else if (v.posSerit) posSeritTik(v.posSerit);
    else if (v.posSor) { const s = (liste.benim || []).find((x) => x.id === v.posSor); if (s) posSoruAc(s); }
    else if (v.nakitSerit) nakitSeritTik(v.nakitSerit);
    else if (v.nakitSor) { const s = (liste.benim || []).find((x) => x.id === v.nakitSor); if (s) nakitSoruAc(s); }
    else if (v.tema) temaSec(v.tema);
    else if (v.webBildirimAc) webBildirimAc();
    else if (v.islem && v.islem !== 'bekliyor') islem(v.islem, v.siparis);
  });
  window.addEventListener('online', () => yenile());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { varislariGuncelle(); yenile(); bildirimdenAcildiMi(); if (anahtar && webMi()) webBildirimTazele(); } });
  setInterval(() => { if (anahtar && !document.hidden) yenile(); }, 15000);
  setInterval(saniyelik, 1000); // teklif geri sayımı, "Şimdi değil" süresi, varış yazısı
  // Ekran açılınca / uygulama öne gelince hemen (Android'de ekran kapanınca sayaçlar durur; 07.11 masa başı bulgu 5)
  for (const ad of ['resume', 'focus', 'pageshow']) (ad === 'resume' ? document : window).addEventListener(ad, () => { varislariGuncelle(); if (anahtar) yenile(); });
  setInterval(() => sinyal(false), 10000); // en çok 60 sn'de bir gider (sinyal kendisi sayar)

  if (!AYAR.merkez) {
    goster('ekGiris');
    mesaj(false, 'Merkez ayarlanmadı (uygulama derlemesinde merkez adresi yok).', 'girisMsg');
  } else if (anahtar) {
    goster(anaEkran());
    yenile();
    bildirimdenAcildiMi();
    bildirimYoluKaydi(); // her açılışta (Google Play durumu değişmiş olabilir)
    sihirbazGerekirse();
    webBildirimTazele(); // web: abonelik tazelenir, kapalıysa uyarı
  } else {
    goster('ekGiris');
  }
  temaDugmeleri();
  window.JTUygulama = { yenile, kuyruk, panelAdresi, bildirimdenAcildiMi, sekmeSec, webBildirimAc, webBildirimTazele, webDurumu: () => webDurum };
})();
