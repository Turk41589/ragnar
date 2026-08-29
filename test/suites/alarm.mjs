/**
 * Alarmin gercekten calmasi.
 *
 * YAVAS: bir sonraki dakika sinirini bekler (en fazla ~2 dakika).
 * Bu yuzden yalnizca `npm run test:tam` ile calisir.
 */

import { openApp, readChat } from "../helpers.mjs";

export const name = "Alarm (yavas)";
export const slow = true;

export async function run(page, base, t) {
  await openApp(page, base);

  // DRA UYKUDA birakiliyor: alarm kendini uyandirabilmeli.
  const target = await page.evaluate(async () => {
    const { addAlarm } = await import("/js/alarms.js");
    const panel = await import("/js/panel.js");
    const when = new Date(Date.now() + 65_000);
    const time =
      `${String(when.getHours()).padStart(2, "0")}:` +
      `${String(when.getMinutes()).padStart(2, "0")}`;
    addAlarm(time, "test alarmi", false);
    panel.renderAlarms();
    return time;
  });

  console.log(`      (${target} icin alarm kuruldu, bekleniyor…)`);

  // Teshis: saniye saniye ne oldugunu goster.
  const probe = setInterval(async () => {
    try {
      const snap = await page.evaluate(async () => {
        const { store } = await import("/js/store.js");
        const n = new Date();
        return {
          saat: `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`,
          alarm: store.alarms.map((a) => `${a.time} acik=${a.enabled} caldi=${a.lastFired}`).join(),
        };
      });
      console.log(`      ${snap.saat}  ${snap.alarm}`);
    } catch { /* sayfa kapandi */ }
  }, 15_000);
  t.ok(await page.locator("#sleep-screen").isVisible(), "alarm kurulurken DRA uykuda");

  // DIKKAT: waitForFunction'da secenekler UCUNCU parametredir; ikinciye
  // verilirse arguman sayilir ve varsayilan 30 saniyelik zaman asimi
  // gecerli olur — dakika sinirina ulasmadan test duser.
  const fired = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("#log li .chat__bubble")].some((el) =>
          el.textContent.includes("Alarm caldi"),
        ),
      null,
      { timeout: 130_000, polling: 500 },
    )
    .then(() => true)
    .catch((err) => {
      console.log(`      (bekleme bitti: ${err.message.split("\n")[0]})`);
      return false;
    });

  clearInterval(probe);
  t.ok(fired, "alarm vakti gelince caliyor");
  t.ok(!(await page.locator("#sleep-screen").isVisible()), "alarm DRA'yi uykudan uyandiriyor");

  if (!fired) return; // Devami anlamsiz; asil hata yukarida raporlandi.

  await page.waitForTimeout(500);
  const chat = await readChat(page);
  t.has(chat.at(-1)?.text ?? "", "test alarmi", "alarm etiketi sesli mesajda geciyor");

  const after = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return store.alarms[0];
  });
  t.eq(after.enabled, false, "tek seferlik alarm caldiktan sonra kapaniyor");
  t.ok(after.lastFired, "alarm son calma tarihini kaydediyor");
}
