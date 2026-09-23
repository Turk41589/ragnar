/**
 * Hibrit tanimanin uctan uca akisi (arayuzde).
 *
 * Gomulu motor (Vosk) sahte bir kopruyle taklit ediliyor; bulut cagrisi
 * sayfanin kendi sunucusuna gidiyor ve orada yakalanip cevaplaniyor.
 * Yani disari hicbir istek cikmiyor, ama arayuzun butun karar mantigi
 * gercek: kesici, uyandirma, gizlilik kapisi, arizada yerel motora donus.
 *
 * Sinanan vaatler:
 *   - Uyurken, "DRA" denmemis cumle buluta GITMEZ.
 *   - "DRA" denince o cumle gider; bulutun dogru yazisiyla uyanir ve
 *     ayni nefesteki komutu calistirir.
 *   - Uyanikken Vosk'un bozuk yazisi komut olarak calismaz.
 *   - Bulut hata verirse DRA susmaz: Vosk'a doner ve kullaniciya soyler.
 */

import { openApp, readChat } from "../helpers.mjs";

export const name = "Bulutta tanima akisi";

/** Sayfada: konusmaya benzeyen sesi kesiciye verir. */
async function konus(page, parcalar) {
  await page.evaluate(async (parcalar) => {
    const sp = await import("/js/speech.js");
    const HIZ = 16000;
    const uret = ([tur, saniye]) => {
      const n = Math.round(saniye * HIZ);
      const out = new Int16Array(n);
      if (tur === "ses") {
        for (let i = 0; i < n; i += 1) {
          // 200 ms hece, 60 ms dusus
          const hece = (i % Math.round(0.26 * HIZ)) < 0.2 * HIZ;
          out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / HIZ) * (hece ? 0.2 : 0.01) * 32767);
        }
      }
      return out;
    };
    for (const p of parcalar) {
      if (p[0] === "vosk") {
        sp.handleRecognitionResult(p[1]);
        continue;
      }
      const ses = uret(p);
      for (let i = 0; i < ses.length; i += 1365) sp.bulutBesle(ses.slice(i, i + 1365));
    }
  }, parcalar);
}

const durum = (page) =>
  page.evaluate(async () => {
    const { state } = await import("/js/state.js");
    const sp = await import("/js/speech.js");
    return { state: state.current, bulut: sp.bulutDurumu() };
  });

