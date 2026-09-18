/**
 * Web aramasi.
 *
 * Kullanici istedigi icin artik HEP ACIK. Istek tarayicidan degil
 * sunucudan gider; boylece tarayici gecmisinize ya da cerezlerinize
 * dokunmaz.
 *
 * Birden fazla kaynak sirayla deneniyor (Wikipedia, DuckDuckGo anlik
 * cevap, DuckDuckGo sonuc sayfasi, DuckDuckGo lite). Tek kaynaga bagli
 * kalmak kirilgandi: html.duckduckgo.com tarayici olmayan isteklere sik
 * sik 403 veriyor ve arastirma tamamen calismiyordu.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

/** HTML varliklarini coz ve etiketleri temizle. */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo yonlendirme adresini gercek adrese cevirir. */
function cleanUrl(href) {
  if (!href) return null;
  try {
    const ham = decodeURIComponent(
      String(href).replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0],
    );
    return /^https?:\/\//i.test(ham) ? ham : null;
  } catch {
    return null;
  }
}

/**
 * Sonuc sayfasindan ILK N kaydi cikarir.
 * Tek bir cumle yerine birkac kaynak vermek, kullanicinin kendi
 * dogrulamasini mumkun kiliyor — bilginin nereden geldigi gorunur olsun.
 */
function parseResults(html, limit) {
  /*
   * Baslik ve ozeti AYNI SIRADA okuyup ONCE eslestiriyoruz, sonra
   * eliyoruz. Onceki hali once eliyor, sonra ozetleri indeksle
   * bagliyordu; elenen her kayit sonrakilerin ozetini kaydiriyor ve
   * kartta bir sitenin baglantisi baska bir sitenin ozetiyle
   * gorunuyordu.
   */
  const basliklar = [];
  const re = /class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    basliklar.push({ href: m[1], title: stripHtml(m[2]) });
  }

  const ozetler = [];
  const re2 = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m2;
  while ((m2 = re2.exec(html))) ozetler.push(stripHtml(m2[1]));

  const kayitlar = [];
  const siteler = new Set();

  for (const [i, ham] of basliklar.entries()) {
    if (kayitlar.length >= limit) break;
    const url = cleanUrl(ham.href);
    if (!url || !ham.title) continue;

    let site;
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    // Ayni siteden ust uste kayitlar yerine cesitlilik.
    if (siteler.has(site)) continue;
    siteler.add(site);

    kayitlar.push({ title: ham.title, url, site, snippet: ozetler[i] || "" });
  }

  return kayitlar;
}

/**
 * Bir sayfanin onizleme gorselini (og:image) cikarir.
 * Gorsel bulunamazsa null; arama gorselsiz de tamamlanir.
 */
async function pageImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    // Tum sayfayi indirmeye gerek yok: og:image bas kisimda.
    const bas = (await res.text()).slice(0, 60_000);
    const src =
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(bas)?.[1] ||
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(bas)?.[1];
    if (!src) return null;
    return new URL(src, url).href;
  } catch {
    return null;
  }
}

/**
 * Zengin arama: birkac kaynak, ozetleri ve onizleme gorselleriyle.
 * `search()` tek cumlelik yanit icin; bu ise ekrana kart basmak icin.
 */
/* ------------------------------------------------------------ kaynaklar */

/**
 * Adresler degisken: testler yerel taklitlere yonlendirebilsin.
 */
let ENDPOINTS = {
  google: "https://www.googleapis.com/customsearch/v1",
  wiki: "https://tr.wikipedia.org/api/rest_v1/page/summary/",
  wikiSearch: "https://tr.wikipedia.org/w/api.php",
  ddgApi: "https://api.duckduckgo.com/",
  ddgHtml: "https://html.duckduckgo.com/html/",
  ddgLite: "https://lite.duckduckgo.com/lite/",
};

