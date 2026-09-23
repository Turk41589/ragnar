/**
 * Modlar: sesli anahtarlar, sohbette bilgi isteme, tek Gmail girisi.
 *
 * Sinanan vaatler:
 *   - Kullanicinin sectigi sozcuk modu acar/kapatir ("internet",
 *     "internet kapat", "web modunu ac").
 *   - Anahtar bir komutu golgeleyemez, iki mod ayni anahtari alamaz.
 *   - Bilgi isteyen mod acilinca DRA sohbette tek tek sorar; yazilan
 *     deger sohbette HIC gorunmez, kaydedilir.
 *   - Bilgi beklenirken sesle gelen soz ne kaydedilir ne sohbete yazilir.
 *   - Gmail tek giris: isletme modundaki Gmail kaynagi ayri bilgi
 *     istemez; eski ayri kayit ortak hesaba tasinir.
 */

import { openApp, tell, readChat } from "../helpers.mjs";

export const name = "Modlar";

const magaza = (page) =>
  page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    return JSON.parse(JSON.stringify(store));
  });

/** Sesle geliyormus gibi bir soz verir (ses tanimanin kesin sonucu). */
const duy = (page, text) =>
  page.evaluate(async (text) => {
    const { emit } = await import("/js/state.js");
    emit("heard", { text, alternatives: [text], final: true, confidence: 1 });
  }, text);

