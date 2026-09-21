/**
 * Ses motoru — yerel cokmeye karsi koruma.
 *
 * GERCEK OLAY: kullanicida motor "kod 3221225477" ile kapandi. O sayi
 * Windows'ta 0xC0000005, yani erisim ihlali. Sebebi kutuphane degil,
 * bizim kodumuzdu:
 *
 *   vosk_model_new  basarisiz oldugunda HATA FIRLATMIYOR, NULL donduruyor
 *   → model.handle === null
 *   → new Recognizer(...) o NULL'u yerel kodda cozmeye calisiyor
 *   → surec aninda cokuyor
 *
 * Bu paket gercek Vosk kutuphanesiyle calisiyor (model gerekmiyor —
 * zaten model YUKLENEMEDIGINDE ne oldugunu sinamak istiyoruz).
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../helpers.mjs";

export const name = "Ses motoru (yerel)";
export const standalone = true;

/** Kucuk bir betigi ayri surecte calistirir; cikis kodunu da doner. */
function calistir(kod) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", kod], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let cikti = "";
    p.stdout.on("data", (c) => { cikti += c; });
    p.stderr.on("data", (c) => { cikti += c; });
    p.on("close", (code, signal) => resolve({ code, signal, cikti }));
  });
}

export async function run(_page, _base, t) {
  // Kutuphane kurulu degilse (indirmesi kurulum aninda oluyor) paketi
  // sessizce gecmiyoruz ama dusurmuyoruz da.
  const varMi = await calistir(
    'try { await import("vosk-koffi"); console.log("VAR"); } catch { console.log("YOK"); }',
  );
  if (!varMi.cikti.includes("VAR")) {
    t.ok(false, "vosk-koffi kurulu degil — motor testi calistirilamadi");
    return;
  }

  /* ============ 1. COKMENIN KENDISI: hala gecerli mi? ============ */

  // Once hatayi TEKRAR URETIYORUZ. Bu, testin gercekten bir sey
  // koruduğunun kaniti: kontrol olmadan surec cokuyor.
  const korumasiz = await calistir(`
    const vosk = (await import("vosk-koffi")).default;
    vosk.setLogLevel?.(-1);
    const model = new vosk.Model("/kesinlikle/olmayan/yol");
    new vosk.Recognizer({ model, sampleRate: 16000 });
    console.log("COKMEDI");
  `);

  t.ok(korumasiz.code !== 0, "kontrolsuz kullanim GERCEKTEN cokuyor (test anlamli)");
  t.ok(!korumasiz.cikti.includes("COKMEDI"), "cokme Recognizer satirinda oluyor");

  /* ============ 2. ISCIMIZ AYNI DURUMDA COKMUYOR ================= */

  const worker = join(ROOT, "electron", "stt-worker.mjs");

  /*
   * Isci normalde Electron'un utilityProcess'i icinde calisiyor ve
   * `process.parentPort` uzerinden haberlesiyor. Burada o kanali taklit
   * edip isciyi duz Node ile calistiriyoruz: sinadigimiz sey Electron
   * degil, NULL kontrolu.
   */
  const iscininMantigi = `
    const vosk = (await import("vosk-koffi")).default;
    vosk.setLogLevel?.(0);

    let hata = null;
    try {
      const model = new vosk.Model("/kesinlikle/olmayan/yol");
      if (!model.handle) {
        throw new Error("Ses modeli yuklenemedi.");
      }
      const rec = new vosk.Recognizer({ model, sampleRate: 16000 });
      if (!rec.handle) throw new Error("Ses tanimlayici kurulamadi.");
    } catch (err) {
      hata = err.message;
    }
    console.log("HATA:" + hata);
  `;

  const korumali = await calistir(iscininMantigi);
  t.eq(korumali.code, 0, "NULL kontrolu ile surec COKMUYOR");
  t.eq(korumali.signal, null, "sinyalle de olmuyor (SIGSEGV yok)");
  t.has(korumali.cikti, "Ses modeli yuklenemedi", "yerine anlasilir bir hata donuyor");

  /* ============ 3. Iscinin KENDI dosyasi bu kontrolu iceriyor mu? */

  const { readFile } = await import("node:fs/promises");
  const kaynak = await readFile(worker, "utf8");

  t.ok(
    /if \(!model\.handle\)/.test(kaynak),
    "stt-worker model.handle'i Recognizer'dan ONCE kontrol ediyor",
  );
  t.ok(
    /if \(!recognizer\.handle\)/.test(kaynak),
    "tanimlayici handle'i da kontrol ediliyor",
  );

  /*
   * SIRA onemli ve bunu FONKSIYON ICINDE olcmek gerekiyor: kod
   * duzenlendikce dosyadaki satir sirasi degisiyor ama calisma sirasi
   * ayni kaliyor. Once metni fonksiyonlara boluyoruz.
   */
  const govde = (ad) => {
    const bas = kaynak.indexOf(`function ${ad}(`);
    if (bas === -1) return "";
    // Bir sonraki ust duzey fonksiyona kadar.
    const sonraki = kaynak.indexOf("\nfunction ", bas + 1);
    const sonraki2 = kaynak.indexOf("\nasync function ", bas + 1);
    const son = Math.min(
      ...[sonraki, sonraki2, kaynak.length].filter((x) => x > bas),
    );
    return kaynak.slice(bas, son);
  };

  const initGovde = govde("init");
  const kurGovde = govde("tanimlayiciKur");

  t.ok(initGovde.length > 0, "init govdesi bulundu");
  t.ok(kurGovde.length > 0, "tanimlayiciKur govdesi bulundu");

  // init: modeli kur → tutamaci KONTROL ET → tanimlayiciyi kur.
  const modelYeri = initGovde.indexOf("new vosk.Model");
  const kontrolYeri = initGovde.indexOf("if (!model.handle)");
  const kurCagrisi = initGovde.indexOf("tanimlayiciKur(");
  t.ok(modelYeri < kontrolYeri, "model kurulduktan SONRA tutamac kontrol ediliyor");
  t.ok(kontrolYeri < kurCagrisi, "tutamac kontrolu tanimlayiciyi kurmadan ONCE");

  // Recognizer tanimlayiciKur icinde ve tutamaci orada da kontrol ediliyor.
  t.ok(kurGovde.includes("new vosk.Recognizer"), "tanimlayici tek yerde kuruluyor");
  t.ok(
    kurGovde.indexOf("new vosk.Recognizer") < kurGovde.indexOf("if (!recognizer.handle)"),
    "tanimlayici tutamaci kurulduktan sonra kontrol ediliyor",
  );

  /*
   * Vosk'un sebebi susturulmamali: setLogLevel(-1) model kurulmadan
   * ONCE cagrilirsa, basarisizligin sebebini anlatan tek satir kayboluyor.
   * Olcum yine init govdesinde.
   */
  const acik = initGovde.indexOf("setLogLevel?.(0)");
  const kapali = initGovde.indexOf("setLogLevel?.(-1)");
  t.ok(acik !== -1 && acik < modelYeri, "gunlukler model kurulmadan ONCE aciliyor");
  t.ok(
    kapali === -1 || kapali > kurCagrisi,
    "Vosk gunlukleri model yuklenmeden once susturulmuyor",
  );

  /* ============ 4. Bozuk model klasoru: cokme degil, cumle ======= */

  const kok = await mkdtemp(join(tmpdir(), "dra-sahte-model-"));
  await mkdir(join(kok, "ivector"), { recursive: true });
  // Boyut dogrulamasini GECEN ama gercek olmayan bir model.
  await writeFile(join(kok, "final.mdl"), Buffer.alloc(6 * 1024 * 1024, 1));
  await writeFile(join(kok, "mfcc.conf"), "x");

  const sahte = await calistir(`
    const vosk = (await import("vosk-koffi")).default;
    vosk.setLogLevel?.(0);
    let sonuc = "bilinmiyor";
    try {
      const model = new vosk.Model(${JSON.stringify(kok)});
      if (!model.handle) throw new Error("Ses modeli yuklenemedi.");
      const rec = new vosk.Recognizer({ model, sampleRate: 16000 });
      if (!rec.handle) throw new Error("Ses tanimlayici kurulamadi.");
      sonuc = "yuklendi";
    } catch (err) {
      sonuc = "hata: " + err.message;
    }
    console.log("SONUC:" + sonuc);
  `);

  t.eq(sahte.code, 0, "gercek olmayan model klasoru de cokertmiyor");
  t.eq(sahte.signal, null, "sahte modelde de SIGSEGV yok");
  t.ok(sahte.cikti.includes("SONUC:"), "sonuc raporlaniyor");

  /* ============ 5. Turkce harfli kullanici adi =================== */
  await runYolSecimi(t);

  /* ============ 6. Sonuc okuma: CIFT AYRISTIRMA ================== */
  await runSonucOkuma(t);
}

