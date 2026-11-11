// Hazırlık ekranı: bildirim izni, alarm kanalı, alarm ses düzeyi, pil, Xiaomi / Huawei ekranları, ses seçimi.
// Deneme uygulamasından (tools/kurye-app-deneme, 0.5) alındı. Sipariş bildirimi HER ZAMAN alarm kanalından gelir
// (bildirim denemesi kararı, 28.10): sesi uygulama çalar, telefon sessizde de duyulur, dokununca durur.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const eklenti = () => {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    return C.Plugins && C.Plugins.Hazirlik ? C.Plugins.Hazirlik : C.registerPlugin ? C.registerPlugin('Hazirlik') : null;
  };
  const APP = 'JetTakip Kurye';

  function item(durum, baslik, aciklama, dugmeler = [], onay = null) {
    const cls = durum === true ? 'ok' : durum === false ? 'err' : 'warn';
    const isaret = durum === true ? '✓ ' : durum === false ? '✗ ' : '• ';
    const b = dugmeler.map((x) => `<button data-act="${esc(x[1])}" ${x[2] ? `data-arg="${esc(x[2])}"` : ''}>${esc(x[0])}</button>`).join('');
    const o = onay ? `<label class="chk"><input type="checkbox" data-onay="${esc(onay.ad)}" ${onay.deger ? 'checked' : ''}> Yaptım</label>` : '';
    return `<div class="item ${cls}"><div class="t">${isaret}${esc(baslik)}</div><div class="d">${aciklama}</div>${b || o ? `<div class="row">${b}${o}</div>` : ''}</div>`;
  }
  function msg(ok, t) {
    const el = $('sesMsg');
    el.textContent = t;
    el.className = 'mesaj ' + (ok ? 'ok' : 'err');
  }

  // ------------------------------------------------------------------ web uygulaması (iPhone adım 6, 09.11)
  // Android eklentisi yoksa (iPhone ana ekran / tarayıcı): kısa iPhone hazırlığı. iOS 16.4+, ana ekranda mı, bildirim izni
  // (düğme; durum uygulama.js'den), "Vardiyada zil açık, Odak kapalı" hatırlatması, Düşük Güç Modu notu.
  // Android hazırlığı / sihirbaz / ses seçimi web'de gösterilmez.
  // Kayıt adı: TEST'te jt_test_..., canlıda jt_... (cekirdek.js kayitAdi)
  const kayitAdi = (k) => (window.JTC && window.JTC.kayitAdi ? window.JTC.kayitAdi(k, (window.JT_AYAR || {}).ortam) : k);
  const yerelOku = (k) => { try { return localStorage.getItem(kayitAdi(k)); } catch (e) { return null; } };
  const androidParcalari = () => document.querySelectorAll('[data-android]');
  function webHazirlik() {
    androidParcalari().forEach((e) => e.classList.add('hidden'));
    const ua = navigator.userAgent;
    const C = window.JTC, U = window.JTUygulama;
    const ios = /iPhone|iPad|iPod/.test(ua), s = C.iosSurumu(ua);
    const standalone = navigator.standalone === true || Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const d = U && U.webDurumu ? U.webDurumu() : null;
    $('cihaz').textContent = `${ios ? 'iPhone' : 'Tarayıcı'}${s ? ' · iOS ' + s.yazi : ''} · ${standalone ? 'ana ekrandan açık' : 'tarayıcıda açık'} · uygulama ${(window.JT_AYAR || {}).surum || ''}`;
    const k = [];
    if (ios) k.push(item(s ? s.yeterli : null, 'iOS 16.4 ve üstü', s && !s.yeterli ? `Bu iPhone'da iOS ${esc(s.yazi)} var: bildirim gelmez. Ayarlar → Genel → Yazılım Güncelleme.` : 'Sipariş bildirimi için gerekli.'));
    if (ios) k.push(item(standalone, 'Ana ekrandan açık', standalone ? 'Uygulama ana ekrandaki "JT Kurye" simgesinden açılmış.'
      : 'Safari\'de Paylaş (kare ve yukarı ok) → "Ana Ekrana Ekle" → Ekle. Sonra ana ekrandaki "JT Kurye" simgesinden açıp kodla giriş yapın. Safari\'de açıkken bildirim gelmez.'));
    const bAcik = Boolean(d && d.kod === 'acik');
    k.push(`<div class="item ${bAcik ? 'ok' : d && d.dugme ? 'err' : 'warn'}" data-web-hazirlik="bildirim"><div class="t">${bAcik ? '✓ ' : '✗ '}Bildirim izni</div>
      <div class="d">${esc(d ? d.metin : 'Bildirim durumu kurye girişinden sonra görünür.')}</div>${d && d.dugme === 'ac' ? '<div class="row"><button type="button" data-web-bildirim-ac="1">Bildirimleri aç</button></div>' : ''}</div>`);
    k.push(item(yerelOku('jt_zil_tamam') === '1' ? true : null, 'Vardiyada zil açık, Odak kapalı',
      'Sipariş sesi telefonun standart bildirim sesidir: <b>yan taraftaki zil düğmesi açık</b> olmalı (turuncu görünmesin), <b>Odak / Rahatsız Etme kapalı</b> olmalı. Ayarlar → Bildirimler → JT Kurye: "Sesler" ve "Kilitli Ekran" açık.',
      [], { ad: 'zil', deger: yerelOku('jt_zil_tamam') === '1' }));
    k.push(item(null, 'Düşük Güç Modu kapalı (öneri)', 'Düşük Güç Modu açıkken bildirimler gecikebilir. Ayarlar → Pil.'));
    k.push('<p class="kucuk">Uygulama kapalıyken telefon bildirimle çalar. Uygulama açıkken yeni sipariş ve uyarılarda uygulama kendi sesini çalar (ilk dokunuştan sonra).</p>');
    $('liste').innerHTML = k.join('');
    $('liste').querySelectorAll('[data-onay="zil"]').forEach((c) => (c.onchange = () => { try { if (c.checked) localStorage.setItem(kayitAdi('jt_zil_tamam'), '1'); else localStorage.removeItem(kayitAdi('jt_zil_tamam')); } catch (e) { /* yok */ } webHazirlik(); }));
  }
  // Uygulama bildirim durumunu her tazelediğinde (Telefon sekmesi açıksa liste güncellenir)
  function webCiz() { if (!eklenti() && !$('liste').closest('.hidden')) webHazirlik(); }

  async function yenile() {
    const H = eklenti();
    if (!H) return webHazirlik();
    androidParcalari().forEach((e) => e.classList.remove('hidden'));
    $('btnSihirbaz').classList.toggle('hidden', sihirbazSira >= 0);
    const d = await H.durum();
    const h = d.hazirlik || {};
    $('cihaz').textContent = `${d.marka || ''} ${d.model || ''} · Android ${d.android || ''} · uygulama ${d.uygulama_surumu || ''}${d.huawei ? ' · Huawei/Honor' : d.xiaomi ? ' · Xiaomi' : d.samsung ? ' · Samsung' : ''}`;
    const gp = String(d.google_play || '');
    const k = [];
    // 04.11: iki yollu bildirim. Google yoksa (ya da TEST'te "FCM'i yok say") uyarıyı vardiya hizmetinin sorgusu getirir.
    const yol = d.bildirim_yolu === 'fcm+sorgu' ? 'FCM + sorgu' : d.bildirim_yolu === 'sorgu' ? 'sadece sorgu' : '?';
    if (d.fcm_yok_say) {
      k.push(item(null, 'Google Play hizmetleri', `<b>TEST: FCM yok sayılıyor</b> (deneme ayarı). Bildirimler sadece vardiyadaki sorguyla gelir. Bildirim yolu: <b>${yol}</b>`));
    } else if (d.bildirim_yolu === 'sorgu') {
      k.push(item(null, 'Google Play hizmetleri', `Bu telefonda Google bildirimi yok; uygulama vardiyada kendisi kontrol eder, <b>pil ayarları çok önemli</b>. Durum: <b>${esc(gp || '?')}</b> · bildirim yolu: <b>${yol}</b>`));
    } else {
      k.push(item(gp.startsWith('var'), 'Google Play hizmetleri', `Sipariş bildirimleri Google üzerinden ve vardiyada uygulamanın kendi sorgusuyla gelir. Durum: <b>${esc(gp || '?')}</b> · bildirim yolu: <b>${yol}</b>`));
    }
    k.push(item(d.bildirim_ayarli === true, 'Bildirim bağlantısı', d.bildirim_ayarli ? 'Hazır.' : 'Bu derlemede bildirim yapılandırması (Firebase) yok: siparişleri görmek için uygulamayı açık tutun.'));
    // Ortak ve marka adımları sihirbazla aynı listeden (sihirbaz.js; 04.11)
    const SH = window.JTSihirbaz;
    for (const a of SH.adimlar(d)) {
      k.push(item(SH.tamamMi(a) ? true : a.onay ? false : a.durum, (a.marka ? a.marka + ': ' : '') + a.baslik, a.aciklama, a.dugmeler, a.onay));
    }
    k.push(item(h.dnd_erisimi === true ? true : null, "Rahatsız Etmeyin'i geçebilme (isteğe bağlı)", 'Rahatsız Etmeyin açıkken de sipariş sesi çalsın.', h.dnd_erisimi ? [] : [['Ayarla', 'dndAyari']]));
    k.push(`<p class="kucuk">${SH.KAYNAK}</p>`);
    // Gizli deneme ayarı: SADECE TEST derlemesinde (telefon tarafı da TEST_DERLEME değilse reddeder)
    if (d.test_derleme === true && (window.JT_AYAR || {}).ortam === 'TEST') {
      k.push(`<div class="item warn" id="testFcmKutu"><div class="t">• Deneme (sadece TEST): FCM'i yok say</div>
        <div class="d">Açıkken telefon Google servisleri yokmuş gibi davranır: FCM bildirimi gösterilmez, uyarılar sadece vardiyadaki sorguyla gelir (Huawei gibi). Denemeden sonra kapatın.</div>
        <div class="row"><label class="chk"><input type="checkbox" id="testFcmYokSay" ${d.fcm_yok_say ? 'checked' : ''}> FCM'i yok say</label></div></div>`);
    }
    $('liste').innerHTML = k.join('');
    const tf = $('testFcmYokSay');
    if (tf) tf.onchange = async () => {
      try { await H.testFcmYokSay({ acik: tf.checked }); } catch (e) { alert(e.message || e); }
      document.dispatchEvent(new Event('jt-bildirim-yolu')); // uygulama yolu merkeze yeniden yazar
      yenile();
    };
    $('liste').querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      try {
        const r = await H[b.dataset.act](b.dataset.arg ? { kanal: b.dataset.arg } : {});
        if (r && r.acilan === 'pil') alert(`Pil ekranı açıldı. "Uygulama başlatma" ya da "Başlatma yöneticisi"ni açın, "${APP}"u bulun, "Otomatik yönet"i kapatıp üç izni açın.`);
        if (r && r.acilan === 'uygulama bilgisi') alert('Özel ekran bulunamadı; uygulama bilgisi açıldı. "Pil" bölümünden arka planda çalışma izinlerini verin.');
      } catch (e) { alert(e.message || e); }
      yenile();
    }));
    $('liste').querySelectorAll('[data-onay]').forEach((c) => (c.onchange = async () => { await H.onay({ ad: c.dataset.onay, deger: c.checked }); yenile(); }));
    sesler();
  }

  async function sesler() {
    const H = eklenti();
    if (!H) return;
    const s = await H.sesler();
    $('sesListe').innerHTML = (s.liste || []).map((x) => `<div class="row">
        <label class="chk" style="flex:1"><input type="radio" name="ses" value="${esc(x.ad)}" ${x.ad === s.secili ? 'checked' : ''}> <b>${esc(x.baslik)}</b>${x.telefon ? ' (telefondan)' : ''}</label>
        <button data-dinle="${esc(x.ad)}">Dinle</button></div>`).join('');
    $('sesListe').querySelectorAll('input[name=ses]').forEach((r) => (r.onchange = async () => {
      try { await H.sesSec({ ses: r.value }); msg(true, 'Seçildi.'); } catch (e) { msg(false, e.message || String(e)); }
      sesler();
    }));
    $('sesListe').querySelectorAll('[data-dinle]').forEach((b) => (b.onclick = async () => {
      const r = await H.sesDinle({ ses: b.dataset.dinle });
      msg(r.caliyor, r.caliyor ? 'Çalıyor…' : 'Ses çalınamadı.');
    }));
  }

  $('btnTelefonSes').onclick = async () => {
    const H = eklenti();
    if (!H) return;
    try { const r = await H.telefondanSec(); msg(true, r && r.baslik ? `Seçildi: ${r.baslik}` : 'Seçildi.'); } catch (e) { msg(false, e.message || String(e)); }
    sesler();
  };
  $('btnSesDene').onclick = async () => {
    const H = eklenti();
    if (!H) return;
    await H.yerelDeneme({ kanal: 'alarm', gecikmeli: true });
    msg(true, '5 saniye içinde ekranı kilitleyin: sipariş sesi böyle çalacak (dokununca durur).');
  };

  // ------------------------------------------------------------------ kurulum sihirbazı (04.11)
  // İlk girişte açılır (uygulama.js): telefona gereken adımlar tek tek. "Ayarı aç" ilgili ekranı açar; dönünce ölçülebilen
  // adımlar kendiliğinden yeşil olur, ölçülemeyenlerde kurye "Yaptım" der. Sonuna gelince bir daha kendiliğinden açılmaz.
  const yerelYaz = (k, v) => { try { localStorage.setItem(kayitAdi(k), v); } catch (e) { /* yok */ } };
  let sihirbazSira = -1; // -1: kapalı
  function sihirbazKapat() {
    sihirbazSira = -1;
    $('sihirbaz').classList.add('hidden');
    $('liste').classList.remove('hidden');
    $('btnSihirbaz').classList.remove('hidden');
    yenile();
  }
  async function sihirbaz(bas = 0) {
    const H = eklenti();
    if (!H) return false;
    sihirbazSira = bas;
    $('sihirbaz').classList.remove('hidden');
    $('liste').classList.add('hidden');
    $('btnSihirbaz').classList.add('hidden');
    await sihirbazCiz();
    return true;
  }
  async function sihirbazCiz() {
    const H = eklenti(), SH = window.JTSihirbaz;
    if (!H || sihirbazSira < 0) return;
    const d = await H.durum();
    const l = SH.adimlar(d);
    const kutu = $('sihirbaz');
    if (sihirbazSira >= l.length) {
      const o = SH.ozet(l);
      yerelYaz('jt_sihirbaz_tamam', '1');
      kutu.innerHTML = `<div class="item ${o.tamam === o.toplam ? 'ok' : 'warn'}"><div class="t">${o.tamam === o.toplam ? '✓ Hazırlık tamam' : '• Hazırlık bitti, eksik var'}</div>
        <div class="d"><b>${o.tamam} / ${o.toplam}</b> adım tamam.${o.tamam === o.toplam ? ' Siparişler bu telefona gecikmeden gelir.' : ' Eksik adımları aşağıdaki listeden tamamlayın.'}</div>
        <div class="row"><button data-sh="bitir">Hazırlık listesine dön</button>${o.ilkEksik >= 0 ? '<button data-sh="eksik">Eksik adıma git</button>' : ''}</div></div>
        <p class="kucuk">${SH.KAYNAK}</p>`;
    } else {
      const a = l[sihirbazSira], tamam = SH.tamamMi(a);
      const ileri = tamam ? 'İleri' : a.onay ? 'Yaptım, ileri' : 'Sonra yaparım';
      const durum = tamam ? '<b style="color:var(--yesil)">✓ Tamam</b>' : a.onay ? 'Ayarı yaptıktan sonra <b>"Yaptım"</b> deyin (telefon bunu kendisi ölçemiyor).' : '<b style="color:var(--kirmizi)">✗ Henüz değil</b> — ayarı açın, dönünce kendiliğinden güncellenir.';
      kutu.innerHTML = `<p class="kucuk">Kurulum sihirbazı${a.marka ? ' · ' + esc(a.marka) : ''} · Adım <b>${sihirbazSira + 1} / ${l.length}</b></p>
        <div class="item ${tamam ? 'ok' : a.onay ? 'warn' : 'err'}"><div class="t">${esc(a.baslik)}</div><div class="d">${a.aciklama}</div>
          <div class="d" style="margin-top:6px">${durum}</div>
          ${a.dugmeler.length ? `<div class="row">${a.dugmeler.map((x) => `<button data-act="${esc(x[1])}" ${x[2] ? `data-arg="${esc(x[2])}"` : ''}>${esc(x[0])}</button>`).join('')}</div>` : ''}</div>
        <div class="row" style="display:flex;gap:8px">
          <button class="buyuk ikincil" data-sh="geri" ${sihirbazSira === 0 ? 'disabled' : ''} style="flex:1">← Geri</button>
          <button class="buyuk" data-sh="ileri" style="flex:2">${ileri}</button></div>
        <button class="buyuk ikincil" data-sh="bitir">Sihirbazı kapat</button>`;
      kutu.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
        try { await H[b.dataset.act](b.dataset.arg ? { kanal: b.dataset.arg } : {}); } catch (e) { alert(e.message || e); }
        sihirbazCiz();
      }));
      kutu.dataset.onay = a.onay && !a.onay.deger ? a.onay.ad : '';
    }
    kutu.querySelectorAll('[data-sh]').forEach((b) => (b.onclick = async () => {
      const ne = b.dataset.sh;
      if (ne === 'bitir') return sihirbazKapat();
      if (ne === 'eksik') { sihirbazSira = Math.max(0, SH.ozet(SH.adimlar(await H.durum())).ilkEksik); return sihirbazCiz(); }
      if (ne === 'geri') sihirbazSira = Math.max(0, sihirbazSira - 1);
      if (ne === 'ileri') {
        if (kutu.dataset.onay) { try { await H.onay({ ad: kutu.dataset.onay, deger: true }); } catch (e) { /* yok */ } }
        sihirbazSira++;
      }
      sihirbazCiz();
    }));
  }
  // Ayar ekranından dönünce ölçülen adımlar güncellensin
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sihirbazSira >= 0) sihirbazCiz(); });
  $('btnSihirbaz').onclick = () => sihirbaz(0);

  window.JTHazirlik = { yenile, eklenti, sihirbaz, webCiz };
})();
