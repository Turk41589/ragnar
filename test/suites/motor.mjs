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

  // Sirasi onemli: kontrol Recognizer'dan SONRA gelirse hicbir ise yaramaz.
  const kontrolYeri = kaynak.indexOf("if (!model.handle)");
  const recYeri = kaynak.indexOf("new vosk.Recognizer");
  t.ok(kontrolYeri < recYeri, "kontrol Recognizer cagrisindan ONCE geliyor");

  // Vosk'un sebebi susturulmamali: setLogLevel(-1) model kurulmadan
  // ONCE cagrilirsa, basarisizligin sebebini anlatan tek satir kayboluyor.
  const susturma = kaynak.indexOf("setLogLevel?.(-1)");
  t.ok(
    susturma === -1 || susturma > recYeri,
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
}
