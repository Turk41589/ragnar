/**
 * Whisper, BU BILGISAYARDA (whisper.cpp).
 *
 * "Kendi tanimamizi yapalim" isteginin gercekci karsiligi bu: sifirdan
 * bir ses modeli egitmek milyonlarca saatlik kayit ister. Whisper ise
 * acik kaynakli, Turkcede cok iyi ve tamamen bu bilgisayarda calisiyor —
 * internet yok, ucret yok, ses hic disari cikmiyor.
 *
 * Nasil calisiyor:
 *   - whisper.cpp'nin hazir Windows programi (whisper-server.exe) ve
 *     "large-v3-turbo" modeli bir kez indiriliyor (~580 MB).
 *   - NVIDIA ekran karti varsa onu kullanan surum de indiriliyor; cumle
 *     neredeyse aninda yaziya donuyor. Yoksa islemcide calisiyor (daha
 *     yavas: kisa bir komut birkac saniye).
 *   - Program yalnizca 127.0.0.1'de dinliyor; baska bir makine ona
 *     ulasamiyor.
 *
 * Bu dosya Electron'a bagli degil: klasor ve adresler disaridan veriliyor
 * ki duz Node ile sinanabilsin.
 */

import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { createServer } from "node:net";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Sabitlenmis surum. En yeni surumlerde hazir Windows programi
 * yayinlanmiyor; bu surumde ikisi de (islemci ve ekran karti) var.
 */
export const SURUM = "v1.8.7";

export const IKILILER = Object.freeze({
  islemci: { dosya: "whisper-bin-x64.zip", boyut: "4 MB" },
  ekranKarti: { dosya: "whisper-cublas-12.4.0-bin-x64.zip", boyut: "460 MB" },
});

export const MODEL = Object.freeze({
  dosya: "ggml-large-v3-turbo-q5_0.bin",
  adres: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
  boyut: "575 MB",
  /** Bundan kucuk dosya yarim inmis demektir. */
  asgariBayt: 300 * 1024 * 1024,
});

/** Model dosyasinin ilk 4 bayti ("ggml" sihirli sayisi, ters sirada). */
const MODEL_IMZASI = "lmgg";

let ayarlar = {
  kok: null,
  ikiliTaban: `https://github.com/ggml-org/whisper.cpp/releases/download/${SURUM}/`,
  modelAdresi: MODEL.adres,
  platform: process.platform,
  asgariModelBayt: MODEL.asgariBayt,
  /** Model yuklenirken beklenecek en uzun sure. */
  baslamaSiniri: 180000,
  nvidiaVarMi: async () => {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", ["-L"], { timeout: 5000, windowsHide: true });
      return /GPU \d+:/.test(stdout);
    } catch {
      return false;
    }
  },
};

/** Klasoru ve (testlerde) indirme adreslerini ayarlar. */
export function ayarla(yeni = {}) {
  ayarlar = { ...ayarlar, ...yeni };
}

let surec = null;
let adres = null;
let hizlandirma = null;
let kuruluyor = false;
let baslatiliyor = null;
let sonHata = null;
const dinleyiciler = new Set();

/** "durdu" olaylarini dinler (ana surec arayuze bildirir). */
export function onOlay(fn) {
  dinleyiciler.add(fn);
  return () => dinleyiciler.delete(fn);
}
const yay = (olay) => {
  for (const fn of dinleyiciler) {
    try {
      fn(olay);
    } catch {
      /* dinleyici hatasi sureci bozmasin */
    }
  }
};

function kok() {
  if (!ayarlar.kok) throw new Error("Whisper klasoru ayarlanmadi.");
  return ayarlar.kok;
}

const kayitYolu = () => join(kok(), "kurulum.json");

async function kayitOku() {
  try {
    return JSON.parse(await readFile(kayitYolu(), "utf8"));
  } catch {
    return {};
  }
}

