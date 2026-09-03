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

import { app, utilityProcess } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);

/** Kucuk Turkce model — yaklasik 45 MB, komut tanima icin fazlasiyla yeterli. */
const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip";
const SAMPLE_RATE = 16000;

let worker = null;
let workerReady = false;
let modelDir = null;
let busy = false;
let lastError = null;

/** Isci coktugunde ya da hata verdiginde haber verilecek yer. */
let onEvent = () => {};
export function onEngineEvent(handler) {
  onEvent = typeof handler === "function" ? handler : () => {};
}

/** Modelin duracagi klasor (kullanici veri dizini). */
function modelRoot() {
  return join(app.getPath("userData"), "ses-modeli");
}

/**
 * Klasor gecerli bir Vosk modeli mi?
 *
 * Vosk'un iki farkli dosya duzeni var ve ikisini de tanimak gerekiyor:
 *
 *  Klasik (buyuk modeller):  am/  conf/  graph/  ivector/
 *  Kompakt (kucuk modeller): final.mdl, HCLr.fst, Gr.fst, mfcc.conf, ivector/
 *
 * Turkce kucuk model (vosk-model-small-tr-0.3) kompakt duzende geliyor —
 * icinde hic "conf" klasoru yok. Yalnizca klasik duzeni aramak, gercek
 * modelin taninmamasina yol aciyordu.
 */
function isModelDir(dir) {
  // Klasik duzen
  if (existsSync(join(dir, "conf"))) return true;
  // Kompakt duzen: akustik model + ya oznitelik ayari ya da graf dosyasi
  return (
    existsSync(join(dir, "final.mdl")) &&
    (existsSync(join(dir, "mfcc.conf")) || existsSync(join(dir, "HCLr.fst")))
  );
}

/** Verilen kokun altinda modeli belirli bir derinlige kadar arar. */
async function findModel(root, depth = 3) {
  if (!existsSync(root)) return null;

  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, level] = queue.shift();

    if (isModelDir(dir)) return dir;

    if (level >= depth) continue;
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) queue.push([join(dir, entry.name), level + 1]);
      }
    } catch {
      /* okunamayan klasoru atla */
    }
  }
  return null;
}

/** Teshis icin: klasorde gercekte ne var? */
async function describeTree(root, depth = 2) {
  const lines = [];
  async function walk(dir, level, prefix) {
    if (level > depth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.slice(0, 12)) {
      lines.push(`${prefix}${entry.isDirectory() ? "[" + entry.name + "]" : entry.name}`);
      if (entry.isDirectory()) await walk(join(dir, entry.name), level + 1, prefix + "  ");
    }
  }
  await walk(root, 0, "");
  return lines.length ? lines.join("\n") : "(bos)";
}

/** Indirilen dosya gercekten zip mi? Sunucular hata sayfasini 200 ile de donebiliyor. */
async function looksLikeZip(path) {
  try {
    const handle = await open(path, "r");
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    await handle.close();
    // ZIP dosyalari "PK\x03\x04" ile baslar.
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch {
    return false;
  }
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
    running: workerReady,
    busy,
    sizeMb,
    // Motor ayri bir surecte calisiyor; coktugunde uygulama etkilenmiyor.
    isolated: true,
    lastError,
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

    // Indirilen sey gercekten zip mi? Degilse acmayi denemek anlamsiz.
    if (!(await looksLikeZip(zipPath))) {
      const size = (await stat(zipPath)).size;
      await rm(zipPath, { force: true });
      throw new Error(
        `Inen dosya bir arsiv degil (${size} bayt). Baglantiniz indirmeyi engelliyor ` +
          "olabilir. Modeli tarayicidan elle indirip \"Model klasorunu sec\" ile " +
          "gosterebilirsiniz.",
      );
    }

    await unzip(zipPath, root);
    await rm(zipPath, { force: true });

    modelDir = await findModel(root);
    if (!modelDir) {
      // Tahmin yurutmek yerine klasorde ne oldugunu bildir.
      const tree = await describeTree(root);
      throw new Error(
        "Arsiv acildi ama icinde Vosk modeli bulunamadi. " +
          "(Aranan: \"conf\" klasoru ya da \"final.mdl\" dosyasi.)\nKlasorde su var:\n" + tree,
      );
    }
    return { modelPath: modelDir };
  } finally {
    busy = false;
  }
}

