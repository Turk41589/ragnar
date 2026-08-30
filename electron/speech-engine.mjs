/**
 * Gomulu ses tanima motoru.
 *
 * Neden gerekli: tarayicilarin ses tanimasi ya sesi saticinin sunucusuna
 * gonderiyor ya da Electron'da hic calismiyor (Chrome'un cihaz ustu dil
 * modelini kendi bilesen guncelleyicisi yonetiyor, Electron'da o yok).
 *
 * Bu modul Vosk'u dogrudan uygulamanin icinde calistirir: model diskte
 * durur, ses hicbir yere gitmez, internet gerekmez.
 */

import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);

/** Kucuk Turkce model — yaklasik 45 MB, komut tanima icin fazlasiyla yeterli. */
const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip";
const SAMPLE_RATE = 16000;

let vosk = null;
let model = null;
let recognizer = null;
let modelDir = null;
let busy = false;

/** Modelin duracagi klasor (kullanici veri dizini). */
function modelRoot() {
  return join(app.getPath("userData"), "ses-modeli");
}

/**
 * Klasorde gecerli bir Vosk modeli var mi?
 * Vosk modelleri "am" ve "conf" alt klasorleriyle gelir.
 */
async function findModel(root) {
  if (!existsSync(root)) return null;
  const candidates = [root];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(root, entry.name));
    }
  } catch {
    return null;
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, "am")) && existsSync(join(dir, "conf"))) return dir;
  }
  return null;
}

/** Motorun ve modelin durumu. */
export async function status() {
  const dir = modelDir || (await findModel(modelRoot()));
  let sizeMb = null;
  if (dir) {
    try {
      const s = await stat(dir);
      sizeMb = s.isDirectory() ? null : Math.round(s.size / 1048576);
    } catch {
      /* onemsiz */
    }
  }
  return {
    engine: "vosk",
    modelReady: Boolean(dir),
    modelPath: dir,
    running: Boolean(recognizer),
    busy,
    sizeMb,
  };
}

/* --------------------------------------------------------- model kurma */

/** Zip'i platformun kendi araciyla acar — ek bagimlilik istemez. */
async function unzip(zipPath, target) {
  await mkdir(target, { recursive: true });
  if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command",
       `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${target}' -Force`],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } else {
    // Modern tar zip da acabiliyor.
    await execFileAsync("tar", ["-xf", zipPath, "-C", target]);
  }
}

/**
 * Modeli indirir ve acar. Ilerlemeyi `onProgress(yuzde)` ile bildirir.
 * Bu, uygulamanin disariya cikan TEK istegi ve yalnizca bir kez olur.
 */
export async function installModel(onProgress = () => {}) {
  if (busy) throw new Error("Model kurulumu zaten suruyor.");
  busy = true;
  const root = modelRoot();
  const zipPath = join(root, "model.zip");

  try {
    await mkdir(root, { recursive: true });
    onProgress(0);

    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Model indirilemedi (${res.status}).`);

    const total = Number(res.headers.get("content-length")) || 0;
    let received = 0;

    const body = Readable.fromWeb(res.body);
    body.on("data", (chunk) => {
      received += chunk.length;
      if (total) onProgress(Math.round((received / total) * 100));
    });

    await pipeline(body, createWriteStream(zipPath));
    onProgress(100);

    await unzip(zipPath, root);
    await rm(zipPath, { force: true });

    modelDir = await findModel(root);
    if (!modelDir) throw new Error("Indirilen dosyada gecerli bir model bulunamadi.");
    return { modelPath: modelDir };
  } finally {
    busy = false;
  }
}

/** Elle indirilmis bir model klasorunu kullanir. */
export async function useModelFrom(path) {
  const found = await findModel(path);
  if (!found) throw new Error("Bu klasorde gecerli bir Vosk modeli yok.");
  modelDir = found;
  return { modelPath: modelDir };
}

/* ------------------------------------------------------------ tanima */

/** Motoru hazirlar. Model yoksa anlasilir bir hata verir. */
export async function start() {
  if (recognizer) return status();

  modelDir = modelDir || (await findModel(modelRoot()));
  if (!modelDir) {
    throw Object.assign(new Error("Ses modeli kurulu degil."), { code: "NO_MODEL" });
  }

  if (!vosk) {
    // Yerel kutuphane yalnizca gerektiginde yuklenir.
    const mod = await import("vosk-koffi");
    vosk = mod.default || mod;
    vosk.setLogLevel?.(-1);
  }

  model = model || new vosk.Model(modelDir);
  recognizer = new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });
  recognizer.setWords(false);
  return status();
}

/** Motoru durdurur ve kaynaklari birakir. */
export function stop() {
  try {
    recognizer?.free();
  } catch {
    /* onemsiz */
  }
  recognizer = null;
}

/**
 * Ham ses verisini motora verir.
 * 16 kHz, tek kanal, 16-bit tamsayi bekleniyor.
 *
 * Doner: { final } tam cumle bittiyse, { partial } konusma surerken.
 */
export function feed(buffer) {
  if (!recognizer) return null;

  const done = recognizer.acceptWaveform(buffer);
  if (done) {
    const text = (JSON.parse(recognizer.result())?.text || "").trim();
    return text ? { final: text } : null;
  }

  const partial = (JSON.parse(recognizer.partialResult())?.partial || "").trim();
  return partial ? { partial } : null;
}

/** Konusma bittiginde bekleyen son sonucu alir. */
export function flush() {
  if (!recognizer) return null;
  const text = (JSON.parse(recognizer.finalResult())?.text || "").trim();
  return text ? { final: text } : null;
}
