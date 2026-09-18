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

  /* ============ NIYET: her soru ayni cevabi hak etmiyor ========== *
   * "En ucuz nerede" diye soran biri ansiklopedi paragrafi degil,
   * SIRALI BIR FIYAT LISTESI bekliyor. "Nasil yapilir" diyen biri tek
   * bir cumle degil, birkac kaynak istiyor.                          */

  t.eq(search.niyet("iphone 15 en ucuz hangi sitede"), "fiyat", "fiyat sorusu taniniyor");
  t.eq(search.niyet("playstation 5 fiyatlari"), "fiyat", "fiyat kelimesi taniniyor");
  t.eq(search.niyet("mercimek corbasi tarifi"), "tarif", "tarif sorusu taniniyor");
  t.eq(search.niyet("kuru fasulye nasil yapilir"), "tarif", "yemek yapimi tarif sayiliyor");
  t.eq(search.niyet("minecraft redstone nasil calisir"), "nasil", "nasil sorusu taniniyor");
  t.eq(search.niyet("eyfel kulesi kac metre"), null, "sradan soru niyetsiz");

  /* --- Turkce fiyat yazimi --- */
  t.eq(search.fiyatBul("1.299,00 TL"), [1299], "binlik nokta, kurus virgul");
  t.eq(search.fiyatBul("₺1.299"), [1299], "TL isareti onde");
  t.eq(search.fiyatBul("12.345,67 ₺"), [12345.67], "kurus okunuyor");
  t.eq(search.fiyatBul("1299 TL"), [1299], "ayracsiz yazim");
  t.eq(search.fiyatBul("5 TL kargo"), [], "cok kucuk tutar fiyat sayilmiyor");
  t.eq(search.fiyatBul("bir sey yok"), [], "tutar yoksa bos");
  t.eq(
    search.fiyatBul("eski fiyat 1.500 TL, indirimli 1.199,90 TL").sort((a, b) => a - b),
    [1199.9, 1500],
    "birden fazla tutar cikariliyor",
  );

  /* --- fiyat sorusu: sorguya "fiyat" ekleniyor, liste siralaniyor --- */

  const dukkan = await startFake((url, res) => {
    if (url.pathname !== "/google") return json(res, 404, {});
    if (url.searchParams.get("searchType") === "image") return json(res, 200, { items: [] });
    return json(res, 200, {
      items: [
        { title: "iPhone 15 128GB", link: "https://pahali.com/a", snippet: "54.999,00 TL" },
        { title: "iPhone 15 128GB", link: "https://ucuz.com/b", snippet: "49.250 TL kargo bedava" },
        { title: "iPhone 15 kilif", link: "https://orta.com/c", snippet: "Fiyati 51.400,50 TL" },
        { title: "iPhone 15 inceleme", link: "https://blog.com/d", snippet: "fiyat bilgisi yok" },
      ],
    });
  });

  try {
    search.configureGoogle({ key: "K", cx: "C" });
    search._setEndpointsForTests({
      google: `${dukkan.base}/google`,
      wikiSearch: "http://127.0.0.1:1/", wiki: "http://127.0.0.1:1/",
      ddgApi: "http://127.0.0.1:1/", ddgHtml: "http://127.0.0.1:1/", ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("iphone 15 en ucuz hangi sitede", { withImages: false });

    t.eq(r.intent, "fiyat", "sonuc niyeti tasiyor");
    t.eq(r.prices.length, 3, "fiyati okunabilen her sonuc listede");
    t.eq(r.prices[0].site, "ucuz.com", "EN UCUZ basta");
    t.eq(r.prices[0].price, 49250, "en ucuz tutar dogru");
    t.eq(r.prices[2].site, "pahali.com", "en pahali sonda");
    t.has(r.prices[0].priceText, "49.250", "tutar Turkce bicimde yaziliyor");
    t.ok(
      !r.prices.some((k) => k.site === "blog.com"),
      "fiyati olmayan sonuc listeye girmiyor",
    );

    // Sorguya "fiyat" eklenmeli: aksi halde arama motoru tanitim
    // sayfasini donduruyor, satis sayfasini degil.
    const istek = dukkan.kayit.find((k) => k.path === "/google" && !k.query.searchType);
    t.has(istek.query.q, "fiyat", "sorguya fiyat kelimesi ekleniyor");

    // Kullaniciya SORDUGU sey gosterilmeli, bizim ekledigimiz kelime degil.
    t.eq(r.query, "iphone 15 en ucuz hangi sitede", "ekranda kullanicinin sorusu yaziyor");

    // Fiyat sorusunda daha genis kapsam isteniyor.
    t.ok(Number(istek.query.num) >= 8, "fiyat sorusunda daha cok sonuc isteniyor");
  } finally {
    dukkan.server.close();
    search.configureGoogle({});
  }

  /* --- tarif sorusu: daha cok kaynak, fiyat listesi YOK --- */

  const mutfak = await startFake((url, res) => {
    if (url.pathname !== "/google") return json(res, 404, {});
    if (url.searchParams.get("searchType") === "image") return json(res, 200, { items: [] });
    return json(res, 200, {
      items: Array.from({ length: 6 }, (_, i) => ({
        title: `Mercimek corbasi tarifi ${i + 1}`,
        link: `https://tarif${i}.com/a`,
        snippet: "Malzemeler: kirmizi mercimek, sogan…",
      })),
    });
  });

  try {
    search.configureGoogle({ key: "K", cx: "C" });
    search._setEndpointsForTests({
      google: `${mutfak.base}/google`,
      wikiSearch: "http://127.0.0.1:1/", wiki: "http://127.0.0.1:1/",
      ddgApi: "http://127.0.0.1:1/", ddgHtml: "http://127.0.0.1:1/", ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("mercimek corbasi tarifi", { limit: 4, withImages: false });
    t.eq(r.intent, "tarif", "tarif niyeti tasiniyor");
    t.eq(r.prices.length, 0, "tarif sorusunda fiyat listesi yok");
    t.ok(r.results.length >= 6, `tarif sorusunda daha cok kaynak geliyor (${r.results.length})`);

    const istek = mutfak.kayit.find((k) => k.path === "/google" && !k.query.searchType);
    t.ok(!/fiyat/.test(istek.query.q), "tarif sorgusuna fiyat kelimesi EKLENMIYOR");
  } finally {
    mutfak.server.close();
    search.configureGoogle({});
  }

  /* ============ 0. GOOGLE — anahtar varsa ONCE o ================= *
   * Google arama SAYFASI otomatik isteklere kapali (CAPTCHA / 403).
   * Resmi yol Programmable Search JSON API ve kendi anahtarini
   * istiyor. Anahtar YOKSA bu kaynak zincire hic girmemeli; uygulama
   * anahtarsiz da calismaya devam etmeli.                            */

  // --- anahtar yokken: Google HIC cagrilmamali ---
  const anahtarsiz = await startFake((url, res) => {
    if (url.pathname === "/google") return json(res, 200, { items: [] });
    if (url.pathname === "/w/api.php") {
      return json(res, 200, { query: { search: [{ title: "Kedi" }] } });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      return json(res, 200, { title: "Kedi", extract: "Kedi bir hayvandir." });
    }
    return json(res, 404, {});
  });

  try {
    search.configureGoogle({});
    t.eq(search.googleStatus().ready, false, "anahtarsizken Google hazir degil");

    search._setEndpointsForTests({
      google: `${anahtarsiz.base}/google`,
      wikiSearch: `${anahtarsiz.base}/w/api.php`,
      wiki: `${anahtarsiz.base}/page/summary/`,
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("kedi", { withImages: false });
    t.eq(r.provider, "Wikipedia", "anahtar yokken zincir Wikipedia'dan devam ediyor");
    t.ok(
      !anahtarsiz.kayit.some((k) => k.path === "/google"),
      "anahtar yokken Google ucuna HIC gidilmiyor",
    );

    // Yapilandirilmamis kaynak "denendi" SAYILMAMALI. Sayilsaydi, ag
    // tamamen koptugunda kullaniciya "bulamadim" denirdi — oysa sorun
    // bulamamak degil, hicbir yere ulasamamak.
    search._setEndpointsForTests({
      google: "http://127.0.0.1:1/",
      wikiSearch: "http://127.0.0.1:1/",
      wiki: "http://127.0.0.1:1/",
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });
    let kopuk = null;
    try {
      await search.richSearch("hicbir sey", { withImages: false });
    } catch (err) {
      kopuk = err;
    }
    t.eq(kopuk?.code, "NO_SOURCE", "anahtarsiz Google ag hatasini maskelemiyor");
    t.eq(kopuk?.tried?.length, 4, "atlanan kaynak denenenler listesine yazilmiyor");
  } finally {
    anahtarsiz.server.close();
  }

  // --- anahtar varken: Google ONCE ve gorselleriyle ---
  const gugil = await startFake((url, res) => {
    if (url.pathname !== "/google") return json(res, 404, {});

    // Gorsel aramasi ayri bir cagri: searchType=image
    if (url.searchParams.get("searchType") === "image") {
      return json(res, 200, {
        items: [
          { link: "https://foto.com/eyfel1.jpg", displayLink: "foto.com",
            image: { contextLink: "https://foto.com/sayfa" } },
          { link: "https://foto.com/eyfel2.jpg", displayLink: "foto.com" },
          // Sema dogrulanmali: bu elenmeli.
          { link: "javascript:alert(1)", displayLink: "kotu" },
        ],
      });
    }

    return json(res, 200, {
      items: [
        { title: "Eyfel Kulesi", link: "https://vikipedi.org/eyfel",
          snippet: "Eyfel Kulesi 330 metre yuksekligindedir." },
        { title: "Eyfel hakkinda", link: "https://gezi.com/eyfel", snippet: "Paris'in simgesi." },
        // Ayni siteden ikinci kayit elenmeli (cesitlilik).
        { title: "Eyfel 2", link: "https://gezi.com/eyfel-2", snippet: "ikinci" },
      ],
    });
  });

  try {
    const durum = search.configureGoogle({ key: "GIZLI-ANAHTAR", cx: "arama-kimligi" });
    t.eq(durum.ready, true, "anahtar girilince Google hazir");
    t.ok(!("key" in durum), "anahtarin kendisi durum bilgisinde tasinmiyor");

    search._setEndpointsForTests({
      google: `${gugil.base}/google`,
      // Digerleri kasten BOZUK: Google cevap verirken denenmemeliler.
      wikiSearch: "http://127.0.0.1:1/",
      wiki: "http://127.0.0.1:1/",
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("eyfel kulesi kac metre", { limit: 4, withImages: true });
    t.eq(r.provider, "Google", "anahtar varsa ONCE Google");
    t.has(r.summary.text, "330 metre", "ilk sonucun ozeti cevap oluyor");
    t.eq(r.summary.source, "vikipedi.org", "cevabin KAYNAGI soyleniyor");
    t.eq(r.results.length, 2, "ayni siteden tekrar eden sonuc eleniyor");
    t.eq(r.results[0].url, "https://vikipedi.org/eyfel", "kaynak bagi dogru");

    // Gorseller: og:image tahmini degil, GERCEK gorsel aramasi.
    t.eq(r.images.length, 2, "gorsel aramasindan gorsel geliyor");
    t.eq(r.images[0].src, "https://foto.com/eyfel1.jpg", "gorsel adresi dogru");
    t.ok(
      !r.images.some((g) => g.src.startsWith("javascript")),
      "gorsel adresinde de sema dogrulaniyor",
    );

    // Istek gercekten dogru kuruldu mu?
    const istek = gugil.kayit.find((k) => k.path === "/google" && !k.query.searchType);
    t.eq(istek.query.key, "GIZLI-ANAHTAR", "anahtar istege konuyor");
    t.eq(istek.query.cx, "arama-kimligi", "arama motoru kimligi gonderiliyor");
    t.eq(istek.query.hl, "tr", "Turkce sonuc isteniyor");
    t.eq(istek.query.gl, "tr", "Turkiye bolgesi isteniyor");

    const gorselIstek = gugil.kayit.find((k) => k.query.searchType === "image");
    t.ok(gorselIstek, "gorseller icin ayri bir arama yapiliyor");
    t.eq(gorselIstek.query.safe, "active", "gorsel aramasinda guvenli kip acik");

    // withImages:false ise gorsel aramasi da YAPILMAMALI — bosu bosuna
    // kotadan sorgu harcamanin anlami yok.
    gugil.kayit.length = 0;
    await search.richSearch("eyfel", { withImages: false });
    t.ok(
      !gugil.kayit.some((k) => k.query.searchType === "image"),
      "gorsel istenmiyorsa gorsel aramasi yapilmiyor (kota harcanmiyor)",
    );
  } finally {
    gugil.server.close();
  }

  // --- kota dolunca anlasilir hata ve ZINCIR DEVAM ETMELI ---
  const kota = await startFake((url, res) => {
    if (url.pathname === "/google") {
      return json(res, 403, { error: { message: "Quota exceeded for quota metric" } });
    }
    if (url.pathname === "/w/api.php") {
      return json(res, 200, { query: { search: [{ title: "Eyfel Kulesi" }] } });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      return json(res, 200, { title: "Eyfel Kulesi", extract: "Paris'te bir kule." });
    }
    return json(res, 404, {});
  });

  try {
    search.configureGoogle({ key: "K", cx: "C" });
    search._setEndpointsForTests({
      google: `${kota.base}/google`,
      wikiSearch: `${kota.base}/w/api.php`,
      wiki: `${kota.base}/page/summary/`,
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("eyfel kulesi", { withImages: false });
    t.eq(r.provider, "Wikipedia", "Google kotasi dolunca zincir DURMUYOR, devam ediyor");

    // Kullanici ne oldugunu anlamali.
    t.has(
      search._internal.googleHatasi(403, JSON.stringify({ error: { message: "Quota exceeded" } })),
      "kota",
      "kota hatasi anlasilir Turkce veriyor",
    );
    t.has(
      search._internal.googleHatasi(400, JSON.stringify({ error: { message: "Invalid cx value" } })),
      "cx",
      "yanlis arama motoru kimligi soyleniyor",
    );
  } finally {
    kota.server.close();
    search.configureGoogle({});
  }

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
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("istanbul", { limit: 3, withImages: true });
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
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("bir sey", { limit: 4, withImages: true });
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
      ddgLite: `${html.base}/html`,
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

  /* ============ 3a. HTML ucu de 403 verirse LITE sayfasi ========= *
   * Kullanicida arastirma hic calismiyordu: html.duckduckgo.com
   * tarayici olmayan isteklere 403 veriyor. Lite ucu ayni motorun sade
   * sayfasi ve genelde bu engeli uygulamiyor. Adres tanimliydi ama
   * hicbir yerde kullanilmiyordu.                                     */

  const lite = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") return json(res, 500, {});
    if (url.pathname === "/ddg") return json(res, 403, {});
    if (url.pathname === "/html") return json(res, 403, {});
    if (url.pathname === "/lite") {
      res.writeHead(200, { "content-type": "text/html" });
      // Lite sayfasinin gercek duzeni: tablo + result-link / result-snippet.
      return res.end(`
        <table>
        <tr><td>1.&nbsp;</td><td>
          <a rel="nofollow" href="https://bir.com/a" class='result-link'>Birinci baslik</a>
        </td></tr>
        <tr><td></td><td class='result-snippet'>birinci lite ozet</td></tr>
        <tr><td>2.&nbsp;</td><td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fiki.com%2Fb" class="result-link">Ikinci baslik</a>
        </td></tr>
        <tr><td></td><td class="result-snippet">ikinci lite ozet</td></tr>
        <tr><td>3.&nbsp;</td><td>
          <a rel="nofollow" href="https://bir.com/c" class='result-link'>Ayni siteden</a>
        </td></tr>
        <tr><td></td><td class='result-snippet'>ucuncu lite ozet</td></tr>
        </table>
      `);
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${lite.base}/w/api.php`,
      wiki: `${lite.base}/page/summary/`,
      ddgApi: `${lite.base}/ddg`,
      ddgHtml: `${lite.base}/html`,
      ddgLite: `${lite.base}/lite`,
    });

    const r = await search.richSearch("lite sorgusu", { limit: 4, withImages: false });
    t.eq(r.results.length, 2, "HTML ucu 403 verince lite sayfasi devreye giriyor");
    t.eq(r.results[0].url, "https://bir.com/a", "dogrudan adres oldugu gibi aliniyor");
    t.eq(r.results[0].snippet, "birinci lite ozet", "ozet-kaynak eslesmesi dogru");
    t.eq(r.results[1].url, "https://iki.com/b", "yonlendirme adresi cozuluyor");
    t.ok(
      !r.results.some((k, i) => r.results.findIndex((x) => x.site === k.site) !== i),
      "ayni siteden tekrar eden kayit elenmis",
    );

    // Lite'a gercekten tarayici gibi gidilmeli; ciplak istek engelleniyor.
    const istek = lite.kayit.find((k) => k.path === "/lite");
    t.has(istek.headers["user-agent"] || "", "Mozilla", "lite'a tarayici kimligi gonderiliyor");
    t.has(istek.govde, "lite+sorgusu", "sorgu govdede gidiyor");

    // Siralama: lite ancak HTML ucu denendikten SONRA gelmeli.
    const sira = lite.kayit.map((k) => k.path);
    t.ok(sira.indexOf("/html") < sira.indexOf("/lite"), "lite son sirada deneniyor");
  } finally {
    lite.server.close();
  }

  /* ============ 3b. Wikipedia HER SORGUYU kapmamali ============== */

  // `list=search` neredeyse her sorguya bir baslik donduruyor. Zincirde
  // ilk sirada oldugu icin "bugun hava nasil" sorusuna ansiklopedinin
  // "Hava" maddesi donuyordu.
  const guncel = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") {
      return json(res, 200, { query: { search: [{ title: "Hava" }] } });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      return json(res, 200, { title: "Hava", extract: "Hava, gazlarin karisimidir." });
    }
    if (url.pathname === "/ddg") {
      return json(res, 200, {
        AbstractText: "Bugun parcali bulutlu.",
        AbstractSource: "Hava Servisi",
        RelatedTopics: [],
      });
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${guncel.base}/w/api.php`,
      wiki: `${guncel.base}/page/summary/`,
      ddgApi: `${guncel.base}/ddg`,
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const r = await search.richSearch("bugun hava nasil", { withImages: false });
    t.eq(r.provider, "DuckDuckGo", "guncel bilgi sorusu Wikipedia'ya gitmiyor");
    t.has(r.summary.text, "parcali bulutlu", "guncel cevap aliniyor");
    t.ok(
      !guncel.kayit.some((k) => k.path === "/w/api.php"),
      "guncel soruda Wikipedia HIC sorulmuyor",
    );

    // Alakasiz baslik donerse de Wikipedia kabul edilmemeli.
    guncel.kayit.length = 0;
    t.eq(
      search._internal.basligiOrtusuyorMu("kuantum bilgisayar", "Kedi"),
      false,
      "alakasiz baslik eleniyor",
    );
    t.eq(
      search._internal.basligiOrtusuyorMu("fotosentez nedir", "Fotosentez"),
      true,
      "ilgili baslik kabul ediliyor",
    );
  } finally {
    guncel.server.close();
  }

  /* ============ 3c. "arastir" KOMUTU da ayni zinciri kullanmali === */

  // Bir donem search() kendi ayri istegini atiyordu: zincirdeki
  // duzeltmelerden yararlanmiyor, asil arastirma komutu hala 403
  // aliyordu.
  const komut = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") {
      return json(res, 200, { query: { search: [{ title: "Fotosentez" }] } });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      return json(res, 200, {
        title: "Fotosentez",
        extract: "Fotosentez, bitkilerin isigi kullanmasidir.",
        content_urls: { desktop: { page: "https://tr.wikipedia.org/wiki/Fotosentez" } },
      });
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${komut.base}/w/api.php`,
      wiki: `${komut.base}/page/summary/`,
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const tek = await search.search("fotosentez nedir");
    t.has(tek.answer, "bitkilerin isigi", "arastir komutu da zinciri kullaniyor");
    t.eq(tek.source, "Wikipedia", "kaynak bildiriliyor");
    t.has(tek.url || "", "wikipedia.org", "kaynak bagi veriliyor");
  } finally {
    komut.server.close();
  }

  /* ============ 3d. Sonuc yok ile ULASILAMADI ayri seyler ======== */

  const bos = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") return json(res, 200, { query: { search: [] } });
    if (url.pathname === "/ddg") {
      return json(res, 200, { AbstractText: "", RelatedTopics: [] });
    }
    if (url.pathname === "/html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html>bos</html>");
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${bos.base}/w/api.php`,
      wiki: `${bos.base}/page/summary/`,
      ddgApi: `${bos.base}/ddg`,
      ddgHtml: `${bos.base}/html`,
      ddgLite: `${bos.base}/html`,
    });

    let h = null;
    try {
      await search.richSearch("olmayan bir sey", { withImages: false });
    } catch (err) {
      h = err;
    }
    // Kaynaklara ULASILDI ama sonuc yok: "internetini kontrol et" demek yanlis.
    t.eq(h?.code, "NO_RESULT", "ulasilip sonuc bulunamayinca NO_RESULT");
    t.has(h?.message || "", "bulamadim", "dogru mesaj veriliyor");
    t.ok(
      !/ulasamadim/.test(h?.message || ""),
      "ag sorunu varmis gibi soylenmiyor",
    );
  } finally {
    bos.server.close();
  }

  /* ============ 3e. withImages: false gorselleri bastirmali ====== */

  const gorselli = await startFake((url, res) => {
    if (url.pathname === "/w/api.php") {
      return json(res, 200, { query: { search: [{ title: "Kedi" }] } });
    }
    if (url.pathname.startsWith("/page/summary/")) {
      return json(res, 200, {
        title: "Kedi", extract: "Kedi bir hayvandir.",
        thumbnail: { source: "https://ornek/kedi.jpg" },
      });
    }
    return json(res, 404, {});
  });

  try {
    search._setEndpointsForTests({
      wikiSearch: `${gorselli.base}/w/api.php`,
      wiki: `${gorselli.base}/page/summary/`,
      ddgApi: "http://127.0.0.1:1/",
      ddgHtml: "http://127.0.0.1:1/",
      ddgLite: "http://127.0.0.1:1/",
    });

    const kapali = await search.richSearch("kedi", { withImages: false });
    t.eq(kapali.images.length, 0, "withImages:false kaynak gorsellerini de bastiriyor");

    const acik = await search.richSearch("kedi", { withImages: true });
    t.eq(acik.images.length, 1, "withImages:true gorseli veriyor");
  } finally {
    gorselli.server.close();
  }

  /* ============ 4. Hicbiri yoksa SEBEP soyleniyor ================ */

  search._setEndpointsForTests({
    wikiSearch: "http://127.0.0.1:1/",
    wiki: "http://127.0.0.1:1/",
    ddgApi: "http://127.0.0.1:1/",
    ddgHtml: "http://127.0.0.1:1/",
    ddgLite: "http://127.0.0.1:1/",
  });

  let hata = null;
  try {
    await search.richSearch("hicbir sey", { withImages: false });
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NO_SOURCE", "hepsi basarisizsa ayri bir hata kodu");
  t.ok(Array.isArray(hata?.tried) && hata.tried.length === 4, "denenen kaynaklar sayiliyor");
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
