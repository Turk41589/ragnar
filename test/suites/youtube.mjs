/**
 * YouTube: stok video deposu + OAuth + yukleme.
 *
 * Google hesabi olmadan da akisin tamami sinanabilir: asagida Google'in
 * uclarini taklit eden GERCEK bir HTTP sunucusu var. Boylece "dogru uca
 * mi gidiyor", "jetonu nereye koyuyor", "devam ettirilebilir yuklemenin
 * iki adimini dogru mu yapiyor", "zamanlanmis yayinda videoyu private
 * yapiyor mu" sorulari gercek bir alisverisle cevaplaniyor.
 */

import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "YouTube";
export const standalone = true;

/** Google'i taklit eden sunucu; her istegi kaydeder. */
function startFakeGoogle() {
  const kayit = [];
  let yuklenenBayt = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const govde = await new Promise((resolve) => {
      const parcalar = [];
      req.on("data", (c) => parcalar.push(c));
      req.on("end", () => resolve(Buffer.concat(parcalar)));
    });

    kayit.push({
      path: url.pathname,
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      auth: req.headers.authorization || null,
      contentType: req.headers["content-type"] || null,
      body: govde,
    });

    const json = (kod, nesne, baslik = {}) => {
      res.writeHead(kod, { "content-type": "application/json", ...baslik });
      res.end(JSON.stringify(nesne));
    };

    /* --- jeton ucu --- */
    if (url.pathname === "/token") {
      const alanlar = new URLSearchParams(govde.toString());
      if (alanlar.get("grant_type") === "authorization_code") {
        return json(200, {
          refresh_token: "yenileme-jetonu-123",
          access_token: "erisim-jetonu-abc",
          expires_in: 3600,
        });
      }
      if (alanlar.get("refresh_token") === "yenileme-jetonu-123") {
        return json(200, { access_token: "erisim-jetonu-abc", expires_in: 3600 });
      }
      return json(400, { error: "invalid_grant", error_description: "Bad Request" });
    }

    /* --- kanal --- */
    if (url.pathname === "/youtube/v3/channels") {
      if (req.headers.authorization !== "Bearer erisim-jetonu-abc") {
        return json(401, { error: { message: "Invalid Credentials" } });
      }
      return json(200, {
        items: [{
          id: "UC_kanal",
          snippet: { title: "Deneme Kanali" },
          statistics: { subscriberCount: "1234", viewCount: "98765", videoCount: "42" },
        }],
      });
    }

    /* --- yukleme oturumu --- */
    if (url.pathname === "/upload/videos" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer erisim-jetonu-abc") {
        return json(401, { error: { message: "Invalid Credentials" } });
      }
      const port = server.address().port;
      return json(200, { ok: true }, {
        location: `http://127.0.0.1:${port}/upload/oturum-1`,
      });
    }

    /* --- dosya gonderimi --- */
    if (url.pathname === "/upload/oturum-1" && req.method === "PUT") {
      yuklenenBayt = govde.length;
      return json(200, { id: "VIDEO_ID_1", kind: "youtube#video" });
    }

    /* --- baslik gorseli --- */
    if (url.pathname === "/upload/thumbnails/set") {
      return json(200, { items: [{ default: { url: "https://x/t.jpg" } }] });
    }

    return json(404, { error: { message: "yok" } });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        server,
        kayit,
        get yuklenenBayt() { return yuklenenBayt; },
        endpoints: {
          token: `http://127.0.0.1:${port}/token`,
          upload: `http://127.0.0.1:${port}/upload/videos`,
          api: `http://127.0.0.1:${port}/youtube/v3`,
          auth: `http://127.0.0.1:${port}/auth`,
        },
      });
    });
  });
}

