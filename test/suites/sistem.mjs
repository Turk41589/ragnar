/**
 * Sunucu yetenekleri: guvenlik korumasi, uygulama tarama/baslatma,
 * web aramasi anahtari ve Kick koprusu.
 *
 * Sunucu artik program calistirabildigi icin guvenlik testleri en
 * onemlileri: yalnizca kendi sayfamiz, yalnizca gecerli jetonla.
 */

import { openApp } from "../helpers.mjs";

export const name = "Sunucu yetenekleri";

export async function run(page, base, t) {
  /* ------------------------------------------------------- guvenlik --- */
  // Bu istekler Node'dan atiliyor; tarayici korumalari devrede degil,
  // yani sunucunun kendi denetimi tek savunma hatti.
  const health = await (await fetch(`${base}/api/health`)).json();
  t.ok(typeof health.token === "string" && health.token.length > 20, "oturum jetonu uretiliyor");

  const attempt = async (headers, body = {}) => {
    const res = await fetch(`${base}/api/apps/scan`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const json = { "content-type": "application/json" };
  const good = { ...json, "x-dra-token": health.token };

  t.eq((await attempt(json)).status, 403, "jetonsuz istek reddediliyor");
  t.eq(
    (await attempt({ ...good, origin: "https://kotu.example" })).status,
    403,
    "yabanci kokenli istek reddediliyor",
  );
  t.eq(
    (await attempt({ ...good, "sec-fetch-site": "cross-site" })).status,
    403,
    "capraz site istegi reddediliyor",
  );
  t.eq(
    (await attempt({ "content-type": "text/plain", "x-dra-token": health.token })).status,
    403,
    "form/duz metin istegi reddediliyor",
  );

  /* --------------------------------------------------- uygulamalar ---- */
  const scan = await attempt(good);
  t.eq(scan.status, 200, "gecerli jetonla tarama calisiyor");
  t.ok(Array.isArray(scan.data.apps), "tarama uygulama listesi donduruyor");

  // Listede olmayan bir kayit ASLA calistirilamamali.
  const bogus = await fetch(`${base}/api/apps/launch`, {
    method: "POST",
    headers: good,
    body: JSON.stringify({ id: "app-yok-boyle" }),
  });
  const bogusData = await bogus.json();
  t.eq(bogusData.ok, false, "listede olmayan uygulama baslatilamiyor");
  t.has(bogusData.error, "listede yok", "reddetme sebebi acik");

  // Kabuk enjeksiyonu denemesi de ayni sekilde reddedilmeli.
  const inject = await fetch(`${base}/api/apps/launch`, {
    method: "POST",
    headers: good,
    body: JSON.stringify({ id: "app-0; rm -rf /tmp/dra-test" }),
  });
  t.eq((await inject.json()).ok, false, "kimlik alanina komut enjekte edilemiyor");

  /* --------------------------------------------------------- arama ---- */
  const searchOff = await fetch(`${base}/api/search`, {
    method: "POST",
    headers: good,
    body: JSON.stringify({ query: "test" }),
  });
  const searchOffData = await searchOff.json();
  t.eq(searchOffData.ok, false, "arama varsayilan olarak kapali");
  t.has(searchOffData.error, "kapali", "kapali oldugu soyleniyor");

  /* ---------------------------------------------------------- kick ---- */
  const kickNoToken = await fetch(`${base}/api/kick/action`, {
    method: "POST",
    headers: good,
    body: JSON.stringify({ action: "ban", args: ["biri"] }),
  });
  const kickData = await kickNoToken.json();
  t.eq(kickData.ok, false, "jetonsuz Kick islemi reddediliyor");

  const kickBadAction = await fetch(`${base}/api/kick/action`, {
    method: "POST",
    headers: good,
    body: JSON.stringify({ action: "surecCalistir", args: [] }),
  });
  t.has(
    (await kickBadAction.json()).error,
    "Bilinmeyen",
    "tanimsiz moderasyon islemi reddediliyor",
  );

  /* ----------------------------------------------- komut yonlendirme -- */
  await openApp(page, base);

  const routing = await page.evaluate(async () => {
    const { explain } = await import("/js/commands.js");

    // Yetenekler KAPALIYKEN: bu komutlar devreye girmemeli.
    const kapali = {
      findApp: () => null,
      searchEnabled: () => false,
      kickReady: () => false,
    };
    // Yetenekler ACIKKEN
    const acik = {
      findApp: (q) => (/spotify|valorant/i.test(q) ? { app: { id: "x", name: "Spotify" }, score: 1 } : null),
      searchEnabled: () => true,
      kickReady: () => true,
    };

    const top = (text, ctx) => {
      const r = explain(text, 1, ctx)[0];
      return r && r.score >= 0.62 ? r.name : null;
    };

    return {
      kapaliUygulama: top("spotify ac", kapali),
      acikUygulama: top("spotify ac", acik),
      acikKapat: top("spotify kapat", acik),
      kapaliMod: top("ahmeti banla", kapali),
      acikMod: top("ahmeti banla", acik),
      acikSustur: top("ahmeti 10 dakika sustur", acik),
      acikYaz: top("sohbete yaz merhaba", acik),
      kapaliArama: top("arastir istanbul nufusu", kapali),
      acikArama: top("arastir istanbul nufusu", acik),
      // Yetenekler acikken bile normal komutlar bozulmamali
      saat: top("saat kac", acik),
      alarm: top("sabah yedi bucukta alarm kur", acik),
    };
  });

  t.eq(routing.kapaliUygulama, "site-ac", "uygulama listesi yokken site acma calisiyor");
  t.eq(routing.acikUygulama, "uygulama-ac", "kurulu uygulama varsa o baslatiliyor");
  t.eq(routing.acikKapat, "uygulama-kapat", "uygulama kapatma yonlendiriliyor");
  t.eq(routing.kapaliMod, null, "yayinci destegi kapaliyken moderasyon calismiyor");
  t.eq(routing.acikMod, "mod-banla", "yayinci destegi acikken banlama calisiyor");
  t.eq(routing.acikSustur, "mod-sustur", "susturma yonlendiriliyor");
  t.eq(routing.acikYaz, "mod-yaz", "sohbete yazma yonlendiriliyor");
  // Arama kapaliyken "arastir ..." komutsuz kalmaz: tarayicida arama
  // sayfasini acar. Kademeli geri cekilme bilincli bir tercih.
  t.eq(routing.kapaliArama, "arama", "arama kapaliyken tarayicida arama sayfasi aciliyor");
  t.eq(routing.acikArama, "web-arama", "arama acikken arama komutu calisiyor");
  t.eq(routing.saat, "saat", "yeni yetenekler saat komutunu bozmuyor");
  t.eq(routing.alarm, "alarm-kur", "yeni yetenekler alarm komutunu bozmuyor");

  /* --------------------------------------------------- ayar aray uzu -- */
  await page.click("#btn-manual-wake");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.click('.tab[data-tab="ayar"]');
  await page.waitForTimeout(200);

  t.eq(
    await page.locator("#set-search").getAttribute("aria-checked"),
    "false",
    "web aramasi varsayilan kapali",
  );
  t.eq(
    await page.locator("#set-streamer").getAttribute("aria-checked"),
    "false",
    "yayinci destegi varsayilan kapali",
  );
  t.ok(await page.locator("#kick-fields").isHidden(), "Kick alanlari kapaliyken gizli");

  await page.click("#set-streamer");
  await page.waitForTimeout(250);
  t.ok(await page.locator("#kick-fields").isVisible(), "yayinci destegi acilinca alanlar gorunuyor");
}