export async function run(page, base, t) {
  // Gomulu motoru taklit eden kopru: sayfa betiklerinden ONCE kurulmali.
  await page.addInitScript(() => {
    const bos = () => () => {};
    window.dra = {
      stt: {
        status: async () => ({ status: { engine: "vosk", modelReady: true } }),
        inspect: async () => ({ info: null }),
        grammar: async () => ({ applied: true }),
        start: async () => ({}),
        stop: async () => ({}),
        feed: () => {},
        onResult: bos,
        onEngine: bos,
        onProgress: bos,
      },
    };
  });

  /** Bulut cagrilarini yakalayan uc. */
  const istekler = [];
  let siradaki = { ok: true, text: "", seconds: 1 };
  let gecikme = 0;
  await page.route("**/api/stt/cloud", async (route) => {
    const govde = JSON.parse(route.request().postData() || "{}");
    istekler.push({ bayt: Buffer.from(govde.pcm || "", "base64").length, ipucu: govde.ipucu });
    const cevap = JSON.stringify(siradaki);
    if (gecikme) await new Promise((r) => setTimeout(r, gecikme));
    await route.fulfill({ status: 200, contentType: "application/json", body: cevap });
  });

  await openApp(page, base);
  const hazir = await page.evaluate(async () => {
    const { store, saveStore } = await import("/js/store.js");
    const system = await import("/js/system.js");
    const sp = await import("/js/speech.js");
    store.bootSequence = false;
    store.sttProvider = "elevenlabs";
    store.elevenKey = "sk-akis-testi";
    saveStore();
    const d = await system.configureSttCloud("elevenlabs", store.elevenKey);
    return { ready: d.ready, keyGorunuyor: JSON.stringify(d).includes("sk-akis"), aktif: sp.bulutAktif() };
  });
  t.ok(hazir.ready, "anahtar bildirilince bulut hazir");
  t.ok(!hazir.keyGorunuyor, "durum yanitinda anahtar yok");
  t.ok(hazir.aktif, "gomulu motor + anahtar → bulut aktif");

  /* ------------------------------------------- uyurken gizlilik ----- */
  t.eq((await durum(page)).state, "sleeping", "DRA uykuda basliyor");
  await konus(page, [["sessiz", 1], ["ses", 1.2], ["sessiz", 1.2]]);
  await page.waitForTimeout(1200);
  t.eq(istekler.length, 0, "uyurken DRA denmeyen cumle buluta gitmiyor");
  t.eq((await durum(page)).state, "sleeping", "ve DRA uyanmiyor");

  // Vosk alakasiz bir sey duydu: yine gitmemeli.
  await konus(page, [["sessiz", 0.5], ["ses", 0.4], ["vosk", { partial: "bugun hava" }], ["ses", 0.6], ["sessiz", 1.2]]);
  await page.waitForTimeout(1200);
  t.eq(istekler.length, 0, "Vosk alakasiz sey duyunca da gitmiyor");

  /* ------------------------------------------------- uyandirma ------ */
  siradaki = { ok: true, text: "Dra, 7 kere 6 kaç eder?", seconds: 2 };
  await konus(page, [
    ["sessiz", 0.5],
    ["ses", 0.4],
    // Kucuk model "dra"yi "bira" duyuyor — uyandirmaya yetiyor.
    ["vosk", { partial: "bira" }],
    ["ses", 1.2],
    ["sessiz", 1.2],
  ]);
  await page.waitForSelector("#hud:not([hidden])", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  t.eq(istekler.length, 1, "DRA denen cumle buluta gitti");
  t.ok(istekler[0]?.bayt > 16000 * 2 * 1.5, `sesin tamami gitti (${istekler[0]?.bayt} bayt)`);
  t.ok(await page.locator("#hud").isVisible(), "bulut yazisiyla uyandi");
  let chat = await readChat(page);
  t.ok(chat.some((m) => m.who === "user" && /7 kere 6/.test(m.text)), "ayni nefesteki komut bulut yazisiyla islendi");
  t.has(chat.at(-1)?.text, "42", "komut dogru yanitlandi");

  /* ----------------------------------- uyanikken Vosk komut degil --- */
  const onceki = (await readChat(page)).length;
  await konus(page, [["vosk", { final: "ayı bira saat kaç" }]]);
  await page.waitForTimeout(500);
  t.eq((await readChat(page)).length, onceki, "uyanikken Vosk'un bozuk yazisi komut olarak calismiyor");

  /* ------------------------------------------ uyanikken bulut ------- */
  siradaki = { ok: true, text: "8 kere 5 kaç eder", seconds: 1.5 };
  await konus(page, [["sessiz", 0.4], ["ses", 1.2], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  t.eq(istekler.length, 2, "uyanikken her cumle buluta gidiyor");
  chat = await readChat(page);
  t.has(chat.at(-1)?.text, "40", "uyanikken bulut yazisi komut olarak isleniyor");

  // Bos yazi (oksuruk, nefes) hicbir sey yapmamali.
  siradaki = { ok: true, text: "", seconds: 1 };
  const bosOnce = (await readChat(page)).length;
  await konus(page, [["sessiz", 0.4], ["ses", 0.8], ["sessiz", 1.2]]);
  await page.waitForTimeout(700);
  t.eq((await readChat(page)).length, bosOnce, "bos yazi sohbete dusmuyor");
  t.ok((await durum(page)).state !== "listening", "bos yazidan sonra 'dinliyor'da takili kalmiyor");

  /* ----------------------------------------------- ariza → Vosk ----- */
  siradaki = { ok: false, error: "ElevenLabs ses tanima kotasi doldu ya da cok sik istek gitti.", code: "HTTP_429" };
  await konus(page, [["sessiz", 0.4], ["ses", 1], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  let d = await durum(page);
  t.ok(d.bulut.arizada, "bulut hatasi ariza olarak isaretlendi");
  t.ok(!d.bulut.aktif, "arizada cumleler buluta gitmiyor");
  chat = await readChat(page);
  t.ok(chat.some((m) => /kotasi doldu/.test(m.text) && /cihazdaki motor/.test(m.text)), "kullaniciya sebebiyle soylendi");

  await konus(page, [["vosk", { final: "9 kere 3 kaç eder" }]]);
  await page.waitForTimeout(700);
  chat = await readChat(page);
  t.has(chat.at(-1)?.text, "27", "arizada Vosk'un yazisi yine calisiyor");

  /* ----------------------------------- uyurken ariza: yine uyanir --- */
  await page.evaluate(async () => {
    const sp = await import("/js/speech.js");
    sp.bulutuYenile();
    document.querySelector("#btn-sleep")?.click();
  });
  await page.waitForTimeout(700);
  t.eq((await durum(page)).state, "sleeping", "uykuya dondu");
  siradaki = { ok: false, error: "ElevenLabs'a ulasilamadi: fetch failed", code: "NETWORK" };
  const istekOnce = istekler.length;
  await konus(page, [["sessiz", 0.5], ["ses", 0.3], ["vosk", { partial: "dra" }], ["ses", 0.5], ["sessiz", 1.2]]);
  await page.waitForTimeout(1200);
  t.eq(istekler.length, istekOnce + 1, "uyandirma cumlesi buluta gitti");
  t.ok(await page.locator("#hud").isVisible(), "bulut cevap vermese de DRA uyandi (Vosk'un duyduguyla)");

  /* ------------------------------------------ yerel secilirse ------- */
  const yerel = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    const sp = await import("/js/speech.js");
    store.sttProvider = "yerel";
    return sp.bulutAktif();
  });
  t.ok(!yerel, "'Cihazdaki model' secilince bulut devre disi");

  /* ------------------------------------ tek secenek: Whisper (ayar) -- */
  await page.click('.tab[data-tab="ayar"]');
  await page.waitForTimeout(250);
  t.eq(await page.locator("#set-stt").count(), 0, "saglayici secimi yok — tek secenek Whisper");
  t.eq(await page.locator("#set-openai-key, #set-stt-key").count(), 0, "bulut anahtari sorulmuyor");
  t.ok(await page.locator("#row-whisper").isVisible(), "Whisper bolumu gorunuyor");
  t.has(await page.textContent("#whisper-status"), "yalnizca Windows uygulamasinda",
    "tarayicida Whisper'in olmadigi soyleniyor");
  const varsayilan = await page.evaluate(async () => {
    localStorage.setItem("dra.state.v2", JSON.stringify({ firstRunDone: true, sttProvider: "elevenlabs" }));
    const { store, loadStore } = await import("/js/store.js");
    store.sttProvider = "whisper";
    loadStore();
    return store.sttProvider;
  });
  t.eq(varsayilan, "whisper", "eski kayittaki ElevenLabs secimi Whisper'a donuyor");

  await page.click("#set-stt-test");
  await page.waitForTimeout(600);
  t.has(await page.textContent("#stt-status"), "Calismiyor", "Whisper baslamayinca sebebi yaziyor");
  t.ok(!(await page.evaluate(async () => (await import("/js/speech.js")).bulutAktif())),
    "Whisper baslamayinca onceki yaziya ceviren acik kalmiyor (kucuk model devam ediyor)");

  /* ======================= Whisper bu bilgisayarda: uyurken de dinler */
  // Tarayici surumu Whisper'i baslatamaz; masaustundeki durumu taklit
  // etmek icin yapilandirma cevabini Whisper olarak veriyoruz.
  await page.route("**/api/stt/cloud/configure", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        status: { ready: true, keySet: false, provider: "whisper", name: "Whisper (bu bilgisayarda)" },
      }),
    }));
  await openApp(page, base);
  const whisperHazir = await page.evaluate(async () => {
    const { store, saveStore } = await import("/js/store.js");
    const system = await import("/js/system.js");
    const sp = await import("/js/speech.js");
    store.bootSequence = false;
    saveStore();
    await system.configureSttCloud("whisper");
    return sp.bulutAktif();
  });
  t.ok(whisperHazir, "Whisper hazir");
  istekler.length = 0;

  // Kucuk model HICBIR SEY duymasa da cumle Whisper'a gidiyor.
  siradaki = { ok: true, text: "bugün hava güzel", seconds: 1 };
  await konus(page, [["sessiz", 1], ["ses", 1.2], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  t.eq(istekler.length, 1, "uyurken kucuk model duymasa da cumle Whisper'a gitti");
  t.eq(istekler[0]?.ipucu, false, "uyurken 'DRA' ipucu verilmiyor (kendiliginden uyanmasin)");
  t.eq((await durum(page)).state, "sleeping", "'DRA' gecmeyen cumle uyandirmiyor");
  t.has(await page.textContent("#sleep-sub"), "bugün hava güzel", "uyku ekraninda ne duydugu gorunuyor");

  // "DRA"yi Whisper duyuyor: kucuk modelin ipucu olmadan uyanir.
  siradaki = { ok: true, text: "Dıra, 6 kere 7 kaç eder?", seconds: 2 };
  await konus(page, [["sessiz", 0.5], ["ses", 1.4], ["sessiz", 1.2]]);
  await page.waitForSelector("#hud:not([hidden])", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  t.ok(await page.locator("#hud").isVisible(), "Whisper 'DRA'yi duyunca uyandi (kucuk model duymadan)");
  t.has((await readChat(page)).at(-1)?.text, "42", "ayni cumledeki komut calisti");
  t.eq(istekler.at(-1)?.ipucu, false, "uyandiran cumle de ipucusuz gitti");

  // Uyanikken ipucu veriliyor ("DRA" gibi ozel sozcukler icin).
  siradaki = { ok: true, text: "5 kere 5 kaç eder", seconds: 1 };
  await konus(page, [["sessiz", 0.4], ["ses", 1.0], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  t.eq(istekler.at(-1)?.ipucu, true, "uyanikken ipucu veriliyor");
  t.has((await readChat(page)).at(-1)?.text, "25", "uyanikken komut calisti");

  /* ---------------------------- konustuktan sonra sagir KALMIYOR ---- */
  // DRA uzun bir cumle soyluyor; ses bitince hemen dinlemeli. Eskiden
  // sagirlik suresi metin uzunlugundan tahmin ediliyordu (~20 sn!).
  await page.route("**/api/tts/configure", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, status: { ready: true, keySet: true, voiceId: "v", model: "m" } }) }));
  await page.route("**/api/tts/speak", (route) => {
    // 0.3 sn sessiz WAV
    const n = 4800;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii"); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36, "ascii"); wav.writeUInt32LE(n * 2, 40);
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, audio: wav.toString("base64"), type: "audio/wav" }) });
  });
  const konusma = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    const system = await import("/js/system.js");
    const sp = await import("/js/speech.js");
    store.voiceEnabled = true;
    store.ttsProvider = "elevenlabs";
    await system.configureTts("k", "v", "m");
    const bas = Date.now();
    const sonuc = await Promise.race([
      sp.say("Bu cumle bilerek uzun tutuldu ki eski tahmin yirmi saniye kadar sagirlik uretsin; " +
        "gercek ses ise yalnizca uc saniyenin onda biri surecek."),
      new Promise((r) => setTimeout(() => r("zaman asimi"), 8000)),
    ]);
    store.voiceEnabled = false;
    return { sonuc, sure: Date.now() - bas };
  });
  t.ok(konusma.sonuc !== "zaman asimi", `seslendirme bitti (${konusma.sure} ms)`);
  await page.waitForTimeout(900);
  const onceIstek = istekler.length;
  siradaki = { ok: true, text: "8 kere 2 kaç eder", seconds: 1 };
  await konus(page, [["sessiz", 0.4], ["ses", 1.0], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  t.eq(istekler.length, onceIstek + 1, "DRA konustuktan hemen sonra soylenen cumle duyuldu");
  t.has((await readChat(page)).at(-1)?.text, "16", "ve komut calisti");

  // "sus" da tahmini sagirligi bitirmeli.
  const susSonrasi = await page.evaluate(async () => {
    const sp = await import("/js/speech.js");
    sp.deafen(20000);
    sp.shutUp();
    return true;
  });
  t.ok(susSonrasi, "susturuldu");
  await page.waitForTimeout(800);
  const susIstek = istekler.length;
  siradaki = { ok: true, text: "2 kere 2 kaç eder", seconds: 1 };
  await konus(page, [["sessiz", 0.4], ["ses", 1.0], ["sessiz", 1.2]]);
  await page.waitForTimeout(900);
  t.eq(istekler.length, susIstek + 1, "susturulduktan sonra soylenen cumle duyuldu");

  /* --------------------------- uyurken kuyruk sisirmesin (TV acik) --- */
  await page.click("#btn-sleep");
  await page.waitForTimeout(600);
  const kuyrukOnce = istekler.length;
  gecikme = 1500;
  siradaki = { ok: true, text: "haberler devam ediyor", seconds: 1 };
  for (let i = 0; i < 4; i += 1) await konus(page, [["sessiz", 0.2], ["ses", 0.8], ["sessiz", 1.0]]);
  await page.waitForTimeout(3800);
  gecikme = 0;
  t.ok(istekler.length - kuyrukOnce <= 2, `uyurken en fazla 2 cumle sirada bekliyor (${istekler.length - kuyrukOnce} gitti)`);
  t.eq((await durum(page)).state, "sleeping", "TV konusmasi DRA'yi uyandirmadi");

  // Sunucudaki anahtari temizle; sonraki paketler etkilenmesin.
  await page.unroute("**/api/stt/cloud/configure");
  await page.evaluate(async () => {
    const system = await import("/js/system.js");
    await system.configureSttCloud("elevenlabs", "");
    await system.configureTts("", "", "");
  });
}