export async function run(page, base, t) {
  await openApp(page, base);

  /* ------------------------------------------------ saf karar mantigi */
  const saf = await page.evaluate(async () => {
    const m = await import("/js/modlar.js");
    const a = { web: "internet", eposta: "postaci" };
    const bul = (x) => m.anahtarBul(x, a);
    return {
      tek: bul("internet"),
      ac: bul("İnternet aç"),
      kapat: bul("internet modunu kapat"),
      cumle: bul("internette kedi ara"),
      site: bul("web sitesi aç"),
      adla: bul("web modunu kapat"),
      adYalniz: bul("youtube"),
      noktalama: bul("Postacı!"),
      bos: bul("aç"),
      ayni: m.anahtarSorunu("internet", "eposta", a),
      tekHarf: m.anahtarSorunu("x", "web", a),
      dolgu: m.anahtarSorunu("aç", "web", a),
      sifre: m.alanDegeri(m.GMAIL_ALANLARI[1], "abcd efgh ijkl mnop"),
      kisaSifre: m.alanDegeri(m.GMAIL_ALANLARI[1], "12345"),
      adres: m.alanDegeri(m.GMAIL_ALANLARI[0], "  Ben@Gmail.com "),
      eksik: m.eksikAlanlar(m.modBul("yayinci"), { kickChannel: "kanal" }).map((x) => x.anahtar),
    };
  });
  t.eq(saf.tek, { id: "web", istek: "degistir" }, "anahtar tek basina: ac/kapa");
  t.eq(saf.ac?.istek, "ac", "'internet ac' → ac");
  t.eq(saf.kapat?.istek, "kapat", "'internet modunu kapat' → kapat");
  t.eq(saf.cumle, null, "anahtar gecen sradan cumle modu degistirmiyor");
  t.eq(saf.site, null, "'web sitesi ac' web modunu acmiyor");
  t.eq(saf.adla, { id: "web", istek: "kapat" }, "'web modunu kapat' anahtarsiz da calisiyor");
  t.eq(saf.adYalniz, null, "modun adi tek basina (youtube) modu degistirmiyor");
  t.eq(saf.noktalama?.id, "eposta", "buyuk harf/noktalama fark etmiyor");
  t.eq(saf.bos, null, "yalnizca 'ac' hicbir modu degistirmiyor");
  t.ok(/zaten/.test(saf.ayni || ""), "iki mod ayni anahtari alamiyor");
  t.ok(Boolean(saf.tekHarf), "tek harfli anahtar reddediliyor");
  t.ok(Boolean(saf.dolgu), "'ac' anahtar olamiyor");
  t.eq(saf.sifre, { deger: "abcdefghijklmnop" }, "uygulama sifresinin bosluklari atiliyor");
  t.ok(Boolean(saf.kisaSifre.hata), "16 harf olmayan sifre reddediliyor");
  t.eq(saf.adres, { deger: "ben@gmail.com" }, "adres kucuk harfe cevriliyor");
  t.eq(saf.eksik, ["kickToken"], "yalnizca eksik bilgi soruluyor");

  /* -------------------------------------------- panelden anahtar ---- */
  await page.click("#btn-manual-wake");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(250);

  const satirlar = await page.locator("#mod-keys input").count();
  t.eq(satirlar, 6, "her mod icin bir anahtar kutusu");

  // Bir komutu golgeleyen anahtar kabul edilmemeli.
  await page.fill("#mod-key-web", "saat kac");
  await page.dispatchEvent("#mod-key-web", "change");
  await page.waitForTimeout(200);
  t.eq((await magaza(page)).modAnahtarlari.web, undefined, "komut olan sozcuk anahtar olamiyor");
  t.eq(await page.inputValue("#mod-key-web"), "", "reddedilince kutu eski haline donuyor");

  await page.fill("#mod-key-web", "internet");
  await page.dispatchEvent("#mod-key-web", "change");
  await page.waitForTimeout(200);
  t.eq((await magaza(page)).modAnahtarlari.web, "internet", "anahtar kaydediliyor");

  const sozluk = await page.evaluate(() => window.__draSesSozlugu?.() || []);
  t.ok(sozluk.includes("internet"), "anahtar cihazdaki ses motorunun sozlugunde");

  /* ---------------------------------------- anahtarla ac / kapat ---- */
  t.eq((await magaza(page)).webMode, true, "web arastirmasi varsayilan acik");
  await tell(page, "internet", 700);
  t.eq((await magaza(page)).webMode, false, "anahtar soylenince mod kapandi");
  t.has((await readChat(page)).at(-1).text, "kapatildi", "DRA ne yaptigini soyluyor");
  t.eq(await page.locator("#set-web").getAttribute("aria-checked"), "false", "dugme de kapali gosteriyor");

  await tell(page, "kuru fasulye nasil yapilir", 900);
  t.has((await readChat(page)).at(-1).text, "Web arastirmasi kapali", "kapaliyken arastirma yapmiyor");
  t.has((await readChat(page)).at(-1).text, "«internet»", "nasil acilacagini anahtarla soyluyor");

  await duy(page, "internet aç");
  await page.waitForTimeout(700);
  t.eq((await magaza(page)).webMode, true, "sesle 'internet ac' modu acti");

  await tell(page, "internet ac", 600);
  t.has((await readChat(page)).at(-1).text, "zaten acik", "acikken 'ac' denince zaten acik diyor");

  /* ------------------------------- bilgi isteyen mod: sohbette sor -- */
  await page.click("#set-streamer");
  await page.waitForTimeout(600);
  let sohbet = await readChat(page);
  t.has(sohbet.at(-1).text, "Kick kanal adinizi yazin", "eksik bilgi sohbette soruluyor");
  t.eq((await magaza(page)).streamerMode, true, "mod acildi");
  const bekleyen = await page.evaluate(() => document.activeElement?.id);
  t.eq(bekleyen, "composer-input", "yazi kutusu odakta — hemen yazilabilir");

  await tell(page, "benimkanalim", 700);
  sohbet = await readChat(page);
  t.ok(!sohbet.some((m) => m.text.includes("benimkanalim")), "kanal adi sohbette gorunmuyor");
  t.has(sohbet.at(-1).text, "erisim jetonunu", "siradaki bilgi soruluyor");
  t.eq(await page.locator("#composer-input").getAttribute("type"), "password", "jeton yazilirken gizli");

  // Bilgi beklenirken SESLE gelen soz: ne kaydedilir ne sohbete yazilir.
  await duy(page, "gizli jeton bir iki uc");
  await page.waitForTimeout(600);
  sohbet = await readChat(page);
  t.ok(!sohbet.some((m) => m.text.includes("gizli jeton")), "sesle soylenen bilgi sohbete yazilmiyor");
  t.has(sohbet.at(-1).text, "YAZARAK", "yazarak girmesi soyleniyor");
  t.eq((await magaza(page)).kickToken, "", "sesle soylenen bilgi kaydedilmiyor");

  await tell(page, "Bearer jeton-cok-gizli-123", 900);
  sohbet = await readChat(page);
  t.ok(!sohbet.some((m) => m.text.includes("jeton-cok-gizli")), "jeton sohbette hic gorunmuyor");
  t.ok(
    (await page.locator("#log").innerHTML()).includes("jeton-cok-gizli") === false,
    "jeton sayfanin sohbet agacinda da yok",
  );
  const kayit = await magaza(page);
  t.eq(kayit.kickChannel, "benimkanalim", "kanal adi kaydedildi");
  t.eq(kayit.kickToken, "jeton-cok-gizli-123", "jeton temizlenip kaydedildi ('Bearer' atildi)");
  t.eq(await page.locator("#composer-input").getAttribute("type"), "text", "bitince yazi kutusu normale dondu");
  t.eq(await page.inputValue("#set-kick-channel"), "benimkanalim", "panel alanlari da doldu");
  t.eq(await page.evaluate(() => window.__draBilgiBekleniyor?.()), null, "bilgi toplama bitti");

  // Artik komutlar normal isleniyor.
  await tell(page, "7 kere 8 kac eder", 600);
  t.has((await readChat(page)).at(-1).text, "56", "toplama bitince komutlar normal calisiyor");

  /* --------------------------------------- hatali deger + iptal ----- */
  await page.click("#set-youtube");
  await page.waitForTimeout(600);
  t.has((await readChat(page)).at(-1).text, "ISTEMCI KIMLIGINI", "YouTube bilgileri soruluyor");
  await tell(page, "yanlis-kimlik", 600);
  sohbet = await readChat(page);
  t.has(sohbet.at(-1).text, "googleusercontent", "gecersiz deger nedeniyle reddediliyor");
  t.ok(!sohbet.some((m) => m.text.includes("yanlis-kimlik")), "reddedilen deger de sohbette yok");
  t.eq((await magaza(page)).ytClientId, "", "gecersiz deger kaydedilmedi");
  await tell(page, "vazgeç", 600);
  t.has((await readChat(page)).at(-1).text, "vazgectim", "iptal edilebiliyor");
  await tell(page, "3 kere 3 kac eder", 600);
  t.has((await readChat(page)).at(-1).text, "9", "iptalden sonra komutlar calisiyor");

  /* ------------------------------------------ uykuda iptal olur ----- */
  await page.click("#set-business");
  await page.waitForTimeout(600);
  t.has((await readChat(page)).at(-1).text, "Isletmenizin adini", "isletme adi soruluyor");
  await page.click("#btn-sleep");
  await page.waitForTimeout(500);
  t.eq(await page.evaluate(() => window.__draBilgiBekleniyor?.()), null, "uyuyunca bilgi toplama iptal");
  t.eq(await page.locator("#composer-input").getAttribute("type"), "text", "yazi kutusu normale dondu");

  /* ---------------------------------------------- tek Gmail girisi -- */
  const gocmus = await page.evaluate(async () => {
    localStorage.setItem("dra.state.v2", JSON.stringify({
      firstRunDone: true,
      voiceEnabled: false,
      sourceValues: { gmail: { user: "eski@gmail.com", pass: "abcdabcdabcdabcd" }, manuel: {} },
    }));
    const { loadStore, store } = await import("/js/store.js");
    loadStore();
    return { user: store.mailUser, pass: store.mailPass, gmailKaldi: "gmail" in store.sourceValues };
  });
  t.eq(gocmus.user, "eski@gmail.com", "eski Gmail kaynagi adresi ortak hesaba tasindi");
  t.eq(gocmus.pass, "abcdabcdabcdabcd", "sifresi de tasindi");
  t.ok(!gocmus.gmailKaldi, "ayri kayit silindi (iki kopya kalmiyor)");

  const degerler = await page.evaluate(async () => {
    const { kaynakDegerleri } = await import("/js/store.js");
    return kaynakDegerleri("gmail");
  });
  t.eq(degerler, { user: "eski@gmail.com", pass: "abcdabcdabcdabcd" }, "Gmail kaynagi ortak girisi kullaniyor");

  await page.click("#btn-manual-wake");
  await page.waitForSelector("#hud:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('.tab[data-tab="modlar"]');
  await page.waitForTimeout(200);
  await page.click("#gmail-logout");
  await page.waitForTimeout(250);
  const cikis = await magaza(page);
  t.ok(!cikis.mailUser && !cikis.mailPass, "cikis yapinca hesap bilgileri silindi");
  t.has(await page.textContent("#gmail-login-status"), "Giris yapilmadi", "durum 'giris yapilmadi'");

  /* ------------------------------- sohbetten Gmail girisi (uctan uca) */
  // Gmail'e gercekten baglanmiyoruz: sinama ucu yakalanip cevaplaniyor.
  let mailCevap = { ok: false, error: "Kimlik dogrulanamadi (yanlis uygulama sifresi)." };
  const sinamalar = [];
  await page.route("**/api/mail/test", async (route) => {
    sinamalar.push(1);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mailCevap) });
  });

  await page.click("#set-mail");
  await page.waitForTimeout(600);
  t.has((await readChat(page)).at(-1).text, "Gmail adresinizi yazin", "e-posta modu acilinca Gmail soruluyor");
  await tell(page, "Ben@Gmail.com", 600);
  t.has((await readChat(page)).at(-1).text, "UYGULAMA SIFRESINI", "sonra uygulama sifresi soruluyor");
  await tell(page, "yanl isyo ksif re12", 600);
  t.has((await readChat(page)).at(-1).text, "16 harf", "bicimi yanlis sifre ag'a gitmeden reddediliyor");
  t.eq(sinamalar.length, 0, "bicimi yanlis sifre icin giris denenmedi");

  await tell(page, "aaaa bbbb cccc dddd", 1200);
  sohbet = await readChat(page);
  t.eq(sinamalar.length, 1, "giris denendi");
  t.has(sohbet.at(-1).text, "giris yapilamadi", "basarisiz giris sebebiyle soyleniyor");
  t.has(sohbet.at(-1).text, "UYGULAMA SIFRESINI", "sifre bir kez daha soruluyor");
  t.eq((await magaza(page)).mailPass, "", "yanlis sifre saklanmadi");
  t.eq((await magaza(page)).mailUser, "ben@gmail.com", "adres saklandi (yeniden sorulmuyor)");

  mailCevap = { ok: true, user: "ben@gmail.com", total: 12 };
  await tell(page, "eeee ffff gggg hhhh", 1200);
  sohbet = await readChat(page);
  t.has(sohbet.at(-1).text, "Gmail'e giris yapildi", "dogru sifreyle giris yapildi");
  t.ok(!sohbet.some((m) => /aaaa|eeee|yanl isyo|ben@gmail/i.test(m.text)), "adres ve sifreler sohbette hic yok");
  const giris = await magaza(page);
  t.eq(giris.gmailDogrulandi, "ben@gmail.com", "giris dogrulandi olarak isaretlendi");
  t.eq(giris.mailPass, "eeeeffffgggghhhh", "sifre bosluksuz kaydedildi");
  t.has(await page.textContent("#gmail-login-status"), "Giris yapildi: ben@gmail.com", "Gmail bolumu girisi gosteriyor");
  t.has(await page.textContent("#mail-account-info"), "ben@gmail.com", "e-posta modu ayni hesabi gosteriyor");
  await page.unroute("**/api/mail/test");
}
