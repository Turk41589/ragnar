/**
 * Web aramasi (varsayilan olarak KAPALI).
 *
 * DRA'nin geri kalani hicbir dis servise baglanmaz. Bu modul o kuralin
 * tek istisnasi ve ancak kullanici ayarlardan acarsa devreye girer.
 * Istek tarayicidan degil sunucudan gider; boylece tarayici gecmisinize
 * ya da cerezlerinize dokunmaz.
 *
 * DuckDuckGo kullaniliyor: anahtar istemiyor ve arama gecmisi tutmuyor.
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
async function fromWikipedia(q) {
  // Once baslik ariyoruz; dogrudan ozet ucu tam eslesme istiyor.
  const ara = `${ENDPOINTS.wikiSearch}?` + new URLSearchParams({
    action: "query", list: "search", srsearch: q, srlimit: "3",
    format: "json", origin: "*",
  });

  const res = await fetch(ara, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);

  const data = await res.json();
  const bulunan = data?.query?.search || [];
  if (!bulunan.length) throw Object.assign(new Error("yok"), { code: "NO_RESULT" });

  const ozetler = await Promise.all(
    bulunan.slice(0, 3).map(async (k) => {
      try {
        const r = await fetch(ENDPOINTS.wiki + encodeURIComponent(k.title), {
          headers: { "user-agent": UA },
          signal: AbortSignal.timeout(8000),
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
    { headers: { "user-agent": UA }, signal: AbortSignal.timeout(9000) },
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
    results: ilgili.slice(0, 4).map((x) => {
      let site = "duckduckgo.com";
      try {
        site = new URL(x.FirstURL).hostname.replace(/^www\./, "");
      } catch { /* adres bozuksa varsayilan kalsin */ }
      return { title: x.Text.split(" - ")[0], url: x.FirstURL, site, snippet: x.Text };
    }),
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
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    throw new Error(`DuckDuckGo'ya ulasilamadi: ${err.message}`);
  }

  if (!res.ok) throw new Error(`Arama servisi ${res.status} dondu.`);

  const sonuclar = parseResults(await res.text(), limit);
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
  ];

  const denenenler = [];
  for (const [ad, calistir] of zincir) {
    try {
      const sonuc = await calistir();
      if (!sonuc.summary && !sonuc.results?.length) continue;

      // Gorsel yoksa sonuc sayfalarindan onizleme cikarmayi deniyoruz.
      let gorseller = sonuc.images || [];
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
      denenenler.push(`${ad}: ${err.message}`);
    }
  }

  // Hepsi basarisizsa NEDEN oldugunu tasiyoruz; "bulamadim" yetmez.
  throw Object.assign(
    new Error(`Hicbir kaynaga ulasamadim. ${denenenler.join(" | ")}`),
    { code: "NO_SOURCE", tried: denenenler },
  );
}

/**
 * Once "anlik cevap" ucunu dener (tanim, hesaplama, kisa bilgi).
 * Sonuc yoksa HTML sonuc sayfasindan ilk kaydi cikarir.
 */
export async function search(query) {
  const q = (query || "").trim();
  if (!q) throw new Error("Bos arama.");

  // --- 1. Anlik cevap ------------------------------------------------
  try {
    const url =
      "https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=" +
      encodeURIComponent(q);
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const data = await res.json();
      const abstract = (data.AbstractText || "").trim();
      if (abstract) {
        return {
          answer: abstract,
          source: data.AbstractSource || "DuckDuckGo",
          url: data.AbstractURL || null,
          kind: "ozet",
        };
      }
      const topic = (data.RelatedTopics || []).find((t) => t?.Text);
      if (topic) {
        return {
          answer: topic.Text.trim(),
          source: "DuckDuckGo",
          url: topic.FirstURL || null,
          kind: "ilgili",
        };
      }
    }
  } catch {
    /* anlik cevap yoksa sonuc sayfasina duseriz */
  }

  // --- 2. Sonuc sayfasi ----------------------------------------------
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "user-agent": UA,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ q }).toString(),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Arama servisi ${res.status} dondu.`);
  const html = await res.text();

  const title = html.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const snippet = html.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const href = html.match(/class="result__a"\s+href="([^"]+)"/i)?.[1];

  if (!title && !snippet) {
    throw Object.assign(new Error("Sonuc bulunamadi."), { code: "NO_RESULT" });
  }

  return {
    answer: stripHtml(snippet || title),
    source: stripHtml(title || "DuckDuckGo"),
    url: href ? decodeURIComponent(href.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0]) : null,
    kind: "sonuc",
  };
}

/** Testler icin: saf cozumleme islevleri. */
export const _internal = { parseResults, cleanUrl, stripHtml };
