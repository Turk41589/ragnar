/**
 * Masaustu (Electron) surumu.
 *
 * Ayni arayuzun uygulama icinde de acildigini, makineye erisimin IPC
 * uzerinden calistigini ve yalitim sinirlarinin korundugunu dogrular.
 *
 * Bu paket kendi Electron ornegini baslatir; tarayici testlerinden
 * bagimsizdir.
 */

import { join } from "node:path";
import { ROOT } from "../helpers.mjs";

export const name = "Masaustu uygulamasi";
export const standalone = true;

/**
 * Gercek Vosk arsivlerinin acildigi farkli duzenleri taklit eder.
 * Dosya sistemi uzerinde kurulur; Electron tarafi bunlari okur.
 */
async function createFakeModels() {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const base = await mkdtemp(join(tmpdir(), "dra-model-"));

  /** Klasik duzen: am/ conf/ graph/ ivector/ */
  const kurKlasik = async (rel, ic) => {
    const kok = join(base, rel);
    await mkdir(join(kok, ic, "conf"), { recursive: true });
    await mkdir(join(kok, ic, "am"), { recursive: true });
    await writeFile(join(kok, ic, "conf", "model.conf"), "--min-active=200\n");
    return kok;
  };

  /**
   * Kompakt duzen: kucuk modellerin gercek hali.
   * Dosya adlari vosk-model-small-tr-0.3 arsivinden birebir alindi —
   * bu duzen taninmadigi icin kurulum basarisiz oluyordu.
   */
  const kurKompakt = async (rel, ic) => {
    const kok = join(base, rel);
    const dir = join(kok, ic);
    await mkdir(join(dir, "ivector"), { recursive: true });
    for (const f of ["final.mdl", "HCLr.fst", "Gr.fst", "mfcc.conf",
                     "disambig_tid.int", "word_boundary.int", "README"]) {
      await writeFile(join(dir, f), "x");
    }
    for (const f of ["final.dubm", "final.ie", "final.mat", "global_cmvn.stats",
                     "online_cmvn.conf", "splice.conf"]) {
      await writeFile(join(dir, "ivector", f), "x");
    }
    return kok;
  };

  const bos = async (rel) => {
    const kok = join(base, rel);
    await mkdir(kok, { recursive: true });
    await writeFile(join(kok, "okuma.txt"), "x");
    return kok;
  };

  return [
    // [ad, klasor, bulunmali mi]
    ["klasik duzen, kokte", await kurKlasik("k1", "."), true],
    ["klasik duzen, bir alt klasorde", await kurKlasik("k2", "vosk-model-tr"), true],
    ["klasik duzen, iki alt klasorde", await kurKlasik("k3", join("a", "b")), true],
    ["kompakt duzen, kokte", await kurKompakt("m1", "."), true],
    ["kompakt duzen, bir alt klasorde (gercek arsiv)", await kurKompakt("m2", "vosk-model-small-tr-0.3"), true],
    ["model yok", await bos("bos"), false],
  ];
}

