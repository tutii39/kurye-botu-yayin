// JetTakip Kurye — kurulum sihirbazının adımları (04.11). Arayüzden bağımsız: tarayıcıda window.JTSihirbaz, Node testlerinde
// require. Telefonun durumuna (HazirlikPlugin.durum) göre SADECE o telefona gereken adımlar, sırayla.
// Ortak adımlar her telefonda; marka adımları Xiaomi / Redmi / POCO (MIUI, HyperOS), Samsung (One UI), Huawei / Honor (EMUI).
// Marka adımları dontkillmyapp.com (CC BY 4.0) içeriğinden KENDİ cümlelerimizle uyarlandı; sitenin kodu kopyalanmadı.
// Adım: { id, baslik, aciklama (HTML; sabit metin), dugmeler: [[yazı, eklenti yöntemi, kanal?]], durum: true / false / null
// (ölçülebiliyorsa), onay: { ad, deger } (ölçülemeyen elle ayar: "Yaptım"), marka }.
(function (kok, fabrika) {
  const m = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else kok.JTSihirbaz = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const APP = 'JetTakip Kurye';
  const KAYNAK = 'Marka adımları <a href="https://dontkillmyapp.com" target="_blank" rel="noopener">dontkillmyapp.com</a> içeriğinden kendi cümlelerimizle uyarlandı (CC BY 4.0).';

  /** Telefonun markası: 'xiaomi' | 'samsung' | 'huawei' | null (durum'daki bayraklardan) */
  function marka(d) {
    if (!d) return null;
    if (d.xiaomi) return 'xiaomi';
    if (d.samsung) return 'samsung';
    if (d.huawei) return 'huawei';
    return null;
  }

  const onay = (ad, deger) => ({ ad, deger: Boolean(deger) });

  function adimlar(d) {
    const h = (d && d.hazirlik) || {};
    const asy = typeof h.alarm_ses_yuzde === 'number' ? h.alarm_ses_yuzde : -1;
    const l = [];
    // ---------------------------------------------------------------- ortak (ölçülebilenler kendiliğinden yeşil olur)
    l.push({ id: 'bildirim_izni', baslik: 'Bildirim izni', durum: h.bildirim_izni === true,
      aciklama: 'Uygulamanın bildirim göstermesine izin verin; yoksa sipariş geldiğini göremezsiniz.',
      dugmeler: h.bildirim_izni ? [] : [['İzin ver', 'bildirimIzniIste']] });
    l.push({ id: 'alarm_kanali', baslik: 'Sipariş bildirimi (alarm kanalı)', durum: h.alarm_kanal_onemi === 4,
      aciklama: 'Açılan ayarda <b>"Açılır pencere"</b> ve <b>"Kilit ekranında göster"</b> açık olsun.',
      dugmeler: [['Kanal ayarını aç', 'kanalAyari', 'alarm']] });
    l.push({ id: 'pil', baslik: 'Pil kısıtlaması yok', durum: h.pil_kisitlamasi_yok === true,
      aciklama: 'Android uygulamayı uyutmasın: açılan soruda <b>İzin ver</b> deyin. Yoksa bildirimler gecikir ya da hiç gelmez.',
      dugmeler: h.pil_kisitlamasi_yok ? [] : [['Ayarla', 'pilIzniIste']] });
    l.push({ id: 'alarm_ses', baslik: 'Alarm ses düzeyi', durum: asy >= 50,
      aciklama: `Sipariş sesi alarm ses düzeyiyle çalar (telefon sessizdeyken de). Şu an: <b>${asy < 0 ? '?' : '%' + asy}</b>. En az %50, tercihen en yüksek.`,
      dugmeler: asy >= 100 ? [] : [['En yükseğe çıkar', 'alarmSesiniYukselt']] });

    // ---------------------------------------------------------------- marka
    const mk = marka(d);
    if (mk === 'xiaomi') {
      l.push({ id: 'xiaomi_otomatik', marka: 'Xiaomi', baslik: 'Otomatik başlatma', onay: onay('otomatik', h.otomatik_baslatma_onay),
        aciklama: `Açılan listede <b>${APP}</b>'u bulun ve anahtarını açın. Kapalıysa telefon uygulamayı arka planda kapatır.`,
        dugmeler: [['Otomatik başlatmayı aç', 'otomatikBaslatma']] });
      l.push({ id: 'xiaomi_pil', marka: 'Xiaomi', baslik: 'Pil tasarrufu: "Kısıtlama yok"', onay: onay('pil_ozel', h.pil_tasarrufu_onay),
        aciklama: 'Uygulama bilgisinde <b>Pil tasarrufu</b>na girin ve <b>Kısıtlama yok</b>u seçin. (HyperOS\'ta adı "Pil" olabilir.)',
        dugmeler: [['Uygulama bilgisini aç', 'uygulamaBilgisi']] });
      l.push({ id: 'xiaomi_izinler', marka: 'Xiaomi', baslik: 'Diğer izinler', onay: onay('kilit', h.kilit_ekrani_onay),
        aciklama: '<b>"Kilit ekranında göster"</b> ve <b>"Arka planda çalışırken açılır pencere göster"</b> izinlerini açın.',
        dugmeler: [['Diğer izinleri aç', 'digerIzinler']] });
      l.push({ id: 'xiaomi_kilitle', marka: 'Xiaomi', baslik: 'Son uygulamalarda kilitle', onay: onay('son_uygulamalar', h.son_uygulamalar_onay),
        aciklama: `Son uygulamalar ekranını açın (alttan yukarı kaydırıp bekleyin). <b>${APP}</b> kartını aşağı çekin ya da basılı tutun ve <b>kilit</b> simgesine dokunun. Böylece "temizle" dediğinizde kapanmaz.`,
        dugmeler: [] });
    } else if (mk === 'samsung') {
      l.push({ id: 'samsung_pil', marka: 'Samsung', baslik: 'Uygulama pili: "Kısıtlamasız"', onay: onay('pil_ozel', h.pil_tasarrufu_onay),
        aciklama: 'Uygulama bilgisinde <b>Pil</b>e girin ve <b>Kısıtlamasız</b>ı seçin.',
        dugmeler: [['Uygulama bilgisini aç', 'uygulamaBilgisi']] });
      l.push({ id: 'samsung_uyumayan', marka: 'Samsung', baslik: '"Hiç uyumayan uygulamalar"a ekle', onay: onay('samsung_uyumayan', h.samsung_uyumayan_onay),
        aciklama: `Pil ekranında <b>Arka plan kullanım sınırları</b> → <b>Hiç uyumayan uygulamalar</b> → <b>+</b> ile <b>${APP}</b>'u ekleyin. (Bazı telefonlarda yol: Ayarlar → Cihaz bakımı → Pil.)`,
        dugmeler: [['Pil ekranını aç', 'samsungPil']] });
      l.push({ id: 'samsung_uyku', marka: 'Samsung', baslik: '"Kullanılmayan uygulamaları uyku moduna al" kapalı', onay: onay('samsung_uyku', h.samsung_uyku_onay),
        aciklama: 'Aynı <b>Arka plan kullanım sınırları</b> ekranında bu seçeneği kapatın; açıksa birkaç gün açılmayan uygulama uyutulur.',
        dugmeler: [['Pil ekranını aç', 'samsungPil']] });
    } else if (mk === 'huawei') {
      l.push({ id: 'huawei_baslatma', marka: 'Huawei', baslik: 'Uygulama başlatma: elle yönet', onay: onay('otomatik', h.otomatik_baslatma_onay),
        aciklama: `Ayarlar → Pil → <b>Uygulama başlatma</b> (bazı modellerde <b>Başlatma yöneticisi</b>). <b>${APP}</b>'u bulun, "Otomatik yönet"i kapatın; <b>Otomatik başlatma, İkincil başlatma, Arka planda çalış</b> üçü de açık olsun.`,
        dugmeler: [['Başlatma yöneticisini aç', 'otomatikBaslatma']] });
      l.push({ id: 'huawei_bagli', marka: 'Huawei', baslik: 'Cihaz uykudayken bağlı kal', onay: onay('kilit', h.kilit_ekrani_onay),
        aciklama: 'Ayarlar → Pil → Diğer pil ayarları → <b>"Cihaz uykudayken bağlı kal"</b> açık olsun (ekran kapalıyken bildirim gecikmesin).',
        dugmeler: [['Pil ayarlarını aç', 'otomatikBaslatma']] });
      l.push({ id: 'huawei_kilitle', marka: 'Huawei', baslik: 'Son uygulamalarda kilitle', onay: onay('son_uygulamalar', h.son_uygulamalar_onay),
        aciklama: `Son uygulamalar ekranında <b>${APP}</b> kartını aşağı çekin ve <b>kilit</b> simgesine dokunun.`,
        dugmeler: [] });
    } else {
      l.push({ id: 'diger_arka_plan', baslik: 'Arka planda çalışma izni', onay: onay('otomatik', h.otomatik_baslatma_onay),
        aciklama: `Uygulama bilgisinde <b>Pil</b> bölümüne girin; varsa <b>"Arka plan etkinliğine izin ver"</b> ya da <b>"Kısıtlamasız"</b>ı seçin. Telefonunuzda "otomatik başlatma" ayarı varsa ${APP} için açın.`,
        dugmeler: [['Uygulama bilgisini aç', 'uygulamaBilgisi']] });
    }
    return l;
  }

  const tamamMi = (a) => a.durum === true || Boolean(a.onay && a.onay.deger);

  /** { toplam, tamam, ilkEksik (sıra no ya da -1) } */
  function ozet(l) {
    const t = (l || []).filter(tamamMi).length;
    return { toplam: (l || []).length, tamam: t, ilkEksik: (l || []).findIndex((a) => !tamamMi(a)) };
  }

  return { adimlar, ozet, tamamMi, marka, KAYNAK, APP };
});
