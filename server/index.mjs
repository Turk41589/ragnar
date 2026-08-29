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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB_DIR = join(ROOT, "web");

/** Web aramasi varsayilan olarak KAPALI; ayardan acilir. */
let searchEnabled = false;

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
async function handleAction(req, res, work) {
  const reason = rejectReason(req);
  if (reason) return sendJson(res, 403, { error: reason });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: "Gecersiz istek govdesi." });
  }

  try {
    const result = await work(body);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error("[dra] islem hatasi:", err?.message || err);
    return sendJson(res, 200, { ok: false, error: err?.message || "Islem basarisiz." });
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      platform: process.platform,
      // Jeton yalnizca ayni kokenden okunabilir; capraz kokenli JavaScript
      // yaniti goremez cunku CORS basligi gondermiyoruz.
      token: SESSION_TOKEN,
      search: { enabled: searchEnabled },
      kick: kick.status(),
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

  if (url.pathname === "/api/search" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      if (!searchEnabled) {
        throw new Error("Web aramasi kapali. Ayar sekmesinden acabilirsiniz.");
      }
      // Modul yalnizca gerektiginde yuklenir; kapaliyken hic dokunulmaz.
      const { search } = await import("./search.mjs");
      return { result: await search(body.query) };
    });
  }

  if (url.pathname === "/api/search/toggle" && req.method === "POST") {
    return handleAction(req, res, async (body) => {
      searchEnabled = Boolean(body.enabled);
      console.log(`[dra] web aramasi ${searchEnabled ? "acildi" : "kapatildi"}`);
      return { enabled: searchEnabled };
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

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Desteklenmeyen metot." });
  }

  return serveStatic(req, res, url.pathname);
});

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