async function kayitYaz(k) {
  await mkdir(kok(), { recursive: true });
  await writeFile(kayitYolu(), JSON.stringify(k, null, 2));
}

/** Model dosyasi gercekten bir Whisper modeli mi? Doner: null ya da sorun. */
export async function modelSorunu(yol) {
  let bilgi;
  try {
    bilgi = await stat(yol);
  } catch {
    return "Model dosyasi bulunamadi.";
  }
  if (bilgi.size < ayarlar.asgariModelBayt) {
    return `Model dosyasi eksik gorunuyor (${Math.round(bilgi.size / 1048576)} MB). Indirme yarim kalmis olabilir.`;
  }
  const fd = await open(yol, "r");
  try {
    const tampon = Buffer.alloc(4);
    await fd.read(tampon, 0, 4, 0);
    if (tampon.toString("latin1") !== MODEL_IMZASI) {
      return "Bu dosya bir Whisper (ggml) modeli degil.";
    }
  } finally {
    await fd.close();
  }
  return null;
}

/** Arsivin icinde whisper-server programini arar. */
async function sunucuBul(dizin, derinlik = 3) {
  let girdiler;
  try {
    girdiler = await readdir(dizin, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const g of girdiler) {
    if (g.isFile() && /^whisper-server(\.exe)?$/i.test(g.name)) return join(dizin, g.name);
  }
  if (derinlik <= 0) return null;
  for (const g of girdiler) {
    if (!g.isDirectory()) continue;
    const bulunan = await sunucuBul(join(dizin, g.name), derinlik - 1);
    if (bulunan) return bulunan;
  }
  return null;
}

async function ac(zip, hedef) {
  await mkdir(hedef, { recursive: true });
  if (ayarlar.platform === "win32" && process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${hedef}' -Force`],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } else {
    // bsdtar zip acabiliyor, GNU tar acamiyor; o zaman unzip.
    try {
      await execFileAsync("tar", ["-xf", zip, "-C", hedef]);
    } catch {
      await execFileAsync("unzip", ["-o", "-q", zip, "-d", hedef]);
    }
  }
}

/** Indirir; once .part'a yazip bitince yerine koyar (yarim dosya kalmasin). */
async function indir(url, hedef, ilerleme) {
  await mkdir(dirname(hedef), { recursive: true });
  const gecici = `${hedef}.part`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Indirilemedi (${new URL(url).hostname}): ${err?.message || err}`);
  }
  if (!res.ok || !res.body) throw new Error(`Indirilemedi (${new URL(url).hostname}: ${res.status}).`);

  const toplam = Number(res.headers.get("content-length")) || 0;
  let gelen = 0;
  let sonYuzde = -1;
  const akis = Readable.fromWeb(res.body);
  akis.on("data", (parca) => {
    gelen += parca.length;
    const yuzde = toplam ? Math.floor((gelen / toplam) * 100) : 0;
    if (yuzde !== sonYuzde) {
      sonYuzde = yuzde;
      ilerleme?.(yuzde);
    }
  });
  await pipeline(akis, createWriteStream(gecici));
  await rename(gecici, hedef);
}

/** Durum: kurulu mu, calisiyor mu, hangi donanimda? */
export async function durum() {
  const k = ayarlar.kok ? await kayitOku() : {};
  const var_ = (y) => Boolean(y && existsSync(y));
  return {
    destekleniyor: ayarlar.platform === "win32",
    islemci: var_(k.islemci),
    ekranKarti: var_(k.ekranKarti),
    model: var_(k.model) ? k.model : null,
    kurulu: var_(k.model) && (var_(k.islemci) || var_(k.ekranKarti)),
    calisiyor: Boolean(surec && adres),
    pid: surec?.pid ?? null,
    adres,
    hizlandirma,
    kuruluyor,
    sonHata,
  };
}

/**
 * Programi ve modeli indirir. Ilerleme: onProgress({ adim, yuzde }).
 * ekranKarti: "otomatik" (NVIDIA varsa) | true | false
 */
export async function kur({ onProgress = () => {}, ekranKarti = "otomatik" } = {}) {
  if (ayarlar.platform !== "win32") {
    throw new Error("Whisper'in hazir programi yalnizca Windows icin. Bu bilgisayarda ElevenLabs ya da OpenAI secin.");
  }
  if (kuruluyor) throw new Error("Whisper kurulumu zaten suruyor.");
  kuruluyor = true;
  sonHata = null;
  const notlar = [];
  try {
    await mkdir(kok(), { recursive: true });
    const kayit = await kayitOku();

    // 1) Islemci surumu — kucuk, her zaman kurulur; ekran karti surumu
    //    acilamazsa DRA buna doner.
    if (!kayit.islemci || !existsSync(kayit.islemci)) {
      const zip = join(kok(), "islemci.zip");
      await indir(ayarlar.ikiliTaban + IKILILER.islemci.dosya, zip, (y) => onProgress({ adim: "program", yuzde: y }));
      const hedef = join(kok(), "islemci");
      await rm(hedef, { recursive: true, force: true });
      await ac(zip, hedef);
      await rm(zip, { force: true });
      const exe = await sunucuBul(hedef);
      if (!exe) throw new Error("Indirilen arsivde whisper-server programi bulunamadi.");
      kayit.islemci = exe;
      await kayitYaz(kayit);
    }

    // 2) Ekran karti surumu (NVIDIA). Basarisizlik kurulumu durdurmaz.
    const gpuIste = ekranKarti === "otomatik" ? await ayarlar.nvidiaVarMi() : Boolean(ekranKarti);
    if (gpuIste && (!kayit.ekranKarti || !existsSync(kayit.ekranKarti))) {
      try {
        const zip = join(kok(), "ekran-karti.zip");
        await indir(ayarlar.ikiliTaban + IKILILER.ekranKarti.dosya, zip, (y) => onProgress({ adim: "ekran karti", yuzde: y }));
        const hedef = join(kok(), "ekran-karti");
        await rm(hedef, { recursive: true, force: true });
        await ac(zip, hedef);
        await rm(zip, { force: true });
        const exe = await sunucuBul(hedef);
        if (exe) {
          kayit.ekranKarti = exe;
          await kayitYaz(kayit);
        }
      } catch (err) {
        notlar.push(`Ekran karti surumu kurulamadi (${err.message}); islemcide calisacak.`);
      }
    }

    // 3) Model.
    if (!kayit.model || (await modelSorunu(kayit.model))) {
      const yol = join(kok(), "model", MODEL.dosya);
      await indir(ayarlar.modelAdresi, yol, (y) => onProgress({ adim: "model", yuzde: y }));
      const sorun = await modelSorunu(yol);
      if (sorun) {
        await rm(yol, { force: true });
        throw new Error(`${sorun} Baglantiniz indirmeyi engelliyor olabilir; modeli tarayicidan indirip «Model dosyasi sec» ile gosterebilirsiniz.`);
      }
      kayit.model = yol;
      await kayitYaz(kayit);
    }

    return { ...(await durum()), notlar };
  } catch (err) {
    sonHata = err.message;
    throw err;
  } finally {
    kuruluyor = false;
  }
}

/**
 * Elle indirilmis bir model dosyasini kullanir. Dosya kendi klasorumuze
 * KOPYALANIYOR: kullanicinin Indirilenler klasoru "C:\Users\msı\..."
 * gibi Turkce harfli olabilir ve whisper.cpp o yolu okuyamaz (Vosk'ta
 * yasadigimiz sorunun aynisi).
 */
export async function modelSec(kaynak) {
  const sorun = await modelSorunu(kaynak);
  if (sorun) throw new Error(sorun);
  const hedef = join(kok(), "model", MODEL.dosya);
  await mkdir(dirname(hedef), { recursive: true });
  if (kaynak !== hedef) await copyFile(kaynak, hedef);
  const kayit = await kayitOku();
  kayit.model = hedef;
  await kayitYaz(kayit);
  return durum();
}

function bosPort() {
  return new Promise((coz, red) => {
    const s = createServer();
    s.unref();
    s.on("error", red);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => coz(port));
    });
  });
}

/** Sunucu "hazir" diyene kadar bekler; surec olurse hemen vazgecer. */
async function hazirBekle(port, cocuk, sinir) {
  const bitis = Date.now() + sinir;
  while (Date.now() < bitis) {
    if (cocuk.exitCode !== null || cocuk.signalCode) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* henuz dinlemiyor */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function dene(exe, model, tur) {
  const port = await bosPort();
  const is = Math.max(2, Math.min(8, availableParallelism() - 1));
  const cocuk = spawn(
    exe,
    ["-m", model, "-l", "tr", "--host", "127.0.0.1", "--port", String(port), "-nt", "-t", String(is)],
    { cwd: dirname(exe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let cikti = "";
  const topla = (p) => {
    cikti = (cikti + p.toString()).slice(-4000);
  };
  cocuk.stdout.on("data", topla);
  cocuk.stderr.on("data", topla);
  cocuk.on("error", (err) => topla(`\n${err.message}`));

  const hazir = await hazirBekle(port, cocuk, ayarlar.baslamaSiniri);
  if (!hazir) {
    cocuk.kill();
    const son = cikti.trim().split(/\r?\n/).slice(-3).join(" | ");
    return { hata: `${tur} surumu baslamadi${son ? `: ${son}` : "."}` };
  }
  return { cocuk, port };
}

/**
 * Sunucuyu baslatir (calisiyorsa ayni adresi doner).
 * Once ekran karti surumu, olmazsa islemci surumu denenir.
 */
export function baslat() {
  if (surec && adres) return Promise.resolve(adres);
  if (baslatiliyor) return baslatiliyor;
  baslatiliyor = (async () => {
    const k = await kayitOku();
    if (!k.model || !existsSync(k.model)) {
      throw Object.assign(new Error("Whisper kurulu degil. Ayar sekmesinden «Whisper'i kur» deyin."), { code: "NOT_INSTALLED" });
    }
    const adaylar = [
      ["ekran karti", k.ekranKarti],
      ["islemci", k.islemci],
    ].filter(([, exe]) => exe && existsSync(exe));
    if (!adaylar.length) {
      throw Object.assign(new Error("Whisper programi bulunamadi. Yeniden kurun."), { code: "NOT_INSTALLED" });
    }

    const hatalar = [];
    for (const [tur, exe] of adaylar) {
      const s = await dene(exe, k.model, tur);
      if (s.hata) {
        hatalar.push(s.hata);
        continue;
      }
      surec = s.cocuk;
      hizlandirma = tur;
      adres = `http://127.0.0.1:${s.port}/inference`;
      sonHata = hatalar.length ? hatalar.join(" ") : null;
      const bu = surec;
      bu.on("exit", (kod) => {
        if (surec !== bu) return;
        surec = null;
        adres = null;
        hizlandirma = null;
        sonHata = `Whisper beklenmedik sekilde kapandi (kod ${kod}).`;
        yay({ type: "durdu", message: sonHata });
      });
      return adres;
    }
    sonHata = hatalar.join(" ");
    throw new Error(sonHata);
  })().finally(() => {
    baslatiliyor = null;
  });
  return baslatiliyor;
}

/** Sunucuyu kapatir (baska saglayici secilince ekran karti bosalsin). */
export function durdur() {
  const s = surec;
  surec = null;
  adres = null;
  hizlandirma = null;
  if (s) {
    try {
      s.kill();
    } catch {
      /* zaten kapali */
    }
  }
}

/** Indirilenleri siler. */
export async function kaldir() {
  durdur();
  await rm(kok(), { recursive: true, force: true });
  sonHata = null;
  return durum();
}
