/**
 * Arastirma: kaynak zinciri.
 *
 * Tek kaynaga bagli kalmak kirilgan — DuckDuckGo'nun HTML ucu tarayici
 * olmayan isteklere sik sik 403 veriyor ve arastirma tamamen
 * calismiyordu. Burada kaynaklarin SIRAYLA denendigi ve ilk cevap
 * verenin kazandigi, gercek HTTP sunuculariyla dogrulaniyor.
 */

import { createServer } from "node:http";

export const name = "Arastirma kaynaklari";
export const standalone = true;

/** Istenen davranisi taklit eden kucuk bir sunucu. */
function startFake(handler) {
  const kayit = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const govde = await new Promise((r) => {
      const p = [];
      req.on("data", (c) => p.push(c));
      req.on("end", () => r(Buffer.concat(p).toString("utf8")));
    });
    kayit.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), govde,
      headers: req.headers });
    handler(url, res, govde);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, kayit, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const json = (res, kod, nesne) => {
  res.writeHead(kod, { "content-type": "application/json" });
  res.end(JSON.stringify(nesne));
};

export async function run(_page, _base, t) {
  const search = await import("../../server/search.mjs");

  /* ============ 1. Wikipedia calisiyorsa ONDAN cevap ============= */

  const hepsi = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") {
      return json(res, 200, {
        query: { search: [{ title: "İstanbul" }, { title: "İstanbul Boğazı" }] },
      });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      const ad = decodeURIComponent(url.pathname.split("/").pop());
      return json(res, 200, {
        title: ad,
        extract: `${ad} hakkinda ozet metin.`,
        content_urls: { desktop: { page: `https://tr.wikipedia.org/wiki/${ad}` } },
        thumbnail: { source: "https://ornek/resim.jpg" },
      });
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wiki: `${hepsi.base}/page/summary/`,
      wikiSearch: `${hepsi.base}/w/api.php`,
      // Digerleri kasten BOZUK: Wikipedia cevap verirken hic
      // denenmemeleri gerekiyor.
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("istanbul", { limit: 3, withImages: false });
    t.eq(r.provider, "Wikipedia", "ilk kaynak Wikipedia");
    t.has(r.summary.text, "ozet metin", "ozet donuyor");
    t.eq(r.results.length, 2, "kaynaklar listeleniyor");
    t.has(r.results[0].url, "wikipedia.org", "kaynak bagi veriliyor");
    t.eq(r.images.length, 2, "gorseller geliyor");
    t.eq(r.query, "istanbul", "sorgu taşiniyor");

    // Wikipedia cevap verdiyse digerlerine HIC gidilmemeli.
    t.ok(
      hepsi.kayit.some((k) => k.path === "/w/api.php"),
      "Wikipedia gercekten soruldu",
    );
  } finally {
    hepsi.server.close();
  }

  /* ============ 2. Wikipedia YOKSA DuckDuckGo'ya dusuyor ========= */

  const ddg = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") return json(res, 500, {});
    if (url.pathname === "/ddg") {
      return json(res, 200, {
        AbstractText: "DuckDuckGo ozeti.",
        AbstractSource: "Vikipedi",
        AbstractURL: "https://ornek.com/a",
        Image: "/i/resim.png",
        RelatedTopics: [
          { Text: "Birinci - aciklama", FirstURL: "https://bir.com/a" },
          { Text: "Ikinci - aciklama", FirstURL: "https://iki.com/b" },
        ],
      });
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${ddg.base}/w/api.php`,
      wiki: `${ddg.base}/page/summary/`,
      ddgApi: `${ddg.base}/ddg`,
      ddgHtml: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("bir sey", { limit: 4, withImages: false });
    t.eq(r.provider, "DuckDuckGo", "Wikipedia patlayinca DuckDuckGo'ya dusuyor");
    t.has(r.summary.text, "DuckDuckGo ozeti", "yedek kaynagin ozeti aliniyor");
    t.eq(r.results.length, 2, "ilgili basliklar kaynak oluyor");
    t.has(r.images[0].src, "duckduckgo.com", "goreli gorsel adresi tamamlaniyor");
  } finally {
    ddg.server.close();
  }

  /* ============ 3. Ikisi de yoksa HTML sonuc sayfasi ============= */

  const html = await startFake((url, res, govde) => {
    if (url.pathname === "/w/api.php") return json(res, 500, {});
    if (url.pathname === "/ddg") return json(res, 403, {});
    if (url.pathname === "/html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbir.com%2Fa">Birinci</a>
        <a class="result__snippet">birinci ozet</a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fiki.com%2Fb">Ikinci</a>
        <a class="result__snippet">ikinci ozet</a>
      `);
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${html.base}/w/api.php`,
      wiki: `${html.base}/page/summary/`,
      ddgApi: `${html.base}/ddg`,
      ddgHtml: `${html.base}/html`,
    });

    const r = await search.richSearch("baska sey", { limit: 4, withImages: false });
    t.eq(r.results.length, 2, "son care HTML sayfasi calisiyor");
    t.eq(r.results[0].snippet, "birinci ozet", "ozet-kaynak eslesmesi dogru");

    // Ciplak istekler 403 aliyor; tarayici basliklari gonderilmeli.
    const istek = html.kayit.find((k) => k.path === "/html");
    t.has(istek.headers["user-agent"] || "", "Mozilla", "tarayici kimligi gonderiliyor");
    t.ok(istek.headers.referer, "referer gonderiliyor (403'u onlemek icin)");
    t.has(istek.govde, "baska+sey", "sorgu govdede gidiyor");
  } finally {
    html.server.close();
  }

  /* ============ 4. Hicbiri yoksa SEBEP soyleniyor ================ */

  search._setEndpointsForTests({
    wikiSearch: "http://127.0.0.1:1/",
    wiki: "http://127.0.0.1:1/",
    ddgApi: "http://127.0.0.1:1/",
    ddgHtml: "http://127.0.0.1:1/",
  });

  let hata = null;
  try {
    await search.richSearch("hicbir sey", { withImages: false });
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NO_SOURCE", "hepsi basarisizsa ayri bir hata kodu");
  t.ok(Array.isArray(hata?.tried) && hata.tried.length === 3, "denenen kaynaklar sayiliyor");
  t.has(hata?.message || "", "Wikipedia", "hangi kaynaklarin denendigi yaziyor");

  // Bos sorgu hicbir kaynaga gitmemeli.
  hata = null;
  try {
    await search.richSearch("   ");
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "Bos arama", "bos sorgu reddediliyor");

  search._setEndpointsForTests(null);
}