export async function run(_page, _base, t) {
  const kok = await mkdtemp(join(tmpdir(), "dra-yt-"));
  process.env.DRA_DATA_DIR = kok;

  const videos = await import("../../server/videos.mjs");
  const yt = await import("../../server/youtube.mjs");

  /* ============================================ 1. STOK DEPOSU ====== */

  const videoYol = join(kok, "video.mp4");
  await writeFile(videoYol, Buffer.alloc(4096, 7)); // sahte video
  const kapakYol = join(kok, "kapak.jpg");
  await writeFile(kapakYol, Buffer.alloc(256, 3));

  t.eq((await videos.list()).length, 0, "depo bos basliyor");

  // Olmayan dosya simdi reddedilmeli, yayin saatinde degil.
  let hata = null;
  try {
    await videos.add({ file: join(kok, "yok.mp4"), title: "X" });
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "bulunamadi", "olmayan video eklenemiyor");

  hata = null;
  try {
    await videos.add({ file: videoYol, title: "   " });
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "bos olamaz", "bassiz video eklenemiyor");

  hata = null;
  try {
    await videos.add({ file: videoYol, title: "a".repeat(101) });
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "100 karakter", "YouTube baslik siniri pesin denetleniyor");

  hata = null;
  try {
    await videos.add({ file: videoYol, title: "X", thumbnail: join(kok, "yok.jpg") });
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "gorseli bulunamadi", "olmayan kapak reddediliyor");

  // --- gecerli kayitlar ---
  const yarin = Date.now() + 86400000;
  const birazSonra = Date.now() + 60_000;
  const gecmis = Date.now() - 60_000;

  const a = await videos.add({
    file: videoYol, title: "Yarinki video", description: "aciklama",
    thumbnail: kapakYol, publishAt: yarin, privacy: "public", tags: ["dra", "test"],
  });
  const b = await videos.add({ file: videoYol, title: "Birazdan", publishAt: birazSonra });
  const c = await videos.add({ file: videoYol, title: "Zamani gecmis", publishAt: gecmis });
  await videos.add({ file: videoYol, title: "Saatsiz" });

  t.eq((await videos.list()).length, 4, "videolar siraya girdi");
  t.eq(a.status, "bekliyor", "yeni kayit bekliyor durumunda");
  t.eq(a.privacy, "public", "gizlilik secimi saklaniyor");
  t.eq(a.tags.length, 2, "etiketler saklaniyor");

  // Siralama: yayin saatine gore, saatsizler sona.
  const sirali = await videos.list();
  t.eq(sirali[0].title, "Zamani gecmis", "en yakin yayin basta");
  t.eq(sirali.at(-1).title, "Saatsiz", "saati olmayan sona atiliyor");

  // Yayin saati gelenler.
  const gelenler = await videos.due();
  t.eq(gelenler.length, 1, "yalnizca saati gelen video sirada");
  t.eq(gelenler[0].id, c.id, "dogru video secildi");
  t.ok(
    !gelenler.some((v) => v.publishAt === null),
    "saati olmayan video kendiliginden yayinlanmiyor",
  );

  const siradaki = await videos.next();
  t.eq(siradaki.id, b.id, "siradaki yayin dogru");

  // Guncelleme ve silme.
  await videos.update(a.id, { title: "Yeni baslik", privacy: "unlisted" });
  t.eq((await videos.get(a.id)).title, "Yeni baslik", "baslik guncelleniyor");
  t.eq((await videos.get(a.id)).privacy, "unlisted", "gizlilik guncelleniyor");

  await videos.remove(b.id);
  t.eq((await videos.list()).length, 3, "video silinebiliyor");

  const ozet = await videos.summary();
  t.eq(ozet.bekliyor, 3, "ozet bekleyenleri sayiyor");

  // Kalicilik: baska bir ornek ayni kaydi gormeli.
  const taze = await import(`../../server/videos.mjs?t=${Date.now()}`);
  t.eq((await taze.list()).length, 3, "depo diske yaziliyor");

  /* ============================================ 2. YOUTUBE ========== */

  const sahte = await startFakeGoogle();
  yt._setEndpointsForTests(sahte.endpoints);

  try {
    /* --- yapilandirilmadan --- */
    yt.configure({});
    t.eq(yt.status().ready, false, "yapilandirmasiz hazir degil");

    hata = null;
    try {
      await yt.channel();
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_YOUTUBE", "bagli degilken istek atilmiyor");
    t.eq(sahte.kayit.length, 0, "bagli degilken ag'a hic cikilmiyor");

    hata = null;
    try {
      yt.startAuth();
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_CLIENT", "istemci bilgisi olmadan yetkilendirme baslamiyor");

    /* --- yetkilendirme --- */
    yt.configure({ clientId: "istemci-1", clientSecret: "gizli-1" });
    t.eq(yt.status().configured, true, "istemci bilgisi kaydedildi");
    t.eq(yt.status().linked, false, "henuz kanal bagli degil");

    const oturum = await yt.startAuth();
    t.has(oturum.url, "client_id=istemci-1", "yetkilendirme adresinde istemci kimligi var");
    t.has(oturum.url, "access_type=offline", "yenileme jetonu icin offline isteniyor");
    t.has(oturum.url, "prompt=consent", "yenileme jetonu icin onay zorlaniyor");
    t.has(oturum.url, "youtube.upload", "yalnizca gereken yetkiler isteniyor");
    t.has(oturum.redirect, "127.0.0.1", "geri cagirma bu bilgisayara donuyor");

    // Google'in tarayiciyi geri gonderisini taklit ediyoruz.
    const geri = await fetch(`${oturum.redirect}/?code=ONAY-KODU`);
    t.eq(geri.status, 200, "geri cagirma sayfasi aciliyor");
    const kod = await oturum.waitForCode();
    t.eq(kod, "ONAY-KODU", "onay kodu yakalaniyor");

    const degisim = await yt.exchangeCode(kod, oturum.redirect);
    t.eq(degisim.refreshToken, "yenileme-jetonu-123", "yenileme jetonu alindi");
    t.eq(yt.status().ready, true, "kanal artik bagli");

    /* --- kanal bilgisi --- */
    sahte.kayit.length = 0;
    const kanal = await yt.channel();
    t.eq(kanal.title, "Deneme Kanali", "kanal adi okunuyor");
    t.eq(kanal.subscribers, 1234, "abone sayisi okunuyor");
    t.eq(kanal.views, 98765, "izlenme sayisi okunuyor");
    t.eq(
      sahte.kayit[0].auth,
      "Bearer erisim-jetonu-abc",
      "jeton Authorization basliginda gidiyor",
    );
    t.eq(sahte.kayit[0].query.mine, "true", "yalnizca kendi kanali isteniyor");

    /* --- yukleme --- */
    sahte.kayit.length = 0;
    const ilerleme = [];
    const sonuc = await yt.upload({
      file: videoYol,
      title: "Test videosu",
      description: "aciklama",
      tags: ["dra"],
      thumbnail: kapakYol,
      onProgress: (p) => ilerleme.push(p),
    });

    t.eq(sonuc.videoId, "VIDEO_ID_1", "video kimligi donuyor");
    t.has(sonuc.url, "VIDEO_ID_1", "izleme adresi uretiliyor");
    t.eq(sonuc.bytes, 4096, "dosya boyutu raporlaniyor");
    t.ok(ilerleme.length > 0, "yukleme ilerlemesi bildiriliyor");
    t.eq(sahte.yuklenenBayt, 4096, "dosyanin tamami gonderildi");

    const oturumIstek = sahte.kayit.find((k) => k.path === "/upload/videos");
    t.eq(oturumIstek.query.uploadType, "resumable", "devam ettirilebilir yukleme kullaniliyor");
    const govde = JSON.parse(oturumIstek.body.toString());
    t.eq(govde.snippet.title, "Test videosu", "baslik gonderiliyor");
    t.eq(govde.status.privacyStatus, "private", "gizlilik varsayilani private");

    t.ok(
      sahte.kayit.some((k) => k.path === "/upload/thumbnails/set"),
      "baslik gorseli ayrica ayarlaniyor",
    );
    t.eq(sonuc.thumbnailWarning, null, "gorsel sorunsuz konuldu");

    /* --- zamanlanmis yayin --- */
    // YouTube publishAt'i YALNIZCA private videoda kabul ediyor; kullanici
    // "public" demis olsa bile zamanlanmis yayinda private gitmeli.
    sahte.kayit.length = 0;
    await yt.upload({
      file: videoYol, title: "Zamanli", privacy: "public", publishAt: yarin,
    });
    const zamanliGovde = JSON.parse(
      sahte.kayit.find((k) => k.path === "/upload/videos").body.toString(),
    );
    t.eq(zamanliGovde.status.privacyStatus, "private", "zamanlanmis yayin private gonderiliyor");
    t.has(zamanliGovde.status.publishAt, "T", "yayin zamani ISO bicimde gonderiliyor");

    /* --- jeton yenileme --- */
    // Erisim jetonunun suresi dolunca sessizce yenilenmeli.
    sahte.kayit.length = 0;
    yt.configure({
      clientId: "istemci-1", clientSecret: "gizli-1", refreshToken: "yenileme-jetonu-123",
    });
    await yt.channel();
    t.ok(
      sahte.kayit.some((k) => k.path === "/token"),
      "erisim jetonu yenileme jetonuyla aliniyor",
    );

    /* --- gecersiz jeton --- */
    yt.configure({
      clientId: "istemci-1", clientSecret: "gizli-1", refreshToken: "cop",
    });
    hata = null;
    try {
      await yt.channel();
    } catch (err) {
      hata = err;
    }
    t.ok(hata, "gecersiz jetonla istek basarisiz");
    t.ok(
      !/cop/.test(hata?.message || ""),
      "hata mesaji jetonu sizdirmiyor",
    );
    /* ========================================== 3. ZAMANLAYICI ====== */

    const perms = await import("../../server/permissions.mjs");
    const sched = await import("../../server/scheduler.mjs");

    yt.configure({
      clientId: "istemci-1", clientSecret: "gizli-1", refreshToken: "yenileme-jetonu-123",
    });

    // Sirayi temizliyoruz: yukaridaki testlerden kalan kayitlar bu
    // bolumun sayimini bozmasin.
    for (const v of await videos.list()) await videos.remove(v.id);

    // Yayin saati GELMIS tek bir video birakiyoruz.
    await perms.revokeAll();
    const zamani = await videos.add({
      file: videoYol, title: "Saati gelmis", publishAt: Date.now() - 1000,
    });

    // Yetki yokken zamanlayici hicbir sey yapmamali.
    sahte.kayit.length = 0;
    const izinsiz = await sched.tick();
    t.eq(izinsiz.skipped, "izin yok", "yetki yokken zamanlayici is yapmiyor");
    t.eq(sahte.kayit.length, 0, "yetki yokken ag'a hic cikilmiyor");
    t.eq((await videos.get(zamani.id)).status, "bekliyor", "video dokunulmadan bekliyor");

    // Yetki verilince yuklemeli.
    await perms.grant("youtube");
    const olaylar = [];
    const cikar = sched.onEvent((o) => olaylar.push(o.type));

    const sonucT = await sched.tick();
    cikar();

    t.eq(sonucT.uploaded, 1, "saati gelen video yuklendi");
    const yuklenen = await videos.get(zamani.id);
    t.eq(yuklenen.status, "yuklendi", "durum yuklendi olarak isaretlendi");
    t.eq(yuklenen.videoId, "VIDEO_ID_1", "video kimligi kaydedildi");
    t.ok(yuklenen.uploadedAt > 0, "yukleme zamani kaydedildi");
    t.eq(olaylar, ["basladi", "ilerleme", "bitti"], "olaylar sirayla bildirildi");

    // Ayni video ikinci turda tekrar yuklenmemeli.
    sahte.kayit.length = 0;
    const ikinci = await sched.tick();
    t.eq(ikinci.uploaded, 0, "yuklenmis video tekrar yuklenmiyor");
    t.eq(sahte.kayit.length, 0, "tekrar yukleme icin ag'a cikilmiyor");

    // Basarisiz yukleme kaydi silmemeli, hatayi yazmali.
    yt.configure({ clientId: "istemci-1", clientSecret: "gizli-1", refreshToken: "cop" });
    const kotu = await videos.add({
      file: videoYol, title: "Basarisiz olacak", publishAt: Date.now() - 1000,
    });
    await sched.tick();
    const kotuKayit = await videos.get(kotu.id);
    t.eq(kotuKayit.status, "hata", "basarisiz yukleme hata olarak isaretleniyor");
    t.ok(kotuKayit.error, "hata sebebi kaydediliyor");
    t.ok(await videos.get(kotu.id), "basarisiz kayit silinmiyor");

    await perms.revokeAll();
  } finally {
    yt._setEndpointsForTests(null);
    sahte.server.close();
  }

  /* =================== 5. YANIT JSON DEGILSE ========================
   * `res.ok` dogru olsa bile govde JSON olmayabilir: yakalama portali
   * (otel/kafe wifi'si), kurum vekil sunucusu ya da operator araya bir
   * HTML sayfasi koyabiliyor. Ciplak JSON.parse burada "Unexpected
   * token <" veriyordu — kullaniciya hicbir sey anlatmayan bir hata. */

  const portal = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>Oturum acin</body></html>");
  });
  await new Promise((r) => portal.listen(0, "127.0.0.1", r));

  try {
    const perms = await import("../../server/permissions.mjs");
    const p = portal.address().port;
    yt._setEndpointsForTests({
      token: `http://127.0.0.1:${p}/token`,
      upload: `http://127.0.0.1:${p}/upload/videos`,
      api: `http://127.0.0.1:${p}/youtube/v3`,
      auth: `http://127.0.0.1:${p}/auth`,
    });
    yt.configure({ clientId: "i", clientSecret: "g", refreshToken: "y" });
    await perms.grant("youtube");

    let portalHata = null;
    try {
      await yt.channel();
    } catch (err) {
      portalHata = err;
    }
    const mesaj = portalHata?.message || "";
    t.ok(portalHata, "JSON olmayan yanit hata veriyor");
    t.has(mesaj, "JSON degil", "hatanin sebebi aciklaniyor");
    t.has(mesaj, "oturum acma", "ne yapilmasi gerektigi ima ediliyor");
    t.ok(!/Unexpected token/i.test(mesaj), "ham ayristirici hatasi gosterilmiyor");
    t.has(mesaj, "Oturum acin", "gelen yanitin bir parcasi gosteriliyor");

    await perms.revokeAll();
  } finally {
    yt._setEndpointsForTests(null);
    portal.close();
    delete process.env.DRA_DATA_DIR;
  }
}
