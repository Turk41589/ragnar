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
  // Web arastirmasi anahtari kaldirildi: artik hep acik.
  t.eq(
    await page.locator("#set-search").count(),
    0,
    "web aramasi anahtari kaldirildi (hep acik)",
  );
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

  /* ------------------------------------------------- ilk acilis ekrani --- *
   * Kullanici "izni ilk acilista istesin" dedi. Ayri bir sayfada aciyoruz
   * cunku diger testler bu ekranin arkasindaki arayuzle ilgileniyor.    */
  {
    const ilk = await page.context().newPage();
    await openApp(ilk, base, { firstRun: true });

    await ilk.waitForSelector("#firstrun:not([hidden])", { timeout: 15000 });
    t.ok(await ilk.locator("#firstrun").isVisible(), "ilk acilista izin ekrani cikiyor");

    const satirlar = await ilk.$$eval("#firstrun-list [data-scope]", (els) =>
      els.map((e) => ({ scope: e.dataset.scope, acik: e.getAttribute("aria-checked") })));
    t.ok(satirlar.length >= 6, "tum yetkiler tek ekranda listeleniyor");
    t.ok(
      satirlar.every((x) => x.acik === "false"),
      "hicbir yetki ONCEDEN SECILI degil (okumadan tiklama tesvik edilmiyor)",
    );
    t.ok(
      await ilk.$$eval("#firstrun-list .hint", (e) => e.every((x) => x.textContent.trim())),
      "her yetkinin ne yaptigi yaziyor",
    );

    // Iki yetki secip onaylayalim.
    await ilk.click('#firstrun-list [data-scope="kontrol"]');
    await ilk.click('#firstrun-list [data-scope="sistem"]');
    await ilk.click("#firstrun-accept");
    await ilk.waitForTimeout(900);
    t.ok(await ilk.locator("#firstrun").isHidden(), "onaydan sonra ekran kapaniyor");

    const verilenler = await ilk.evaluate(async () => {
      const s = await import("/js/system.js");
      return (await s.permissions()).filter((p) => p.granted).map((p) => p.id).sort();
    });
    t.eq(verilenler, ["kontrol", "sistem"], "yalnizca secilen yetkiler verildi");

    // Bir daha gosterilmemeli.
    await ilk.reload({ waitUntil: "networkidle" });
    await ilk.waitForTimeout(1600);
    t.ok(await ilk.locator("#firstrun").isHidden(), "ikinci acilista tekrar sorulmuyor");

    // Sonraki testler etkilenmesin.
    await ilk.evaluate(async () => {
      const s = await import("/js/system.js");
      await s.revokePermission("*");
    });
    await ilk.close();
  }

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

  /* -------------------------------------------- karttaki adres suzgeci
   * Kart iceriginin bir kismi DISARIDAN geliyor: arama sonuclari,
   * e-posta basliklari, sayfa onizlemeleri. Aralarina "javascript:" ile
   * baslayan bir adres karisirsa, tiklandiginda uygulamanin KENDI
   * sayfasinda calisir — ve o sayfada `window.dra` var, yani bilgisayara
   * erisim var. target="_blank" bunu engellemiyor: tarayicilar
   * "javascript:" baglarini yeni pencerede DEGIL, bulundugu sayfada
   * calistirir.                                                        */

  const suzgec = await page.evaluate(async () => {
    const hud = await import("/js/hud.js");

    const kotu = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///C:/Windows/System32/config",
      "vbscript:msgbox(1)",
    ];

    hud.logCard({
      title: "Sinama",
      sections: [{
        links: [
          ...kotu.map((url, i) => ({ title: `kotu ${i}`, url })),
          { title: "iyi", url: "https://ornek.com/a" },
        ],
        // BILEREK yalnizca tehlikeli gorseller: gecerli bir dis adres
        // koyarsak tarayici onu gercekten indirmeye calisir ve bu paketin
        // "localhost disina istek atilmadi" olcumunu bozar. Gecerli
        // adresin gectigi zaten guvenliAdres uzerinden dogrulaniyor.
        images: [
          { src: "javascript:alert(1)", url: "javascript:alert(1)", site: "kotu" },
          { src: "vbscript:msgbox(1)", url: "data:text/html,x", site: "kotu2" },
        ],
      }],
    });

    const kart = [...document.querySelectorAll(".card")].at(-1);
    const baglar = [...kart.querySelectorAll(".card__links a")].map((a) => a.getAttribute("href"));
    const yazilar = [...kart.querySelectorAll(".card__links li")].map((li) => li.textContent);
    const gorseller = [...kart.querySelectorAll(".card__shot img")].map((i) => i.getAttribute("src"));
    const gorselBaglar = [...kart.querySelectorAll("a.card__shot")].map((a) => a.getAttribute("href"));

    return {
      baglar,
      yazilar,
      gorseller,
      gorselBaglar,
      // Yardimci dogrudan da sinansin.
      dogrudan: kotu.map((u) => hud.guvenliAdres(u)),
      iyiGecti: hud.guvenliAdres("https://ornek.com/a"),
      gorselGecer: hud.guvenliAdres("https://ornek.com/r.png"),
      goreli: hud.guvenliAdres("/js/hud.js"),
    };
  });

  t.eq(suzgec.baglar, ["https://ornek.com/a"], "yalnizca http(s) bagi tiklanabilir oluyor");
  t.eq(suzgec.baglar.length, 1, "tehlikeli adresler bag olarak kurulmuyor");
  t.eq(suzgec.yazilar.length, 6, "elenen sonuclar sessizce yok olmuyor, basliklari duruyor");
  t.eq(suzgec.gorseller, [], "tehlikeli gorsel adresi yuklenmiyor");
  t.eq(suzgec.gorselBaglar, [], "tehlikeli gorsel bagi kurulmuyor");
  t.eq(
    suzgec.gorselGecer,
    "https://ornek.com/r.png",
    "gecerli gorsel adresi gecmeye devam ediyor",
  );
  t.eq(suzgec.dogrudan, [null, null, null, null, null], "guvenliAdres hepsini eliyor");
  t.eq(suzgec.iyiGecti, "https://ornek.com/a", "normal adres gecmeye devam ediyor");
  t.eq(suzgec.goreli, null, "goreli adres kabul edilmiyor (mutlak http(s) sart)");

  /* ------------------------------------------- kaydedilemeyen ayarlar
   * Notlar, alarmlar ve ayarlar tarayici deposunda duruyor. Depo dolu
   * ya da kapaliysa saveStore ESKIDEN sessizce geciyordu: kullanici not
   * aliyor, alarm kuruyor, hicbiri kaydedilmiyor ve bunu ancak
   * uygulamayi kapatip acinca anliyordu.                              */

  const depoHatasi = await page.evaluate(async () => {
    const st = await import("/js/store.js");
    const gercek = localStorage.setItem.bind(localStorage);

    const duyulan = [];
    const dinleyici = (e) => duyulan.push(e.detail?.message || "");
    window.addEventListener("dra:store-error", dinleyici);

    // store.js bilerek console.error yaziyor (dogru davranis). Paketin
    // "konsolda hata yok" olcumu bunu gercek bir hata sanmasin diye
    // sinama suresince susturuyoruz.
    const gercekHata = console.error;
    console.error = () => {};

    // Depo dolu gibi davran.
    localStorage.setItem = () => {
      const err = new Error("dolu");
      err.name = "QuotaExceededError";
      throw err;
    };

    st.saveStore();
    st.saveStore();            // ikinci kez: tekrar bagirmamali
    const hastaykenDurum = st.storeHealth().saveError;

    localStorage.setItem = gercek;
    st.saveStore();            // duzelince temizlenmeli
    const duzeldiktenSonra = st.storeHealth().saveError;

    console.error = gercekHata;
    window.removeEventListener("dra:store-error", dinleyici);
    return { duyulan, hastaykenDurum, duzeldiktenSonra };
  });

  t.eq(depoHatasi.duyulan.length, 1, "kaydedilemedigi BIR kez bildiriliyor (her seferinde degil)");
  t.has(depoHatasi.duyulan[0] || "", "dolu", "sebep yaziyor (depo dolu)");
  t.ok(depoHatasi.hastaykenDurum, "durum sorgulanabiliyor");
  t.eq(depoHatasi.duzeldiktenSonra, null, "sorun gecince durum temizleniyor");

  /* ------------------------------------------------- merkez sahne ----
   * Istenen davranis: DRA bir seyi ANLATIRKEN orta bolum konuyla ilgili
   * gorselleri gostersin, konusma bitince eski haline donsun. Sohbet ve
   * ayar panelleri yerinde kalsin.                                     */

  const sahne = await page.evaluate(async () => {
    const hud = await import("/js/hud.js");
    const durum = () => ({
      sahne: !document.getElementById("stage").hidden,
      halka: !document.getElementById("core-ring").hidden,
      sohbet: Boolean(document.querySelector(".panel--right")?.offsetParent),
      ayar: Boolean(document.querySelector(".panel--left")?.offsetParent),
    });

    const once = durum();

    const acildi = hud.showStage({
      title: "eyfel kulesi kac metre",
      note: "Eyfel Kulesi 330 metre yuksekligindedir.",
      // Adres AYNI KOKENDEN: bu paket "localhost disina hicbir istek
      // atilmadi" diye olcuyor, gercek bir dis adres o olcumu bozar.
      // Gorselin yuklenip yuklenmedigi onemli degil; sinanan sey
      // adresin sahneye alinip alinmadigi.
      images: [
        { src: `${location.origin}/js/hud.js`, site: "vikipedi" },
        { src: "javascript:alert(1)", site: "kotu" },
      ],
      sources: ["tr.wikipedia.org", "britannica.com"],
    });
    const acikken = durum();
    const kart = {
      baslik: document.getElementById("stage-title").textContent,
      not: document.getElementById("stage-note").textContent,
      gorsel: document.querySelectorAll("#stage-shots img").length,
      gorselAdres: [...document.querySelectorAll("#stage-shots img")]
        .map((i) => i.getAttribute("src")),
      kaynak: [...document.querySelectorAll("#stage-sources li")].map((l) => l.textContent),
    };

    hud.hideStage();
    await new Promise((r) => setTimeout(r, 350));
    const sonra = durum();

    // Gosterilecek hicbir sey yoksa sahne HIC acilmamali: bos bir kutu
    // reaktoru gizlemekten kotu.
    const bosAcildi = hud.showStage({ title: "", note: "", images: [], sources: [] });

    // Gercek bir dis adresin KABUL edildigini ag'a cikmadan dogruluyoruz.
    const guvenli = hud.guvenliAdres("https://ornek.com/1.png");
    return { once, acildi, acikken, kart, sonra, bosAcildi, guvenli, acikMi: hud.stageOpen() };
  });

  t.eq(sahne.once.sahne, false, "sahne bastan kapali");
  t.eq(sahne.acildi, true, "icerik varsa sahne aciliyor");
  t.eq(sahne.acikken.sahne, true, "anlatirken sahne gorunuyor");
  t.eq(sahne.acikken.halka, false, "sahne acikken reaktor yerini birakiyor");
  t.eq(sahne.acikken.sohbet, true, "sahne acikken SOHBET yerinde kaliyor");
  t.eq(sahne.acikken.ayar, true, "sahne acikken AYAR paneli yerinde kaliyor");
  t.has(sahne.kart.baslik, "eyfel", "sahnede soru yaziyor");
  t.has(sahne.kart.not, "330 metre", "sahnede ozet yaziyor");
  t.eq(sahne.kart.gorsel, 1, "yalnizca guvenli gorsel sahneye giriyor");
  t.eq(sahne.kart.gorselAdres.length, 1, "tehlikeli adres elendi");
  t.ok(!sahne.kart.gorselAdres[0].startsWith("javascript"), "sahneye giren adres guvenli");
  t.eq(sahne.guvenli, "https://ornek.com/1.png", "normal dis adres sahneye kabul ediliyor");
  t.eq(sahne.kart.kaynak, ["tr.wikipedia.org", "britannica.com"], "kaynak adlari yaziyor");
  t.eq(sahne.sonra.sahne, false, "konusma bitince sahne kapaniyor");
  t.eq(sahne.sonra.halka, true, "kapaninca reaktor geri geliyor");
  t.eq(sahne.bosAcildi, false, "gosterilecek sey yoksa sahne acilmiyor");

  /* ------------------------------------------- gelen kutusu gorunumu -
   * Kullanicinin cizdigi sey: ustte hesap adi, altinda "yeni gelen
   * okunmamis" ve "okunmamis diger" gruplari, her satirda gonderen
   * kalin / konusu ince.                                              */

  const kutu = await page.evaluate(async () => {
    const hud = await import("/js/hud.js");
    hud.logCard({
      title: "E-posta raporu",
      sections: [{
        inbox: {
          account: "ornek@gmail.com",
          unreadTotal: 12,
          groups: [
            {
              title: "Yeni gelen okunmamis mailleriniz",
              entries: [
                { from: "Ayse Yilmaz", text: "Gorusme icin uygun musunuz?", at: "09:14" },
                { from: "Marka Isbirligi", text: "Sponsorluk teklifi", at: "08:02" },
              ],
            },
            {
              title: "Okunmamis diger mailleriniz",
              entries: [{ from: "Banka", text: "Ekstre hazir", at: "12.09" }],
            },
            // Bos grup basilmamali.
            { title: "Bos grup", entries: [] },
          ],
        },
      }],
    });

    const el = [...document.querySelectorAll(".card")].at(-1).querySelector(".inbox");
    return {
      hesap: el.querySelector(".inbox__account").textContent,
      rozet: el.querySelector(".inbox__badge").textContent,
      gruplar: [...el.querySelectorAll(".inbox__group")].map((g) => g.textContent),
      gonderenler: [...el.querySelectorAll(".inbox__from")].map((f) => f.textContent),
      yazilar: [...el.querySelectorAll(".inbox__text")].map((f) => f.textContent),
      saatler: [...el.querySelectorAll(".inbox__time")].map((f) => f.textContent),
    };
  });

  t.eq(kutu.hesap, "ornek@gmail.com", "kutunun ustunde hesap adi yaziyor");
  t.has(kutu.rozet, "12", "toplam okunmamis sayisi gorunuyor");
  t.eq(kutu.gruplar.length, 2, "bos grup basilmiyor");
  t.has(kutu.gruplar[0], "Yeni gelen", "once yeni gelenler");
  t.has(kutu.gruplar[1], "diger", "sonra digerleri");
  t.eq(kutu.gonderenler, ["Ayse Yilmaz", "Marka Isbirligi", "Banka"], "gonderenler sirayla");
  t.eq(kutu.yazilar[0], "Gorusme icin uygun musunuz?", "konu ozeti yaziyor");
  t.eq(kutu.saatler[0], "09:14", "saat gosteriliyor");

  // Hic okunmamis yoksa bos kutu degil, acik bir cumle.
  const bosKutu = await page.evaluate(async () => {
    const hud = await import("/js/hud.js");
    hud.logCard({
      title: "E-posta raporu",
      sections: [{ inbox: { account: "x@y.com", groups: [{ title: "Yeni", entries: [] }] } }],
    });
    const el = [...document.querySelectorAll(".card")].at(-1).querySelector(".inbox");
    return el.querySelector(".inbox__empty")?.textContent || "";
  });
  t.has(bosKutu, "Okunmamis mesaj yok", "bos kutuda anlasilir bir cumle var");

  /* ---------------------------------------------- "rapor ver" zinciri
   * Istenen sira: once bilgisayarin durumu, sonra bagliysa Gmail gelen
   * kutusu, sonra bagliysa WhatsApp / musteri mesajlari. Bagli olmayan
   * bolum SESSIZCE atlanmali — her "rapor ver"de "Gmail kurulu degil"
   * duymak istenmez.                                                   */

  const zincir = await page.evaluate(async () => {
    const { runCommand } = await import("/js/commands.js");

    const cagrilan = [];
    const ctx = {
      fullReport: async () => {
        cagrilan.push("tam");
        return "Bilgisayar iyi. Gmail'de 2 okunmamis. WhatsApp'ta 1 yanit bekliyor.";
      },
      // Eski yol: artik kullanilmamali.
      computerReport: async () => {
        cagrilan.push("yalnizca-bilgisayar");
        return "Yalnizca bilgisayar.";
      },
    };

    const sonuc = await runCommand("rapor ver", ctx);
    return { cagrilan, metin: sonuc?.text || "" };
  });

  t.eq(zincir.cagrilan, ["tam"], '"rapor ver" ZINCIRI calistiriyor, tek raporu degil');
  t.has(zincir.metin, "Gmail", "sozlu ozet Gmail bolumunu de iceriyor");
  t.has(zincir.metin, "WhatsApp", "sozlu ozet WhatsApp bolumunu de iceriyor");

  /* ---------------------------------- arastirma kartla VE sahneyle gelir
   * "arastir …" komutu bir donem yalnizca duz bir cumle donduruyordu:
   * ne kart, ne gorsel, ne kaynak bagi. Komutla sorulan soru ile dogrudan
   * sorulan soru arasinda kullanici acisindan fark yok.               */

  const arastirma = await page.evaluate(async () => {
    const { runCommand } = await import("/js/commands.js");
    const ctx = {
      searchEnabled: () => true,
      research: async (q) => ({
        text: `${q} icin cevap.`,
        stage: { title: q, note: "ozet", images: [{ src: "https://a.co/1.png" }], sources: ["a.co"] },
      }),
    };
    const sonuc = await runCommand("arastir eyfel kulesi", ctx);
    return {
      metin: sonuc?.text || "",
      sahneVar: Boolean(sonuc?.stage),
      sahneBaslik: sonuc?.stage?.title || "",
    };
  });

  t.has(arastirma.metin, "cevap", "arastirma komutu cevap donduruyor");
  t.ok(arastirma.sahneVar, "arastirma komutu sahne verisi de tasiyor");
  t.has(arastirma.sahneBaslik, "eyfel", "sahnede sorulan soru yaziyor");

  /* ------------------------------------------- Google arama anahtari -
   * Google arama sayfasi otomatik isteklere kapali; resmi yol kendi
   * anahtarinizi istiyor. Anahtar ISTEGE BAGLI: girilmezse DRA yine
   * arastirir. Anahtarin kendisi arka tarafa gider ama geri GELMEZ.  */

  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(150);

  const gugil = await page.evaluate(async () => {
    const { store, saveStore } = await import("/js/store.js");
    const sistem = await import("/js/system.js");

    const durum = () => document.getElementById("google-status").textContent;

    store.googleKey = "";
    store.googleCx = "";
    saveStore();
    const panel = await import("/js/panel.js");
    panel.syncSettings();
    const bos = durum();

    store.googleKey = "ANAHTAR";
    saveStore();
    panel.syncSettings();
    const eksik = durum();

    store.googleCx = "KIMLIK";
    saveStore();
    panel.syncSettings();
    const tam = durum();

    // Arka tarafa bildir; donen bilgide anahtarin KENDISI olmamali.
    let bildirim = null;
    try {
      bildirim = await sistem.configureSearch(store.googleKey, store.googleCx);
    } catch (err) {
      bildirim = { hata: err.message };
    }

    const saglik = sistem.info().search?.google || {};

    // Temizle: sonraki testler etkilenmesin.
    store.googleKey = "";
    store.googleCx = "";
    saveStore();
    await sistem.configureSearch("", "");

    return {
      bos, eksik, tam, bildirim, saglik,
      alanVar: Boolean(document.getElementById("set-google-key")),
      sifreTipi: document.getElementById("set-google-key").getAttribute("type"),
      hepsi: JSON.stringify({ bildirim, saglik }),
    };
  });

  t.ok(gugil.alanVar, "Modlar sekmesinde anahtar alani var");
  t.eq(gugil.sifreTipi, "password", "anahtar alani ekranda gizli yaziliyor");
  t.has(gugil.bos, "girilmedi", "anahtarsizken durum bunu soyluyor");
  t.has(gugil.bos, "DuckDuckGo", "anahtarsizken de calistigi soyleniyor");
  t.has(gugil.eksik, "Eksik", "tek basina anahtar yetmiyor, cx de gerekiyor");
  t.has(gugil.tam, "Kaydedildi", "ikisi girilince kaydedildigi soyleniyor");
  t.eq(gugil.saglik.ready, true, "arka taraf anahtari aldi");
  t.eq(gugil.saglik.keySet, true, "anahtarin VAR OLDUGU biliniyor");
  t.ok(!gugil.hepsi.includes("ANAHTAR"), "anahtarin KENDISI arayuze geri donmuyor");

  /* ------------------------------------------------- fiyat listesi ---
   * "En ucuz nerede" sorusunun cevabi bir paragraf degil, sirali bir
   * liste. En ucuz olan goze carpmali ve her satir kaynagina gitmeli —
   * fiyat arama sonucundan okundugu icin dogrulanabilir olmali.     */

  const fiyat = await page.evaluate(async () => {
    const hud = await import("/js/hud.js");
    hud.logCard({
      title: "Fiyat karsilastirmasi: iphone 15",
      sections: [{
        prices: [
          { site: "ucuz.com", url: "https://ucuz.com/b", title: "iPhone 15 128GB", price: 49250, priceText: "49.250 TL" },
          { site: "orta.com", url: "https://orta.com/c", title: "iPhone 15", price: 51400, priceText: "51.400 TL" },
          { site: "kotu.com", url: "javascript:alert(1)", title: "iPhone 15", price: 54999, priceText: "54.999 TL" },
        ],
      }],
    });

    const el = [...document.querySelectorAll(".card")].at(-1).querySelector(".prices");
    const satirlar = [...el.querySelectorAll(".prices__item")];
    return {
      siteler: satirlar.map((x) => x.querySelector(".prices__site").textContent),
      tutarlar: satirlar.map((x) => x.querySelector(".prices__price").textContent),
      enUcuzIsaretli: satirlar[0].dataset.best === "1",
      digerleriIsaretsiz: satirlar.slice(1).every((x) => x.dataset.best !== "1"),
      baglar: satirlar.map((x) => {
        const a = x.querySelector(".prices__site");
        return a.tagName === "A" ? a.getAttribute("href") : null;
      }),
      not: el.querySelector(".prices__note")?.textContent || "",
    };
  });

  t.eq(fiyat.siteler, ["ucuz.com", "orta.com", "kotu.com"], "sira korunuyor (ucuzdan pahaliya)");
  t.eq(fiyat.tutarlar[0], "49.250 TL", "tutar yaziliyor");
  t.ok(fiyat.enUcuzIsaretli, "EN UCUZ olan isaretleniyor");
  t.ok(fiyat.digerleriIsaretsiz, "yalnizca en ucuz isaretli");
  t.eq(fiyat.baglar[0], "https://ucuz.com/b", "satir kaynagina gidiyor");
  t.eq(fiyat.baglar[2], null, "tehlikeli adres tiklanabilir yapilmiyor");
  t.has(fiyat.not, "degismis olabilir", "fiyatin dogrulanmasi gerektigi yaziyor");

  /* ------------------------------------------- ses ayri is parcaciginda
   * ScriptProcessorNode'un geri cagrisi ANA IS PARCACIGINDA calisiyordu
   * — reaktor animasyonu ve dalga tuvaliyle ayni yerde. Ana is
   * parcacigi tikandiginda ses parcalari gecikiyor ya da atlaniyor:
   * Vosk kopuk ses duyuyor ("her seferinde cok yanlis anliyor") ve
   * DRA'nin kendi sesi uzuyor ("orrrrrneeekkk").
   *
   * AudioWorklet ayri bir ses is parcaciginda calisiyor. Modul BLOB
   * adresinden yukleniyor cunku uygulama file:// uzerinden calisiyor
   * ve ayri dosya yuklemesi engelleniyor.                             */

  const ses = await page.evaluate(async () => {
    const mic = await import("/js/mic-capture.js");

    // Gercek mikrofon yok; sessiz bir akis uretiyoruz. Sinadigimiz sey
    // sesin ICERIGI degil, YOLUN kurulup parca uretmesi.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const uretim = new AudioCtx();
    const hedef = uretim.createMediaStreamDestination();
    const osc = uretim.createOscillator();
    osc.frequency.value = 440;
    osc.connect(hedef);
    osc.start();

    // acquireStream yerine dogrudan bu akisi kullandirmak icin
    // getUserMedia'yi gecici olarak degistiriyoruz.
    const gercek = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => hedef.stream;

    const parcalar = [];
    let hata = null;
    try {
      await mic.startCapture((pcm) => parcalar.push(pcm.length));
      // Birkac parca birikene kadar bekle.
      const bitis = Date.now() + 4000;
      while (parcalar.length < 2 && Date.now() < bitis) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      hata = String(err?.message || err);
    }

    const saglik = mic.captureHealth();
    mic.stopCapture();
    // Durdurduktan SONRAKI durum ayrica okunuyor.
    const sonra = mic.captureHealth();
    navigator.mediaDevices.getUserMedia = gercek;
    osc.stop();
    await uretim.close();

    return {
      hata, parcaSayisi: parcalar.length, ornekSayisi: parcalar[0] || 0,
      saglik, durduktanSonra: sonra.capturing,
    };
  });

  t.eq(ses.hata, null, "ses yakalama kuruluyor");
  t.eq(ses.saglik.engine, "worklet", "ses AYRI IS PARCACIGINDA yakalaniyor (worklet)");
  t.ok(ses.parcaSayisi >= 2, `ses parcalari uretiliyor (${ses.parcaSayisi})`);
  t.ok(ses.ornekSayisi > 0, `parcalarda ornek var (${ses.ornekSayisi})`);
  t.ok(ses.saglik.peak > 0, "parcalarda GERCEKTEN ses var (tepe > 0)");
  t.eq(ses.saglik.capturing, true, "calisirken yakalama acik gorunuyor");
  t.eq(ses.durduktanSonra, false, "durdurunca yakalama kapaniyor");
  t.ok(Number.isFinite(ses.saglik.contextRate), "ornekleme hizi raporlaniyor");

  /* ------------------------------------------------------- ag yalitimi */
  t.eq(external, [], "localhost disina hicbir istek atilmadi");
}
