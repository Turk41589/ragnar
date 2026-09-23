/**
 * DRA masaustu uygulamasi — ana surec.
 *
 * Tarayici surumuyle ayni arayuzu calistirir; fark, makineye erisim
 * gerektiren islerin HTTP yerine dogrudan IPC uzerinden yapilmasi.
 * Bu daha guvenli: ortada dinlenecek bir port, korunacak bir jeton yok.
 *
 * Arayuz dosyalari uygulamanin icinden gelir — internet gerekmez.
 */

import {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, shell, nativeImage, session, dialog,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as apps from "../server/apps.mjs";
import * as kick from "../server/kick.mjs";
import * as tts from "../server/tts.mjs";
import * as sttBulut from "../server/stt-bulut.mjs";
import * as piper from "../server/piper.mjs";
import * as control from "../server/control.mjs";
import * as media from "../server/media.mjs";
import * as permissions from "../server/permissions.mjs";
import * as report from "../server/report.mjs";
import * as mail from "../server/mail.mjs";
import * as editstyle from "../server/editstyle.mjs";
import * as montage from "../server/montage.mjs";
import * as youtube from "../server/youtube.mjs";
import * as videos from "../server/videos.mjs";
import * as scheduler from "../server/scheduler.mjs";
import * as sources from "../server/sources.mjs";
import * as messages from "../server/messages.mjs";
import * as autoreply from "../server/autoreply.mjs";
import * as business from "../server/business.mjs";
import * as stt from "./speech-engine.mjs";
import * as whisper from "./whisper-yerel.mjs";
import { guvenliKok } from "./yol.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Gizli acilis: bilgisayar acilirken DRA pencere gostermeden baslar,
 * tepside bekler ve adini duyunca kendini gosterir.
 *
 * Windows'ta oturum acilis kaydina bu bayrak yaziliyor; kullanici
 * uygulamayi elle actiginda bayrak olmadigi icin pencere normal aciliyor.
 */
const GIZLI_BASLAT = process.argv.includes("--gizli");

/**
 * Google arama anahtarinin durumu.
 *
 * Arama modulu tembel yukleniyor (kullanilmadikca hic yuklenmesin
 * diye). Saglik bilgisi her acilista soruluyor ve modulu yalnizca
 * bunun icin yuklemek gereksiz — daha once yuklenmisse durumu
 * oradan, yuklenmemisse "hazir degil" diyoruz.
 */
let aramaModulu = null;

/** Arama modulunu bir kez yukleyip saklar. */
async function aramaYukle() {
  if (!aramaModulu) aramaModulu = await import("../server/search.mjs");
  return aramaModulu;
}

function googleDurumu() {
  return aramaModulu?.googleStatus?.() || { ready: false, keySet: false, cxSet: false };
}

let mainWindow = null;
let splashWindow = null;
let tray = null;
/** Web arastirmasi artik HEP ACIK (kullanici boyle istedi). */
const searchEnabled = true;
let quitting = false;

/* ------------------------------------------------------------ izinler */

/**
 * Electron, tarayicinin aksine mikrofon iznini KENDILIGINDEN VERMEZ —
 * varsayilan davranis reddetmektir ve ses tanima "not-allowed" ile duser.
 * Uygulama kendi arayuzunu calistirdigi icin mikrofonu burada aciyoruz;
 * baska her izin reddediliyor.
 */
const IZINLI = new Set(["media", "audioCapture", "microphone", "speech-recognition"]);

function setupPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(IZINLI.has(permission));
  });

  ses.setPermissionCheckHandler((_contents, permission) => IZINLI.has(permission));

  // Cihaz secimi de acikca onaylanmali.
  ses.setDevicePermissionHandler(({ deviceType }) => deviceType === "audioInput");
}

/* --------------------------------------------------------- acilis ekrani */

/** Acilis ekrani en az bu kadar gorunur — yoksa bir an parlayip kayboluyor. */
const SPLASH_MIN_MS = 1600;
/** Ana pencere hic acilmasa bile acilis ekrani bu sureden fazla kalmaz. */
const SPLASH_MAX_MS = 20000;