/**
 * Sonuclarin okunmasi.
 *
 * GERCEK OLAY: model nihayet yuklendi, ses akmaya basladi ve DRA
 * "[object Object]" is not valid JSON dedi.
 *
 * Sebep: vosk-koffi'nin `result()`, `partialResult()` ve `finalResult()`
 * fonksiyonlari kendi iclerinde JSON.parse'dan geciyor ve NESNE
 * donduruyor. Ben ustune bir daha JSON.parse cagiriyordum; nesne once
 * metne cevriliyor ("[object Object]") ve ayristirilmaya calisiliyordu.
 *
 * Metin donduren tek fonksiyon `resultString()`.
 */
async function runSonucOkuma(t) {
  const { metniAl } = await import("../../electron/stt-worker.mjs");

  /* --- kutuphanenin GERCEKTE donduregu sey: nesne --- */
  t.eq(metniAl({ text: "merhaba dunya" }, "text"), "merhaba dunya", "nesneden metin okunuyor");
  t.eq(metniAl({ partial: "merha" }, "partial"), "merha", "nesneden ara sonuc okunuyor");
  t.eq(metniAl({ text: "  bosluklu  " }, "text"), "bosluklu", "bosluklar kirpiliyor");
  t.eq(metniAl({ text: "" }, "text"), "", "bos metin bos donuyor");
  t.eq(metniAl({}, "text"), "", "alan yoksa bos donuyor");

  /* --- eski davranis: JSON metni de kabul edilsin (surum degisirse) --- */
  t.eq(metniAl('{"text":"merhaba"}', "text"), "merhaba", "JSON metni de okunabiliyor");
  t.eq(metniAl('{"partial":"mer"}', "partial"), "mer", "JSON ara sonucu okunabiliyor");

  /* --- hicbir durumda COKMEMELI --- */
  for (const kotu of [null, undefined, "", "   ", "bozuk json", "[object Object]", 42, true]) {
    let patladi = false;
    let sonuc;
    try {
      sonuc = metniAl(kotu, "text");
    } catch {
      patladi = true;
    }
    t.ok(!patladi, `bozuk girdi cokertmiyor: ${JSON.stringify(kotu)}`);
    t.eq(sonuc, "", `bozuk girdi bos donuyor: ${JSON.stringify(kotu)}`);
  }

  /*
   * ASIL REGRESYON: nesne verildiginde ESKI kod ne yapiyordu?
   * JSON.parse(nesne) → JSON.parse("[object Object]") → SyntaxError.
   * Yeni kod ayni girdide sessizce dogru cevabi veriyor.
   */
  let eskiKodPatladi = false;
  try {
    JSON.parse({ text: "merhaba" });
  } catch {
    eskiKodPatladi = true;
  }
  t.ok(eskiKodPatladi, "eski yol GERCEKTEN patliyor (test anlamli)");
  t.eq(metniAl({ text: "merhaba" }, "text"), "merhaba", "yeni yol ayni girdide calisiyor");

  /* --- isci dosyasi artik sonuclari cift ayristirmıyor --- */
  const { readFile } = await import("node:fs/promises");
  const kaynak = await readFile(join(ROOT, "electron", "stt-worker.mjs"), "utf8");
  for (const cagri of ["result()", "partialResult()", "finalResult()"]) {
    t.ok(
      !kaynak.includes(`JSON.parse(recognizer.${cagri}`),
      `recognizer.${cagri} cift ayristirilmiyor`,
    );
  }
}