export function _setEndpointsForTests(next) {
  ENDPOINTS = next ? { ...ENDPOINTS, ...next } : {
    google: "https://www.googleapis.com/customsearch/v1",
    wiki: "https://tr.wikipedia.org/api/rest_v1/page/summary/",
    wikiSearch: "https://tr.wikipedia.org/w/api.php",
    ddgApi: "https://api.duckduckgo.com/",
    ddgHtml: "https://html.duckduckgo.com/html/",
    ddgLite: "https://lite.duckduckgo.com/lite/",
  };
}

/** Tarayiciya benzeyen basliklar — ciplak istekler cogu zaman 403 aliyor. */
const BROWSER_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
};

/* ------------------------------------------------------------- Google */

/**
 * Google Programmable Search (Custom Search JSON API).
 *
 * NEDEN AYRI BIR ANAHTAR GEREKIYOR: Google arama sayfasini otomatik
 * isteklere kapatiyor — kazimaya calisan her istek er ya da gec CAPTCHA
 * ya da 403 aliyor. Resmi yol bu API ve kendi anahtarinizi istiyor.
 * Ucretsiz katman gunde 100 sorgu; kisisel kullanim icin fazlasiyla
 * yeter, asilirsa Google'a para odemeden DURUYOR (sessizce faturaya
 * donusmuyor).
 *
 * Anahtar GIRILMEDIYSE bu kaynak zincire hic girmiyor: uygulama
 * anahtarsiz da calismaya devam ediyor, yalnizca Wikipedia ve
 * DuckDuckGo ile.
 *
 * Anahtar diskte SUNUCU TARAFINDA tutulmuyor; her acilista arayuzden
 * bildiriliyor — ElevenLabs ve YouTube'da oldugu gibi.
 */
let google = { key: null, cx: null };

export function configureGoogle({ key, cx } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  google = { key: temiz(key), cx: temiz(cx) };
  return googleStatus();
}

export function googleStatus() {
  return {
    ready: Boolean(google.key && google.cx),
    // Anahtarin kendisi asla disari verilmez; yalnizca var olup olmadigi.
    keySet: Boolean(google.key),
    cxSet: Boolean(google.cx),
  };
}

/** Google'in hata govdesinden okunabilir bir cumle cikarir. */
function googleHatasi(status, govde) {
  let sebep = "";
  try {
    sebep = JSON.parse(govde)?.error?.message || "";
  } catch {
    sebep = String(govde).slice(0, 160);
  }
  if (status === 403 && /quota|rate/i.test(sebep)) {
    return "Google arama kotasi doldu (gunluk 100 ucretsiz sorgu). " +
      "Yarin sifirlanir; o zamana kadar diger kaynaklar kullaniliyor.";
  }
  if (status === 400 && /cx/i.test(sebep)) {
    return "Google arama motoru kimligi (cx) gecersiz. Modlar sekmesinden kontrol edin.";
  }
  if (status === 400 || status === 403) {
    return `Google anahtari kabul edilmedi${sebep ? `: ${sebep}` : "."}`;
  }
  return `Google ${status} dondu${sebep ? `: ${sebep}` : "."}`;
}

