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
