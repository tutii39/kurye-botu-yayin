// Web uygulamasında (iPhone ana ekran; Android eklentisi yok) uygulama AÇIKKEN uyarı sesi (iPhone adım 7, 09.11).
// Ses dosyası yok: tarayıcının ses motoruyla (Web Audio) kısa bip dizisi üretilir. Tarayıcı sesi ancak ilk dokunuştan sonra
// açar: ilk dokunuşta ses motoru hazırlanır (ac). iOS 17+: "playback" oturumu (sessiz düğmesine rağmen çalabilsin; eski
// sürümde zil kapalıyken duyulmayabilir — rehberdeki "zil açık" kuralı bu yüzden). Uygulama kapalıyken ses telefonun
// standart bildirim sesidir (sw.js), burası değil.
// Android APK'da kullanılmaz: orada sesi Android eklentisi çalar.
(function (kok, fabrika) {
  const m = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else kok.JTSes = m.olustur(kok);
})(typeof self !== 'undefined' ? self : this, function () {
  // Desenler: [frekans Hz, süre ms, ara ms] ... ; tekrar: bir dizinin bitişinden sonra yeniden başlama (ms; 0 = bir kez)
  const DESEN = {
    iptal: { notalar: [[880, 220, 120], [660, 220, 120], [880, 220, 120], [660, 320, 0]], tekrar: 2500 },
    uyari: { notalar: [[740, 200, 120], [988, 260, 0]], tekrar: 4000 },
    teklif: { notalar: [[988, 160, 90], [988, 160, 90], [1319, 300, 0]], tekrar: 4000 },
  };
  const diziSuresi = (d) => d.notalar.reduce((t, n) => t + n[1] + n[2], 0);

  function olustur(pencere) {
    let ctx = null, zamanlayici = null, calan = null;
    const durum = { acik: false, calan: null, calma: 0 }; // testler için: kaç dizi çalındı
    function sesMotoru() {
      if (ctx) return ctx;
      const AC = pencere.AudioContext || pencere.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { ctx = null; }
      return ctx;
    }
    // İlk dokunuşta: ses motoru açılır (tarayıcı kuralı). Tekrar çağrılması zararsız.
    function ac() {
      try {
        const n = pencere.navigator;
        if (n && n.audioSession && n.audioSession.type !== 'playback') n.audioSession.type = 'playback';
      } catch (e) { /* eski iOS */ }
      const c = sesMotoru();
      if (!c) return false;
      if (c.state === 'suspended' && c.resume) c.resume().catch(() => {});
      durum.acik = true;
      return true;
    }
    function dizi(d) {
      const c = sesMotoru();
      durum.calma++;
      // iPhone uygulama arkaya gidip gelince ses motorunu askıya alabilir: daha önce açıldıysa yeniden açmayı dene
      if (c && durum.acik && c.state !== 'running' && c.resume) { try { c.resume().catch(() => {}); } catch (e) { /* yok */ } }
      if (!c || c.state !== 'running') return;
      let t = c.currentTime + 0.02;
      for (const [f, sure, ara] of d.notalar) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'square';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
        g.gain.setValueAtTime(0.35, t + sure / 1000 - 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + sure / 1000);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + sure / 1000 + 0.02);
        t += (sure + ara) / 1000;
      }
    }
    // tur: 'iptal' | 'uyari' | 'teklif'. Aynı tür çalıyorsa yeniden başlatılmaz. durdur'a kadar tekrar eder.
    function baslat(tur) {
      const d = DESEN[tur] || DESEN.uyari;
      if (calan === tur) return;
      durdur();
      calan = tur;
      durum.calan = tur;
      const cal = () => { if (calan !== tur) return; try { dizi(d); } catch (e) { /* ses yok */ } if (d.tekrar) zamanlayici = setTimeout(cal, diziSuresi(d) + d.tekrar); };
      cal();
    }
    function durdur() {
      calan = null;
      durum.calan = null;
      if (zamanlayici) clearTimeout(zamanlayici);
      zamanlayici = null;
    }
    return { ac, baslat, durdur, durum, DESEN };
  }
  return { olustur, DESEN, diziSuresi };
});
