/**
 * Komut motoru: saat cozumleyici, matematik, komut eslesmesi ve oneriler.
 * Tarayicida calisir cunku moduller DOM'a bagli.
 */

import { openApp, tell, readChat } from "../helpers.mjs";

export const name = "Komut motoru";

export async function run(page, base, t) {
  await openApp(page, base);

  /* ---------------------------------------------- saat cozumleyici ---- */
  const clockCases = [
    ["sabah yedi bucukta alarm kur", "07:30"],
    ["sabah yedi buçukta alarm kur", "07:30"],
    ["akşam dokuzda alarm kur ilaç", "21:00"],
    ["07:30 alarm kur", "07:30"],
    ["saat 6 45 alarm kur", "06:45"],
    ["gece on birde alarm kur", "23:00"],
    ["yediye çeyrek kala alarm kur", "06:45"],
    ["öğlen on ikide alarm", "12:00"],
    ["sabah altı buçukta beni uyandır", "06:30"],
    ["yirmi üçte alarm kur", "23:00"],
    ["saat sekizde alarm", "08:00"],
  ];

  const clockResults = await page.evaluate(async (cases) => {
    const { parseClockTime, normalize } = await import("/js/commands.js");
    return cases.map(([text]) => parseClockTime(normalize(text)));
  }, clockCases);

  clockCases.forEach(([text, expected], i) => {
    t.eq(clockResults[i], expected, `saat: "${text}"`);
  });

  /* ------------------------------------------------------ matematik --- */
  const mathCases = [
    ["12 kere 8 kac eder", "96"],
    ["45 arti 17", "62"],
    ["100 bolu 4", "25"],
    ["2 uzeri 10", "1.024"],
  ];

  await page.click("#btn-manual-wake");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(300);

  for (const [input, expected] of mathCases) {
    await tell(page, input);
    const chat = await readChat(page);
    t.has(chat.at(-1).text, expected, `hesap: "${input}" → ${expected}`);
  }

  /* --------------------------------------------------- komut eslesme -- */
  const matchCases = [
    ["saat kac", "Saat "],
    ["yazi tura at", "geldi"],
    ["not al pil al", "Not alindi"],
    ["notlarim", "pil al"],
    ["kimsin", "yapay zeka degilim"],
    ["neler yapabilirsin", "hesap yapabilirim"],
    ["5 dakika zamanlayici kur", "zamanlayici kuruldu"],
    ["sabah yedi bucukta alarm kur", "07:30"],
    ["alarmlarim", "alarminiz var"],
    ["hava durumu", "disariya hicbir baglanti"],
  ];

  for (const [input, expected] of matchCases) {
    await tell(page, input);
    const chat = await readChat(page);
    t.has(chat.at(-1).text, expected, `komut: "${input}"`);
  }

  // Selamlama uc varyanttan rastgele secilir; hepsini karsilayan kalip.
  await tell(page, "merhaba");
  const greeting = (await readChat(page)).at(-1);
  t.match(
    greeting.text,
    /efendim|Buradayim|Sistemler calisiyor/,
    'komut: "merhaba" (rastgele selamlama)',
  );

  /* ------------------------------------------------------- oneriler --- */
  await tell(page, "saatin kac oldugunu soyler misin");
  let chat = await readChat(page);
  t.has(chat.at(-1).text, 'saat kac', "yakin komut onerisi");

  await tell(page, "blorp zonk gribble");
  chat = await readChat(page);
  t.has(chat.at(-1).text, "yapay zekasi degilim", "anlasilmayan girdi: yetenek listesi");

  /* -------------------- zamanlayici ile alarmi karistirmamali --------- */
  const timers = await page.$$eval("#timers li", (e) => e.map((x) => x.textContent));
  t.ok(
    timers.some((x) => x.includes("Zamanlayici")),
    "'5 dakika zamanlayici' alarm degil sayac kurdu",
  );
}
