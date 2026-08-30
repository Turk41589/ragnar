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
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(1200);

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
  } finally {
    await app.close();
  }
}