async function googleCagir(params) {
  const res = await fetch(`${ENDPOINTS.google}?` + new URLSearchParams(params), {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  const metin = await res.text();
  if (!res.ok) throw new Error(googleHatasi(res.status, metin));
  try {
    return JSON.parse(metin);
  } catch {
    throw new Error("Google beklenmedik bir yanit verdi (JSON degil).");
  }
}

/**
 * Konuyla ilgili GERCEK gorseller.
 *
 * Sahnede su ana kadar kaynak sayfalarin onizleme gorselleri
 * (`og:image`) kullaniliyordu — cogu zaman sitenin logosu ya da
 * alakasiz bir kapak cikiyor. Gorsel aramasi konunun kendisini
 * getiriyor.
 *
 * Basarisiz olursa sessizce bos donuyor: gorsel bir suslemedir,
 * cevabin kendisi degil.
 */
async function googleGorseller(q) {
  try {
    const d = await googleCagir({
      key: google.key, cx: google.cx, q,
      searchType: "image", num: "4", safe: "active", hl: "tr", gl: "tr",
    });
    return (d.items || [])
      .map((x) => {
        // Sema dogrulanmadan karta/sahneye adres gecmiyor.
        let u;
        try {
          u = new URL(x.link);
        } catch {
          return null;
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        return { src: u.href, site: x.displayLink || "", url: x.image?.contextLink || null };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fromGoogle(q, limit, gorselIstiyor) {
  if (!google.key || !google.cx) {
    // ATLANDI, denendi degil. Ayrimi korumak sart: asagida "hicbir
    // kaynaga ULASILAMADI" ile "ulasildi ama sonuc yok" farkli seyler.
    // Girilmemis bir anahtari "denendi" saymak, ag koptugunda
    // kullaniciya "bulamadim" dedirtirdi.
    throw Object.assign(new Error("Google anahtari girilmemis"), { code: "SKIPPED" });
  }

  const d = await googleCagir({
    key: google.key, cx: google.cx, q,
    num: String(Math.max(1, Math.min(10, limit))),
    hl: "tr", gl: "tr", safe: "active",
  });

  const kayitlar = [];
  const siteler = new Set();
  for (const x of d.items || []) {
    let u;
    try {
      u = new URL(x.link);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;

    const site = u.hostname.replace(/^www\./, "");
    // Ayni siteden ust uste kayitlar yerine cesitlilik.
    if (siteler.has(site)) continue;
    siteler.add(site);

    kayitlar.push({ title: x.title || site, url: u.href, site, snippet: x.snippet || "" });
  }

  if (!kayitlar.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  return {
    provider: "Google",
    // Google "su cevap" demiyor, sonuc listesi veriyor. Ilk sonucun
    // ozetini cevap olarak kullaniyoruz ve KAYNAGINI soyluyoruz.
    summary: kayitlar[0].snippet
      ? { text: kayitlar[0].snippet, source: kayitlar[0].site, url: kayitlar[0].url }
      : null,
    results: kayitlar,
    /*
     * Gorsel aramasi AYRI bir sorgu ve ayri bir kota kalemi. Ucretsiz
     * katman gunde 100 sorgu; istenmeyen gorsel icin yarisini harcamak
     * anlamsiz. Yalnizca gercekten gosterilecekse cagriliyor.
     */
    images: gorselIstiyor ? await googleGorseller(q) : [],
  };
}

/**
 * Wikipedia: olgusal sorularin en guvenilir kaynagi.
 * Anahtar istemiyor, engellemiyor, ozet + gorsel + bag veriyor.
 */
/**
 * Wikipedia bu soru icin uygun mu?
 *
 * `list=search` neredeyse HER sorguya bir baslik donduruyor. Zincirde
 * ilk sirada oldugu icin "bugun hava nasil" sorusuna ansiklopedinin
 * "Hava" maddesi donuyordu. Iki olcut koyuyoruz:
 *   - Guncel bilgi isteyen sorular ansiklopediye ait degil.
 *   - Donen baslik sorguyla gercekten ortusmeli.
 */
const GUNCEL = /bugun|dun|yarin|su an|simdi|son dakika|hava durumu|hava nasil|kac tl|kac lira|kac dolar|fiyat|kur|mac skoru|skor|puan durumu|ne zaman baslayacak|acik mi|kapali mi/;

function wikiUygunMu(q) {
  const n = q.toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
  return !GUNCEL.test(n);
}

/** Donen baslik sorguyla ortusuyor mu? */
function basligiOrtusuyorMu(q, title) {
  const sadelestir = (x) => x.toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");

  const sorgu = sadelestir(q).split(/\s+/).filter((w) => w.length >= 3);
  if (!sorgu.length) return true;
  const baslik = sadelestir(title);
  return sorgu.some((w) => baslik.includes(w) || w.includes(baslik));
}

async function fromWikipedia(q) {
  if (!wikiUygunMu(q)) {
    throw Object.assign(new Error("guncel bilgi sorusu"), { code: "NOT_APPLICABLE" });
  }

  // Once baslik ariyoruz; dogrudan ozet ucu tam eslesme istiyor.
  const ara = `${ENDPOINTS.wikiSearch}?` + new URLSearchParams({
    action: "query", list: "search", srsearch: q, srlimit: "3",
    format: "json", origin: "*",
  });

  const res = await fetch(ara, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);

  const data = await res.json();
  const bulunan = (data?.query?.search || [])
    // Alakasiz baslik donduyse Wikipedia bu soruya cevap veremiyor demektir.
    .filter((k) => basligiOrtusuyorMu(q, k.title || ""));
  if (!bulunan.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  const ozetler = await Promise.all(
    bulunan.slice(0, 3).map(async (k) => {
      try {
        const r = await fetch(ENDPOINTS.wiki + encodeURIComponent(k.title), {
          headers: { "user-agent": UA },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        return {
          title: d.title,
          extract: d.extract,
          url: d.content_urls?.desktop?.page ||
            `https://tr.wikipedia.org/wiki/${encodeURIComponent(k.title)}`,
          image: d.thumbnail?.source || d.originalimage?.source || null,
        };
      } catch {
        return null;
      }
    }),
  );

  const gecerli = ozetler.filter((x) => x?.extract);
  if (!gecerli.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  return {
    provider: "Wikipedia",
    summary: { text: gecerli[0].extract, source: "Wikipedia", url: gecerli[0].url },
    results: gecerli.map((x) => ({
      title: x.title,
      url: x.url,
      site: "tr.wikipedia.org",
      snippet: x.extract.slice(0, 220),
    })),
    images: gecerli
      .filter((x) => x.image)
      .map((x) => ({ src: x.image, site: x.title, url: x.url })),
  };
}

/** DuckDuckGo anlik cevap ucu — kisa tanimlar ve hesaplamalar. */
async function fromDdgApi(q) {
  const res = await fetch(
    `${ENDPOINTS.ddgApi}?` + new URLSearchParams({
      q, format: "json", no_html: "1", skip_disambig: "1",
    }),
    { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

  const data = await res.json();
  const ozet = (data.AbstractText || "").trim();
  const ilgili = (data.RelatedTopics || []).filter((x) => x?.Text && x?.FirstURL);

  if (!ozet && !ilgili.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  const gorsel = data.Image
    ? (data.Image.startsWith("http") ? data.Image : `https://duckduckgo.com${data.Image}`)
    : null;

  return {
    provider: "DuckDuckGo",
    summary: ozet
      ? { text: ozet, source: data.AbstractSource || "DuckDuckGo", url: data.AbstractURL || null }
      : null,
    results: ilgili
      .map((x) => {
        // Sema DOGRULANIYOR. Diger iki kaynak bunu yapiyordu, burasi
        // yapmiyordu: "javascript:" ile baslayan bir adres karta kadar
        // gidebiliyordu. `new URL` boyle bir adresi sorunsuz ayristirir,
        // yani yalnizca try/catch yetmiyor.
        let u;
        try {
          u = new URL(x.FirstURL);
        } catch {
          return null;
        }
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return {
          title: x.Text.split(" - ")[0],
          url: u.href,
          site: u.hostname.replace(/^www\./, ""),
          snippet: x.Text,
        };
      })
      .filter(Boolean)
      .slice(0, 4),
    images: gorsel ? [{ src: gorsel, site: data.AbstractSource || "DuckDuckGo" }] : [],
  };
}

/** DuckDuckGo sonuc sayfasi — en genis kapsam ama engellenmeye acik. */
async function fromDdgHtml(q, limit) {
  let res;
  try {
    res = await fetch(ENDPOINTS.ddgHtml, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://duckduckgo.com/",
      },
      body: new URLSearchParams({ q }).toString(),
      signal: AbortSignal.timeout(9000),
    });
  } catch (err) {
    throw new Error(`DuckDuckGo'ya ulasilamadi: ${err.message}`);
  }

  if (!res.ok) throw new Error(`Arama servisi ${res.status} dondu.`);

  const sonuclar = parseResults(await res.text(), limit);
  if (!sonuclar.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  return { provider: "DuckDuckGo", summary: null, results: sonuclar, images: [] };
}

/**
 * DuckDuckGo "lite" sayfasi.
 *
 * Neden ayri bir kaynak: html.duckduckgo.com tarayici olmayan isteklere
 * sik sik 403 veriyor — kullanicida arastirma tam olarak bu yuzden
 * calismiyordu. Lite ucu cok daha sade bir sayfa dondurur ve ayni
 * engellemeyi genelde uygulamaz. Adres zaten tanimliydi ama hicbir yerde
 * kullanilmiyordu.
 *
 * Sayfa duzeni tablo tabanli:
 *   <a ... class="result-link" href="...">Baslik</a>
 *   <td class="result-snippet">Ozet</td>
 * Oznitelik sirasi degisebildigi icin href ayri okunuyor.
 */
function parseLite(html, limit) {
  const basliklar = [];
  const re = /<a\b([^>]*\bclass=["'][^"']*result-link[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = /\bhref=["']([^"']+)["']/i.exec(m[1])?.[1];
    const title = stripHtml(m[2]);
    if (href && title) basliklar.push({ href, title });
  }

  const ozetler = [];
  const re2 = /<td[^>]*\bclass=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;
  let m2;
  while ((m2 = re2.exec(html))) ozetler.push(stripHtml(m2[1]));

  const kayitlar = [];
  const siteler = new Set();

  for (const [i, ham] of basliklar.entries()) {
    if (kayitlar.length >= limit) break;
    // Lite bazen dogrudan adres, bazen yonlendirme veriyor; ikisi de olur.
    const url = /^https?:\/\//i.test(ham.href) ? ham.href : cleanUrl(ham.href);
    if (!url) continue;

    let site;
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (siteler.has(site)) continue;
    siteler.add(site);

    kayitlar.push({ title: ham.title, url, site, snippet: ozetler[i] || "" });
  }

  return kayitlar;
}

async function fromDdgLite(q, limit) {
  let res;
  try {
    res = await fetch(ENDPOINTS.ddgLite, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://lite.duckduckgo.com/",
      },
      body: new URLSearchParams({ q }).toString(),
      signal: AbortSignal.timeout(9000),
    });
  } catch (err) {
    throw new Error(`DuckDuckGo lite'a ulasilamadi: ${err.message}`);
  }

  if (!res.ok) throw new Error(`Arama servisi (lite) ${res.status} dondu.`);

  const sonuclar = parseLite(await res.text(), limit);
  if (!sonuclar.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  return { provider: "DuckDuckGo", summary: null, results: sonuclar, images: [] };
}

/* ----------------------------------------------------------- niyet */

function sadelestir(x) {
  return String(x || "").toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
}

/**
 * Soru ne tur bir cevap istiyor?
 *
 * Her soruya ayni bicimde cevap vermek ise yaramiyor: "en ucuz nerede"
 * diyen biri bir ansiklopedi paragrafi degil, SIRALI BIR FIYAT LISTESI
 * bekliyor. "Nasil yapilir" diyen biri tek bir cumle degil, birkac
 * kaynak istiyor.
 *
 * Doner: "fiyat" | "tarif" | "nasil" | null
 */
export function niyet(q) {
  const n = sadelestir(q);
  if (/(en ucuz|en uygun|fiyat|kac para|kac lira|kac tl|nereden al|hangi sitede|satin al|indirim)/.test(n)) {
    return "fiyat";
  }
  if (/(tarif|malzemeler|nasil yapilir|nasil yapilisi|yapilisi|yapimi|nasil pisirilir)/.test(n)) {
    return "tarif";
  }
  if (/(nasil|adim adim|rehber|nasil calisir|nasil kullanilir)/.test(n)) return "nasil";
  return null;
}

/**
 * Metinden Turk Lirasi tutarlarini cikarir.
 *
 * Turkce yazim: binlik ayraci nokta, kurus ayraci virgul.
 *   "1.299,00 TL"  "₺1.299"  "1299,90 TL"  "12.345,67 ₺"
 *
 * Cok kucuk ve cok buyuk degerler eleniyor: "5 TL kargo" ya da bir
 * telefon numarasi fiyat degil.
 */
export function fiyatBul(metin) {
  const bulunan = [];
  const kalip = /(?:₺|\bTL\b)\s*([\d][\d.\s]{0,12}(?:,\d{1,2})?)|([\d][\d.\s]{0,12}(?:,\d{1,2})?)\s*(?:₺|\bTL\b)/gi;
  let m;
  while ((m = kalip.exec(String(metin || "")))) {
    const ham = (m[1] || m[2] || "").trim();
    if (!ham) continue;
    // Binlik ayraclarini at, kurus virgulunu noktaya cevir.
    const sayi = Number(ham.replace(/[.\s]/g, "").replace(",", "."));
    if (!Number.isFinite(sayi)) continue;
    if (sayi < 10 || sayi > 10_000_000) continue;
    bulunan.push(sayi);
  }
  return bulunan;
}

/** Tutari okunabilir bicime cevirir. */
function fiyatYaz(n) {
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TL`;
}

/**
 * Sonuclardan fiyat listesi cikarir, UCUZDAN PAHALIYA siralar.
 *
 * Her sonucta birden fazla tutar gecebiliyor (indirimli/eski fiyat,
 * taksit). EN DUSUGUNU aliyoruz: kullanicinin sordugu sey "en uygun".
 */
function fiyatListesi(sonuclar) {
  const liste = [];
  for (const k of sonuclar || []) {
    const tutarlar = fiyatBul(`${k.title || ""} ${k.snippet || ""}`);
    if (!tutarlar.length) continue;
    const enDusuk = Math.min(...tutarlar);
    liste.push({
      site: k.site,
      url: k.url,
      title: k.title,
      price: enDusuk,
      priceText: fiyatYaz(enDusuk),
    });
  }
  return liste.sort((a, b) => a.price - b.price);
}

export async function richSearch(query, { limit = 4, withImages = true } = {}) {
  const ham = (query || "").trim();
  if (!ham) throw new Error("Bos arama.");

  /*
   * NIYETE GORE SORGUYU VE KAPSAMI AYARLIYORUZ.
   *
   * Fiyat sorusunda "fiyat" kelimesi sorguda yoksa ekliyoruz: arama
   * motoru aksi halde urunun tanitim sayfasini donduruyor, satis
   * sayfasini degil. Tarif ve "nasil yapilir" sorularinda daha cok
   * kaynak istiyoruz — tek bir ozet bu tur sorulara yetmiyor.
   */
  const tur = niyet(ham);
  const q = tur === "fiyat" && !/fiyat/i.test(ham) ? `${ham} fiyat` : ham;
  const kapsam = tur === "fiyat" ? Math.max(limit, 8)
    : (tur === "tarif" || tur === "nasil") ? Math.max(limit, 6)
    : limit;

  /*
   * TEK KAYNAGA BAGLI KALMIYORUZ.
   *
   * DuckDuckGo'nun HTML ucu tarayici olmayan isteklere sik sik 403
   * veriyor; tek kaynak oldugunda arastirma tamamen calismiyordu.
   * Kaynaklar sirayla deneniyor, ilk cevap veren kazaniyor. Hangisinin
   * cevapladigi da doniyor: bilginin nereden geldigi gorunur olmali.
   */
  const zincir = [
    // Anahtar girilmisse once Google: Turkce sonuclarda ve guncel
    // bilgide digerlerinden acik ara iyi. Anahtar yoksa NOT_APPLICABLE
    // ile kendini atliyor.
    ["Google", () => fromGoogle(q, kapsam, withImages)],
    ["Wikipedia", () => fromWikipedia(q)],
    ["DuckDuckGo anlik cevap", () => fromDdgApi(q)],
    ["DuckDuckGo sonuclari", () => fromDdgHtml(q, kapsam)],
    // HTML ucu 403 verdiginde son sans: ayni motorun sade sayfasi.
    ["DuckDuckGo lite", () => fromDdgLite(q, kapsam)],
  ];

  const denenenler = [];
  /** Kaynaga ULASILDI ama sonuc yoktu — "ag yok" demekten farkli. */
  let ulasildi = false;

  for (const [ad, calistir] of zincir) {
    try {
      const sonuc = await calistir();
      ulasildi = true;
      if (!sonuc.summary && !sonuc.results?.length) continue;

      // Gorseller istenmiyorsa kaynagin verdikleri de gosterilmemeli.
      let gorseller = withImages ? sonuc.images || [] : [];
      if (withImages && !gorseller.length && sonuc.results?.length) {
        const adaylar = sonuc.results.slice(0, 3);
        const bulunan = await Promise.all(adaylar.map((k) => pageImage(k.url)));
        gorseller = bulunan
          .map((src, i) => (src ? { src, site: adaylar[i].site, url: adaylar[i].url } : null))
          .filter(Boolean);
      }

      const kayitlar = (sonuc.results || []).slice(0, kapsam);

      return {
        // Kullaniciya SORDUGU seyi gosteriyoruz; sorguya ekledigimiz
        // kelimeyi degil.
        query: ham,
        provider: sonuc.provider,
        intent: tur,
        summary: sonuc.summary,
        results: kayitlar,
        // Fiyat sorusuysa ucuzdan pahaliya sirali liste.
        prices: tur === "fiyat" ? fiyatListesi(kayitlar) : [],
        images: gorseller.slice(0, 4),
        at: Date.now(),
      };
    } catch (err) {
      // Yapilandirilmamis kaynak HIC DENENMEDI: ne "ulasildi" sayilir
      // ne de denenenler listesine yazilir.
      if (err?.code === "SKIPPED") continue;
      // Kaynaga ulasildi ama sonuc yok / uygun degil: ag sorunu degil.
      if (err?.code === "NO_RESULT" || err?.code === "NOT_APPLICABLE") ulasildi = true;
      denenenler.push(`${ad}: ${err.message}`);
    }
  }

  /*
   * Iki farkli basarisizlik var ve kullaniciya farkli seyler soylemeli:
   *   - Kaynaklara ULASILDI ama sonuc yok  → "bulamadim"
   *   - Hicbirine ulasilamadi              → "internet/guvenlik duvari"
   */
  if (ulasildi) {
    throw Object.assign(
      new Error(`"${ham}" icin bir sey bulamadim.`),
      { code: "NO_RESULT", tried: denenenler },
    );
  }

  throw Object.assign(
    new Error(`Hicbir kaynaga ulasamadim. ${denenenler.join(" | ")}`),
    { code: "NO_SOURCE", tried: denenenler },
  );
}

/**
 * Tek cumlelik yanit (sesli okumak icin).
 *
 * ONEMLI: bu, "arastir ..." komutunun kullandigi yol. Bir donem kendi
 * ayri DuckDuckGo istegini atiyordu ve zincirdeki duzeltmelerden
 * yararlanmiyordu — yani asil arastirma komutu hala 403 aliyordu.
 * Artik ayni zinciri kullaniyor.
 */
export async function search(query) {
  const r = await richSearch(query, { limit: 3, withImages: false });

  if (r.summary) {
    return {
      answer: r.summary.text,
      source: r.summary.source || r.provider,
      url: r.summary.url || null,
      kind: "ozet",
    };
  }

  const ilk = r.results[0];
  return {
    answer: ilk.snippet || ilk.title,
    source: ilk.site || r.provider,
    url: ilk.url,
    kind: "sonuc",
  };
}

export const _internal = {
  parseResults, parseLite, cleanUrl, stripHtml, wikiUygunMu, basligiOrtusuyorMu,
  googleHatasi, fiyatListesi, fiyatYaz,
};