/** Model klasorunun icerigini dondurur (teshis dugmesi icin). */
export async function inspect() {
  const root = modelRoot();
  return {
    root,
    exists: existsSync(root),
    tree: existsSync(root) ? await describeTree(root) : "(klasor yok)",
    modelPath: modelDir || (await findModel(root)),
  };
}

/** Elle indirilmis bir model klasorunu kullanir. */
export async function useModelFrom(path) {
  const found = await findModel(path);
  if (!found) {
    throw new Error(
      "Bu klasorde Vosk modeli bulunamadi. Icinde \"final.mdl\" dosyasi ya da " +
        "\"conf\" klasoru olan klasoru secin (ya da onu iceren ust klasoru)." +
        "\nSecilen klasorde:\n" + (await describeTree(path, 1)),
    );
  }
  modelDir = found;
  return { modelPath: modelDir };
}

/* ------------------------------------------------------------ tanima */

/**
 * Motoru hazirlar.
 *
 * Vosk ayri bir surecte baslatilir; bu surecte olusabilecek bir yerel
 * cokme uygulamayi etkilemez. Model yoksa anlasilir bir hata verilir.
 */
export function start(onResult) {
  if (workerReady) return status();

  return new Promise(async (resolve, reject) => {
    try {
      modelDir = modelDir || (await findModel(modelRoot()));
    } catch {
      modelDir = null;
    }
    if (!modelDir) {
      return reject(Object.assign(new Error("Ses modeli kurulu degil."), { code: "NO_MODEL" }));
    }

    lastError = null;
    const workerPath = join(HERE, "stt-worker.mjs");
    worker = utilityProcess.fork(workerPath, [], { serviceName: "dra-ses-motoru" });

    // Motor makul surede hazir olmazsa asili kalmayalim.
    const zamanAsimi = setTimeout(() => {
      stop();
      reject(new Error("Ses motoru zamaninda baslamadi."));
    }, 12000);

    worker.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(zamanAsimi);
        workerReady = true;
        resolve(status());
        return;
      }
      if (message?.type === "result") {
        onResult?.(message);
        return;
      }
      if (message?.type === "error") {
        lastError = message.message;
        clearTimeout(zamanAsimi);
        if (!workerReady) reject(new Error(message.message));
        else onEvent({ type: "error", message: message.message });
      }
    });

    worker.on("exit", (code) => {
      clearTimeout(zamanAsimi);
      const bekleniyordu = worker === null;
      worker = null;
      workerReady = false;
      if (bekleniyordu || code === 0) return;

      // Yerel cokme: uygulama ayakta, kullaniciya durumu bildiriyoruz.
      lastError = lastError || `Ses motoru beklenmedik sekilde kapandi (kod ${code}).`;
      console.error(`[dra] ${lastError}`);
      onEvent({ type: "crashed", message: lastError });
      reject(new Error(lastError));
    });

    worker.postMessage({ type: "init", modelPath: modelDir });
  });
}

/** Motoru durdurur ve kaynaklari birakir. */
export function stop() {
  const w = worker;
  worker = null;
  workerReady = false;
  if (!w) return;
  try {
    w.postMessage({ type: "close" });
    // Kapanma mesajina yanit vermezse zorla sonlandir.
    setTimeout(() => {
      try { w.kill(); } catch { /* zaten kapandi */ }
    }, 1500);
  } catch {
    try { w.kill(); } catch { /* zaten kapandi */ }
  }
}

/**
 * Ham ses verisini motora verir.
 * 16 kHz, tek kanal, 16-bit tamsayi bekleniyor.
 */
export function feed(pcm) {
  if (!workerReady || !worker) return;
  try {
    worker.postMessage({ type: "feed", pcm });
  } catch (err) {
    lastError = err?.message || "Ses verisi gonderilemedi.";
  }
}

/** Konusma bittiginde bekleyen son sonucu ister. */
export function flush() {
  if (workerReady && worker) worker.postMessage({ type: "reset" });
}
