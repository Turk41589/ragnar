/**
 * Musteri mesaji kaynaklari.
 *
 * Sinanan asil sey: "kullanici hangi kaynagi secerse DRA tam olarak o
 * kaynagin istedigi bilgiyi ister" iddiasi. Bilgi listesi kaynagin kendi
 * taniminda duruyor; arayuz de sesli akis da onu okuyor.
 *
 * Instagram ve WhatsApp icin Meta'nin Graph API'sini taklit eden GERCEK
 * bir yerel sunucu var; boylece "dogru uca mi gidiyor", "jetonu nereye
 * koyuyor", "kendi mesajimizi musteri sanmiyor mu" sorularinin hepsi
 * gercek bir alisverisle cevaplaniyor.
 */

import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Zamanlar GORELI uretiliyor.
 *
 * SABIT tarih YAZMIYORUZ: ozet penceresi son 7 gune bakiyor, sabit bir
 * tarih birkac gun sonra pencerenin disina dusuyor ve test kendiliginden
 * bozuluyor. Bu tam olarak iki kez yasandi — once WhatsApp tarafinda,
 * sonra Instagram tarafinda. Her ikisi de artik "biraz once".
 */
const SANIYE = Math.floor(Date.now() / 1000) - 3600;

/** Instagram ISO zamani: n dakika once. */
const iso = (dakikaOnce) =>
  new Date(Date.now() - dakikaOnce * 60000).toISOString().replace(/\.\d+Z$/, "+0000");

export const name = "Musteri kaynaklari";
export const standalone = true;

