/**
 * DRA sunucusu.
 *
 * Iki isi var:
 *  1. web/ klasorunu localhost uzerinden servis eder. (Tarayicilar file://
 *     uzerinden mikrofona izin vermez; localhost "guvenli baglam" sayilir.)
 *  2. Tarayicinin yapamayacagi isleri ustlenir: uygulama baslatma/kapatma,
 *     (istege bagli) web aramasi ve (istege bagli) Kick moderasyonu.
 *
 * Varsayilan halinde disariya HICBIR istek atmaz. Arama ve Kick koprusu
 * ayrica acilmadikca sessiz durur. Bagimliligi yok — sadece Node.
 *
 * Islem yapan tum uclar guard.mjs'ten gecer: yalnizca 127.0.0.1, yalnizca
 * kendi sayfamiz, yalnizca gecerli oturum jetonuyla.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SESSION_TOKEN, rejectReason } from "./guard.mjs";
import * as apps from "./apps.mjs";
import * as kick from "./kick.mjs";
import * as tts from "./tts.mjs";
import * as sttBulut from "./stt-bulut.mjs";
import * as piper from "./piper.mjs";
import * as control from "./control.mjs";
import * as media from "./media.mjs";
import * as permissions from "./permissions.mjs";
import * as report from "./report.mjs";
import * as mail from "./mail.mjs";
import * as editstyle from "./editstyle.mjs";
import * as montage from "./montage.mjs";
import * as youtube from "./youtube.mjs";
import * as videos from "./videos.mjs";
import * as scheduler from "./scheduler.mjs";
import * as sources from "./sources.mjs";
import * as messages from "./messages.mjs";
import * as whatsapp from "./whatsapp.mjs";
import * as autoreply from "./autoreply.mjs";
import * as business from "./business.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB_DIR = join(ROOT, "web");

/**
 * Web aramasi artik HEP ACIK.
 *
 * Bir donem ayardan aciliyordu; kullanici "her zaman acik olsun" dedi.
 * Arama yine de yalnizca DRA bir soruyu kendi komutlarinda bulamayinca
 * yapiliyor — kendiliginden dolasmiyor.
 */
const searchEnabled = true;

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Arama modulu tembel yukleniyor: kullanilmadikca hic yuklenmesin.
 * Bir kez yukleyip sakliyoruz ki Google anahtarinin durumu saglik
 * bilgisinde de sorulabilsin.
 */
let aramaModulu = null;
async function aramaYukle() {
  if (!aramaModulu) aramaModulu = await import("./search.mjs");
  return aramaModulu;
}

