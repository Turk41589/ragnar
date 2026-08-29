/**
 * Arayuz: uyandirma, sohbet paneli, kontrol paneli, kalicilik,
 * dar ekran yerlesimi ve ag yalitimi.
 */

import { openApp, tell, readChat, hear } from "../helpers.mjs";

export const name = "Arayuz";

export async function run(page, base, t, { external }) {
  await openApp(page, base);

  /* ------------------------------------------------------ uyku ekrani - */
  t.ok(await page.locator("#sleep-screen").isVisible(), "uyku ekrani aciliyor");
  t.ok(await page.locator("#sleep-input").isVisible(), "uyku ekraninda yazi kutusu var");

  /* -------------------------------------------- uyandirma kelimesi ---- */
  for (const noise of ["bugun hava guzel", "ara beni", "yarin gorusuruz"]) {
    await hear(page, noise);
    await page.waitForTimeout(150);
  }
  t.ok(await page.locator("#sleep-screen").isVisible(), "alakasiz sozler uyandirmiyor");

  await hear(page, "dra");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(400);
  t.ok(await page.locator("#hud").isVisible(), '"dra" uyandiriyor');

  // Uyandirma kelimesi komutun basindaysa temizlenmeli
  await hear(page, "dra 7 kere 6 kac eder");
  await page.waitForTimeout(700);
  let chat = await readChat(page);
  t.has(chat.at(-1).text, "42", "komut basindaki uyandirma kelimesi ayikleniyor");

  /* ------------------------------------------------------ sohbet ------ */
  t.ok(await page.locator("#composer-input").isVisible(), "sohbet yazi kutusu gorunur");
  await tell(page, "merhaba");
  chat = await readChat(page);
  t.eq(chat.at(-2).who, "user", "kullanici mesaji sohbete dusuyor");
  t.eq(chat.at(-1).who, "dra", "DRA yaniti sohbete dusuyor");

  /* ------------------------------------------------- kontrol paneli --- */
  for (const tab of ["notlar", "alarm", "ayar", "sistem"]) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(150);
    t.ok(await page.locator(`.pane[data-pane="${tab}"]`).isVisible(), `sekme acildi: ${tab}`);
  }

  // Not ekle / sil
  await page.click('.tab[data-tab="notlar"]');
  await page.fill("#note-input", "test notu");
  await page.press("#note-input", "Enter");
  await page.waitForTimeout(200);
  let notes = await page.$$eval("#notes li", (e) => e.map((x) => x.textContent));
  t.ok(notes.some((n) => n.includes("test notu")), "panelden not eklenebiliyor");

  await page.click("#notes li:last-child .iconbtn--danger");
  await page.waitForTimeout(200);
  notes = await page.$$eval("#notes li", (e) => e.map((x) => x.textContent));
  t.ok(!notes.some((n) => n.includes("test notu")), "panelden not silinebiliyor");

  // Alarm kur
  await page.click('.tab[data-tab="alarm"]');
  await page.fill("#alarm-time", "07:30");
  await page.fill("#alarm-label", "spor");
  await page.click("#alarm-form button[type=submit]");
  await page.waitForTimeout(250);
  const alarms = await page.$$eval("#alarms li", (e) => e.map((x) => x.textContent));
  t.ok(alarms.some((a) => a.includes("07:30") && a.includes("spor")), "panelden alarm kurulabiliyor");

  /* ---------------------------------------------------------- ayarlar - */
  await page.click('.tab[data-tab="ayar"]');
  t.eq(
    await page.locator("#set-local").getAttribute("aria-checked"),
    "true",
    "'sesi cihazda tut' varsayilan olarak acik",
  );

  await page.click("#set-boot");
  await page.selectOption("#set-sleep", "5");
  await page.fill("#set-wake", "dıra, drah");
  await page.dispatchEvent("#set-wake", "change");
  await page.click(".swatch[title='mor']");
  await page.waitForTimeout(250);

  const settings = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return {
      boot: store.bootSequence,
      sleep: store.autoSleepMinutes,
      wake: store.extraWakeWords,
      theme: store.theme,
      css: getComputedStyle(document.documentElement).getPropertyValue("--hue-r").trim(),
    };
  });
  t.eq(settings.boot, false, "acilis dizisi kapatilabiliyor");
  t.eq(settings.sleep, 5, "otomatik uyku suresi degisiyor");
  t.eq(settings.wake, ["dıra", "drah"], "ek uyandirma sozcukleri kaydediliyor");
  t.eq(settings.theme, [186, 122, 255], "tema secilebiliyor");
  t.eq(settings.css, "186", "tema CSS'e uygulaniyor");

  /* ------------------------------------------------------------ teshis - */
  await page.click("#set-diag");
  await page.waitForTimeout(600);
  // Teshis iki mesaj basar: rapor, sonra yorum. Ikisini de ayri ayri ara.
  const diagChat = await readChat(page);
  const report = diagChat.find((m) => m.text.includes("Cihaz ustu Turkce tanima"));
  t.ok(report, "teshis ses tanima durumunu raporluyor");
  t.has(report?.text ?? "", "Mikrofon seviyesi", "teshis mikrofon seviyesini yaziyor");
  t.has(diagChat.at(-1).text, "mikrofonu acin", "teshis mikrofon kapaliyken yol gosteriyor");
  await page.click('.tab[data-tab="ayar"]');

  /* --------------------------------------------------------- kalicilik */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const persisted = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return { alarms: store.alarms.length, theme: store.theme, wake: store.extraWakeWords.length };
  });
  t.eq(persisted.alarms, 1, "alarmlar yenilemeden sonra duruyor");
  t.eq(persisted.theme, [186, 122, 255], "tema yenilemeden sonra duruyor");
  t.eq(persisted.wake, 2, "uyandirma sozcukleri yenilemeden sonra duruyor");

  /* ---------------------------------------------------------- sifirla - */
  await page.click("#btn-manual-wake");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.click('.tab[data-tab="ayar"]');
  await page.click("#set-reset");
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return { notes: store.notes.length, alarms: store.alarms.length, theme: store.theme };
  });
  t.eq(afterReset.notes, 0, "sifirlama notlari siliyor");
  t.eq(afterReset.alarms, 0, "sifirlama alarmlari siliyor");
  t.eq(afterReset.theme, [53, 230, 255], "sifirlama temayi geri aliyor");

  /* --------------------------------------------------------- dar ekran */
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(500);
  t.ok(await page.locator(".panel--right").isVisible(), "dar ekranda sohbet gorunuyor");
  t.ok(await page.locator(".panel--left").isVisible(), "dar ekranda kontrol paneli gorunuyor");
  t.ok(
    !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
    "dar ekranda yatay tasma yok",
  );
  await page.setViewportSize({ width: 1600, height: 950 });

  /* ------------------------------------------------------- ag yalitimi */
  t.eq(external, [], "localhost disina hicbir istek atilmadi");
}
