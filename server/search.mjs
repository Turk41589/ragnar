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
export async function richSearch(query, { limit = 4, withImages = true } = {}) {
  const q = (query || "").trim();
  if (!q) throw new Error("Bos arama.");

  let ozet = null;
  let ozetGorsel = null;

  // Anlik cevap varsa en uste koyuyoruz.
  try {
    const res = await fetch(
      "https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=" +
        encodeURIComponent(q),
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(9000) },
    );
    if (res.ok) {
      const data = await res.json();
      if ((data.AbstractText || "").trim()) {
        ozet = {
          text: data.AbstractText.trim(),
          source: data.AbstractSource || "DuckDuckGo",
          url: data.AbstractURL || null,
        };
      }
      if (data.Image) {
        ozetGorsel = data.Image.startsWith("http")
          ? data.Image
          : `https://duckduckgo.com${data.Image}`;
      }
    }
  } catch {
    /* anlik cevap yoksa sonuclarla devam */
  }

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

  const sonuclar = parseResults(await res.text(), limit);
  if (!sonuclar.length && !ozet) {
    throw Object.assign(new Error("Sonuc bulunamadi."), { code: "NO_RESULT" });
  }

  // Gorseller: ilk uc sonuc icin, hepsi ayni anda ve basarisizlik
  // aramanin tamamini dusurmeden.
  let gorseller = [];
  if (withImages) {
    const adaylar = sonuclar.slice(0, 3);
    const bulunan = await Promise.all(adaylar.map((k) => pageImage(k.url)));
    gorseller = bulunan
      .map((src, i) => (src ? { src, site: adaylar[i].site, url: adaylar[i].url } : null))
      .filter(Boolean);
    if (ozetGorsel) gorseller.unshift({ src: ozetGorsel, site: ozet?.source || "DuckDuckGo" });
  }

  return { query: q, summary: ozet, results: sonuclar, images: gorseller, at: Date.now() };
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
