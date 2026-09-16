/**
 * Bilgisayar kontrolu: ses, medya, ileri sarma, YouTube, muzik.
 *
 * Gercek PowerShell calistirilmiyor (burasi Linux ve zaten calistirmak
 * istemeyiz); onun yerine kosucu degistirilip URETILEN KOMUT olculuyor.
 * Sinanan sey: dogru sanal tus mu, kac kez mi, dogru pencereye mi,
 * ve en onemlisi SERBEST KOMUT CALISTIRILMIYOR mu.
 */

import { createServer } from "node:http";

export const name = "Bilgisayar kontrolu";
export const standalone = true;

/** YouTube arama sayfasini taklit eder. */
const istekler = [];

function startFakeYoutube(html) {
  const server = createServer((req, res) => {
    istekler.push(req.url);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

export async function run(_page, _base, t) {
  const control = await import("../../server/control.mjs");
  const media = await import("../../server/media.mjs");

  const komutlar = [];
  control._setRunnerForTests(async (script) => {
    komutlar.push(script);
    // foreground() JSON bekliyor; digerleri bos cikti kabul ediyor.
    if (script.includes("GetForegroundWindow")) {
      return JSON.stringify({
        title: "Counter-Strike 2", process: "cs2", maximized: false,
        width: 1920, height: 1080, screenWidth: 1920, screenHeight: 1080,
        workHeight: 1032,
      });
    }
    if (script.includes("WmiMonitorBrightnessMethods")) return "TAMAM";
    if (script.includes("AppActivate")) return "TAMAM";
    return "";
  });

  const son = () => komutlar[komutlar.length - 1] || "";
  const sifirla = () => { komutlar.length = 0; };

  try {
    /* ============================== SES ============================= */

    sifirla();
    const sesUp = await control.volume("up", 5);
    t.eq(sesUp.direction, "up", "ses acma islemi dondu");
    // 0xAF = sesi artir sanal tusu.
    t.has(son(), "175", "ses artirma icin dogru sanal tus (0xAF)");
    t.has(son(), "keybd_event", "tus dogrudan user32 uzerinden gonderiliyor");
    t.has(son(), "-lt 5", "istenen adim sayisi kadar basiliyor");
    // Tus asagi VE yukari gonderilmeli; yalnizca asagi basili birakir.
    t.eq(
      (son().match(/keybd_event/g) || []).length,
      3, // biri bildirim, ikisi cagri (asagi + yukari)
      "tus hem basiliyor hem birakiliyor",
    );

    sifirla();
    await control.volume("down", 2);
    t.has(son(), "174", "ses kisma icin dogru tus (0xAE)");
    t.has(son(), "-lt 2", "kucuk adim istenince az basiliyor");

    let hata = null;
    try {
      await control.volume("yukari");
    } catch (err) {
      hata = err;
    }
    t.ok(hata, "gecersiz ses yonu reddediliyor");

    sifirla();
    await control.mute();
    t.has(son(), "173", "sustur icin dogru tus (0xAD)");

    /* ============================== MEDYA =========================== */

    sifirla();
    await control.media("oynat");
    t.has(son(), "179", "oynat/duraklat tusu (0xB3)");

    sifirla();
    await control.media("sonraki");
    t.has(son(), "176", "sonraki parca tusu (0xB0)");

    hata = null;
    try {
      await control.media("ucur");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "Bilinmeyen medya", "bilinmeyen medya islemi reddediliyor");

    /* ============================== ILERI SARMA ===================== */

    // Sanal medya tuslarinda ileri sarma YOK; YouTube kisayolu kullaniliyor.
    sifirla();
    await control.sendKeysTo("YouTube", "lll");
    t.has(son(), "AppActivate", "hedef pencere one getiriliyor");
    t.has(son(), "*YouTube*", "pencere basligina gore bulunuyor");
    t.has(son(), "SendKeys", "tuslar pencereye gonderiliyor");
    t.has(son(), "'lll'", "istenen tuslar gonderiliyor");

    // Pencere yoksa anlasilir hata.
    control._setRunnerForTests(async () => "YOK");
    hata = null;
    try {
      await control.sendKeysTo("Spotify", "l");
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_WINDOW", "olmayan pencere bildiriliyor");
    t.has(hata?.message || "", "Spotify", "hangi pencerenin arandigi yaziliyor");

    /* ============================== KACISLAR ======================== */

    // Tek tirnak PowerShell dizesini bozar; kacisli yazilmali.
    control._setRunnerForTests(async (script) => {
      komutlar.push(script);
      return "TAMAM";
    });
    sifirla();
    await control.sendKeysTo("O'Brien's Window", "l");
    t.has(son(), "O''Brien''s", "tek tirnaklar kacisli yaziliyor");

    /* ============================== ON PLAN ========================= */

    control._setRunnerForTests(async (script) => {
      komutlar.push(script);
      return JSON.stringify({
        title: "Counter-Strike 2", process: "cs2", maximized: false,
        width: 1920, height: 1080, screenWidth: 1920, screenHeight: 1080,
        workHeight: 1032,
      });
    });
    const oyun = await control.foreground();
    t.eq(oyun.process, "cs2", "on plandaki uygulama okunuyor");
    t.eq(oyun.fullscreen, true, "tam ekran uygulama taniniyor (oyun modu)");

    control._setRunnerForTests(async () => JSON.stringify({
      title: "Not Defteri", process: "notepad", maximized: false,
      width: 900, height: 600, screenWidth: 1920, screenHeight: 1080,
      workHeight: 1032,
    }));
    const pencere = await control.foreground();
    t.eq(pencere.fullscreen, false, "normal pencere tam ekran sayilmiyor");

    // Kenarliksiz tam ekran: birkac piksel eksik olabilir.
    control._setRunnerForTests(async () => JSON.stringify({
      title: "Oyun", process: "game", maximized: false,
      width: 1919, height: 1079, screenWidth: 1920, screenHeight: 1080,
      workHeight: 1032,
    }));
    t.eq(
      (await control.foreground()).fullscreen,
      true,
      "kenarliksiz tam ekran da taniniyor",
    );

    /* -------- BUYUTULMUS pencere OYUN DEGIL -------- *
     * GetWindowRect buyutulmus pencerelerde gorunmez kenarligi de
     * sayar; olculer ekrani asar. Yalnizca boyuta bakinca her
     * buyutulmus tarayici "oyun" sayiliyor ve DRA hic gorunmuyordu. */
    control._setRunnerForTests(async () => JSON.stringify({
      title: "Chrome", process: "chrome", maximized: true,
      width: 1936, height: 1056, screenWidth: 1920, screenHeight: 1080,
      workHeight: 1032,
    }));
    const buyutulmus = await control.foreground();
    t.eq(buyutulmus.fullscreen, false, "BUYUTULMUS pencere tam ekran sayilmiyor");
    t.eq(buyutulmus.maximized, true, "buyutulmus oldugu bildiriliyor");

    // Gorev cubugu gorunuyorsa tam ekran degildir.
    control._setRunnerForTests(async () => JSON.stringify({
      title: "Uygulama", process: "app", maximized: false,
      width: 1920, height: 1032, screenWidth: 1920, screenHeight: 1080,
      workHeight: 1032,
    }));
    t.eq(
      (await control.foreground()).fullscreen,
      false,
      "gorev cubugu gorunuyorsa tam ekran degil",
    );

    // Pencerenin BULUNDUGU ekran olculuyor, birincil ekran degil.
    t.ok(
      komutlar.some((k) => k.includes("MonitorFromWindow")),
      "pencerenin bulundugu ekran olculuyor",
    );
    t.ok(
      komutlar.some((k) => k.includes("GetWindowPlacement")),
      "buyutulmus olup olmadigi soruluyor",
    );

    // Bozuk cikti cokertmemeli.
    control._setRunnerForTests(async () => "bu json degil");
    t.eq(await control.foreground(), null, "bozuk cikti null donuyor");

    /* ============================== ADRES =========================== */

    control._setRunnerForTests(async (script) => {
      komutlar.push(script);
      return "";
    });

    sifirla();
    await control.openUrl("https://ornek.com/a?b=1");
    t.has(son(), "Start-Process", "adres varsayilan tarayicida aciliyor");
    t.has(son(), "ornek.com", "dogru adres gonderiliyor");

    // GUVENLIK: yalnizca http(s). "file:" ile dosya acilmasin.
    for (const kotu of ["file:///C:/Windows/System32", "javascript:alert(1)", "cmd.exe"]) {
      hata = null;
      try {
        await control.openUrl(kotu);
      } catch (err) {
        hata = err;
      }
      t.ok(hata, `"${kotu.slice(0, 18)}" reddediliyor`);
    }

    /* ============================== PARLAKLIK ======================= */

    control._setRunnerForTests(async (script) => {
      komutlar.push(script);
      return "TAMAM";
    });
    sifirla();
    const p = await control.brightness(250);
    t.eq(p.percent, 100, "parlaklik yuzde 100'de siniriliyor");
    t.has(son(), "WmiSetBrightness(1, 100)", "parlaklik komutu dogru");

    // Desteklemeyen ekranda anlasilir hata.
    control._setRunnerForTests(async () => "YOK");
    hata = null;
    try {
      await control.brightness(50);
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "monitorun kendi", "desteklenmeyen ekran anlatiliyor");

    /* ============================== GUC ============================= */

    control._setRunnerForTests(async (script) => {
      komutlar.push(script);
      return "";
    });
    sifirla();
    await control.power("kilitle");
    t.has(son(), "LockWorkStation", "ekran kilitleme komutu dogru");

    // SERBEST KOMUT YOK: yalnizca isimli islemler.
    hata = null;
    try {
      await control.power("format c:");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "Bilinmeyen guc islemi", "isimsiz guc islemi reddediliyor");
    t.ok(
      !komutlar.some((k) => k.includes("format")),
      "reddedilen islem komut satirina HIC ULASMIYOR",
    );
  } finally {
    control._setRunnerForTests(null);
  }

  /* ============================== YOUTUBE ========================== */

  const sayfa = await startFakeYoutube(
    '{"contents":{"x":1},"videoRenderer":{"videoId":"dQw4w9WgXcQ","thumbnail":{}},' +
      '"title":{"runs":[{"text":"Kara Murat \\u0026 Devler"}]},' +
      '"ownerText":{"runs":[{"text":"Eski Filmler"}]}}',
  );
  media._setBaseForTests(sayfa.base);

  try {
    const video = await media.findVideo("kara murat");
    // "sp" zaten yuzde-kodlu; URLSearchParams'a verilirse yeniden
    // kodlaniyor ve YouTube suzgeci hic uygulanmiyordu.
    t.has(istekler.at(-1) || "", "sp=EgIQAQ%3D%3D", "video suzgeci cift kodlanmiyor");
    t.eq(video.id, "dQw4w9WgXcQ", "video kimligi cikariliyor");
    t.eq(video.title, "Kara Murat & Devler", "baslik cozuluyor (JSON kacislari dahil)");
    t.eq(video.channel, "Eski Filmler", "kanal adi okunuyor");
    t.has(video.url, "watch?v=dQw4w9WgXcQ", "izleme adresi uretiliyor");

    let bosHata = null;
    try {
      await media.findVideo("   ");
    } catch (err) {
      bosHata = err;
    }
    t.ok(bosHata, "bos arama reddediliyor");
  } finally {
    media._setBaseForTests(null);
    sayfa.server.close();
  }

  // Sonuc yoksa anlasilir hata.
  const bosSayfa = await startFakeYoutube("<html>hicbir sey yok</html>");
  media._setBaseForTests(bosSayfa.base);
  try {
    let h = null;
    try {
      await media.findVideo("olmayan sey");
    } catch (err) {
      h = err;
    }
    t.eq(h?.code, "NO_RESULT", "video bulunamayinca anlasilir hata");
  } finally {
    media._setBaseForTests(null);
    bosSayfa.server.close();
  }

  /* ============================== ARAMA ESLESMESI ================== */

  // Ozetler indeksle baglaniyordu; elenen her kayit sonrakilerin
  // ozetini kaydiriyor, kartta bir sitenin bagi baska bir sitenin
  // ozetiyle gorunuyordu.
  const search = await import("../../server/search.mjs");
  const { _internal } = search;
  if (_internal?.parseResults) {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbir.com%2Fa">Birinci</a>
      <a class="result__snippet">birinci ozet</a>
      <a class="result__a" href="bozuk-adres">Elenecek</a>
      <a class="result__snippet">elenecek ozet</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fiki.com%2Fb">Ikinci</a>
      <a class="result__snippet">ikinci ozet</a>
    `;
    const kayitlar = _internal.parseResults(html, 5);
    t.eq(kayitlar.length, 2, "gecersiz adres eleniyor");
    t.eq(kayitlar[0].snippet, "birinci ozet", "ilk kaydin ozeti dogru");
    t.eq(
      kayitlar[1].snippet,
      "ikinci ozet",
      "eleme sonrasi ozetler KAYMIYOR (kaynak-ozet eslesmesi bozulmuyor)",
    );
    t.eq(kayitlar[1].site, "iki.com", "site adi cikariliyor");
  }

  /* ============================== MUZIK KAYNAKLARI ================= */

  t.eq(media.resolveMusicSource("spotify").label, "Spotify", "spotify taniniyor");
  t.eq(media.resolveMusicSource("youtube music").label, "YouTube Music", "yt music taniniyor");
  t.eq(media.resolveMusicSource("spotifyden").label, "Spotify", "ekli hali de taniniyor");
  t.eq(media.resolveMusicSource("winamp"), null, "bilinmeyen kaynak null donuyor");
  t.has(
    media.MUZIK.spotify.url("jazz"),
    "search/jazz",
    "arama adresi kaynaga gore kuruluyor",
  );
}
