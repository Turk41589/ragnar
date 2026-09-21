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
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { asciiDisi, guvenliKok } from "./yol.mjs";

/**
 * Bu dosyanin bulundugu klasor. Isci sureci buradan baslatiliyor.
 * Eksikti: `start()` icinde kullanildigi halde hicbir yerde
 * tanimlanmamisti; ses motoru her denemede ReferenceError ile
 * duruyordu ve hata bir async yurutucu icinde kayboldugu icin
 * "mikrofon acilmiyor ama bir sey de yazmiyor" seklinde goruluyordu.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const execFileAsync = promisify(execFile);

/** Kucuk Turkce model — yaklasik 45 MB, komut tanima icin fazlasiyla yeterli. */
const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip";
const SAMPLE_RATE = 16000;

let worker = null;
let workerReady = false;
let modelDir = null;
let busy = false;
let lastError = null;
/** Suren baslatma sozu — es zamanli cagrilar ayni sonucu paylasir. */
let starting = null;

/** Isci coktugunde ya da hata verdiginde haber verilecek yer. */
let onEvent = () => {};
export function onEngineEvent(handler) {
  onEvent = typeof handler === "function" ? handler : () => {};
}

/** Modelin duracagi klasor (kullanici veri dizini). */
/** Modelin duracagi klasor. */
function modelRoot() {
  return guvenliKok({
    userData: app.getPath("userData"),
    programData: process.env.ProgramData,
    platform: process.platform,
  });
}

/** Uygulamanin kendi veri klasorundeki ESKI konum. */
function eskiModelRoot() {
  return join(app.getPath("userData"), "ses-modeli");
}

/**
 * Model eski (Turkce harfli) konumdaysa yeni ASCII konuma TASIR.
 *
 * Boylece 45 MB'lik model yeniden indirilmiyor. Ayni diskte oldugu icin
 * tasima aninda bitiyor. Basarisiz olursa hicbir sey bozulmuyor: model
 * eski yerinde kaliyor ve asagidaki kisa-yol yontemi devreye giriyor.
 */
