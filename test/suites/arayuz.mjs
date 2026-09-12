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

  // Calisma modlari artik kendi sekmesinde (Modlar).
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(150);
  t.ok(await page.locator("#set-search").isVisible(), "web aramasi Modlar sekmesinde");
  t.ok(await page.locator("#set-streamer").isVisible(), "yayinci destegi Modlar sekmesinde");
  await page.click('.tab[data-tab="ayar"]');

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

  /* ------------------------------------------- ses tanima profilleri --- */
  const profiles = await page.evaluate(async () => {
    const sp = await import("/js/speech.js");
    return {
      hepsi: sp.PROFILES.length,
      yerel: sp.LOCAL_PROFILES.map((p) => p.processLocally),
      bulut: sp.CLOUD_PROFILES.map((p) => p.processLocally),
      adlar: sp.PROFILES.map((p) => p.name),
    };
  });
  t.ok(profiles.yerel.length > 1, "birden fazla cihaz ustu ayar deneniyor");
  t.ok(profiles.yerel.every((v) => v === true), "yerel profillerin hepsi cihazda isliyor");
  t.ok(profiles.bulut.every((v) => v === false), "bulut profilleri cihazda islemiyor");
  t.eq(
    profiles.yerel.length + profiles.bulut.length,
    profiles.hepsi,
    "profiller yerel/bulut olarak eksiksiz ayrilmis",
  );
  t.ok(new Set(profiles.adlar).size === profiles.hepsi, "profil adlari benzersiz");

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

  /* -------------------------------------------------- izin akisi -------- *
   * "Her seye erissin ama once izin istesin" isteginin arayuz tarafi.
   * Sinanan sey: izin verilmeden is YAPILMIYOR, soru CIKIYOR, "hayir"
   * denince vazgeciliyor, "evet" denince is tamamlaniyor.               */
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(500);
  t.ok(await page.locator('[data-pane="modlar"]').isVisible(), "Modlar sekmesi aciliyor");
  t.ok(
    await page.locator("#row-background").count() > 0,
    "calisma modlari Modlar sekmesine tasindi",
  );
  t.ok(await page.locator("#perm-list").count() > 0, "izin listesi Modlar sekmesinde");

  // Baslangicta hicbir izin verilmemis olmali.
  await page.click("#perm-revoke-all");
  await page.waitForTimeout(400);
  const ilkIzinler = await page.$$eval(
    "#perm-list .permrow__state",
    (els) => els.map((e) => e.dataset.granted),
  );
  t.ok(ilkIzinler.length >= 5, "yetkiler tek tek listeleniyor");
  t.ok(ilkIzinler.every((g) => g === "false"), "baslangicta hicbir yetki verilmemis");

  // --- "hayir" dendiginde is yapilmamali ----------------------------
  await page.fill("#composer-input", "rapor ver");
  await page.press("#composer-input", "Enter");
  await page.waitForSelector("#consent:not([hidden])", { timeout: 10000 });
  t.ok(await page.locator("#consent").isVisible(), "izin sorusu ekrana cikiyor");
  t.has(
    await page.textContent("#consent-title"),
    "Bilgisayar",
    "soru hangi yetki oldugunu yaziyor",
  );
  t.ok(
    (await page.textContent("#consent-detail")).length > 20,
    "soru ne yapilacagini acikliyor",
  );

  await page.click("#consent-no");
  await page.waitForTimeout(700);
  t.ok(await page.locator("#consent").isHidden(), "hayir deyince soru kapaniyor");
  t.eq(
    await page.$$eval("#log .card", (e) => e.length),
    0,
    "izin verilmeyince rapor uretilmiyor",
  );

  // --- sesle "evet" ------------------------------------------------
  await page.fill("#composer-input", "rapor ver");
  await page.press("#composer-input", "Enter");
  await page.waitForSelector("#consent:not([hidden])", { timeout: 10000 });
  // Soru acikken yazilan "evet" komut degil, cevap sayilmali.
  await page.fill("#composer-input", "evet");
  await page.press("#composer-input", "Enter");
  await page.waitForSelector("#log .card", { timeout: 20000 });
  t.ok(await page.locator("#consent").isHidden(), "evet deyince soru kapaniyor");

  const kart = await page.textContent("#log .card");
  t.has(kart, "Bilgisayar raporu", "rapor gorsel kart olarak basiliyor");
  t.has(kart, "Bellek", "raporda bellek satiri var");
  t.has(kart, "Acik kalma", "raporda calisma suresi var");
  t.ok(
    await page.locator("#log .card .card__bar i").count() > 0,
    "kartta doluluk cubuklari var (sunum gibi)",
  );

  // Izin verildikten sonra bir daha sorulmamali.
  await tell(page, "rapor ver", 2500);
  t.ok(await page.locator("#consent").isHidden(), "verilen izin tekrar sorulmuyor");
  t.eq(
    await page.$$eval("#log .card", (e) => e.length),
    2,
    "ikinci rapor sorusuz uretildi",
  );

  // Modlar sekmesi izni verildi olarak gostermeli.
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(600);
  t.eq(
    await page.$$eval(
      '#perm-list [data-perm="sistem"] .permrow__state',
      (els) => els[0]?.dataset.granted,
    ),
    "true",
    "verilen izin Modlar sekmesinde gorunuyor",
  );

  // Geri alinca yeniden sorulmali.
  await page.click("#perm-revoke-all");
  await page.waitForTimeout(500);
  await page.click('.tab[data-tab="ayar"]');
  await page.fill("#composer-input", "rapor ver");
  await page.press("#composer-input", "Enter");
  await page.waitForSelector("#consent:not([hidden])", { timeout: 10000 });
  t.ok(
    await page.locator("#consent").isVisible(),
    "izin geri alininca yeniden soruluyor",
  );
  await page.click("#consent-no");
  await page.waitForTimeout(500);

  /* ------------------------------------------------------ e-posta modu */
  // Hesap girilmeden "mail var mi" agi hic yoklamamali; kullaniciya ne
  // yapmasi gerektigini soylemeli.
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(300);
  t.ok(await page.locator("#set-mail").count() > 0, "e-posta modu Modlar sekmesinde");
  t.ok(await page.locator("#mail-fields").isHidden(), "hesap alanlari kapaliyken gizli");

  await page.click("#set-mail");
  await page.waitForTimeout(300);
  t.ok(await page.locator("#mail-fields").isVisible(), "mod acilinca alanlar gorunuyor");
  t.eq(
    await page.locator("#set-mail-pass").getAttribute("type"),
    "password",
    "uygulama sifresi ekranda gizli yaziliyor",
  );

  await tell(page, "mail var mi", 1500);
  const mailYanit = (await readChat(page)).at(-1).text;
  t.has(mailYanit, "uygulama sifrenizi", "hesap yoksa ne yapilacagi soyleniyor");
  t.ok(await page.locator("#consent").isHidden(), "hesap yoksa izin bile sorulmuyor");

  await page.click("#set-mail");
  await page.waitForTimeout(250);

  /* ------------------------------------------------------ DRA'nin sesi */
  // Ses ayarlari Ayar sekmesinde; onceki blok Modlar'da birakmis olabilir.
  await page.click('.tab[data-tab="ayar"]');
  await page.waitForTimeout(250);
  // Varsayilan ses bilgisayarindan gelir; ElevenLabs ancak kullanici
  // acarsa devreye girer ve o zaman bile arayuz ElevenLabs'la konusmaz.
  t.eq(
    await page.evaluate(async () => (await import("/js/store.js")).store.ttsProvider),
    "yerel",
    "varsayilan ses yerel (disari cikmiyor)",
  );
  t.ok(await page.locator("#row-eleven").isHidden(), "ElevenLabs alanlari varsayilan gizli");

  await page.selectOption("#set-tts", "elevenlabs");
  await page.waitForTimeout(400);
  t.ok(await page.locator("#row-eleven").isVisible(), "ElevenLabs secilince alanlar aciliyor");
  t.eq(
    await page.evaluate(async () => (await import("/js/store.js")).store.ttsProvider),
    "elevenlabs",
    "secim kaydediliyor",
  );

  // Anahtar girilmeden hazir sayilmamali.
  t.eq(
    await page.evaluate(async () => (await import("/js/system.js")).ttsReady()),
    false,
    "anahtarsizken ElevenLabs hazir degil",
  );

  // EN ONEMLISI: ElevenLabs secili ve HAZIR gorunuyorken bile istek
  // basarisiz olabilir (kota, ag, gecersiz anahtar). O zaman DRA DILSIZ
  // KALMAMALI. Sahte bir anahtarla hazir duruma gecip gercek bir
  // basarisizlik uretiyoruz: ElevenLabs'a ulasilamiyor.
  const hazirMi = await page.evaluate(async () => {
    const system = await import("/js/system.js");
    await system.configureTts("sk-sahte-anahtar", "sahte-ses", "eleven_flash_v2_5");
    return system.ttsReady();
  });
  t.eq(hazirMi, true, "anahtar girilince hazir duruma geciyor");

  const konusma = await page.evaluate(async () => {
    const speech = await import("/js/speech.js");
    const { store } = await import("/js/store.js");
    store.voiceEnabled = true;
    const t0 = Date.now();
    // Basarisiz olursa bile cozmeli; takilirsa bu satir hic donmez.
    await speech.say("deneme");
    return Date.now() - t0;
  });
  t.ok(konusma < 25000, `ElevenLabs cevap vermeyince konusma cozuluyor (${konusma}ms)`);

  // Kullanici sessizce yerel sese dusuruldugunu ogrenmeli.
  const uyari = await page.$$eval("#log li", (els) =>
    els.map((e) => e.textContent || "").filter((x) => /ElevenLabs/i.test(x)),
  );
  t.ok(
    uyari.some((x) => /kullanilamadi/i.test(x)),
    "ElevenLabs dusunce kullaniciya haber veriliyor",
  );

  // "Sesi dinle" de ayni sekilde takilmamali: servis yokken anlasilir
  // bir hata vermeli, sessizce yutulmamali.
  const dinlet = await page.evaluate(async () => {
    const speech = await import("/js/speech.js");
    try {
      await speech.previewVoice("deneme");
      return "sessiz";
    } catch (err) {
      return err.message;
    }
  });
  t.ok(dinlet !== "sessiz", "ses dinletilemeyince hata veriliyor");
  t.has(dinlet, "ElevenLabs", "dinletme hatasi neden oldugunu soyluyor");

  // Anahtar girilince sesler kendiliginden gelmeli — ayri bir dugmeye
  // basmak gerekmemeli. Servis yok, ama denemenin yapildigini goruyoruz.
  await page.fill("#set-eleven-key", "sk-sahte-anahtar");
  await page.dispatchEvent("#set-eleven-key", "change");
  await page.waitForTimeout(1200);
  t.has(
    await page.textContent("#eleven-status"),
    "Sesler alinamadi",
    "anahtar girilince sesler kendiliginden cekilmeye calisiliyor",
  );

  // Anahtari geri cekiyoruz ki sonraki testler etkilenmesin.
  await page.evaluate(async () => {
    const { store, saveStore } = await import("/js/store.js");
    const system = await import("/js/system.js");
    store.elevenKey = "";
    store.elevenVoice = "";
    saveStore();
    await system.configureTts("", "", "eleven_flash_v2_5");
  });

  await page.selectOption("#set-tts", "yerel");
  await page.waitForTimeout(300);
  t.ok(await page.locator("#row-eleven").isHidden(), "yerele donunce alanlar kapaniyor");

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
