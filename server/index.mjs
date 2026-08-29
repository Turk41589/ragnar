/**
 * DRA sunucusu.
 *
 * Tek isi var: web/ klasorunu localhost uzerinden servis etmek.
 * Bu gerekli cunku tarayicilar file:// uzerinden mikrofona izin vermez;
 * localhost ise "guvenli baglam" sayilir.
 *
 * Disariya HICBIR istek atmaz. Ne bir yapay zeka servisi, ne bir analitik,
 * ne de baska bir ucuncu taraf. Bagimliligi da yok — sadece Node.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB_DIR = join(ROOT, "web");

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
    return sendJson(res, 200, { ok: true });
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
