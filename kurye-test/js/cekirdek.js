// JetTakip Kurye — çekirdek (arayüzden bağımsız; tarayıcıda window.JTC, Node testlerinde require ile).
// - api: ortak defterin public.defter_* fonksiyonları (Supabase REST /rest/v1/rpc/...). Kimlik = cihazın gizli anahtarı.
// - kuyruk: internet yokken basılan "dükkândan aldım / fiş fotoğrafı / teslim ettim / bırakıyorum" sırayla saklanır,
//   internet gelince aynı eylem kimliğiyle gönderilir (merkezde tekrar zararsız). "ALIYORUM" kuyruğa ALINMAZ
//   (alma o anki duruma göre bir yarış; 10 dk önce basılmış bir alma sonradan gelip siparişi kapmamalı).
// - mantik: düğme kuralları, para / ödeme yazıları, uyarılar.
// Müşteri bilgisi (ad, telefon, adres) telefonda kalıcı saklanmaz: sadece ekrandaki listede (bellekte) durur.
(function (kok, fabrika) {
  const m = fabrika();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else kok.JTC = m;
})(typeof self !== 'undefined' ? self : this, function () {
  class CevrimdisiHata extends Error {
    constructor(neden) {
      super('İnternet yok');
      this.cevrimdisi = true;
      this.neden = neden;
    }
  }
  class SunucuHata extends Error {
    constructor(mesaj, durum) {
      super(mesaj);
      this.durum = durum;
    }
  }

  function api({ merkez, anahtar, fetchFn, zamanAsimiMs = 15000 }) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    async function rpc(fn, args) {
      if (!merkez) throw new SunucuHata('Merkez adresi ayarlanmamış', 0);
      let r;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), zamanAsimiMs) : null;
      try {
        r = await f(`${merkez.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: anahtar || '', authorization: `Bearer ${anahtar || ''}` },
          body: JSON.stringify(args || {}),
          signal: ctl ? ctl.signal : undefined,
        });
      } catch (e) {
        throw new CevrimdisiHata(e && e.message);
      } finally {
        if (t) clearTimeout(t);
      }
      if (r.status >= 500 || r.status === 0) throw new CevrimdisiHata('sunucu ' + r.status);
      let govde = null;
      try {
        govde = await r.json();
      } catch (e) {
        govde = null;
      }
      if (!r.ok) throw new SunucuHata((govde && (govde.message || govde.error)) || `HTTP ${r.status}`, r.status);
      return govde;
    }
    return { rpc };
  }

  /** Rastgele tekil kimlik (eylem kimliği, cihaz anahtarı) */
  function rastgele(bayt = 16) {
    const a = new Uint8Array(bayt);
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : require('crypto').webcrypto;
    c.getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  const eylemKimligi = () => 'e-' + rastgele(12);

  /**
   * İnternetsiz kuyruk. depo: { oku(): dizi, yaz(dizi) } (tarayıcıda localStorage). Kuyruktaki işlem:
   * { eylem, fn, args, siparis, tur, eklendi }. isle(): sırayla gönderir; internet yoksa durur (sıra korunur),
   * sunucu cevap verdiyse (sonuç ne olursa olsun) işlem kuyruktan çıkar ve sonucu bildirilir.
   */
  function kuyruk({ depo, rpc, bildir = () => {}, simdi = () => Date.now() }) {
    let calisiyor = false;
    const oku = () => {
      try {
        const x = depo.oku();
        return Array.isArray(x) ? x : [];
      } catch (e) {
        return [];
      }
    };
    function ekle(islem) {
      const l = oku();
      if (l.some((x) => x.eylem === islem.eylem)) return; // aynı basış iki kez eklenmez
      l.push({ ...islem, eklendi: simdi() });
      depo.yaz(l);
    }
    async function isle() {
      if (calisiyor) return { gonderilen: 0, bekleyen: oku().length };
      calisiyor = true;
      let gonderilen = 0;
      try {
        for (;;) {
          const l = oku();
          if (!l.length) break;
          const x = l[0];
          let sonuc;
          try {
            sonuc = await rpc(x.fn, { ...x.args, p_eylem: x.eylem });
          } catch (e) {
            if (e && e.cevrimdisi) break; // sıra korunur, sonra tekrar
            sonuc = { sonuc: 'hata', mesaj: (e && e.message) || String(e) };
          }
          depo.yaz(oku().filter((y) => y.eylem !== x.eylem));
          gonderilen += 1;
          bildir(x, sonuc);
        }
      } finally {
        calisiyor = false;
      }
      return { gonderilen, bekleyen: oku().length };
    }
    return { ekle, isle, bekleyen: () => oku(), siparisIcin: (id) => oku().filter((x) => x.siparis === id) };
  }

  // ------------------------------------------------------------------ mantık
  const ODEME = { nakit: 'Nakit', kapida_kart: 'Kapıda kart', yemek_karti: 'Yemek kartı', online: 'Online ödendi', bilinmiyor: 'Ödeme bilinmiyor' };
  const odemeAdi = (o) => ODEME[o] || String(o || '');
  const para = (x) => (x == null || x === '' ? '-' : Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL');

  // Durumlar (merkezdeki iç adlar → kuryenin gördüğü ad). Karar 02.11: iç adlar aynı, restoranda ve teslim_edilemedi eklendi.
  const DURUM_ADI = {
    yeni: 'Havuzda', alindi: 'Restorana gidiyor', restoranda: 'Restoranda', yolda: 'Paket alındı — yolda',
    teslim: 'Teslim edildi', teslim_edilemedi: 'Teslim edilemedi', iptal: 'İptal',
  };
  const durumAdi = (d) => DURUM_ADI[d] || String(d || '');
  // Kuryenin adımları: işlem → hedef durum (merkezdeki defter_durum ve geçiş tablosuyla aynı)
  const ADIM = { restoranda: 'restoranda', dukkandan_aldi: 'yolda', teslim: 'teslim', teslim_edilemedi: 'teslim_edilemedi', birak: 'yeni' };
  const BITIS = new Set(['teslim', 'teslim_edilemedi', 'yeni', 'iptal']);

  /** Kuyrukta bekleyen adımlar uygulanınca siparişin durumu (internet yokken sıradaki adıma geçilebilsin) */
  function tahminiDurum(s, bekleyen = []) {
    let d = s.durum;
    for (const x of bekleyen) if (ADIM[x.tur]) d = ADIM[x.tur];
    return d;
  }

  /**
   * Bir siparişte hangi düğmeler var? Tek adım düğmesi: RESTORANDAYIM → PAKETİ ALDIM → TESLİM ETTİM; ayrıca
   * "Teslim edemedim" (paket alındıktan sonra) ve "Bırakıyorum" (paketi almadan önce).
   * s: sunucudaki sipariş; bekleyen: bu siparişin kuyruktaki işlemleri; fotoHazir: telefonda çekilmiş foto var mı.
   * Dönüş: [{ ad, etiket, acik, neden, ikincil }]
   */
  function dugmeler(s, { bekleyen = [], fotoHazir = false } = {}) {
    const kuyrukta = (tur) => bekleyen.some((x) => x.tur === tur);
    const fotoTamam = s.fis_alindi || kuyrukta('foto') || fotoHazir;
    const d = tahminiDurum(s, bekleyen);
    if (BITIS.has(d) && d !== s.durum) return [{ ad: 'bekliyor', etiket: 'Gönderilmeyi bekliyor…', acik: false }];
    const birak = { ad: 'birak', etiket: 'Bırakıyorum', acik: true, ikincil: true };
    if (d === 'alindi') return [{ ad: 'restoranda', etiket: 'RESTORANDAYIM', acik: true }, birak];
    if (d === 'restoranda') return [{ ad: 'dukkandan_aldi', etiket: 'PAKETİ ALDIM', acik: true }, birak];
    if (d === 'yolda') {
      const l = [];
      if (s.fis_zorunlu) l.push({ ad: 'foto', etiket: fotoTamam ? 'FİŞ FOTOĞRAFI ✓ (yeniden çek)' : 'FİŞ FOTOĞRAFI ÇEK', acik: true, ikincil: Boolean(fotoTamam) });
      l.push({
        ad: 'teslim',
        etiket: 'TESLİM ETTİM',
        acik: !s.fis_zorunlu || Boolean(fotoTamam),
        neden: s.fis_zorunlu && !fotoTamam ? 'Kapıda kart: önce fiş fotoğrafı' : null,
      });
      l.push({ ad: 'teslim_edilemedi', etiket: 'Teslim edemedim', acik: true, ikincil: true });
      return l;
    }
    return [];
  }

  /**
   * "Teslim edemedim" seçimi: nedenler merkezden gelir (defter_kurye_ozet.nedenler; liste tek yerde: SQL tablosu).
   * Dönüş: { ok, hata } — neden listede olmalı; açıklama zorunlu nedende ("Diğer") açıklama boş olamaz.
   */
  function nedenDogrula(nedenler, kod, aciklama) {
    const n = (nedenler || []).find((x) => x.kod === kod);
    if (!n) return { ok: false, hata: 'Bir neden seçin.' };
    if (n.aciklama_zorunlu && !String(aciklama || '').trim()) return { ok: false, hata: `"${n.ad}" için kısa bir açıklama yazın.` };
    return { ok: true, hata: null };
  }

  /** Gösterilecek iptal uyarısı: kuryenin henüz "Gördüm" demediği ilk iptal (ozet.iptaller), bu oturumda kapatılanlar hariç */
  function iptalUyarisi(ozet, kapatilan = new Set()) {
    return ((ozet && ozet.iptaller) || []).find((x) => !kapatilan.has(x.id)) || null;
  }

  // Tam ekran uyarılar (GÖRDÜM'e kadar kalır): iptal + yönetici işlemleri (02.11: havuza geri alındı, başka kuryeye devredildi,
  // sana devredildi). Kaynak: defter_kurye_ozet.iptaller ve .uyarilar.
  const UYARI_METNI = {
    iptal: () => ({ baslik: 'İPTAL', alt: 'Bu siparişe gitmeyin', renk: 'kirmizi' }),
    geri_alindi: (no) => ({ baslik: 'GERİ ALINDI', alt: `Paket #${no} havuza geri alındı — bu siparişe gitme`, renk: 'kirmizi' }),
    devredildi: (no) => ({ baslik: 'DEVREDİLDİ', alt: `Paket #${no} başka kuryeye devredildi — artık sende değil`, renk: 'kirmizi' }),
    devralindi: (no) => ({ baslik: 'SANA DEVREDİLDİ', alt: `Paket #${no} sana devredildi`, renk: 'mavi' }),
    atandi: (no) => ({ baslik: 'SANA ATANDI', alt: `Paket #${no} sana atandı — Paketlerim'de`, renk: 'mavi' }), // 03.11: panelden elle atama
  };
  function ekranUyarilari(ozet) {
    const l = [];
    for (const x of (ozet && ozet.iptaller) || []) l.push({ anahtar: 'iptal:' + x.id, tur: 'iptal', siparis_id: x.id, dukkan: x.dukkan, mahalle: x.mahalle, kaynak_no: x.kaynak_no, kisa_no: x.kisa_no });
    for (const x of (ozet && ozet.uyarilar) || []) {
      if (UYARI_METNI[x.tur]) l.push({ anahtar: 'uyari:' + x.id, tur: x.tur, siparis_id: x.siparis_id, dukkan: x.dukkan, mahalle: x.mahalle, kaynak_no: x.kaynak_no, kisa_no: x.kisa_no });
    }
    return l.map((u) => ({ ...u, ...UYARI_METNI[u.tur](u.kisa_no || u.kaynak_no || '') }));
  }
  /** Gösterilecek ilk tam ekran uyarı (bu telefonda "GÖRDÜM" denenler hariç) ya da null */
  function ekranUyarisi(ozet, kapatilan = new Set()) {
    return ekranUyarilari(ozet).find((u) => !kapatilan.has(u.anahtar)) || null;
  }
  /** "GÖRDÜM"ün merkeze gidecek çağrısı: iptal:<sipariş> → defter_iptal_gordum, uyari:<no> → defter_uyari_gordum */
  function gordumCagrisi(anahtar) {
    const m = /^(iptal|uyari):(.+)$/.exec(String(anahtar || ''));
    if (!m) return null;
    return m[1] === 'iptal' ? { fn: 'defter_iptal_gordum', args: { p_siparis: m[2] } } : { fn: 'defter_uyari_gordum', args: { p_uyari: Number(m[2]) } };
  }

  /** Ana ekranın üst uyarıları (ozet: defter_kurye_ozet) */
  function uyarilar(ozet, { bekleyenSayi = 0, cevrimdisi = false } = {}) {
    const u = [];
    if (cevrimdisi) u.push({ tur: 'kirmizi', metin: `İnternet yok${bekleyenSayi ? ` — ${bekleyenSayi} işlem gönderilmeyi bekliyor` : ''}. Yeni sipariş alınamaz.` });
    else if (bekleyenSayi) u.push({ tur: 'sari', metin: `${bekleyenSayi} işlem gönderiliyor…` });
    if (!ozet) return u;
    if (ozet.kilitli) u.push({ tur: 'kirmizi', metin: `Kilitli: ${ozet.kilit_nedeni || 'yöneticinizi arayın'}. Yeni sipariş alamazsınız.` });
    if (ozet.fis_bekleyen && ozet.fis_bekleyen.length) u.push({ tur: 'kirmizi', metin: 'Fiş fotoğrafı bekleniyor: fotoğraf gelene kadar teslim sayılmaz ve yeni sipariş alamazsınız.' });
    // 09.11: eski nakit eşiği uyarısı (yöneticiye teslim) kalktı; para işletmeye verilir, nakit borcu şeridi ve hatırlatması var
    if (ozet.aktif_paket >= ozet.paket_siniri) u.push({ tur: 'sari', metin: `${ozet.aktif_paket} paketiniz var (sınır ${ozet.paket_siniri}): yeni sipariş alamazsınız.` });
    return u;
  }

  /** "ALIYORUM" sonucunun kuryeye gösterilecek yazısı */
  function almaYazisi(r) {
    const s = r && r.sonuc;
    return {
      aldiniz: 'Aldınız.',
      baskasi_aldi: `${(r && r.kim) || 'Başka bir kurye'} aldı.`,
      sinir: `Paket sınırınız dolu (${r && r.aktif}/${r && r.sinir}).`,
      kilitli: `Kilitlisiniz: ${(r && r.neden) || 'yöneticinizi arayın'}.`,
      fis_bekleniyor: 'Önce bekleyen fiş fotoğrafını gönderin.',
      mesaide_degil: 'Önce "Mesaideyim"i açın.',
      atanmamis: 'Bu dükkâna atanmamışsınız.',
      iptal: 'Sipariş iptal edildi.',
      bitti: 'Sipariş teslim edilmiş.',
      yok: 'Sipariş bulunamadı.',
    }[s] || 'Alınamadı.';
  }

  /** Giriş kodu: 8 karakter, karışan harf/rakam yok (0 O 1 I L); "K7PQ-4XMR" ya da "k7pq4xmr" kabul */
  function kodDuzelt(k) {
    const t = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[2-9A-HJKMNP-Z]{8}$/.test(t) ? t.slice(0, 4) + '-' + t.slice(4) : null;
  }

  /** Kuyruktaki adımın merkezden gelen sonucu → kuryeye yazı (tamam / tekrar ise null) */
  function adimYazisi(sonuc) {
    if (!sonuc || !sonuc.sonuc || sonuc.sonuc === 'tamam' || sonuc.tekrar) return null;
    if (['aldi', 'eklendi', 'zaten', 'zaten_kapali', 'kart_degil'].includes(sonuc.sonuc)) return null; // POS (06.11): sessiz
    return {
      baskasinin: 'Bu POS sende görünmüyor (başka kuryede).',
      yok: 'POS kaydı bulunamadı.',
      fis_gerekli: 'Teslim kaydedilmedi: önce fiş fotoğrafı.',
      yetki_yok: 'Bu sipariş artık sizde değil (yönetici geri almış olabilir).',
      iptal: 'Sipariş iptal edilmiş.',
      gecersiz_gecis: 'İşlem yapılamadı (sipariş durumu değişmiş).',
      neden_gecersiz: 'Teslim edemedim: neden seçilmedi.',
      aciklama_gerekli: 'Teslim edemedim: açıklama yazılmadı.',
      foto_buyuk: 'Fotoğraf çok büyük, tekrar çekin.',
      hata: 'İşlem yapılamadı: ' + (sonuc.mesaj || ''),
    }[sonuc.sonuc] || 'İşlem yapılamadı.';
  }

  // ------------------------------------------------------------------ iki yollu bildirim (04.11)
  // Telefondaki asıl uygulama Java'da (Gosterilenler.java, SinyalServisi.java); burası aynı kuralların derlemesiz denenen
  // kopyası. tests/kurye-app-v1/yerel.test.js sabitlerin Java ile aynı olduğuna bakar.
  const GOSTERILEN_SURE_MS = 12 * 60 * 60 * 1000; // "gösterilenler" listesi: son 12 saat
  const GOSTERILEN_EN_FAZLA = 300; // en çok 300 anahtar
  const SORGU_ARALIK_MS = [15000, 30000, 60000]; // art arda hata: 15 → 30 → 60 sn; başarıda 15 sn

  /**
   * Bu anahtar ilk kez mi geliyor? liste = { anahtar: zaman } (eklenme sırasıyla). FCM de sorgu da önce buraya bakar:
   * listede yoksa eklenir ve gösterilir; varsa geçilir. Eskiler (12 saat) atılır; 300'ü aşarsa en eski atılır.
   */
  function gosterilen(liste, anahtar, simdi = Date.now()) {
    const yeni = {};
    for (const [k, z] of Object.entries(liste || {})) if (typeof z === 'number' && simdi - z < GOSTERILEN_SURE_MS) yeni[k] = z;
    if (!anahtar) return { yeni: true, liste: yeni }; // anahtarsız iş (olmamalı): gösterilir, listeye girmez
    if (Object.prototype.hasOwnProperty.call(yeni, anahtar)) return { yeni: false, liste: yeni };
    yeni[anahtar] = simdi;
    const anahtarlar = Object.keys(yeni);
    for (let i = 0; anahtarlar.length - i > GOSTERILEN_EN_FAZLA; i++) delete yeni[anahtarlar[i]];
    return { yeni: true, liste: yeni };
  }

  /** FCM mesajının anahtarı: merkezin verdiği "anahtar" (k<kuyruk no>); eski gönderici vermezse mesajdan üretilir */
  function fcmAnahtari(d) {
    if (d && d.anahtar) return String(d.anahtar);
    const x = d || {};
    return `fcm:${x.tur || ''}/${x.siparis_id || ''}/${x.surum || ''}/${x.asama || x.uyari || ''}`;
  }

  /** Sorgu aralığı: başarıda merkezin dediği (10–60 sn arası; yoksa 15 sn); 1 hata → 30 sn, 2+ art arda hata → 60 sn */
  function sorguAraligi(hataSayisi, merkezSn) {
    if (hataSayisi > 0) return SORGU_ARALIK_MS[Math.min(hataSayisi, SORGU_ARALIK_MS.length - 1)];
    const sn = Number(merkezSn);
    return sn >= 10 && sn <= 60 ? sn * 1000 : SORGU_ARALIK_MS[0];
  }

  /** Siparişin gösterilen no'su (05.11): dükkânın gördüğü kısa no ("#4926", "#…8952"); yoksa defterdeki kaynak no */
  function siparisNo(s) {
    const n = (s && (s.kisa_no || s.kaynak_no)) || '';
    return n ? '#' + n : '';
  }

  // ------------------------------------------------------------------ arayüz v2 (05.11): görev kartı, teklif, varış süresi
  const VARIS_VARSAYILAN = { secenekler: [5, 10, 15, 20, 25], adim: 5, tolerans: 5 };
  /** Varış ayarı (defter_kurye_ozet.varis_ayar; panelden). Eski merkezde yoksa 5/10/15/20/25, adım 5, tolerans 5 */
  function varisAyari(ozet) {
    const v = (ozet && ozet.varis_ayar) || {};
    const s = (Array.isArray(v.secenekler) ? v.secenekler : []).map(Number).filter((x) => Number.isInteger(x) && x > 0);
    const sayi = (x, vs) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : vs);
    return { secenekler: s.length >= 2 ? s : VARIS_VARSAYILAN.secenekler.slice(), adim: sayi(v.adim, VARIS_VARSAYILAN.adim), tolerans: sayi(v.tolerans, VARIS_VARSAYILAN.tolerans) };
  }
  /**
   * Görev kartındaki varış satırı. s.varis_hedef yoksa null.
   * Dönüş: { kalan, gec, gecKaldi, metin } — süre varken "7 dk kaldı", tolerans içinde "süre doldu", sonra "6 dk geç kaldın"
   */
  function varisDurumu(s, ayar, simdi = Date.now()) {
    const h = s && s.varis_hedef ? new Date(s.varis_hedef).getTime() : NaN;
    if (!Number.isFinite(h)) return null;
    const tol = (ayar && Number.isFinite(Number(ayar.tolerans))) ? Number(ayar.tolerans) : VARIS_VARSAYILAN.tolerans;
    const kalan = Math.ceil((h - simdi) / 60000), gec = Math.max(0, Math.floor((simdi - h) / 60000));
    if (kalan > 0) return { kalan, gec: 0, gecKaldi: false, metin: `${kalan} dk kaldı` };
    if (gec <= tol) return { kalan: 0, gec, gecKaldi: false, metin: 'süre doldu' };
    return { kalan: 0, gec, gecKaldi: true, metin: `${gec} dk geç kaldın` };
  }
  /** Ödeme kutusu: nakit (turuncu) / kart (POS) / online. Tutar: kapıda alınacak varsa o, yoksa sipariş tutarı */
  function paraKutusu(s) {
    const t = Number(s && s.kapida_tahsil) > 0 ? s.kapida_tahsil : s && s.tutar;
    if (s && s.odeme === 'nakit') return { tur: 'nakit', baslik: 'Kapıda nakit al', alt: 'para üstü hazırla', tutar: t };
    if (s && (s.odeme === 'kapida_kart' || s.odeme === 'yemek_karti')) return { tur: 'kart', baslik: s.odeme === 'yemek_karti' ? 'Kapıda yemek kartı' : 'Kapıda kart ile al', alt: s.odeme === 'yemek_karti' ? 'telefondan NFC / QR · POS gerekmez' : 'POS cihazını unutma', tutar: t };
    if (s && s.odeme === 'online') return { tur: 'online', baslik: 'Online ödendi', alt: 'para alma', tutar: s.tutar };
    return { tur: 'online', baslik: 'Ödeme bilinmiyor', alt: 'dükkâna sor', tutar: s && s.tutar };
  }
  /** Görev adımı (üstteki 3 çizgi): 0 dükkâna git, 1 paketi al, 2 teslim et */
  const GOREV_ADIM = { alindi: 0, restoranda: 1, yolda: 2 };
  const KAYNAK_ADI = { trendyol: 'Trendyol Go', getir: 'Getir', yemeksepeti: 'Yemeksepeti', migros: 'Migros Yemek', telefon: 'Telefon', jettakip: 'JetTakip' };
  /** Teklif neden alınamaz? null = alınabilir. Sıra: bağlantı, vardiya, kilit, fiş, paket sınırı */
  function alamazNedeni(ozet, { cevrimdisi = false } = {}) {
    if (cevrimdisi) return 'İnternet yok · sipariş alınamaz';
    if (!ozet) return 'Bağlanıyor…';
    if (!ozet.mesaide) return 'Vardiya kapalı';
    if (ozet.kilitli) return `Kilitlisiniz: ${ozet.kilit_nedeni || 'yöneticinizi arayın'}`;
    if ((ozet.fis_bekleyen || []).length) return 'Önce bekleyen fiş fotoğrafını gönderin';
    if (Number(ozet.aktif_paket) >= Number(ozet.paket_siniri)) return `Paket sınırı dolu (${ozet.aktif_paket}/${ozet.paket_siniri})`;
    return null;
  }

  // ------------------------------------------------------------------ teklif geri sayımı (06.11)
  // Merkez (defter_siparisler, 20261106220000_teklif_suresi.sql) her teklifte panelin "Sipariş kimse almazsa" ayarına göre
  // teklif_t0 (ilk bildirim), genis_zaman (diğer kuryelere açılma), yonetici_zaman (yöneticiye düşme) verir. Halka sıradaki
  // adıma kadar döner; adım geçince bir sonrakine (aynı halka baştan). Eski merkezde alan yoksa null (halka yok).
  const zamanOku = (x) => { const v = x ? Date.parse(x) : NaN; return Number.isFinite(v) ? v : null; };
  const sureYazisi = (sn) => (sn >= 60 ? `${Math.floor(sn / 60)}:${String(sn % 60).padStart(2, '0')}` : String(sn));
  /** Dönüş: { kalan (sn), oran (0..1, halkada kalan), sayi ("45" / "1:45"), alt, kirmizi, bitti } ya da null */
  function teklifSayaci(s, simdi = Date.now()) {
    const t0 = zamanOku(s && s.teklif_t0);
    if (t0 == null) return null;
    const adimlar = [];
    const g = zamanOku(s.genis_zaman), y = zamanOku(s.yonetici_zaman);
    if (g != null && !s.genis) adimlar.push({ an: g, alt: 'sonra diğer kuryelere de açılır', bitti: 'Diğer kuryelere de açıldı' });
    if (y != null) adimlar.push({ an: y, alt: 'sonra yöneticiye düşer', bitti: 'Yöneticiye bildirildi' });
    adimlar.sort((a, b) => a.an - b.an);
    let bas = t0;
    for (const a of adimlar) {
      if (simdi < a.an) {
        const kalan = Math.ceil((a.an - simdi) / 1000);
        const oran = Math.max(0, Math.min(1, (a.an - simdi) / Math.max(1000, a.an - bas)));
        return { kalan, oran, sayi: sureYazisi(kalan), alt: (kalan < 60 ? 'sn ' : '') + a.alt, kirmizi: kalan <= 10, bitti: false };
      }
      bas = Math.max(bas, a.an);
    }
    if (adimlar.length) return { kalan: 0, oran: 0, sayi: '0', alt: adimlar[adimlar.length - 1].bitti, kirmizi: true, bitti: true };
    if (s.yoneticide) return { kalan: 0, oran: 0, sayi: '0', alt: 'Yöneticiye bildirildi', kirmizi: true, bitti: true };
    return null;
  }
  /** Merkez saati ile telefon saati farkı (ms). simdi = Date.now() + fark */
  const saatFarki = (merkezSaati, yerel = Date.now()) => { const m = zamanOku(merkezSaati); return m == null ? 0 : m - yerel; };

  // ------------------------------------------------------------------ işletme notu (06.11)
  // İşletme programdan tek dokunuşla hazır not gönderir ("Paket hazır", "5 dk daha", "Ürün eksik, ara"). Telefon kısa sesli
  // bildirim alır; görev kartında en son not küçük satır olarak durur. s.notlar: merkezden son 3 not (en yeni önce).
  /** Dönüş: { metin, saat, eski (daha önceki not sayısı) } ya da null */
  function isletmeNotu(s) {
    const l = (s && Array.isArray(s.notlar) ? s.notlar : []).filter((n) => n && n.metin);
    if (!l.length) return null;
    const z = zamanOku(l[0].zaman);
    return { metin: String(l[0].metin), saat: z == null ? '' : new Date(z).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), eski: l.length - 1 };
  }

  // ------------------------------------------------------------------ vardiyayı bitir (06.11)
  // Elinde alınmış / dükkânda / yoldaki paket varken vardiya BİTMEZ (düğme yok, açıklama + Tamam). POS sende ise sadece uyarı.
  /** Dönüş: { engel: paket sayısı (0 = bitebilir), posUyari: [işletme adları] } */
  // Karar 07.11: POS kuryedeyken de vardiya BİTMEZ (işletme gün sonu Z raporu için POS'a muhtaç); kaçış: panelde yönetici
  // "POS iade edildi". Dönüş: engel (elindeki paket sayısı), posEngel (POS'u sende olan işletmeler), bitirilebilir
  function bitirDurumu(ozet, benim = [], poslar = []) {
    const aktif = (benim || []).filter((s) => ['alindi', 'restoranda', 'yolda'].includes(s && s.durum)).length;
    const engel = Math.max(aktif, Number(ozet && ozet.aktif_paket) || 0);
    const posEngel = [...new Set((poslar || []).map((p) => p.dukkan).filter(Boolean))];
    return { engel, posEngel, posUyari: posEngel, bitirilebilir: engel === 0 && posEngel.length === 0 };
  }

  // ------------------------------------------------------------------ "Şimdi değil" sonrası tekrar (07.11)
  // Merkez "kimse almadı" bildirimini tekrar_sn'de bir (ilk bildirimden), tekrar_son'a kadar tekrarlar; diğer kuryelere açılınca
  // (genis_zaman) atanmış kuryelere de bir kez daha çalar. "Şimdi değil" denen teklif, telefonun bir sonraki çaldığı ana kadar
  // gizli kalır; o an ekranda yeniden açılır (çalan telefonda boş ekran olmasın). Eski merkez (alan yok): 60 sn, açılmaya kadar.
  // 07.11 gece (karar "alınmadığı her 2 dakikada bir çalsın"): 1. tekrar tekrar_sn'de, sonrakiler her cal_aralik_sn'de bir
  // (vars. 120), tekrar_son'a (ilk + 30 dk) kadar; yöneticiye düştükten sonra da. cal_aralik_sn yoksa (eski merkez) tekrar_sn'de bir.
  /** "sonra"dan (ms) sonraki ilk çalma anı (ms) ya da null (artık çalmaz) */
  function sonrakiHatirlatma(s, sonra) {
    const t0 = zamanOku(s && s.teklif_t0);
    const g = zamanOku(s && s.genis_zaman);
    const aday = [];
    const n = s && s.tekrar_sn === undefined ? 60 : Number(s && s.tekrar_sn);
    const ar = s && s.cal_aralik_sn != null ? Number(s.cal_aralik_sn) : n;
    const son = s && s.tekrar_son !== undefined ? zamanOku(s.tekrar_son) : (g != null ? g : zamanOku(s && s.yonetici_zaman));
    if (t0 != null && Number.isFinite(n) && n > 0 && Number.isFinite(ar) && ar > 0) {
      for (let k = 1; k <= 99; k++) {
        const t = t0 + (n + (k - 1) * ar) * 1000;
        if (son != null && t >= son) break;
        if (t > sonra) { aday.push(t); break; }
      }
    }
    if (g != null && g > sonra && !(s && s.genis)) aday.push(g);
    return aday.length ? Math.min(...aday) : null;
  }
  /** Teklif "Şimdi değil" ile gizli mi? gecildi: basıldığı an (ms) ya da yok */
  function teklifGizli(s, gecildi, simdi = Date.now()) {
    if (gecildi == null) return false;
    const t = sonrakiHatirlatma(s, gecildi);
    return t == null || simdi < t;
  }

  // ------------------------------------------------------------------ POS cihazı (06.11): docs/kurye-app/POS-TAKIBI-PLANI.md
  // Karar 04.11: POS takibi SADECE kapıda kredi / banka kartında. Yemek kartı NFC / QR ile telefondan alınır, POS taşınmaz.
  const KARTLI = new Set(['kapida_kart']);
  const kartliMi = (s) => Boolean(s && KARTLI.has(s.odeme));
  const POS_ESIK_VARSAYILAN = 20;
  /** Hatırlatma eşiği (dk; panelden, defter_kurye_ozet.pos_esik_dk). Eski merkezde yoksa 20 */
  function posEsigi(ozet) {
    const n = Number(ozet && ozet.pos_esik_dk);
    return Number.isFinite(n) && n > 0 ? n : POS_ESIK_VARSAYILAN;
  }
  const ACIK_DURUM = new Set(['alindi', 'restoranda', 'yolda']);

  /**
   * Kuryedeki POS'lar: merkezdeki açık oturumlar (ozet.poslar) + kuyrukta bekleyen "POS'u aldım"lar − kuyrukta bekleyen iadeler
   * (internet yokken de şerit doğru görünsün). benim: defter_siparisler.benim. Kuyruk işleri:
   *   { tur: 'pos_aldi', siparis, dukkan, ikinci, eylem, eklendi }   { tur: 'pos_iade', siparis, pos_anahtar, args: { p_acilis } }
   * Dönüş: [{ anahtar, acilis_id, dukkan, pos, baslangic, siparisler: [id], bekleyen: [id] (teslim edilmemiş), yerel }]
   */
  function poslar(ozet, kuyrukIsleri = [], benim = []) {
    const l = ((ozet && ozet.poslar) || []).map((p) => ({
      anahtar: 'a' + p.acilis_id, acilis_id: p.acilis_id, dukkan: p.dukkan, pos: p.pos, baslangic: p.baslangic,
      siparisler: (p.siparisler || []).map((x) => x.id), yerel: false,
    }));
    for (const x of kuyrukIsleri) {
      if (x.tur !== 'pos_aldi' || l.some((p) => p.siparisler.includes(x.siparis))) continue;
      const ayni = !x.ikinci && l.find((p) => p.dukkan === x.dukkan);
      if (ayni) ayni.siparisler.push(x.siparis);
      else l.push({ anahtar: 'y' + x.eylem, acilis_id: null, dukkan: x.dukkan, pos: 'POS', baslangic: new Date(x.eklendi || Date.now()).toISOString(), siparisler: [x.siparis], yerel: true });
    }
    const iadeler = kuyrukIsleri.filter((x) => x.tur === 'pos_iade');
    const kalan = l.filter((p) => !iadeler.some((x) => x.pos_anahtar === p.anahtar || (x.args && x.args.p_acilis != null && x.args.p_acilis === p.acilis_id)
                                                    || (x.siparis && p.siparisler.includes(x.siparis))));
    return kalan.map((p) => ({
      ...p,
      bekleyen: p.siparisler.filter((id) => {
        const s = (benim || []).find((b) => b.id === id);
        return s && ACIK_DURUM.has(tahminiDurum(s, kuyrukIsleri.filter((k) => k.siparis === id)));
      }),
    }));
  }

  /** Kaç dakikadır kuryede, eşik aşıldı mı; şerit yazısı. Eşik aşılınca kırmızı */
  function posSeridi(p, esik = POS_ESIK_VARSAYILAN, simdi = Date.now()) {
    const dk = Math.max(0, Math.floor((simdi - new Date(p.baslangic).getTime()) / 60000));
    const asti = dk >= esik;
    return { dk, asti, renk: asti ? 'kirmizi' : 'turuncu', metin: `POS sende · ${p.dukkan} · ${dk} dk`, alt: asti ? 'Süre doldu: dükkâna geri götür' : (p.bekleyen && p.bekleyen.length ? 'teslimden sonra dükkâna geri götür' : 'iade etmek için dokun') };
  }

  /**
   * "Paketi aldım"dan sonra sorulacak POS sorusu. null = sorulmaz (kartlı değil ya da bu sipariş zaten bir POS'ta).
   * 'ilk': "İşletmenin POS cihazını aldın mı?"  'ayni': "POS zaten sende; bu sipariş de aynı POS ile mi?"
   */
  function posSorusu(s, liste = []) {
    if (!kartliMi(s) || liste.some((p) => p.siparisler.includes(s.id))) return null;
    const ayni = liste.find((p) => p.dukkan === s.dukkan);
    return ayni ? { tur: 'ayni', pos: ayni } : { tur: 'ilk', pos: null };
  }

  /** Teklif başka işletmeden ve kuryede bir POS varsa uyarı (ALIYORUM engellenmez) */
  function teklifPosUyarisi(teklif, liste = []) {
    const baska = [...new Set(liste.filter((p) => p.dukkan !== (teklif && teklif.dukkan)).map((p) => p.dukkan))];
    return baska.length ? `POS sende: ${baska.join(', ')} · iade etmeyi unutma` : null;
  }

  /** İade için merkeze gidecek değerler: oturum no (biliniyorsa) + oturumdaki ilk sipariş (internet yokken alınan için) */
  const posIadeArgs = (p) => ({ p_acilis: p.acilis_id == null ? null : p.acilis_id, p_siparis: p.siparisler[0] || null });

  // ------------------------------------------------------------------ nakit borcu (08.11; NAKIT-PLANI.md)
  /** Yönelme eki (sade kural: son ünlü + kaynaştırma): "Deneme Bufe" → "Deneme Bufe'ye", "Waffle Evim" → "Waffle Evim'e" */
  function yeEki(ad) {
    const s = String(ad || '').trim();
    if (!s) return s;
    const kucuk = s.toLocaleLowerCase('tr-TR');
    const unluler = kucuk.match(/[aeıioöuü]/g);
    const son = unluler ? unluler[unluler.length - 1] : 'e';
    return `${s}'${/[aeıioöuü]$/.test(kucuk) ? 'y' : ''}${'aıou'.includes(son) ? 'a' : 'e'}`;
  }
  /** Kapıda nakit mi (soru sorulur): ödeme nakit ve kapıda alınacak tutar > 0 */
  const nakitMi = (s) => Boolean(s) && s.odeme === 'nakit' && Number(s.kapida_tahsil != null ? s.kapida_tahsil : s.tutar) > 0;
  /**
   * Borçlar: merkezin listesi (defter_nakit_durum.borclar) + internetsiz kuyrukta bekleyen cevaplar / "Parayı verdim"ler.
   * Dönüş: [{ dukkan_id, dukkan, bakiye, bekleyen, acik }] (bakiye 0 ve bekleyen 0 olan çıkar).
   */
  function nakitBorclar(nakit, bekleyen = []) {
    const m = new Map();
    for (const b of (nakit && nakit.borclar) || []) m.set(b.dukkan_id, { dukkan_id: b.dukkan_id, dukkan: b.dukkan, bakiye: Number(b.bakiye) || 0, bekleyen: Number(b.bekleyen) || 0, itirazli: Number(b.itirazli) || 0 });
    for (const x of bekleyen) {
      if (x.tur !== 'nakit_yanit' && x.tur !== 'nakit_verdim') continue;
      // İşletme kimliği bilinmiyorsa (ilk borç, internet yok) aynı adlı satır; yoksa geçici "ad:" anahtarı
      const anahtar = x.dukkan_id || ([...m.values()].find((b) => b.dukkan === x.dukkan) || {}).dukkan_id || (x.dukkan ? 'ad:' + x.dukkan : null);
      if (!anahtar) continue;
      const b = m.get(anahtar) || { dukkan_id: anahtar, dukkan: x.dukkan || '', bakiye: 0, bekleyen: 0, itirazli: 0 };
      if (x.tur === 'nakit_yanit' && x.verdi === false) b.bakiye += Number(x.tutar) || 0;
      if (x.tur === 'nakit_verdim') b.bekleyen = Math.max(b.bekleyen, b.bakiye);
      m.set(anahtar, b);
    }
    return [...m.values()].map((b) => ({ ...b, acik: Math.max(0, b.bakiye - b.bekleyen) })).filter((b) => b.bakiye !== 0 || b.bekleyen > 0);
  }
  /** Üst şerit "İşletmelere borcum": eksi bakiye (işletme kuryeye borçlu) toplamdan düşmez */
  const nakitToplam = (l = []) => l.reduce((t, b) => t + Math.max(0, b.bakiye), 0);
  /**
   * Turuncu şerit: "<işletme>'ye X TL borcun" + alt satır; eksi bakiye: "<işletme> sana X TL borçlu".
   * 09.11: işletme "almadım / eksik aldım" dediyse (itirazli) "X TL anlaşmazlık · yönetici çözecek".
   */
  function nakitSeridi(b) {
    if (b.bakiye < 0) return { metin: `${b.dukkan} sana ${para(-b.bakiye)} borçlu`, alt: 'Peşin verdiğin sipariş iptal oldu · yöneticine söyle' };
    const itirazli = Number(b.itirazli) || 0;
    return {
      metin: `${yeEki(b.dukkan)} ${para(b.bakiye)} borcun`,
      alt: itirazli > 0 ? `${para(itirazli)} anlaşmazlık · işletme "almadım / eksik" dedi, yönetici çözecek`
        : b.acik <= 0 ? `${para(b.bekleyen)} onay bekliyor · işletme "aldım" deyince kalkar`
        : b.bekleyen > 0 ? `${para(b.bekleyen)} onay bekliyor · kalanı verince "Parayı verdim"` : 'Parayı verince "Parayı verdim"i kaydır',
    };
  }
  /**
   * "Bu siparişin parasını işletmeye şimdi verdin mi?" sorulmalı mı: kapıda nakit, paket kuryede (yolda), cevap yok
   * (merkezde de, kuyrukta da). nakit: defter_nakit_durum (yanitlar).
   */
  function nakitSorusu(s, nakit, bekleyen = []) {
    if (!nakitMi(s)) return false;
    if (nakit && nakit.yanitlar && nakit.yanitlar[s.id]) return false;
    if (bekleyen.some((x) => x.tur === 'nakit_yanit' && x.siparis === s.id)) return false;
    return tahminiDurum(s, bekleyen.filter((x) => x.siparis === s.id)) === 'yolda';
  }

  /**
   * "Müşteriyi ara" (07.11): defterdeki müşteri telefonundan tel: adresi.
   * Trendyol / Getir maskeli numara + kod: program "0212 000 34 03 — arayınca kod: 10000000001" yazar → "tel:02120003403,10000000001"
   * (virgül: telefon ~2 sn bekler, sonra kodu kendisi tuşlar). Hazır "numara,kod" da olur. Birden çok numara ("a / b") → ilki.
   * Boşluk, tire, parantez temizlenir; numara 7 haneden kısaysa null. Hiçbir şey saklanmaz (sadece ekranda kurulur).
   */
  function aramaBilgisi(tel) {
    const t = String(tel == null ? '' : tel).trim();
    if (!t) return null;
    let ham = t, kod = null;
    const m = /^(.*?)[\s—–-]*arayınca\s+kod\s*:?\s*([\d\s]+)$/i.exec(t) || /^([^,]*?),\s*([\d\s]+)$/.exec(t);
    if (m) { ham = m[1]; kod = m[2].replace(/\D/g, '') || null; }
    ham = ham.split('/')[0];
    const numara = (ham.trim().startsWith('+') ? '+' : '') + ham.replace(/\D/g, '');
    if (numara.replace('+', '').length < 7) return null;
    if (kod && kod.length > 20) kod = null;
    return { href: `tel:${numara}${kod ? ',' + kod : ''}`, numara, kod };
  }

  /** Bildirim yolu yazısı (Hazırlık ve panel) */
  function bildirimYoluYazisi(yol) {
    return { 'fcm+sorgu': 'FCM + sorgu', sorgu: 'sadece sorgu', web: 'iPhone (web)' }[yol] || '?';
  }

  // ------------------------------------------------------------------ web uygulaması (iPhone adım 5–6, 09.11)
  /** iOS sürümü: "iPhone OS 16_4" → { ana: 16, alt: 4, yazi: '16.4', yeterli: true }. Web bildirimi iOS 16.4 ve üstünde. */
  function iosSurumu(ua) {
    const m = /(?:iPhone|iPad|iPod)[^)]*? OS (\d+)[_.](\d+)/.exec(String(ua || ''));
    if (!m) return null;
    const ana = Number(m[1]), alt = Number(m[2]);
    return { ana, alt, yazi: `${ana}.${alt}`, yeterli: ana > 16 || (ana === 16 && alt >= 4) };
  }
  /**
   * Kurye web bildirimi durumu → { kod, metin, dugme } (dugme: 'ac' | null). iPhone'da bildirim sadece ana ekrana
   * eklenmiş uygulamada ve bir düğmeye dokununca istenir. abone: bu tarayıcıda abonelik var VE merkez kayıtlı diyor.
   */
  function webBildirimDurumu({ destek, ios, iosSurum, standalone, izin, vapid, abone }) {
    if (ios && iosSurum && !iosSurum.yeterli) {
      return { kod: 'eski_ios', metin: `Bu iPhone'da iOS ${iosSurum.yazi} var. Sipariş bildirimi için iOS 16.4 ve üstü gerekir: Ayarlar → Genel → Yazılım Güncelleme.`, dugme: null };
    }
    if (ios && !standalone) {
      return { kod: 'ana_ekran', metin: 'Önce Ana Ekrana Ekle: Safari\'de alttaki Paylaş düğmesine (kare ve yukarı ok) dokunun → "Ana Ekrana Ekle" → Ekle. Sonra ana ekrandaki "JT Kurye" simgesinden açıp kodla giriş yapın.', dugme: null };
    }
    if (!destek) return { kod: 'destek_yok', metin: 'Bu tarayıcı web bildirimini desteklemiyor. iPhone\'da Safari ile açıp ana ekrana ekleyin.', dugme: null };
    if (!vapid) return { kod: 'merkez_yok', metin: 'Merkezde web bildirimi ayarlı değil. Yöneticinize haber verin; siparişleri görmek için uygulamayı açık tutun.', dugme: null };
    if (izin === 'denied') return { kod: 'reddedildi', metin: 'Bildirim izni reddedilmiş. Ayarlar → Bildirimler → JT Kurye → "Bildirimlere İzin Ver"i açın.', dugme: null };
    if (abone && izin === 'granted') return { kod: 'acik', metin: 'Bildirimler açık: yeni sipariş gelince telefon çalar.', dugme: null };
    return { kod: 'kapali', metin: 'Bildirimler kapalı: uygulama kapalıyken yeni sipariş gelince telefon çalmaz.', dugme: 'ac' };
  }
  /** "#siparis=<uuid>" → uuid (küçük harf) ya da null (bildirime dokununca açılan sipariş) */
  function hashSiparis(h) {
    const m = /(?:^|[#&])siparis=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:&|$)/i.exec(String(h || ''));
    return m ? m[1].toLowerCase() : null;
  }

  /** Uygulama açıkken (web) teklif sesi teklif başına en çok 30 sn (Android ile aynı; 09.11). ms: sadece testte kısaltılır. */
  const TEKLIF_SES_MS = 30 * 1000;
  function teklifSesiCalsin(bas, simdi, ms) {
    const sinir = Number(ms) > 0 ? Number(ms) : TEKLIF_SES_MS;
    return bas != null && simdi - bas < sinir;
  }

  return {
    iosSurumu, webBildirimDurumu, hashSiparis, teklifSesiCalsin, TEKLIF_SES_MS,
    api, kuyruk, rastgele, eylemKimligi, dugmeler, uyarilar, almaYazisi, odemeAdi, para, kodDuzelt, CevrimdisiHata, SunucuHata,
    durumAdi, tahminiDurum, nedenDogrula, iptalUyarisi, adimYazisi, DURUM_ADI, ekranUyarilari, ekranUyarisi, gordumCagrisi,
    gosterilen, fcmAnahtari, sorguAraligi, siparisNo, bildirimYoluYazisi, varisAyari, varisDurumu, paraKutusu, GOREV_ADIM, KAYNAK_ADI, alamazNedeni, GOSTERILEN_SURE_MS, GOSTERILEN_EN_FAZLA, SORGU_ARALIK_MS,
    kartliMi, posEsigi, poslar, posSeridi, posSorusu, teklifPosUyarisi, posIadeArgs, POS_ESIK_VARSAYILAN,
    teklifSayaci, saatFarki, bitirDurumu, isletmeNotu, sonrakiHatirlatma, teklifGizli,
    yeEki, nakitMi, nakitBorclar, nakitToplam, nakitSeridi, nakitSorusu, aramaBilgisi,
  };
});