/** Meta Graph API taklidi. */
function startFakeMeta() {
  const kayit = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const govde = await new Promise((resolve) => {
      const p = [];
      req.on("data", (c) => p.push(c));
      req.on("end", () => resolve(Buffer.concat(p).toString("utf8")));
    });

    kayit.push({
      path: url.pathname,
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      auth: req.headers.authorization || null,
      body: govde,
    });

    const json = (kod, nesne) => {
      res.writeHead(kod, { "content-type": "application/json" });
      res.end(JSON.stringify(nesne));
    };

    const jeton = url.searchParams.get("access_token") ||
      (req.headers.authorization || "").replace("Bearer ", "");
    if (jeton && jeton !== "IYI-JETON") {
      return json(400, { error: { message: "Invalid OAuth access token", code: 190 } });
    }

    /* --- Instagram hesap bilgisi --- */
    if (url.pathname === "/IG_HESAP") {
      return json(200, { username: "kahveci", name: "Kahveci Dukkani" });
    }

    /* --- Instagram konusmalari --- */
    if (url.pathname === "/IG_HESAP/conversations") {
      return json(200, {
        data: [{
          id: "k1",
          messages: {
            data: [
              {
                id: "m1", created_time: iso(180),
                from: { id: "musteri-1", username: "ayse" },
                message: "Merhaba, bugun acik misiniz?",
              },
              {
                // Kendi hesabimizdan cikan mesaj: musteri mesaji DEGIL.
                id: "m2", created_time: iso(175),
                from: { id: "IG_HESAP", username: "kahveci" },
                message: "Evet acigiz!",
              },
              {
                id: "m3", created_time: iso(120),
                from: { id: "musteri-2", username: "mehmet" },
                message: "Rezervasyon yapabilir miyim?",
              },
              // Bos mesaj (fotograf) — atlanmali.
              { id: "m4", from: { id: "musteri-3" }, message: "" },
            ],
          },
        }],
      });
    }

    if (url.pathname === "/IG_HESAP/messages" && req.method === "POST") {
      return json(200, { message_id: "gonderildi-1" });
    }

    /* --- WhatsApp numara bilgisi --- */
    if (url.pathname === "/WA_NUMARA") {
      return json(200, { display_phone_number: "+90 555 000 0000", verified_name: "Kahveci" });
    }

    if (url.pathname === "/WA_NUMARA/messages" && req.method === "POST") {
      return json(200, { messages: [{ id: "wamid.1" }] });
    }

    return json(404, { error: { message: "yok" } });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, kayit, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

export async function run(_page, _base, t) {
  process.env.DRA_DATA_DIR = await mkdtemp(join(tmpdir(), "dra-kaynak-"));

  const sources = await import("../../server/sources.mjs");
  const mail = await import("../../server/mail.mjs");

  // Paketler ayni surecte calisiyor: e-posta paketi mail.mjs'i
  // yapilandirilmis birakmis olabilir. Gmail'in "kurulmamis" davranisini
  // sinayacagimiz icin temiz baslatiyoruz.
  mail.configure({ user: "", pass: "" });
  const messages = await import("../../server/messages.mjs");
  const ig = await import("../../server/instagram.mjs");
  const wa = await import("../../server/whatsapp.mjs");

  /* ============================ 1. KAYNAK KATALOGU ================== */

  const katalog = sources.catalog();
  const idler = katalog.map((k) => k.id).sort();
  t.eq(idler, ["gmail", "instagram", "manuel", "whatsapp"], "dort kaynak sunuluyor");

  // ISTEGIN OZU: her kaynak KENDI istedigi bilgiyi tanimliyor.
  const gmailK = katalog.find((k) => k.id === "gmail");
  t.eq(
    gmailK.fields.map((f) => f.key),
    ["user", "pass"],
    "Gmail kendi isteyecegi bilgileri tanimliyor",
  );
  t.has(
    gmailK.fields.find((f) => f.key === "pass").hint,
    "Uygulama sifreleri",
    "Gmail alani nereden alinacagini anlatiyor",
  );

  const igK = katalog.find((k) => k.id === "instagram");
  t.eq(
    igK.fields.map((f) => f.key),
    ["accountId", "token"],
    "Instagram farkli bilgiler istiyor",
  );

  const waK = katalog.find((k) => k.id === "whatsapp");
  t.eq(
    waK.fields.map((f) => f.key),
    ["phoneNumberId", "token", "verifyToken"],
    "WhatsApp kendi alanlarini istiyor",
  );
  t.eq(waK.inbound, "webhook", "WhatsApp'in gelen mesaji webhook ile geliyor");
  t.ok(waK.warning, "WhatsApp'in kisiti bastan bildiriliyor");
  t.has(waK.warning, "webhook", "kisitin sebebi aciklaniyor");

  const manuelK = katalog.find((k) => k.id === "manuel");
  t.eq(manuelK.fields.length, 0, "elle giris hicbir bilgi istemiyor");
  t.eq(manuelK.ready, true, "elle giris kurulumsuz hazir");

  // Her alanin kullaniciya gosterilecek bir etiketi olmali.
  t.ok(
    katalog.every((k) => k.fields.every((f) => f.label && f.type)),
    "her alanin etiketi ve turu var",
  );

  /* ============================ 2. EKSIK BILGI ====================== */

  let hata = null;
  try {
    sources.configure("instagram", { accountId: "IG_HESAP" });
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "MISSING_FIELDS", "eksik bilgiyle yapilandirma reddediliyor");
  t.has(hata?.fields?.join(" ") || "", "jeton", "hangi bilginin eksik oldugu soyleniyor");
  t.eq(ig.status().ready, false, "eksik yapilandirma 'hazir' saymiyor");

  hata = null;
  try {
    sources.configure("tiktok", {});
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "Bilinmeyen kaynak", "olmayan kaynak reddediliyor");

  // Zorunlu olmayan alan bos birakilabilmeli.
  const waDurum = sources.configure("whatsapp", {
    phoneNumberId: "WA_NUMARA", token: "IYI-JETON",
  });
  t.eq(waDurum.status.ready, true, "zorunlu olmayan alan bos birakilabiliyor");

  /* ============================ 3. INSTAGRAM ======================== */

  const meta = await startFakeMeta();
  ig._setBaseForTests(meta.base);
  wa._setBaseForTests(meta.base);

  try {
    sources.configure("instagram", { accountId: "IG_HESAP", token: "IYI-JETON" });
    t.eq(ig.status().ready, true, "Instagram yapilandirildi");
    t.ok(!("token" in ig.status()), "jetonun kendisi disari verilmiyor");

    const sinama = await sources.test("instagram");
    t.has(sinama.detail, "kahveci", "Instagram sinamasi hesabi buluyor");

    meta.kayit.length = 0;
    const igMesajlar = await ig.fetchMessages();
    t.eq(igMesajlar.length, 2, "yalnizca musteri mesajlari aliniyor");
    t.ok(
      !igMesajlar.some((m) => m.text === "Evet acigiz!"),
      "kendi gonderdigimiz mesaj musteri sanilmiyor",
    );
    t.ok(
      !igMesajlar.some((m) => !m.text),
      "bos (fotograf) mesajlar atlaniyor",
    );
    t.eq(igMesajlar[0].from, "ayse", "gonderen adi okunuyor");
    t.eq(igMesajlar[0].handle, "@ayse", "kullanici adi isaretleniyor");
    t.ok(igMesajlar[0].at > 0, "mesaj zamani cozuluyor");
    t.has(
      meta.kayit[0].query.platform,
      "instagram",
      "Instagram platformu belirtiliyor",
    );

    // Gecersiz jeton anlasilir bir hataya donusmeli.
    sources.configure("instagram", { accountId: "IG_HESAP", token: "COP" });
    hata = null;
    try {
      await ig.fetchMessages();
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "suresi dolmus", "gecersiz jeton anlatiliyor");
    t.ok(!/COP/.test(hata?.message || ""), "hata mesaji jetonu sizdirmiyor");

    /* ============================ 4. WHATSAPP ======================= */

    sources.configure("whatsapp", {
      phoneNumberId: "WA_NUMARA", token: "IYI-JETON", verifyToken: "gizli-dogrulama",
    });

    const waSinama = await sources.test("whatsapp");
    t.has(waSinama.detail, "Kahveci", "WhatsApp sinamasi numarayi buluyor");
    t.eq(waSinama.warning, null, "dogrulama jetonu varken uyari yok");

    // Dogrulama jetonu yoksa gelen mesaj alinamaz — bunu soylemeli.
    sources.configure("whatsapp", { phoneNumberId: "WA_NUMARA", token: "IYI-JETON" });
    const waEksik = await sources.test("whatsapp");
    t.has(waEksik.warning || "", "gelen", "dogrulama jetonu yoksa uyariliyor");

    // Webhook dogrulamasi (Meta adresi kaydederken sinar).
    sources.configure("whatsapp", {
      phoneNumberId: "WA_NUMARA", token: "IYI-JETON", verifyToken: "gizli-dogrulama",
    });
    t.eq(
      wa.verifyWebhook({
        "hub.mode": "subscribe",
        "hub.verify_token": "gizli-dogrulama",
        "hub.challenge": "12345",
      }),
      { ok: true, challenge: "12345" },
      "dogru jetonla webhook dogrulaniyor",
    );
    t.eq(
      wa.verifyWebhook({ "hub.mode": "subscribe", "hub.verify_token": "yanlis" }).ok,
      false,
      "yanlis jetonla webhook reddediliyor",
    );

    // Webhook govdesinden mesaj cikarma.
    const cikan = wa.handleWebhook({
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: "905550000001", profile: { name: "Zeynep" } }],
            messages: [
              { id: "wamid.a", from: "905550000001", timestamp: String(SANIYE),
                text: { body: "Siparisim ne zaman gelir?" } },
              // Metin olmayan mesaj atlanmali.
              { id: "wamid.b", from: "905550000002", type: "image", image: { id: "x" } },
            ],
          },
        }],
      }],
    });
    t.eq(cikan.length, 1, "webhook govdesinden metin mesaji cikariliyor");
    t.eq(cikan[0].from, "Zeynep", "gonderen adi rehberden esleniyor");
    t.eq(cikan[0].handle, "+905550000001", "numara isaretleniyor");
    t.eq(cikan[0].at, SANIYE * 1000, "WhatsApp saniyesi milisaniyeye cevriliyor");

    // Webhook'tan gelen mesaj "cekildiginde" teslim edilmeli.
    const teslim = await wa.fetchMessages();
    t.eq(teslim.length, 1, "biriken mesaj teslim ediliyor");
    t.eq((await wa.fetchMessages()).length, 0, "ayni mesaj ikinci kez teslim edilmiyor");

    // Yanit gonderme.
    meta.kayit.length = 0;
    await sources.reply("whatsapp", "+90 555 000 0001", "Merhaba, yarin gelir.");
    const gonderim = meta.kayit.find((k) => k.path === "/WA_NUMARA/messages");
    t.ok(gonderim, "yanit dogru uca gidiyor");
    t.eq(gonderim.auth, "Bearer IYI-JETON", "jeton Authorization basliginda");
    const waGovde = JSON.parse(gonderim.body);
    t.eq(waGovde.to, "905550000001", "numaradan bosluk ve isaretler temizleniyor");
    t.eq(waGovde.text.body, "Merhaba, yarin gelir.", "mesaj metni gonderiliyor");

    // Gmail yanit gondermiyor; bunu acikca soylemeli.
    hata = null;
    try {
      await sources.reply("gmail", "x@y.com", "merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "yanit gonderilemiyor", "desteklenmeyen gonderim anlatiliyor");

    /* ============================ 5. TOPLAMA ======================== */

    wa.handleWebhook({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "905550000003", profile: { name: "Ali" } }],
        messages: [{ id: "wamid.c", from: "905550000003", timestamp: String(SANIYE + 100),
          text: { body: "Fiyat listeniz var mi?" } }],
      } }] }],
    });
    sources.configure("instagram", { accountId: "IG_HESAP", token: "IYI-JETON" });

    const toplama = await sources.collect(["instagram", "whatsapp", "gmail"]);
    t.eq(toplama.bySource.instagram, 2, "Instagram mesajlari depoya girdi");
    t.eq(toplama.bySource.whatsapp, 1, "WhatsApp mesaji depoya girdi");
    // Gmail yapilandirilmadi: digerlerini engellememeli.
    t.has(toplama.errors.gmail || "", "Yapilandirilmamis", "kurulmamis kaynak bildiriliyor");
    t.eq(toplama.added, 3, "toplam eklenen sayisi dogru");

    // Ayni mesajlar ikinci kez eklenmemeli.
    const ikinci = await sources.collect(["instagram"]);
    t.eq(ikinci.added, 0, "ayni mesaj iki kez kaydedilmiyor");

    /* ============================ 6. DEPO =========================== */

    const hepsi = await messages.list();
    t.eq(hepsi.length, 3, "mesajlar tek depoda toplandi");
    t.ok(hepsi[0].at >= hepsi[1].at, "en yeni mesaj basta");
    t.eq(
      [...new Set(hepsi.map((m) => m.source))].sort(),
      ["instagram", "whatsapp"],
      "mesajlar kaynagini tasiyor",
    );

    const sadeceWa = await messages.list({ source: "whatsapp" });
    t.eq(sadeceWa.length, 1, "kaynaga gore suzulebiliyor");

    const ozet = await messages.summary();
    t.eq(ozet.total, 3, "ozet toplami dogru");
    t.eq(ozet.bySource.instagram, 2, "ozet kaynak kirilimi veriyor");
    t.eq(ozet.unanswered, 3, "yanitlanmamislar sayiliyor");

    await messages.markReplied(hepsi[0].id, "Tesekkurler, yarin gonderiyoruz.");
    const sonra = await messages.summary();
    t.eq(sonra.unanswered, 2, "yanitlanan mesaj sayimdan dusuyor");
    t.eq((await messages.get(hepsi[0].id)).status, "yanitlandi", "durum guncelleniyor");

    await messages.markRead(hepsi[1].id);
    t.eq((await messages.get(hepsi[1].id)).status, "okundu", "okundu isaretlenebiliyor");

    // Kalicilik.
    const taze = await import(`../../server/messages.mjs?t=${Date.now()}`);
    t.eq((await taze.list()).length, 3, "mesajlar diske yaziliyor");
  } finally {
    ig._setBaseForTests(null);
    wa._setBaseForTests(null);
    wa._resetForTests();
    meta.server.close();
    delete process.env.DRA_DATA_DIR;
  }
}