async function eskiKonumdanTasi() {
  const eski = eskiModelRoot();
  const yeni = modelRoot();
  if (eski === yeni) return;
  if (!existsSync(eski) || existsSync(yeni)) return;

  try {
    await mkdir(dirname(yeni), { recursive: true });
    await rename(eski, yeni);
    console.log(`[dra] ses modeli ASCII konuma tasindi: ${yeni}`);
  } catch (err) {
    console.warn(`[dra] model tasinamadi (${err.message}); eski yerinde kullanilacak.`);
  }
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

/**
 * Model klasorunu Vosk'a VERMEDEN ONCE dogrular.
 *
 * Neden gerekli: Vosk yerel kod. Eksik ya da yarim inmis bir modelle
 * karsilasinca hata dondurmuyor, dogrudan COKUYOR (Windows'ta erisim
 * ihlali, 0xC0000005). Cokmus bir surecten geriye yalnizca bir sayi
 * kaliyor ve o sayi kullaniciya hicbir sey anlatmiyor.
 *
 * Burada ucuz ve kesin olan seylere bakiyoruz: gereken dosyalar var mi,
 * ici bos olan var mi, klasorun toplam boyutu bir modele benziyor mu.
 * Hepsi gecerse yine de cokebilir — ama en sik iki sebep burada
 * yakalaniyor ve kullanici ne yapacagini ogreniyor.
 *
 * Doner: sorun varsa anlatan bir metin, yoksa null.
 */
async function modelDogrula(dir) {
  const klasik = existsSync(join(dir, "conf"));

  // Duzene gore olmazsa olmazlar.
  const gerekli = klasik
    ? [join(dir, "conf")]
    : [join(dir, "final.mdl")];

  for (const yol of gerekli) {
    if (!existsSync(yol)) {
      return `Model eksik: "${yol}" bulunamadi.`;
    }
  }

  // Bos dosya = yarim inmis ya da yarim acilmis arsiv.
  const bosOlanlar = [];
  let toplam = 0;

  async function tara(kok, derinlik = 0) {
    if (derinlik > 3) return;
    let girenler;
    try {
      girenler = await readdir(kok, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of girenler) {
      const tam = join(kok, e.name);
      if (e.isDirectory()) {
        await tara(tam, derinlik + 1);
        continue;
      }
      try {
        const s = await stat(tam);
        toplam += s.size;
        if (s.size === 0) bosOlanlar.push(e.name);
      } catch {
        /* okunamayan dosyayi atla */
      }
    }
  }
  await tara(dir);

  if (bosOlanlar.length) {
    return `Model dosyalari yarim: ${bosOlanlar.slice(0, 5).join(", ")} ` +
      `bos (${bosOlanlar.length} dosya). Indirme yarida kalmis olabilir.`;
  }

  /*
   * En kucuk Vosk modeli bile 40 MB'in uzerinde. Bunun cok altindaysa
   * arsiv yarim acilmis demektir. Esigi BILEREK dusuk tuttuk (5 MB):
   * amac saglam bir modeli yanlislikla reddetmek degil, acikca bozuk
   * olani yakalamak.
   */
  const mb = toplam / 1048576;
  if (mb < 5) {
    return `Model cok kucuk (${mb.toFixed(1)} MB). Gercek bir Vosk modeli ` +
      "en az 40 MB civarindadir; arsiv yarim acilmis gorunuyor.";
  }

  return null;
}

/**
 * Windows'ta ASCII disi karakter iceren yollari 8.3 "kisa yol" bicimine
 * cevirir.
 *
 * Neden: Vosk'un C arayuzu model yolunu dar (ANSI) bir metin olarak
 * aliyor. Kullanici adinda Turkce harf varsa — ki sik — yol
 * "C:\Users\Şükrü\..." oluyor ve Vosk o dosyalari acamiyor; hata
 * dondurmek yerine cokuyor. Windows her klasor icin ASCII bir kisa ad
 * da tutuyor ("C:\Users\SUKRU~1\..."); onu kullaniyoruz.
 *
 * Kisa ad uretimi bazi diskler icin kapali olabilir. O zaman elimizdeki
 * yolu oldugu gibi birakiyoruz — durumu kotulestirmiyoruz.
 */
async function asciiYol(yol) {
  if (process.platform !== "win32") return yol;
  if (!asciiDisi(yol)) return yol;

  /*
   * Yol ORTAM DEGISKENIYLE gidiyor, arguman olarak DEGIL.
   *
   * Ilk hali argumandi ve ise yaramadi: Node argumani UTF-8 yaziyor,
   * cmd.exe onu OEM kod sayfasiyla okuyor ve Turkce harf yine
   * bozuluyor. Ortam degiskenleri Windows'ta UTF-16 tasiniyor, yani
   * bozulma yok. Ciktisi olan KISA AD zaten saf ASCII.
   */
  try {
    const { stdout } = await execFileAsync(
      "cmd.exe",
      ["/c", 'for %I in ("%DRA_MODEL_YOLU%") do @echo %~sI'],
      { windowsHide: true, env: { ...process.env, DRA_MODEL_YOLU: yol } },
    );
    const kisa = stdout.trim();
    // Kisa ad uretilememisse (bazi disklerde 8.3 adlari kapali) cikti
    // bos kalir ya da hala Turkce olur.
    if (kisa && !asciiDisi(kisa) && existsSync(kisa)) return kisa;
  } catch {
    /* kisa ad alinamadi; asagida oldugu gibi donuyoruz */
  }
  return yol;
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

/**
 * Windows cikis kodlarini anlasilir Turkceye cevirir.
 *
 * Yerel bir cokme ham sayi olarak geliyor ve "kod 3221225477" kullaniciya
 * hicbir sey anlatmiyor. Bu sayilar aslinda Windows'un NTSTATUS
 * degerleri; en sik gorulen birkacinin ne demek oldugu belli.
 */
const COKME_KODLARI = {
  3221225477: {
    ad: "erisim ihlali (0xC0000005)",
    // En sik iki sebep: model dosyalari bozuk/eksik, ya da model yolunda
    // Vosk'un okuyamadigi karakterler var.
    ne: "Ses modeli okunamiyor. Genellikle modelin eksik ya da yarim " +
      "inmis olmasindan olur. Ayar sekmesinden \"Ses modelini yeniden kur\" " +
      "deyin.",
  },
  3221225781: {
    ad: "eksik DLL (0xC0000135)",
    ne: "Windows'ta eksik bir sistem bileseni var. Microsoft Visual C++ " +
      "Yeniden Dagitilabilir Paketi'ni (x64) kurup tekrar deneyin.",
  },
  3221225595: {
    ad: "bozuk DLL (0xC0000139)",
    ne: "Bir sistem bileseni eksik ya da surumu uyumsuz. Microsoft Visual " +
      "C++ Yeniden Dagitilabilir Paketi'ni (x64) kurup tekrar deneyin.",
  },
  3221226505: {
    ad: "yigin bozulmasi (0xC0000409)",
    ne: "Ses motoru beklenmedik bir veriyle karsilasti. Model dosyalari " +
      "bozuk olabilir; yeniden kurmayi deneyin.",
  },
};

/** Vosk'un kendi hata satirlarini ayiklar. */
function voskSebebi(cikti) {
  const satirlar = String(cikti || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => /ERROR|WARN|LOG \(Vosk/i.test(x));
  if (!satirlar.length) return "";
  // En sonuncusu en ilgili olan; cok uzunsa kirpiyoruz.
  return satirlar[satirlar.length - 1].slice(0, 300);
}

/** Cikis kodunu okunabilir bir cumleye cevirir. */
function cokmeMesaji(code, modelPath) {
  const bilinen = COKME_KODLARI[code];
  const yol = modelPath ? `\nKullanilan model: ${modelPath}` : "";

  if (!bilinen) {
    return `Ses motoru beklenmedik sekilde kapandi (kod ${code}).${yol}`;
  }
  return `Ses motoru cokti — ${bilinen.ad}.\n${bilinen.ne}${yol}`;
}

/** Motorun ve modelin durumu. */
export async function status() {
  const dir = modelDir
    || (await findModel(modelRoot()))
    || (await findModel(eskiModelRoot()));
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
    /*
     * ONCE TEMIZLIYORUZ.
     *
     * Eskiden kurulum var olan klasorun UZERINE aciyordu. Yarim kalmis
     * bir indirmeden sonra tekrar denendiginde eski bozuk dosyalar
     * yerinde kaliyor, arsiv onlarin ustune aciliyor ve model yine
     * bozuk kaliyordu — kullanici "yeniden kur" dedigi halde ayni
     * cokme devam ediyordu.
     */
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    // Elde tutulan eski yol artik gecersiz.
    modelDir = null;
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
    if (modelDir) {
      // Indirme tamamlandi diye model saglam demek degil. Burada
      // yakalarsak kullanici cokmeyle degil, anlasilir bir cumleyle
      // karsilasiyor.
      const sorun = await modelDogrula(modelDir);
      if (sorun) {
        modelDir = null;
        throw new Error(`${sorun}\nBaglantinizi kontrol edip tekrar deneyin.`);
      }
    }
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
  const eski = eskiModelRoot();
  return {
    root,
    exists: existsSync(root),
    tree: existsSync(root) ? await describeTree(root) : "(klasor yok)",
    modelPath: modelDir || (await findModel(root)) || (await findModel(eski)),
    // Turkce harfli kullanici adinda model ASCII bir konuma tasiniyor;
    // teshiste iki konumu da gostermek gerekiyor.
    legacyRoot: eski === root ? null : eski,
    legacyExists: eski !== root && existsSync(eski),
    pathHasNonAscii: asciiDisi(root),
  };
}

/**
 * Kurulu modeli siler.
 *
 * Bozuk bir kurulumdan donmenin acik yolu. Motor calisiyorsa once
 * durduruluyor: Windows acik dosyayi sildirmiyor.
 */
export async function removeModel() {
  stop();
  const root = modelRoot();
  // Her iki konumu da temizliyoruz: yarim kalmis bir tasima geride
  // bozuk bir kopya birakmis olabilir.
  await rm(root, { recursive: true, force: true });
  if (eskiModelRoot() !== root) {
    await rm(eskiModelRoot(), { recursive: true, force: true });
  }
  modelDir = null;
  lastError = null;
  return { removed: root };
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
export function start(onResult, dilbilgisi = null) {
  if (workerReady) return status();
  // Es zamanli iki cagri iki isci acmasin.
  if (starting) return starting;
  starting = doStart(onResult, dilbilgisi).finally(() => { starting = null; });
  return starting;
}

async function doStart(onResult, dilbilgisi) {
  try {
    await eskiKonumdanTasi();
    modelDir = modelDir || (await findModel(modelRoot()));
    // Tasinamadiysa model hala eski yerinde olabilir; orayi da bak.
    if (!modelDir) modelDir = await findModel(eskiModelRoot());
  } catch {
    modelDir = null;
  }
  if (!modelDir) {
    throw Object.assign(new Error("Ses modeli kurulu degil."), { code: "NO_MODEL" });
  }

  /*
   * Modeli Vosk'a VERMEDEN once dogruluyoruz. Bozuk bir modelle Vosk
   * hata dondurmuyor, coküyor — ve cokmus bir surecten geriye yalnizca
   * bir sayi kaliyor. Burada yakalarsak kullaniciya ne yapacagini
   * soyleyebiliyoruz.
   */
  const sorun = await modelDogrula(modelDir);
  if (sorun) {
    throw Object.assign(
      new Error(`${sorun}\nAyar sekmesinden "Ses modelini yeniden kur" deyin.`),
      { code: "BAD_MODEL", modelPath: modelDir },
    );
  }

  /*
   * Yolda Turkce harf varsa (kullanici adindan geliyor) Vosk dosyalari
   * acamiyor ve yine cokuyor. Windows'un ASCII kisa adini kullaniyoruz.
   */
  const voskYolu = await asciiYol(modelDir);

  lastError = null;
  const workerPath = join(HERE, "stt-worker.mjs");

  // Yurutucu BILEREK senkron: icine async koyulursa buradaki bir hata
  // sozu hic sonuclandirmadan kaybolur ve cagiran sonsuza kadar bekler.
  return new Promise((resolve, reject) => {
    let bitti = false;
    const sonlandir = (fn, arg) => { if (!bitti) { bitti = true; fn(arg); } };

    let w;
    /*
     * Iscinin stderr'ini YAKALIYORUZ.
     *
     * Vosk basarisiz bir yuklemenin sebebini stderr'e yaziyor
     * ("Folder '...' does not contain model files" gibi). Varsayilan
     * ayarda o cikti dogrudan konsola gidiyor ve kullanici hicbir zaman
     * gormuyor. Son satirlari saklayip hata mesajina ekliyoruz: sorunun
     * ne oldugunu anlatan tek yer orasi.
     */
    let voskCiktisi = "";
    try {
      w = utilityProcess.fork(workerPath, [], {
        serviceName: "dra-ses-motoru",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const topla = (chunk) => {
        voskCiktisi = (voskCiktisi + String(chunk)).slice(-2000);
      };
      w.stderr?.on("data", topla);
      w.stdout?.on("data", topla);
    } catch (err) {
      lastError = err?.message || "Ses motoru baslatilamadi.";
      return reject(new Error(lastError));
    }
    worker = w;

    // Motor makul surede hazir olmazsa asili kalmayalim.
    const zamanAsimi = setTimeout(() => {
      stop();
      sonlandir(reject, new Error("Ses motoru zamaninda baslamadi."));
    }, 12000);

    w.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(zamanAsimi);
        workerReady = true;
        sonlandir(resolve, null);
        return;
      }
      if (message?.type === "result") {
        onResult?.(message);
        return;
      }
      if (message?.type === "error") {
        lastError = message.message;
        if (!workerReady) {
          clearTimeout(zamanAsimi);
          // Baslarken hata veren isci arkada asili kalmasin.
          stop();
          const sebep = voskSebebi(voskCiktisi);
          /*
           * Yol hala ASCII disiysa sebebi BUYUK IHTIMALLE odur.
           * Kullanici "klasorde dosyalar var, neden bulamiyor?" diye
           * bakmasin; gercek sebebi soyluyoruz.
           */
          const yolNotu = asciiDisi(voskYolu)
            ? "\nSEBEP MUHTEMELEN YOL: kullanici adinizda Turkce harf var " +
              `(${voskYolu}). Ses motoru bu harfleri okuyamiyor. Ayar ` +
              "sekmesinden \"Ses modelini yeniden kur\" deyin; model Turkce " +
              "harf gecmeyen bir klasore kurulacak."
            : "";
          sonlandir(reject, new Error(
            message.message + (sebep ? `\nMotorun soyledigi: ${sebep}` : "") + yolNotu,
          ));
        } else {
          onEvent({ type: "error", message: message.message });
        }
      }
    });

    w.on("exit", (code) => {
      clearTimeout(zamanAsimi);
      // Bu cikis BU iscinin mi? stop() sonrasi yeni bir isci baslatilmis
      // olabilir; eski iscinin gec gelen cikisi yenisini oldurmemeli.
      const bizimki = worker === w;
      const beklenen = worker === null || !bizimki;
      if (bizimki) {
        worker = null;
        workerReady = false;
      }
      if (beklenen || code === 0) return;

      // Yerel cokme: uygulama ayakta, kullaniciya durumu bildiriyoruz.
      const sebep = voskSebebi(voskCiktisi);
      lastError = lastError
        || cokmeMesaji(code, voskYolu) + (sebep ? `\nMotorun soyledigi: ${sebep}` : "");
      console.error(`[dra] ${lastError}`);
      onEvent({ type: "crashed", message: lastError });
      sonlandir(reject, new Error(lastError));
    });

    w.postMessage({ type: "init", modelPath: voskYolu, grammar: dilbilgisi });
  }).then(() => status());
}

/**
 * Sozcuk listesini degistirir (sinirli kip ac/kapa).
 *
 * Model yerinde kaliyor — pahali olan o. Yalnizca tanimlayici yeniden
 * kuruluyor, bu da aninda oluyor.
 */
export function setGrammar(words) {
  if (!workerReady || !worker) return { applied: false, reason: "motor calismiyor" };
  worker.postMessage({ type: "grammar", words });
  return { applied: true, active: Array.isArray(words) && words.length > 0 };
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
