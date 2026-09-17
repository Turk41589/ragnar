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
  wiki: "https://tr.wikipedia.org/api/rest_v1/page/summary/",
  wikiSearch: "https://tr.wikipedia.org/w/api.php",
  ddgApi: "https://api.duckduckgo.com/",
  ddgHtml: "https://html.duckduckgo.com/html/",
  ddgLite: "https://lite.duckduckgo.com/lite/",
};

export function _setEndpointsForTests(next) {
  ENDPOINTS = next ? { ...ENDPOINTS, ...next } : {
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

export async function richSearch(query, { limit = 4, withImages = true } = {}) {
  const q = (query || "").trim();
  if (!q) throw new Error("Bos arama.");

  /*
   * TEK KAYNAGA BAGLI KALMIYORUZ.
   *
   * DuckDuckGo'nun HTML ucu tarayici olmayan isteklere sik sik 403
   * veriyor; tek kaynak oldugunda arastirma tamamen calismiyordu.
   * Kaynaklar sirayla deneniyor, ilk cevap veren kazaniyor. Hangisinin
   * cevapladigi da doniyor: bilginin nereden geldigi gorunur olmali.
   */
  const zincir = [
    ["Wikipedia", () => fromWikipedia(q)],
    ["DuckDuckGo anlik cevap", () => fromDdgApi(q)],
    ["DuckDuckGo sonuclari", () => fromDdgHtml(q, limit)],
    // HTML ucu 403 verdiginde son sans: ayni motorun sade sayfasi.
    ["DuckDuckGo lite", () => fromDdgLite(q, limit)],
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

      return {
        query: q,
        provider: sonuc.provider,
        summary: sonuc.summary,
        results: (sonuc.results || []).slice(0, limit),
        images: gorseller.slice(0, 4),
        at: Date.now(),
      };
    } catch (err) {
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
      new Error(`"${q}" icin bir sey bulamadim.`),
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
};