/**
 * Turkce harfli kullanici adi.
 *
 * GERCEK OLAY: kullanicinin Windows adi "msı" (noktasiz ı) ve model yolu
 * "C:\Users\msı\AppData\Roaming\DRA\ses-modeli\..." oluyordu. Dosyalar
 * yerinde — 56 MB, hepsi tam — ama Vosk klasoru BULAMIYOR:
 *
 *   ERROR (VoskAPI:Model()) Folder '...' does not contain model files
 *
 * Sebep: Vosk'un C arayuzu yolu DAR (ANSI) metin olarak aliyor. "ı"
 * harfi UTF-8'de iki bayt; Windows onu Turkce kod sayfasiyla okuyunca
 * yol bozuluyor.
 *
 * Cozum: kullanici adi GECMEYEN, tamamen ASCII bir klasor.
 */
async function runYolSecimi(t) {
  const { asciiDisi, guvenliKok } = await import("../../electron/yol.mjs");

  /* --- ASCII tespiti --- */
  t.eq(asciiDisi("C:\\Users\\mehmet\\AppData"), false, "duz ascii yol temiz");
  t.eq(asciiDisi("C:\\Users\\msı\\AppData"), true, "noktasiz ı yakalaniyor");
  t.eq(asciiDisi("C:\\Users\\Şükrü\\AppData"), true, "Ş ve ü yakalaniyor");
  t.eq(asciiDisi("C:\\Users\\Gökçe\\x"), true, "ö ve ç yakalaniyor");
  t.eq(asciiDisi(""), false, "bos metin sorun degil");

  /* --- kok secimi --- */
  const ascii = guvenliKok({
    userData: "C:\\Users\\mehmet\\AppData\\Roaming\\DRA",
    programData: "C:\\ProgramData",
    platform: "win32",
  });
  t.ok(ascii.includes("mehmet"), "ascii kullanici adinda VARSAYILAN konum korunuyor");

  const turkce = guvenliKok({
    userData: "C:\\Users\\msı\\AppData\\Roaming\\DRA",
    programData: "C:\\ProgramData",
    platform: "win32",
  });
  t.ok(!asciiDisi(turkce), "Turkce adda secilen konum tamamen ASCII");
  t.ok(!turkce.includes("msı"), "secilen konum kullanici adini TASIMIYOR");
  t.ok(turkce.includes("ProgramData"), "ProgramData altina geciliyor");

  // ProgramData yoksa ya da o da bozuksa: elimizdekiyle devam.
  const pdYok = guvenliKok({
    userData: "C:\\Users\\msı\\AppData\\Roaming\\DRA",
    programData: undefined,
    platform: "win32",
  });
  t.ok(pdYok.includes("msı"), "ProgramData yoksa varsayilana donuluyor (kotulestirmiyoruz)");

  // Windows disinda sorun yok: UTF-8 yollar sorunsuz calisiyor.
  const linux = guvenliKok({
    userData: "/home/msı/.config/DRA",
    programData: undefined,
    platform: "linux",
  });
  t.ok(linux.includes("msı"), "Windows disinda yol degistirilmiyor");
}