let splashShownAt = 0;
let splashGuard = null;

function createSplash() {
  // Sayac olusturma aninda baslar. Yalnizca "ready-to-show" anina bakmak,
  // ana pencere daha once hazir olursa gecen sureyi epoch buyuklugunde
  // gosteriyor ve en az gorunme suresi sessizce atlaniyordu.
  splashShownAt = Date.now();

  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    // Uygulamanin adi her yerde DRA; "Ragnar Studyo" yalnizca ekranda
    // gorunen bir yazi, kimlik degil.
    title: "DRA",
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    center: true,
    // Acilis ekrani statik bir sayfa; hicbir koprüye ihtiyaci yok.
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  splashWindow.loadFile(join(ROOT, "web", "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());

  // Guvenlik agi: ana pencere bir sebeple hic hazir olmazsa, cerceve siz ve
  // her zaman ustte duran bu pencere ekranda kilitli kalmasin.
  splashGuard = setTimeout(() => {
    if (splashWindow) {
      console.warn("[dra] ana pencere zamaninda hazir olmadi; acilis ekrani kapatiliyor.");
      destroySplash();
      mainWindow?.show();
    }
  }, SPLASH_MAX_MS);
}

function destroySplash() {
  clearTimeout(splashGuard);
  splashGuard = null;
  splashWindow?.destroy();
  splashWindow = null;
}

/** Ana pencere hazir olunca acilis ekranini kapatir. */
function closeSplash() {
  if (!splashWindow) return 0;
  const gecen = Date.now() - splashShownAt;
  const bekle = Math.max(0, SPLASH_MIN_MS - gecen);
  setTimeout(destroySplash, bekle);
  return bekle;
}

/* ------------------------------------------------------------- pencere */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#04070c",
    autoHideMenuBar: true,
    show: false,
    title: "DRA",
    webPreferences: {
      preload: join(HERE, "preload.cjs"),
      // Arayuz Node'a dogrudan erisemez; yalnizca preload'daki dar yuzey.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Pencere gizliyken Chromium sayfayi kisar: zamanlayicilar dakikada
      // bire duser, requestAnimationFrame ise tamamen durur. DRA gizli
      // baslayip tepside dinledigi icin bu, uyandirma sozcugunu, alarmlari
      // ve yanitlari felce ugratirdi. Kisma kapali.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(join(ROOT, "web", "index.html"));

  mainWindow.once("ready-to-show", () => {
    // Gizli acilista pencere gosterilmez; arayuz arka planda calisir,
    // mikrofonu dinler ve adi duyulunca kendini gosterir.
    if (GIZLI_BASLAT) return;
    const bekle = closeSplash();
    setTimeout(() => mainWindow?.show(), bekle);
  });

  // Arayuz yuklenemezse kullaniciyi bos ekranla birakma: acilis ekranini
  // kapat, pencereyi goster ki en azindan durum gorulebilsin.
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[dra] arayuz yuklenemedi (${code}): ${desc}`);
    destroySplash();
    mainWindow?.show();
  });

  // Disari acilan baglantilar varsayilan tarayiciya gitsin,
  // uygulamanin icinde acilmasin.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  /*
   * PENCERE KENDI ADRESINDEN AYRILAMAZ.
   *
   * Bu pencereye preload bagli: icindeki sayfa `window.dra` uzerinden
   * bilgisayara erisebiliyor — dosya okuma, e-posta, program calistirma,
   * hepsi. O yetkiyi yalnizca KENDI arayuzumuz hak ediyor.
   *
   * setWindowOpenHandler yalnizca YENI pencere acma denemelerini
   * yakaliyor. Ayni pencerenin baska bir adrese gitmesi (target'siz bir
   * bag, `location.href = …`, form gonderimi, meta refresh) oradan
   * gecmiyor. Boyle bir gezinme, uzak bir sayfayi tam yetkili kopruyle
   * ayni yere koyardi. Arastirma sonuclari ve e-posta iceriklerinde
   * disaridan gelen adresler tasindigi icin bu teorik bir risk degil.
   *
   * Kural: uygulamanin kendi dosyasi disinda hicbir yere gidilmez;
   * http(s) ise varsayilan tarayicida acilir.
   */
  const ARAYUZ = new URL(`file://${join(ROOT, "web", "index.html")}`).href;

  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Sayfanin kendini yenilemesi ya da cipa (#bolum) serbest.
    if (url === ARAYUZ || url.startsWith(`${ARAYUZ}#`) || url.startsWith(`${ARAYUZ}?`)) return;

    event.preventDefault();
    console.warn(`[dra] pencere disariya gitmeye calisti, engellendi: ${url}`);
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Gomulu webview de ayni kapidan gecmeli; hic kullanmiyoruz.
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  // Kapatma dugmesi uygulamayi sonlandirmaz, tepsiye indirir.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function showWindow() {
  // Tepsiden geri cagirmada acilis ekrani gosterilmez; o yalnizca ilk acilista.
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* --------------------------------------------------------------- tepsi */

/** Basit bir daire simgesi — harici dosya gerektirmesin. */
function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <circle cx="16" cy="16" r="13" fill="none" stroke="#35e6ff" stroke-width="2"/>
    <circle cx="16" cy="16" r="5" fill="#35e6ff"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("DRA");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "DRA'yi goster", click: showWindow },
      { label: "Uyandir", click: () => mainWindow?.webContents.send("dra:wake") },
      { label: "Uyut", click: () => mainWindow?.webContents.send("dra:sleep") },
      { type: "separator" },
      {
        label: "Cikis",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

/* ----------------------------------------------------------------- IPC */

/** Her IPC islemini ayni bicimde sarmalar: hata firlatmak yerine dondurur. */
function handle(channel, work) {
  ipcMain.handle(channel, async (_event, payload = {}) => {
    try {
      const result = await work(payload);
      return { ok: true, ...(result || {}) };
    } catch (err) {
      console.error(`[dra] ${channel}:`, err?.message || err);
      // Izin eksikligi arayuzde soruya donusecek; hatanin kimligi kaybolmasin.
      return {
        ok: false,
        error: err?.message || "Islem basarisiz.",
        ...(err?.code ? { code: err.code } : {}),
        ...(err?.scope ? { scope: err.scope, title: err.title, detail: err.detail } : {}),
        ...(Array.isArray(err?.tried) ? { tried: err.tried } : {}),
      };
    }
  });
}

/**
 * Isimli kontrol islemleri. Sunucu surumuyle ayni kume; serbest komut yok.
 */
async function runControl(body) {
  const what = String(body?.action || "");
  switch (what) {
    case "volume": return control.volume(body.direction, Number(body.steps) || 5);
    case "mute": return control.mute();
    case "media": return control.media(body.what);
    case "seek": {
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
    case "power": return control.power(body.what);
    case "brightness": return control.brightness(body.percent);
    case "open": return control.openUrl(body.url);
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
    default: throw new Error(`Bilinmeyen islem: ${what}`);
  }
}

function registerIpc() {
  // Ses motoru ayri bir surecte; coktugunde uygulama olmuyor ama
  // kullanicinin bunu bilmesi gerekiyor.
  stt.onEngineEvent((olay) => {
    mainWindow?.webContents.send("dra:stt:engine", olay);
  });

  handle("dra:health", async () => ({
    platform: process.platform,
    desktop: true,
    // Arayuz gizli mi baslatildigini bilmeli: o zaman mikrofonu kendisi acar.
    hiddenLaunch: GIZLI_BASLAT,
    search: { enabled: searchEnabled, google: googleDurumu() },
    kick: kick.status(),
    tts: tts.status(),
    sttCloud: sttBulut.status(),
    piper: piper.status(),
    mail: mail.status(),
    youtube: youtube.status(),
    apps: await apps.scanInfo(),
  }));

  handle("dra:apps:list", async () => ({ apps: await apps.listApps() }));

  handle("dra:apps:scan", async () => {
    const list = await apps.scanApps();
    return { count: list.length, apps: list };
  });

  handle("dra:apps:launch", async ({ id }) => {
    const list = await apps.listApps();
    // Yalnizca taranmis listeden bir kayit calistirilabilir.
    const entry = list.find((a) => a.id === id);
    if (!entry) throw new Error("Bu uygulama listede yok.");
    await apps.launchApp(entry);
    return { name: entry.name };
  });

  handle("dra:apps:close", async ({ id }) => {
    const list = await apps.listApps();
    const entry = list.find((a) => a.id === id);
    if (!entry) throw new Error("Bu uygulama listede yok.");
    await apps.closeApp(entry);
    return { name: entry.name };
  });

  handle("dra:search:configure", async ({ key, cx }) => {
    const { configureGoogle } = await aramaYukle();
    return { google: configureGoogle({ key, cx }) };
  });

  handle("dra:search:toggle", async ({ enabled }) => {
    // Arama artik kapatilamiyor; eski cagrilar sessizce basarili donsun.
    return { enabled: true };
  });

  handle("dra:search", async ({ query }) => {
    // Kapaliyken modul hic yuklenmez.
    const { search } = await aramaYukle();
    return { result: await search(query) };
  });

  handle("dra:kick:configure", async ({ token, channel }) => ({
    status: kick.configure({ token, channel }),
  }));

  handle("dra:kick:action", async ({ action, args }) => {
    const fn = kick.ACTIONS[action];
    if (!fn) throw new Error("Bilinmeyen moderasyon islemi.");
    const message = await fn(...(args || []));
    return { message: typeof message === "string" ? message : JSON.stringify(message) };
  });

  /* ---------------------------------------------------- izinler ---- */

  handle("dra:perm:list", async () => ({ permissions: await permissions.list() }));
  handle("dra:perm:grant", async ({ scope }) => await permissions.grant(scope));
  handle("dra:perm:revoke", async ({ scope }) =>
    scope === "*" ? await permissions.revokeAll() : await permissions.revoke(scope));

  /* ------------------------------------------------------ rapor ---- */

  handle("dra:report:system", async () => {
    // Yetki denetimi burada: arayuzun "izin var" demesi yetmez.
    await permissions.require("sistem");
    return { report: await report.system() };
  });

  /* ------------------------------------------------ musteri kaynaklari */

  handle("dra:sources:list", async () => ({
    sources: sources.catalog(),
    summary: await messages.summary(),
  }));

  handle("dra:sources:configure", async ({ id, values }) => {
    await permissions.require("isletme");
    return sources.configure(id, values);
  });

  handle("dra:sources:test", async ({ id }) => {
    await permissions.require("isletme");
    return { result: await sources.test(id) };
  });

  handle("dra:sources:collect", async ({ ids }) => {
    await permissions.require("isletme");
    return { result: await sources.collect(ids || []) };
  });

  handle("dra:sources:reply", async ({ id, target, text, messageId }) => {
    await permissions.require("isletme");
    await sources.reply(id, target, text);
    if (messageId) await messages.markReplied(messageId, text);
    return { sent: true };
  });

  handle("dra:messages:list", async (o) => ({
    messages: await messages.list(o || {}),
    summary: await messages.summary(o || {}),
  }));

  handle("dra:messages:add", async ({ from, text }) => {
    const { added } = await messages.ingest("manuel", [{ from, text, at: Date.now() }]);
    return { added };
  });

  handle("dra:messages:mark", async ({ id, reply }) => ({
    message: reply ? await messages.markReplied(id, reply) : await messages.markRead(id),
  }));

  /* --------------------------------------------- otomatik yanit / rapor */

  handle("dra:auto:list", async () => ({
    status: await autoreply.status(),
    rules: await autoreply.list(),
  }));

  handle("dra:auto:mode", async ({ enabled }) => {
    await permissions.require("isletme");
    return { status: await autoreply.setEnabled(enabled) };
  });

  handle("dra:auto:add", async (o) => ({ rule: await autoreply.add(o) }));
  handle("dra:auto:remove", async ({ id }) => await autoreply.remove(id));
  handle("dra:auto:toggle", async ({ id }) => ({ rule: await autoreply.toggle(id) }));

  handle("dra:auto:run", async ({ dryRun }) => {
    await permissions.require("isletme");
    return { result: await autoreply.run({ dryRun: Boolean(dryRun) }) };
  });

  handle("dra:business:report", async ({ days }) => ({
    report: await business.report({ days: Number(days) || 30 }),
  }));

  /* ---------------------------------------------------- youtube ---- */

  handle("dra:yt:configure", async ({ clientId, clientSecret, refreshToken }) => ({
    status: youtube.configure({ clientId, clientSecret, refreshToken }),
  }));

  handle("dra:yt:link", async () => {
    // Tarayiciyi acip kullanicinin onayini bekliyoruz; geri cagirma
    // 127.0.0.1'de kendi actigimiz kisa omurlu sunucuya donuyor.
    await permissions.require("youtube");
    const oturum = await youtube.startAuth();
    shell.openExternal(oturum.url);
    const kod = await oturum.waitForCode();
    const { refreshToken } = await youtube.exchangeCode(kod, oturum.redirect);
    return { refreshToken, status: youtube.status() };
  });

  handle("dra:yt:channel", async () => {
    await permissions.require("youtube");
    return { channel: await youtube.channel() };
  });

  handle("dra:videos:list", async () => ({
    videos: await videos.list(),
    summary: await videos.summary(),
  }));

  handle("dra:videos:add", async (o) => {
    await permissions.require("youtube");
    return { video: await videos.add(o) };
  });

  handle("dra:videos:remove", async ({ id }) => await videos.remove(id));
  handle("dra:videos:update", async ({ id, patch }) => ({
    video: await videos.update(id, patch || {}),
  }));

  /* ----------------------------------------------------- montaj ---- */

  handle("dra:montage:status", async () => ({
    ffmpeg: await montage.ffmpegStatus(),
    templates: montage.TEMPLATES,
  }));

  handle("dra:montage:style", async ({ path }) => {
    await permissions.require("montaj");
    return { style: await editstyle.read(path) };
  });

  handle("dra:montage:pick", async ({ kind }) => {
    // Klasor/dosya secimi ana surecte: arayuz kendi basina yol uyduramaz.
    const secenek = kind === "folder"
      ? { properties: ["openDirectory"] }
      : kind === "video"
        ? { properties: ["openFile"], filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi"] }] }
      : kind === "image"
        ? { properties: ["openFile"], filters: [{ name: "Gorsel", extensions: ["png", "jpg", "jpeg", "webp"] }] }
        : kind === "music"
          ? { properties: ["openFile"], filters: [{ name: "Ses", extensions: ["mp3", "m4a", "wav", "aac"] }] }
          : {
              properties: ["openFile"],
              filters: [{ name: "Montaj projesi", extensions: ["mlt", "kdenlive", "fcpxml", "xml", "json", "prproj"] }],
            };
    const sonuc = await dialog.showOpenDialog(mainWindow, secenek);
    return { path: sonuc.canceled ? null : sonuc.filePaths[0] };
  });

  handle("dra:montage:render", async (o) => {
    await permissions.require("montaj");
    const style = o.stylePath ? await editstyle.read(o.stylePath) : null;
    const plan = montage.planFromStyle(style, { template: o.template });
    const result = await montage.render({
      clipsDir: o.clipsDir,
      plan,
      title: o.title,
      titleImage: o.titleImage,
      music: o.music,
      out: o.out,
      onProgress: (p) => mainWindow?.webContents.send("dra:montage:progress", p),
    });
    return { result };
  });

  /* ---------------------------------------------------- e-posta ---- */

  handle("dra:mail:configure", async ({ user, pass, host }) => ({
    status: mail.configure({ user, pass, host }),
  }));

  handle("dra:mail:test", async () => {
    await permissions.require("eposta");
    return await mail.test();
  });

  handle("dra:mail:summary", async ({ days }) => {
    await permissions.require("eposta");
    return { summary: await mail.summary({ days: Number(days) || 2 }) };
  });

  /* ---------------------------------------------- bilgisayar kontrolu */

  handle("dra:control", async (o) => {
    await permissions.require("kontrol");
    return { result: await runControl(o) };
  });

  handle("dra:control:foreground", async () => {
    // On plandaki pencerenin basligi da bir erisim; yetki sart.
    await permissions.require("kontrol");
    return { foreground: await control.foreground() };
  });

  handle("dra:media:find", async ({ query }) => {
    await permissions.require("kontrol");
    return { video: await media.findVideo(query) };
  });

  handle("dra:search:rich", async ({ query, limit }) => {
    const { richSearch } = await aramaYukle();
    return { result: await richSearch(query, { limit: Number(limit) || 4 }) };
  });

  /* ----------------------------------------------------- piper ----- */

  handle("dra:piper:configure", async ({ bin, voice }) => ({
    status: piper.configure({ bin, voice }),
  }));
  handle("dra:piper:test", async () => await piper.test());
  handle("dra:piper:speak", async ({ text }) => {
    const { audio, type, truncated } = await piper.speak(text);
    return { audio: audio.toString("base64"), type, truncated };
  });

  handle("dra:piper:pick", async ({ kind }) => {
    const secenek = kind === "voice"
      ? { properties: ["openFile"], filters: [{ name: "Piper ses modeli", extensions: ["onnx"] }] }
      : { properties: ["openFile"] };
    const sonuc = await dialog.showOpenDialog(mainWindow, secenek);
    return { path: sonuc.canceled ? null : sonuc.filePaths[0] };
  });

  /* ------------------------------------------------ seslendirme ---- */

  handle("dra:tts:configure", async ({ apiKey, voiceId, model }) => ({
    status: tts.configure({ apiKey, voiceId, model }),
  }));

  handle("dra:tts:voices", async () => ({ voices: await tts.voices() }));
  handle("dra:tts:models", async () => ({ models: await tts.models() }));
  handle("dra:tts:test", async () => await tts.test());

  handle("dra:tts:speak", async ({ text }) => {
    const { audio, type, chars, truncated } = await tts.speak(text);
    // Ses baytlari base64 olarak arayuze gecer; anahtar ana surecte kalir.
    return { audio: audio.toString("base64"), type, chars, truncated };
  });

  /* ----------------------------------------- bulutta ses tanima ---- */

  handle("dra:stt:cloud:configure", async ({ provider = "elevenlabs", key, model }) => {
    // Whisper bu bilgisayarda calisiyor: once sunucusunu baslatip yerel
    // adresini veriyoruz. Baska saglayici secilince kapatiyoruz ki ekran
    // karti ve bellek bosa dolmasin.
    if (provider === "whisper") {
      const adres = await whisper.baslat();
      return { status: sttBulut.configure({ provider, adres }), whisper: await whisper.durum() };
    }
    whisper.durdur();
    return { status: sttBulut.configure({ provider, key, model }) };
  });

  /* ------------------------------------------ whisper (bu bilgisayar) */

  handle("dra:whisper:status", async () => ({ status: await whisper.durum() }));

  handle("dra:whisper:install", async ({ ekranKarti = "otomatik" }) => ({
    status: await whisper.kur({
      ekranKarti,
      onProgress: (p) => mainWindow?.webContents.send("dra:whisper:progress", p),
    }),
  }));

  // Indirme engellenirse: kullanici modeli tarayicidan indirip gosterir.
  handle("dra:whisper:pick-model", async () => {
    const sonuc = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Whisper modeli", extensions: ["bin"] }],
    });
    if (sonuc.canceled) return { status: await whisper.durum() };
    return { status: await whisper.modelSec(sonuc.filePaths[0]) };
  });

  handle("dra:whisper:remove", async () => {
    sttBulut.configure({ provider: "elevenlabs" });
    return { status: await whisper.kaldir() };
  });

  // Ses baytlari burada metne donusur; anahtar arayuze hic gecmez.
  handle("dra:stt:cloud", async ({ pcm }) => await sttBulut.transcribe(pcm));

  /* --------------------------------------------- gomulu ses tanima -- */

  handle("dra:stt:status", async () => ({ status: await stt.status() }));

  handle("dra:stt:install", async () => {
    // Ilerleme arayuze canli bildirilir; indirme birkac dakika surebilir.
    const result = await stt.installModel((percent) => {
      mainWindow?.webContents.send("dra:stt:progress", { percent });
    });
    return result;
  });

  handle("dra:stt:use-folder", async ({ path }) => stt.useModelFrom(path));

  /** Kullaniciya klasor sectirir; indirme engellenirse elle kurmanin yolu. */
  handle("dra:stt:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Vosk model klasorunu secin",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await stt.useModelFrom(result.filePaths[0])) };
  });

  handle("dra:stt:inspect", async () => ({ info: await stt.inspect() }));

  handle("dra:stt:remove", async () => stt.removeModel());

  handle("dra:stt:start", async ({ grammar } = {}) => {
    // Sonuclar isci surecinden gelip dogrudan arayuze aktariliyor.
    const durum = await stt.start((sonuc) => {
      mainWindow?.webContents.send("dra:stt:result", sonuc);
    }, Array.isArray(grammar) && grammar.length ? grammar : null);
    return { status: durum };
  });

  handle("dra:stt:grammar", async ({ words }) => stt.setGrammar(
    Array.isArray(words) && words.length ? words : null,
  ));

  handle("dra:stt:stop", async () => {
    stt.stop();
    return {};
  });

  /**
   * Ses parcasi. Cok sik geldigi icin `handle` yerine tek yonlu `on`
   * kullaniliyor; sonuc ayri bir olayla geri gonderiliyor.
   */
  ipcMain.on("dra:stt:feed", (_event, chunk) => {
    // Isci surecine aktariliyor; sonuc oradan olay olarak donuyor.
    stt.feed(chunk);
  });

  handle("dra:autostart", async ({ enabled }) => {
    // "--gizli" bayragi sayesinde acilista pencere gosterilmiyor.
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
      args: ["--gizli"],
    });
    return { enabled: Boolean(enabled) };
  });

  handle("dra:autostart:get", async () => ({
    enabled: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.on("dra:window:minimize", () => mainWindow?.minimize());
  ipcMain.on("dra:window:close", () => mainWindow?.hide());

  /** Arayuz, adini duyunca kendini gosterebilsin. */
  ipcMain.on("dra:window:show", () => showWindow());
  ipcMain.on("dra:window:hide", () => mainWindow?.hide());
}

/* ------------------------------------------------------------- yasam */

// Tek ornek: ikinci kez calistirilirsa var olan pencere one gelir.
// Isletim sisteminin gordugu ad: DRA.
app.setName("DRA");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    // Whisper'in klasoru: kullanici adinda Turkce harf varsa ASCII bir
    // yere (whisper.cpp de Vosk gibi o yolu okuyamiyor).
    whisper.ayarla({
      kok: guvenliKok({
        userData: app.getPath("userData"),
        programData: process.env.ProgramData,
        platform: process.platform,
        alt: "whisper",
      }),
    });
    whisper.onOlay((olay) => mainWindow?.webContents.send("dra:whisper:event", olay));
    setupPermissions();
    registerIpc();

    // Yayin zamanlayicisi. Yetki verilmemisse hicbir sey yapmaz; olaylari
    // arayuze bildiriyoruz ki yukleme sessizce olmasin.
    scheduler.onEvent((olay) => mainWindow?.webContents.send("dra:yt:event", olay));
    scheduler.start();
    // Acilis ekrani yalnizca kullanici uygulamayi elle actiginda gosterilir.
    if (!GIZLI_BASLAT) createSplash();
    createWindow();
    createTray();

    // Herhangi bir uygulamadayken DRA'yi cagirmak icin kisayol.
    globalShortcut.register("Alt+Space", () => {
      showWindow();
      mainWindow?.webContents.send("dra:wake");
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Pencereler kapaninca uygulama kapanmaz — tepside beklemeye devam eder.
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    // Arka planda Whisper programi kalmasin.
    whisper.durdur();
  });
}
