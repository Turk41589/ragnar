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
import * as stt from "./speech-engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let mainWindow = null;
let tray = null;
let searchEnabled = false;
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
    },
  });

  mainWindow.loadFile(join(ROOT, "web", "index.html"));

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Disari acilan baglantilar varsayilan tarayiciya gitsin,
  // uygulamanin icinde acilmasin.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Kapatma dugmesi uygulamayi sonlandirmaz, tepsiye indirir.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function showWindow() {
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
      return { ok: false, error: err?.message || "Islem basarisiz." };
    }
  });
}

function registerIpc() {
  handle("dra:health", async () => ({
    platform: process.platform,
    desktop: true,
    search: { enabled: searchEnabled },
    kick: kick.status(),
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

  handle("dra:search:toggle", async ({ enabled }) => {
    searchEnabled = Boolean(enabled);
    return { enabled: searchEnabled };
  });

  handle("dra:search", async ({ query }) => {
    if (!searchEnabled) throw new Error("Web aramasi kapali. Ayar sekmesinden acabilirsiniz.");
    // Kapaliyken modul hic yuklenmez.
    const { search } = await import("../server/search.mjs");
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

  handle("dra:stt:start", async () => ({ status: await stt.start() }));

  handle("dra:stt:stop", async () => {
    stt.stop();
    return {};
  });

  /**
   * Ses parcasi. Cok sik geldigi icin `handle` yerine tek yonlu `on`
   * kullaniliyor; sonuc ayri bir olayla geri gonderiliyor.
   */
  ipcMain.on("dra:stt:feed", (_event, chunk) => {
    try {
      const result = stt.feed(Buffer.from(chunk));
      if (result) mainWindow?.webContents.send("dra:stt:result", result);
    } catch (err) {
      console.error("[dra] ses tanima:", err?.message || err);
    }
  });

  handle("dra:autostart", async ({ enabled }) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true });
    return { enabled: Boolean(enabled) };
  });

  handle("dra:autostart:get", async () => ({
    enabled: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.on("dra:window:minimize", () => mainWindow?.minimize());
  ipcMain.on("dra:window:close", () => mainWindow?.hide());
}

/* ------------------------------------------------------------- yasam */

// Tek ornek: ikinci kez calistirilirsa var olan pencere one gelir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    setupPermissions();
    registerIpc();
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

  app.on("will-quit", () => globalShortcut.unregisterAll());
}