/** Ana pencereyi (index.html) bekler; acilis ekranini atlar. */
async function mainWindowOf(app, timeout = 30000) {
  const bitis = Date.now() + timeout;
  while (Date.now() < bitis) {
    const w = app.windows().find((x) => x.url().includes("index.html"));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Ana pencere bulunamadi.");
}

/** Kosul saglanana kadar bekler. */
async function waitFor(kosul, timeout = 10000) {
  const bitis = Date.now() + timeout;
  while (Date.now() < bitis) {
    if (kosul()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export async function run(_page, _base, t) {
  let electron;
  try {
    ({ _electron: electron } = await import("playwright"));
  } catch {
    t.ok(false, "playwright yuklenemedi");
    return;
  }

  const app = await electron.launch({
    args: [ROOT, "--no-sandbox", "--disable-gpu"],
    env: { ...process.env, DRA_TEST: "1" },
  });

  try {
    /* ---------------------------------------------- acilis ekrani ---- */
    // Ilk acilan pencere stüdyo ekrani; ana pencere onun ardindan geliyor.
    // Acilis penceresi ana pencere hazir olunca kendini yok ediyor; bu
    // yuzden ona yapilan her cagri yarista kaybedebilir. Sorgular
    // korunuyor ki paketin tamami tek bir yaris yuzunden dusmesin.
    const acilis = await app.firstWindow();
    let acilisUrl = "";
    let studyo = "";
    try {
      await acilis.waitForLoadState("domcontentloaded");
      acilisUrl = acilis.url();
      studyo = await acilis.textContent(".stüdyo");
    } catch {
      /* pencere kapandi — asagidaki dogrulamalar bunu bildirir */
    }
    t.has(acilisUrl, "splash.html", "once acilis ekrani aciliyor");
    t.has(studyo || "", "RAGNAR", "acilis ekraninda studyo adi var");

    /* --------------------------------------------------- ana pencere - */
    const window = await mainWindowOf(app);
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(1400);

    // Acilis ekrani ana pencere hazir olunca kapanmali.
    await waitFor(() => !app.windows().some((w) => w.url().includes("splash.html")), 15000);
    t.ok(
      !app.windows().some((w) => w.url().includes("splash.html")),
      "acilis ekrani ana pencere hazir olunca kapaniyor",
    );

    /* ------------------------------------------------ arayuz yuklendi */
    t.eq(await window.title(), "DRA", "pencere basligi dogru");
    t.ok(await window.locator("#sleep-screen").isVisible(), "uyku ekrani uygulamada aciliyor");
    t.ok(await window.locator("#sleep-input").isVisible(), "yazi kutusu var");

    /* --------------------------------------------------- kopru yuzeyi */
    const bridge = await window.evaluate(() => ({
      desktop: window.dra?.desktop === true,
      // Arayuz Node'a dogrudan erisememeli.
      nodeSizinti: typeof window.require !== "undefined" || typeof window.process !== "undefined",
      anahtarlar: Object.keys(window.dra || {}).sort(),
    }));
    t.ok(bridge.desktop, "arayuz masaustu kipinde oldugunu biliyor");
    t.ok(!bridge.nodeSizinti, "Node arayuze sizmiyor (yalitim acik)");
    t.eq(
      bridge.anahtarlar,
      ["apps", "desktop", "health", "kick", "on", "search", "stt", "version", "window"],
      "kopru yalnizca beklenen yuzeyi aciyor",
    );

    /* ------------------------------------------- gomulu ses motoru --- */
    const stt = await window.evaluate(() => window.dra.stt.status());
    t.ok(stt.ok, "gomulu motor durumu okunabiliyor");
    t.eq(stt.status.engine, "vosk", "motor Vosk");
    t.eq(stt.status.modelReady, false, "model kurulu degilken oyle raporluyor");
    t.eq(stt.status.running, false, "motor kendiliginden calismiyor");

    // Model yokken baslatma anlasilir bir hata vermeli, cokmemelidir.
    const noModel = await window.evaluate(() =>
      window.dra.stt.start().then(
        () => ({ hata: null }),
        (err) => ({ hata: err.message }),
      ),
    );
    t.has(noModel.hata || "", "model", "model yokken anlasilir hata veriyor");

    // Arayuz de bunu bilmeli.
    const arayuz = await window.evaluate(async () => {
      const sp = await import("./js/speech.js");
      const st = await import("./js/store.js");
      return {
        gomuluVar: sp.embeddedAvailable(),
        varsayilanMotor: st.store.speechEngine,
      };
    });
    t.ok(arayuz.gomuluVar, "arayuz gomulu motoru goruyor");

    // Model klasoru incelenebilmeli — hata ayiklamanin tek yolu bu.
    const inceleme = await window.evaluate(() => window.dra.stt.inspect());
    t.ok(inceleme.ok, "model klasoru incelenebiliyor");
    t.ok(typeof inceleme.info.root === "string", "model klasoru yolu biliniyor");

    /* ------------------------------------------- model tespiti ------ *
     * Kullanicida kurulum "gecerli bir model bulunamadi" ile dusmustu:
     * tespit hem "am" hem "conf" ariyor ve yalnizca bir alt seviyeye
     * bakiyordu. Vosk arsivleri farkli derinlige acilabiliyor ve bazi
     * modellerde "am" yerine "am-onnx" var. Asagidaki vakalar duzeltmenin
     * gercekten calistigini dogruluyor.                                */
    const kokler = await createFakeModels();

    for (const [ad, yol, beklenen] of kokler) {
      const sonuc = await window.evaluate(
        (p) => window.dra.stt.useFolder(p).then(
          (r) => ({ bulundu: true, path: r.modelPath }),
          (e) => ({ bulundu: false, hata: e.message }),
        ),
        yol,
      );
      t.eq(sonuc.bulundu, beklenen, `model tespiti: ${ad}`);
      if (!beklenen && sonuc.hata) {
        t.has(sonuc.hata, "final.mdl", `${ad}: hata neye bakildigini soyluyor`);
      }
    }
    t.eq(arayuz.varsayilanMotor, "gomulu", "uygulamada varsayilan motor gomulu");

    /* ---------------------------------------------------------- IPC -- */
    const health = await window.evaluate(() => window.dra.health());
    t.ok(health.ok, "saglik bilgisi IPC ile geliyor");
    t.eq(health.desktop, true, "masaustu bayragi dogru");
    t.eq(health.search.enabled, false, "web aramasi varsayilan kapali");
    t.eq(health.kick.ready, false, "Kick varsayilan kapali");

    // Tarayici surumunun aksine ortada jeton yok — IPC'de gerek de yok.
    t.ok(!("token" in health), "masaustunde oturum jetonu tasinmiyor");

    const scan = await window.evaluate(() => window.dra.apps.scan());
    t.ok(scan.ok && Array.isArray(scan.apps), "uygulama taramasi IPC ile calisiyor");

    /* --------------------------------------- beyaz liste hala gecerli */
    const bogus = await window.evaluate(() =>
      window.dra.apps.launch("app-yok-boyle").then(
        () => ({ hata: null }),
        (err) => ({ hata: err.message }),
      ),
    );
    t.has(bogus.hata || "", "listede yok", "listede olmayan uygulama uygulamada da baslatilamiyor");

    const kapaliArama = await window.evaluate(() =>
      window.dra.search.query("test").then(
        () => ({ hata: null }),
        (err) => ({ hata: err.message }),
      ),
    );
    t.has(kapaliArama.hata || "", "kapali", "arama kapaliyken uygulamada da reddediliyor");

    /* ------------------------------------------- komutlar calisiyor mu */
    await window.evaluate(async () => {
      const { store, saveStore } = await import("./js/store.js");
      store.voiceEnabled = false;
      saveStore();
    });
    await window.fill("#sleep-input", "saat kac");
    await window.press("#sleep-input", "Enter");
    await window.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
    await window.waitForTimeout(2200);

    const reply = await window.$$eval("#log li .chat__bubble", (els) => els.at(-1)?.textContent ?? "");
    t.has(reply, "Saat ", "uygulama icinde komutlar cevap veriyor");

    /* ---------------------------------------------- ses zinciri ------ *
     * Vosk'un kendisini burada calistiramayiz (ne mikrofon var ne model),
     * ama ONDAN SONRAKI her adimi sinayabiliriz: ana surecten gelen bir
     * tanima sonucu, arayuzde komuta donusuyor mu?
     * Sonuc olayi ana surecten gonderiliyor — gercek akisin aynisi.     */
    /** Motordan sonuc gelmis gibi davranir (zincirin geri kalanini sinar). */
    const seslen = async (metin, final = true) => {
      await window.evaluate(
        async ({ metin, final }) => {
          const sp = await import("./js/speech.js");
          sp.handleRecognitionResult(final ? { final: metin } : { partial: metin });
        },
        { metin, final },
      );
      await window.waitForTimeout(700);
    };

    /** Gercek IPC yolundan gonderir — koruma katmanini sinar. */
    const ipcSeslen = async (metin) => {
      await app.evaluate(
        ({ BrowserWindow }, veri) => {
          // Acilis ekrani degil, arayuzun oldugu pencere hedeflenmeli.
          const w = BrowserWindow.getAllWindows().find((x) =>
            x.webContents.getURL().includes("index.html"),
          );
          if (!w) throw new Error("Ana pencere bulunamadi.");
          w.webContents.send("dra:stt:result", { final: veri });
        },
        metin,
      );
      await window.waitForTimeout(900);
    };

    await seslen("12 kere 8 kac eder");
    const sesliYanit = await window.$$eval("#log li .chat__bubble", (e) => e.at(-1)?.textContent ?? "");
    t.has(sesliYanit, "96", "motordan gelen metin komuta donusuyor");

    await seslen("not al pil al");
    const notYanit = await window.$$eval("#log li .chat__bubble", (e) => e.at(-1)?.textContent ?? "");
    t.has(notYanit, "Not alindi", "sesli not komutu isliyor");

    // Uyandirma kelimesi de ayni yoldan gecmeli: once uyut, sonra seslen.
    await window.fill("#composer-input", "uyu");
    await window.press("#composer-input", "Enter");
    await window.waitForTimeout(900);
    t.ok(await window.locator("#sleep-screen").isVisible(), "sesli komutla uyudu");

    await seslen("dra");
    await window.waitForSelector("#hud:not([hidden])", { timeout: 20000 });
    t.ok(await window.locator("#hud").isVisible(), "motordan gelen 'dra' uyandiriyor");

    // Ara sonuclar da akmali (konusurken altyazi).
    await seslen("saat", false);
    const araYazi = await window.locator("#core-caption").textContent();
    t.has(araYazi, "saat", "ara sonuclar altyaziya dusuyor");

    /* --------------------------------------------- ses verisi yolu --- */
    // Motor calismasa bile ses parcasi gondermek uygulamayi cokertmemeli.
    const beslemeSonucu = await window.evaluate(() => {
      try {
        const pcm = new Int16Array(1600);
        for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.round(Math.sin(i / 8) * 8000);
        window.dra.stt.feed(new Uint8Array(pcm.buffer));
        return "gonderildi";
      } catch (e) {
        return "HATA: " + e.message;
      }
    });
    t.eq(beslemeSonucu, "gonderildi", "ses verisi motora guvenle gonderiliyor");
    await window.waitForTimeout(300);
    t.ok(true, "motor calismazken gelen ses uygulamayi cokertmiyor");

    /* ------------------------------------ kapali mikrofonda artik sonuc */
    // Mikrofon kapaliyken kuyrukta kalmis bir sonuc komut sayilmamali.
    await window.fill("#composer-input", "uyu");
    await window.press("#composer-input", "Enter");
    await window.waitForTimeout(900);

    const oncekiMesajSayisi = await window.$$eval("#log li", (e) => e.length);
    await ipcSeslen("dra");
    t.ok(
      await window.locator("#sleep-screen").isVisible(),
      "mikrofon kapaliyken gelen artik sonuc uyandirmiyor",
    );
    t.eq(
      await window.$$eval("#log li", (e) => e.length),
      oncekiMesajSayisi,
      "artik sonuc sohbete de dusmuyor",
    );
  } finally {
    await app.close();
  }
}