function googleDurumu() {
  return aramaModulu?.googleStatus?.() || { ready: false, keySet: false, cxSet: false };
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Istek govdesi cok buyuk.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Islem yapan uclarin ortak sarmalayicisi: once guvenlik, sonra is. */
async function handleAction(req, res, work, { limit } = {}) {
  const reason = rejectReason(req);
  if (reason) return sendJson(res, 403, { error: reason });

  let body;
  try {
    body = await readBody(req, limit);
  } catch {
    return sendJson(res, 400, { error: "Gecersiz istek govdesi." });
  }

  try {
    const result = await work(body);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error("[dra] islem hatasi:", err?.message || err);
    // Izin eksikligi sradan bir hata degil: arayuz bunu gorup kullaniciya
    // "su yetkiyi veriyor musun" diye sorabilmeli. Hatanin kimligi
    // tasinmazsa arayuzun elinde yalnizca bir metin kalir.
    return sendJson(res, 200, {
      ok: false,
      error: err?.message || "Islem basarisiz.",
      ...(err?.code ? { code: err.code } : {}),
      ...(err?.scope ? { scope: err.scope, title: err.title, detail: err.detail } : {}),
      // Arastirma hatasinda hangi kaynaklarin denendigi de tasinsin.
      ...(Array.isArray(err?.tried) ? { tried: err.tried } : {}),
    });
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  // Dizin disina cikma denemelerini engelle.
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(WEB_DIR, safe);
  if (!filePath.startsWith(WEB_DIR)) {
    return sendJson(res, 403, { error: "Yasak." });
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 — bulunamadi");
  }
}

/**
 * Isimli kontrol islemlerini dagitir.
 *
 * Serbest komut YOK: yalnizca burada listelenen isler yapilabilir.
 * Yanlis duyulan bir kelime en fazla bilinen bir islemi tetikler.
 */
async function runControl(body) {
  const what = String(body?.action || "");
  switch (what) {
    case "volume":
      return control.volume(body.direction, Number(body.steps) || 5);
    case "mute":
      return control.mute();
    case "media":
      return control.media(body.what);
    case "seek": {
      // Ileri/geri sarma sanal medya tuslarinda yok; YouTube'un kendi
      // kisayoslari kullaniliyor (l = +10sn, j = -10sn) ve bunun icin
      // tarayici penceresi one getiriliyor.
      // YouTube kisayolu 10'ar saniye atliyor; istenen sure 10'un kati
      // degilse UYGULANAN sureyi donduruyoruz. Aksi halde DRA "25 saniye
      // sardim" deyip aslinda 30 sariyordu.
      const istenen = Number(body.seconds ?? 10);
      const ileri = istenen >= 0;
      const kere = Math.max(1, Math.min(12, Math.round(Math.abs(istenen) / 10)));
      const sonuc = await control.sendKeysTo(
        body.window || "YouTube",
        (ileri ? "l" : "j").repeat(kere),
      );
      return { ...sonuc, applied: kere * 10, forward: ileri };
    }
    // Genel "keys" kanali KALDIRILDI.
    //
    // Herhangi bir pencereye herhangi bir tus dizisi gondermek, bu
    // dosyanin basindaki "serbest komut calistirilmaz" kuralinin
    // etrafindan dolasmak demekti: SendKeys'te "%{F4}" pencereyi
    // kapatir, "^{ESC}" baslat menusunu acar. Arayuzde kullanan da
    // yoktu. Tus gerektiren her yeni yetenek, "seek" gibi ISIMLI bir
    // islem olarak eklenmeli.
    case "power":
      return control.power(body.what);
    case "brightness":
      return control.brightness(body.percent);
    case "open":
      return control.openUrl(body.url);
    case "youtube": {
      const video = await media.findVideo(body.query);
      await control.openUrl(video.url);
      return { action: "youtube", video };
    }
    case "music": {
      const kaynak = media.resolveMusicSource(body.source);
      if (!kaynak) {
        throw new Error(
          `"${body.source}" bilinmiyor. Su kaynaklardan calabilirim: ` +
            Object.values(media.MUZIK).map((m) => m.label).join(", ") + ".",
        );
      }
      const adres = kaynak.url(body.query || "");
      await control.openUrl(adres);
      return { action: "music", source: kaynak.label, query: body.query || "", url: adres };
    }
    default:
      throw new Error(`Bilinmeyen islem: ${what}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      platform: process.platform,
      // Jeton yalnizca ayni kokenden okunabilir; capraz kokenli JavaScript
      // yaniti goremez cunku CORS basligi gondermiyoruz.
      token: SESSION_TOKEN,
      search: { enabled: searchEnabled, google: googleDurumu() },
      kick: kick.status(),
      tts: tts.status(),
      sttCloud: sttBulut.status(),
    piper: piper.status(),
    mail: mail.status(),
    youtube: youtube.status(),
      apps: await apps.scanInfo(),
    });
  }

  /* ---------------------------------------------------- uygulamalar -- */

  if (url.pathname === "/api/apps") {
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, apps: await apps.listApps() });
    }
    return sendJson(res, 405, { error: "GET bekleniyor." });
  }

  if (url.pathname === "/api/apps/scan" && req.method === "POST") {
    return handleAction(req, res, async () => {
      const list = await apps.scanApps();
      return { count: list.length, apps: list };
    });
  }

  if (url.pathname === "/api/apps/launch" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const list = await apps.listApps();
      // Yalnizca taranmis listeden bir kayit calistirilabilir.
      const app = list.find((a) => a.id === body.id);
      if (!app) throw new Error("Bu uygulama listede yok.");
      await apps.launchApp(app);
      return { name: app.name };
    });
  }

  if (url.pathname === "/api/apps/close" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const list = await apps.listApps();
      const app = list.find((a) => a.id === body.id);
      if (!app) throw new Error("Bu uygulama listede yok.");
      await apps.closeApp(app);
      return { name: app.name };
    });
  }

  /* ---------------------------------------------------------- arama -- */


  if (url.pathname === "/api/search/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const { configureGoogle } = await aramaYukle();
      return { google: configureGoogle({ key: body.key, cx: body.cx }) };
    });
  }

  if (url.pathname === "/api/search" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      if (!searchEnabled) {
        throw new Error("Web aramasi kapali. Ayar sekmesinden acabilirsiniz.");
      }
      // Modul yalnizca gerektiginde yuklenir; kapaliyken hic dokunulmaz.
      const { search } = await aramaYukle();
      return { result: await search(body.query) };
    });
  }

  if (url.pathname === "/api/search/toggle" && req.method === "POST") {
    // Arama artik kapatilamiyor; eski istekler sessizce basarili donsun.
    return handleAction(req, res, async () => ({ enabled: true }));
  }

  if (url.pathname === "/api/search/rich" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const { richSearch } = await aramaYukle();
      return { result: await richSearch(body.query, { limit: Number(body.limit) || 4 }) };
    });
  }

  /* ----------------------------------------------------------- kick -- */

  if (url.pathname === "/api/kick/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) =>
      ({ status: kick.configure({ token: body.token, channel: body.channel }) }));
  }

  if (url.pathname === "/api/kick/action" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const fn = kick.ACTIONS[body.action];
      if (!fn) throw new Error("Bilinmeyen moderasyon islemi.");
      const message = await fn(...(body.args || []));
      return { message: typeof message === "string" ? message : JSON.stringify(message) };
    });
  }

  /* ------------------------------------------ bulutta ses tanima -- */

  if (url.pathname === "/api/stt/cloud/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      // Tarayici surumunde Whisper'i baslatacak bir ana surec yok.
      status: body.provider === "whisper"
        ? (() => {
          throw Object.assign(new Error("Whisper yalnizca uygulama surumunde calisir."), { code: "DESKTOP_ONLY" });
        })()
        : sttBulut.configure({ provider: body.provider || "elevenlabs", key: body.key, model: body.model }),
    }));
  }

  if (url.pathname === "/api/stt/cloud" && req.method === "POST") {
    // 15 sn'lik ses base64 ile ~650 KB; genel sinir 256 KB.
    return handleAction(req, res, async (body) => await sttBulut.transcribe(body.pcm), {
      limit: 1024 * 1024,
    });
  }

  /* ------------------------------------------------ seslendirme (TTS) */

  if (url.pathname === "/api/tts/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      status: tts.configure({
        apiKey: body.apiKey,
        voiceId: body.voiceId,
        model: body.model,
      }),
    }));
  }

  if (url.pathname === "/api/tts/voices" && req.method === "POST") {
    return handleAction(req, res, async () => ({ voices: await tts.voices() }));
  }

  if (url.pathname === "/api/tts/models" && req.method === "POST") {
    return handleAction(req, res, async () => ({ models: await tts.models() }));
  }

  if (url.pathname === "/api/tts/test" && req.method === "POST") {
    return handleAction(req, res, async () => await tts.test());
  }

  if (url.pathname === "/api/tts/speak" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const { audio, type, chars, truncated } = await tts.speak(body.text);
      // Ses, ayni korumali uctan base64 olarak doner; arayuz ElevenLabs
      // ile hic konusmaz, anahtari hic gormez.
      return { audio: audio.toString("base64"), type, chars, truncated };
    });
  }

  /* ------------------------------------------------------- izinler -- */

  if (url.pathname === "/api/permissions" && req.method === "POST") {
    return handleAction(req, res, async () => ({ permissions: await permissions.list() }));
  }

  if (url.pathname === "/api/permissions/grant" && req.method === "POST") {
    return handleAction(req, res, async (body) => await permissions.grant(body.scope));
  }

  if (url.pathname === "/api/permissions/revoke" && req.method === "POST") {
    return handleAction(req, res, async (body) =>
      body.scope === "*" ? await permissions.revokeAll() : await permissions.revoke(body.scope));
  }

  /* --------------------------------------------------------- rapor -- */

  if (url.pathname === "/api/report/system" && req.method === "POST") {
    return handleAction(req, res, async () => {
      // Yetki denetimi ISIN YAPILDIGI yerde: arayuzun sozune guvenmiyoruz.
      await permissions.require("sistem");
      return { report: await report.system() };
    });
  }

  /* ------------------------------------------------------- e-posta -- */

  if (url.pathname === "/api/mail/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      status: mail.configure({ user: body.user, pass: body.pass, host: body.host }),
    }));
  }

  if (url.pathname === "/api/mail/test" && req.method === "POST") {
    return handleAction(req, res, async () => {
      await permissions.require("eposta");
      return await mail.test();
    });
  }

  if (url.pathname === "/api/mail/summary" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("eposta");
      return { summary: await mail.summary({ days: Number(body.days) || 2 }) };
    });
  }

  /* -------------------------------------------------------- montaj -- */

  if (url.pathname === "/api/montage/status" && req.method === "POST") {
    return handleAction(req, res, async () => ({
      ffmpeg: await montage.ffmpegStatus(),
      templates: montage.TEMPLATES,
    }));
  }

  if (url.pathname === "/api/montage/style" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("montaj");
      return { style: await editstyle.read(body.path) };
    });
  }

  if (url.pathname === "/api/montage/render" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("montaj");
      const style = body.stylePath ? await editstyle.read(body.stylePath) : null;
      const plan = montage.planFromStyle(style, { template: body.template });
      return {
        result: await montage.render({
          clipsDir: body.clipsDir,
          plan,
          title: body.title,
          titleImage: body.titleImage,
          music: body.music,
          out: body.out,
        }),
      };
    });
  }

  /* ------------------------------------------------------- youtube -- */

  if (url.pathname === "/api/youtube/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      status: youtube.configure({
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        refreshToken: body.refreshToken,
      }),
    }));
  }

  if (url.pathname === "/api/youtube/channel" && req.method === "POST") {
    return handleAction(req, res, async () => {
      await permissions.require("youtube");
      return { channel: await youtube.channel() };
    });
  }

  if (url.pathname === "/api/videos" && req.method === "POST") {
    return handleAction(req, res, async () => ({
      videos: await videos.list(),
      summary: await videos.summary(),
    }));
  }

  if (url.pathname === "/api/videos/add" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("youtube");
      return { video: await videos.add(body) };
    });
  }

  if (url.pathname === "/api/videos/remove" && req.method === "POST") {
    return handleAction(req, res, async (body) => await videos.remove(body.id));
  }

  if (url.pathname === "/api/videos/update" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      video: await videos.update(body.id, body.patch || {}),
    }));
  }

  /* ------------------------------------------------ musteri kaynaklari */

  if (url.pathname === "/api/sources" && req.method === "POST") {
    return handleAction(req, res, async () => ({
      sources: sources.catalog(),
      summary: await messages.summary(),
    }));
  }

  if (url.pathname === "/api/sources/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("isletme");
      return sources.configure(body.id, body.values);
    });
  }

  if (url.pathname === "/api/sources/test" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("isletme");
      return { result: await sources.test(body.id) };
    });
  }

  if (url.pathname === "/api/sources/collect" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("isletme");
      return { result: await sources.collect(body.ids || []) };
    });
  }

  if (url.pathname === "/api/sources/reply" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("isletme");
      await sources.reply(body.id, body.target, body.text);
      if (body.messageId) await messages.markReplied(body.messageId, body.text);
      return { sent: true };
    });
  }

  if (url.pathname === "/api/messages" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      messages: await messages.list(body || {}),
      summary: await messages.summary(body || {}),
    }));
  }

  if (url.pathname === "/api/messages/add" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      // Elle giris hicbir hesaba baglanmadigi icin yetki gerektirmiyor;
      // kullanicinin kendi yazdigi kendi verisi.
      const { added } = await messages.ingest("manuel", [{
        from: body.from, text: body.text, at: Date.now(),
      }]);
      return { added };
    });
  }

  if (url.pathname === "/api/messages/mark" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      message: body.reply
        ? await messages.markReplied(body.id, body.reply)
        : await messages.markRead(body.id),
    }));
  }

  /* WhatsApp webhook: Meta buraya POST eder. Guard'dan GECMEZ cunku
     istek bizim sayfamizdan degil Meta'dan geliyor; korumasi kendi
     dogrulama jetonu. */
  if (url.pathname === "/webhook/whatsapp") {
    if (req.method === "GET") {
      const sonuc = whatsapp.verifyWebhook(Object.fromEntries(url.searchParams));
      if (!sonuc.ok) {
        res.writeHead(403, { "content-type": "text/plain" });
        return res.end("dogrulanamadi");
      }
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(sonuc.challenge);
    }
    if (req.method === "POST") {
      let govde = null;
      try {
        govde = await readBody(req);
      } catch {
        govde = null;
      }
      try {
        const gelen = whatsapp.handleWebhook(govde || {});
        if (gelen.length) await messages.ingest("whatsapp", gelen);
      } catch (err) {
        console.warn("[dra] whatsapp webhook:", err.message);
      }
      // Meta 200 gormezse tekrar tekrar gonderiyor.
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
  }

  /* --------------------------------------------- otomatik yanit / rapor */

  if (url.pathname === "/api/autoreply" && req.method === "POST") {
    return handleAction(req, res, async () => ({
      status: await autoreply.status(),
      rules: await autoreply.list(),
    }));
  }

  if (url.pathname === "/api/autoreply/toggle-mode" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("isletme");
      return { status: await autoreply.setEnabled(body.enabled) };
    });
  }

  if (url.pathname === "/api/autoreply/add" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({ rule: await autoreply.add(body) }));
  }

  if (url.pathname === "/api/autoreply/remove" && req.method === "POST") {
    return handleAction(req, res, async (body) => await autoreply.remove(body.id));
  }

  if (url.pathname === "/api/autoreply/toggle" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({ rule: await autoreply.toggle(body.id) }));
  }

  if (url.pathname === "/api/autoreply/run" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      // Deneme kipi de yetki istiyor: mesajlari okumak da bir erisim.
      await permissions.require("isletme");
      return { result: await autoreply.run({ dryRun: Boolean(body.dryRun) }) };
    });
  }

  if (url.pathname === "/api/business/report" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      report: await business.report({ days: Number(body.days) || 30 }),
    }));
  }

  /* --------------------------------------------------------- piper -- */

  if (url.pathname === "/api/piper/configure" && req.method === "POST") {
    return handleAction(req, res, async (body) => ({
      status: piper.configure({ bin: body.bin, voice: body.voice }),
    }));
  }

  if (url.pathname === "/api/piper/test" && req.method === "POST") {
    return handleAction(req, res, async () => await piper.test());
  }

  if (url.pathname === "/api/piper/speak" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      const { audio, type, truncated } = await piper.speak(body.text);
      return { audio: audio.toString("base64"), type, truncated };
    });
  }

  /* ---------------------------------------------- bilgisayar kontrolu */

  if (url.pathname === "/api/control" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("kontrol");
      return { result: await runControl(body) };
    });
  }

  if (url.pathname === "/api/control/foreground" && req.method === "POST") {
    return handleAction(req, res, async () => {
      // On plandaki pencerenin basligi ve uygulamasi da bir erisim:
      // yetki olmadan okunmamali.
      await permissions.require("kontrol");
      return { foreground: await control.foreground() };
    });
  }

  if (url.pathname === "/api/media/find" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      await permissions.require("kontrol");
      return { video: await media.findVideo(body.query) };
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Desteklenmeyen metot." });
  }

  return serveStatic(req, res, url.pathname);
});

// Yayin zamanlayicisi: yetki verilmemisse hicbir sey yapmaz.
scheduler.start();

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  ██████╗ ██████╗  █████╗ ");
  console.log("  ██╔══██╗██╔══██╗██╔══██╗");
  console.log("  ██║  ██║██████╔╝███████║");
  console.log("  ██║  ██║██╔══██╗██╔══██║");
  console.log("  ██████╔╝██║  ██║██║  ██║");
  console.log("  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝");
  console.log("");
  console.log(`  Arayuz    : http://localhost:${PORT}`);
  console.log(`  Uyandirma : mikrofon acikken "DRA" deyin`);
  console.log(`  Ag        : disariya hicbir istek atilmiyor`);
  console.log("");
});
