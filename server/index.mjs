/**
 * DRA sunucusu.
 *
 * Iki isi var:
 *  1. web/ klasorunu localhost uzerinden servis eder. (Mikrofon izni icin sart:
 *     tarayicilar file:// uzerinden mikrofona izin vermez, localhost guvenli sayilir.)
 *  2. /api/chat ucundan Claude'a kopru kurar; API anahtari burada kalir.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB_DIR = join(ROOT, "web");

// --- Kucuk .env yukleyici (harici bagimlilik istemiyoruz) ------------------
function loadEnvFile() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

// Beyin modulu .env yuklendikten SONRA import edilmeli.
const { askStream, brainStatus, describeError } = await import("./brain.mjs");

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

/** Sunucudan tarayiciya olay akisi (SSE). */
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: "Gecersiz istek." });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return sendJson(res, 400, { error: "Bos istek." });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    const text = await askStream(
      { prompt, history: body.history, context: body.context },
      (delta) => {
        if (!aborted) sseWrite(res, "delta", { text: delta });
      },
    );
    if (!aborted) sseWrite(res, "done", { text });
  } catch (err) {
    console.error("[dra] beyin hatasi:", err?.message || err);
    if (!aborted) sseWrite(res, "error", { message: describeError(err) });
  } finally {
    res.end();
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
    return sendJson(res, 200, { ok: true, brain: brainStatus() });
  }

  if (url.pathname === "/api/chat") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST bekleniyor." });
    return handleChat(req, res);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Desteklenmeyen metot." });
  }

  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const brain = brainStatus();
  console.log("");
  console.log("  ██████╗ ██████╗  █████╗ ");
  console.log("  ██╔══██╗██╔══██╗██╔══██╗");
  console.log("  ██║  ██║██████╔╝███████║");
  console.log("  ██║  ██║██╔══██╗██╔══██║");
  console.log("  ██████╔╝██║  ██║██║  ██║");
  console.log("  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝");
  console.log("");
  console.log(`  Arayuz    : http://localhost:${PORT}`);
  console.log(
    `  Beyin     : ${brain.ready ? `bagli (${brain.model})` : `cevrimdisi — ${brain.reason}`}`,
  );
  console.log(`  Uyandirma : mikrofon acikken "DRA" deyin`);
  console.log("");
});
