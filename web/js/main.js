/**
 * DRA — ana orkestrasyon.
 *
 * Akis:
 *   uyku  --("DRA")-->  acilis dizisi  -->  hazir
 *   hazir --(komut)-->  yerel motor  ya da  Claude beyni  -->  sesli yanit
 *   hazir --(sessizlik / "uyu")-->  uyku
 */

import { S, state, setState, remember, on, emit } from "./state.js";
import * as speech from "./speech.js";
import * as audio from "./audio.js";
import * as hud from "./hud.js";
import { mountReactor, mountWave } from "./reactor.js";
import { runCommand, normalize, suggestCommand, nearestCommand } from "./commands.js";
import { store, loadStore, saveStore } from "./store.js";
import * as panel from "./panel.js";
import * as alarms from "./alarms.js";
import * as system from "./system.js";

/* ============================================================ ayarlar */

/** Uyandirma kelimesinin ses tanimadan cikabilecegi temel bicimleri. */
const BASE_WAKE_WORDS = [
  "dra", "dara", "dira", "dera", "draa",
  "tra", "tira", "tara", "de ra", "d ra",
];

/** Temel liste + ayarlardan gelen ek sozcukler. */
let wakeWords = new Set(BASE_WAKE_WORDS);

function rebuildWakeWords() {
  wakeWords = new Set([...BASE_WAKE_WORDS, ...store.extraWakeWords.map(normalize)]);
}

/* ============================================================ elemanlar */

const $ = (id) => document.getElementById(id);

const dom = {
  btnEnable: $("btn-enable"),
  btnManualWake: $("btn-manual-wake"),
  btnMic: $("btn-mic"),
  btnVoice: $("btn-voice"),
  btnFull: $("btn-full"),
  btnSleep: $("btn-sleep"),
  composer: $("composer"),
  input: $("composer-input"),
};

/* ============================================================ tema */

/** Tema rengini CSS degiskenlerine yazar. */
function applyTheme(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return;
  store.theme = rgb;
  const root = document.documentElement.style;
  root.setProperty("--hue-r", String(rgb[0]));
  root.setProperty("--hue-g", String(rgb[1]));
  root.setProperty("--hue-b", String(rgb[2]));
  saveStore();
}

/* ============================================================ zamanlayicilar */

let timers = [];

function addTimer(label, seconds) {
  const timer = { id: Date.now() + Math.random(), label, endsAt: Date.now() + seconds * 1000 };
  timers.push(timer);
  hud.renderTimers(timers);
}

setInterval(() => {
  if (!timers.length) return;
  const now = Date.now();
  const due = timers.filter((t) => t.endsAt <= now);
  if (due.length) {
    timers = timers.filter((t) => t.endsAt > now);
    for (const t of due) {
      hud.log("system", `${t.label} doldu.`);
      hud.toast(`${t.label} doldu`);
      respond(`${t.label} suresi doldu efendim.`);
    }
  }
  hud.renderTimers(timers);
}, 1000);

/* ============================================================ alarmlar */

/**
 * Vakti gelen alarm.
 *
 * Alarm uyku modunda da calmali — kullanici DRA'yi uyandirmayi
 * unutmus olabilir. Bu yuzden gerekiyorsa once kendini uyandirir.
 */
async function onAlarmFired(alarm) {
  alarms.ring();
  panel.markRinging(alarm.id);
  panel.openTab("alarm");

  const spoken = alarm.label
    ? `Alarm efendim: ${alarm.label}. Saat ${alarm.time}.`
    : `Alarm efendim. Saat ${alarm.time}.`;

  if (state.current === S.SLEEPING) {
    // Uyandirma sirasinda kendi selamini vermesin — alarmi duyursun.
    await wakeUp("", { silent: true });
  }

  hud.log("system", `Alarm caldi: ${alarm.time}${alarm.label ? ` — ${alarm.label}` : ""}`);
  hud.toast(`Alarm: ${alarm.time}`, 6000);
  // `logged` bayragi verilmemeli: bu metni henuz kimse kayda yazmadi.
  await respond(spoken);

  // Vurguyu bir sure sonra kaldir.
  setTimeout(() => panel.markRinging(null), 20_000);
}

/* ============================================================ konusma akisi */

let autoSleepTimer = null;

function touch() {
  clearTimeout(autoSleepTimer);
  if (state.current === S.SLEEPING) return;
  // Ayarlarda 0 secilirse otomatik uyku tamamen kapanir.
  if (!store.autoSleepMinutes) return;
  autoSleepTimer = setTimeout(() => {
    if (state.current === S.SLEEPING) return;
    goToSleep("Uzun suredir sessizsiniz. Uyku moduna geciyorum.");
  }, store.autoSleepMinutes * 60_000);
}

/** Metni ekrana yazar ve (ses aciksa) okur. */
async function respond(text, { logged = false, kind = null } = {}) {
  if (!text) return;
  if (!logged) hud.log("dra", text);
  hud.setCaption(text, kind);
  remember("assistant", text);

  if (store.voiceEnabled && speech.voiceSupported) {
    setState(S.SPEAKING);
    await speech.say(text);
  }
  if (state.current !== S.SLEEPING) setState(S.IDLE);
  touch();
}

/** Komut isleme hattinin tamami. */
let busy = false;

async function handleUtterance(rawText) {
  const text = (rawText || "").trim();
  if (!text) return;

  // Ekranda bekleyen bir izin sorusu varsa once ona cevap veriyoruz.
  // Aksi halde kullanici "evet" dedigini sanip komut vermis olurdu.
  if (hud.consentPending()) {
    const karar = izinCevabi(text);
    if (karar !== null) {
      hud.log("user", text);
      hud.settleConsent(karar);
      return;
    }
    hud.log("system", "Once izin sorusunu cevaplayin: evet ya da hayir.");
    return;
  }

  if (busy) return;
  busy = true;
  touch();

  try {
    hud.log("user", text);
    hud.setCaption(text);
    remember("user", text);

    setState(S.THINKING);

    const local = await runCommand(text, ctx);
    if (local) {
      await respond(local.text);
      // Yan etki yanittan SONRA: once "uyuyorum" desin, sonra uyusun.
      if (local.after) await local.after();
      return;
    }

    // Eslesme yok.
    // Web aramasi aciksa soruyu internete sorar; kapaliysa uydurmak
    // yerine ne yapabildigini soyler ve en yakin komutu onerir.
    // Yazim hatasi olan bir KOMUT ise internete gitmenin anlami yok:
    // "alrm kur" aranacak bir soru degil, yanlis yazilmis bir komut.
    if (nearestCommand(text)) {
      await respond(suggestCommand(text));
      return;
    }

    hud.log("system", "Bunu komutlarimda bulamadim, arastiriyorum…");
    await respond(await ctx.research(text));
  } catch (err) {
    console.error("[dra]", err);
    hud.log("error", err.message || "Bilinmeyen hata");
    await respond("Bir sorun cikti, istegi tamamlayamadim.", { kind: "error" });
  } finally {
    busy = false;
    if (state.current !== S.SLEEPING) setState(S.IDLE);
  }
}

/* ============================================================ uyandirma */

/** Duyulan metin uyandirma kelimesini iceriyor mu? */
function isWakePhrase(text) {
  const n = normalize(text);
  if (!n) return false;
  if (wakeWords.has(n)) return true;

  for (const token of n.split(" ")) {
    if (wakeWords.has(token)) return true;
    // "dra", "draya", "drayi" gibi ekli bicimler
    if (token.startsWith("dra") && token.length <= 6) return true;
  }
  return false;
}

/** Komuttan bas taraftaki uyandirma kelimesini temizler. */
function stripWakeWord(text) {
  return text
    .replace(/^\s*(hey|ey|hay)?\s*(dra|dara|dira|dera|tra)\b[\s,.:!?]*/i, "")
    .trim();
}

let waking = false;
/**
 * Uyandirma aninda on planda tam ekran bir uygulama var miydi?
 * Varsa DRA bu oturum boyunca ekrana cikmaz, sesle konusur.
 */
let oyundaMiyiz = false;

async function wakeUp(spokenRest = "", { silent = false } = {}) {
  if (waking || state.current !== S.SLEEPING) return;
  waking = true;
  setState(S.WAKING);

  /*
   * Oyun oynarken pencereyi one getirmek oyunu kucultur ve bozar.
   * On planda TAM EKRAN bir uygulama varsa DRA gorunmez kalir ve
   * yalnizca sesle cevap verir.
   *
   * Bu denetim yalnizca ARKA PLAN kipinde yapiliyor: yalnizca orada
   * pencereyi kendimiz one getiriyoruz. Her uyanista bir PowerShell
   * cagrisi beklemek uyanmayi gereksiz yere yavaslatirdi.
   */
  oyundaMiyiz = false;
  if (arkaPlandaMi()) {
    const onPlan = await system.foregroundWindow();
    oyundaMiyiz = Boolean(onPlan?.fullscreen);

    if (oyundaMiyiz) {
      hud.log(
        "system",
        `${onPlan.process || "Tam ekran uygulama"} onde — arka planda kaliyorum.`,
      );
    } else {
      system.showWindow();
    }
  }

  if (store.bootSequence) await hud.playBoot();
  hud.showHud();
  // Klavyeyle gelen kullanici hemen yazmaya devam edebilsin.
  if (!state.micEnabled) dom.input.focus();
  setState(S.IDLE);
  waking = false;
  touch();

  const hour = new Date().getHours();
  const salute =
    hour < 6 ? "Iyi geceler" : hour < 12 ? "Gunaydin" : hour < 18 ? "Iyi gunler" : "Iyi aksamlar";

  hud.log("system", "DRA uyandirildi.");

  // Alarm gibi kendi mesaji olan tetikleyiciler selami atlar.
  if (silent) return;

  const rest = stripWakeWord(spokenRest);
  if (rest && rest.length > 2) {
    // "DRA saat kac" gibi tek nefeste gelen komutlar
    await respond(`${salute} efendim.`);
    await handleUtterance(rest);
  } else {
    await respond(`${salute} efendim. Sizi dinliyorum.`);
  }
}

function goToSleep(farewell) {
  clearTimeout(autoSleepTimer);
  speech.shutUp();
  setState(S.SLEEPING);
  hud.showSleep();

  // Arka plan kipinde uyurken pencere de tepsiye iner; DRA dinlemeye
  // devam eder ve adini duyunca yeniden gorunur.
  if (arkaPlandaMi()) setTimeout(() => system.hideWindow(), 400);
  oyundaMiyiz = false;
  hud.sleepStatus(
    state.micEnabled ? "Dinliyorum — «DRA» deyin" : "Mikrofon kapali",
    state.micEnabled ? "ok" : "warn",
  );
  hud.sleepMeter(state.micEnabled, 0);
  state.history.length = 0;
  if (farewell) hud.toast(farewell);
}

/* ============================================================ duyma yonlendirme */

let lastFinalAt = 0;

on("heard", ({ text, alternatives, final }) => {
  // --- uyku modu: sadece uyandirma kelimesi ile ilgileniyoruz --------
  if (state.current === S.SLEEPING) {
    hud.sleepStatus(`duyulan: "${text}"`, null);
    const hit = alternatives.find((alt) => isWakePhrase(alt));
    if (hit) wakeUp(hit);
    return;
  }

  // --- uyanik: ara sonuclari altyaziya yaz ---------------------------
  if (!final) {
    if (!busy && state.current !== S.SPEAKING) {
      hud.setCaption(text, "interim");
      setState(S.LISTENING);
    }
    return;
  }

  // --- kesin sonuc: komut olarak isle --------------------------------
  if (busy || state.current === S.SPEAKING) return;

  // Ayni cumlenin tekrar tetiklenmesini onle.
  const now = Date.now();
  if (now - lastFinalAt < 400) return;
  lastFinalAt = now;

  const command = stripWakeWord(text);
  if (!command || command.length < 2) return;
  handleUtterance(command);
});

/* ============================================================ mikrofon durumu */

on("mic", ({ status, message }) => {
  if (status === "on") {
    state.micEnabled = true;
    dom.btnMic?.setAttribute("aria-pressed", "true");
    if (state.current === S.SLEEPING) hud.sleepStatus("Dinliyorum — «DRA» deyin", "ok");
    hud.sleepMeter(true, 0);
  } else if (status === "off") {
    dom.btnMic?.setAttribute("aria-pressed", "false");
    if (state.current === S.SLEEPING) hud.sleepStatus("Mikrofon kapali", "warn");
    hud.sleepMeter(false, 0);
    hud.setPrivacyPill("off");
  } else {
    state.micEnabled = false;
    dom.btnMic?.setAttribute("aria-pressed", "false");
    hud.sleepStatus(message || "Mikrofon hatasi", status === "warn" ? "warn" : "error");
    hud.sleepMeter(false, 0);
    if (message) {
      // Uyku ekranindaki yazi HUD acikken gorunmuyor, toast da birkac
      // saniyede kayboluyor. Kalici yer sohbet kaydi.
      hud.log(status === "warn" ? "system" : "error", message);
      hud.toast(message, 9000);
      // Dugme yanlis bilgi vermesin.
      dom.btnEnable.disabled = false;
      dom.btnEnable.textContent = "Mikrofonu baslat";
    }
  }
  hud.setGauge("mic", state.micEnabled ? 8 : 0, state.micEnabled ? "acik" : "kapali");
});

/**
 * Seslendirme uyarilari. ElevenLabs cevap vermediginde DRA susmaz,
 * bilgisayarin sesine doner — ama kullanici bunu bilsin.
 */
/**
 * Yayin zamanlayicisindan gelen olaylar. Yukleme arka planda oluyor;
 * kullanici olup bitenden habersiz kalmamali.
 */
system.onYoutubeEvent?.((olay) => {
  if (!olay) return;
  if (olay.type === "basladi") {
    hud.log("system", `YouTube: "${olay.video.title}" yukleniyor…`);
  } else if (olay.type === "bitti") {
    hud.log("system", `YouTube: "${olay.video.title}" yayinlandi — ${olay.sonuc.url}`);
    hud.toast("Video yayinlandi", 6000);
  } else if (olay.type === "hata") {
    hud.log("error", `YouTube: "${olay.video.title}" yuklenemedi — ${olay.error}`);
    hud.toast("Video yuklenemedi", 6000);
  }
});

on("tts", ({ message }) => {
  if (!message) return;
  hud.log("system", message);
  hud.toast(message, 6000);
});

/* ================================================================== rapor */

/** Windows cekirdek surumunu okunur bir ada cevirir. */
function windowsAdi(release) {
  const buildNo = Number(release?.split(".")[2]);
  if (!Number.isFinite(buildNo)) return null;
  // 22000 ve sonrasi Windows 11; oncesi 10. (Microsoft'un kendi esigi.)
  return buildNo >= 22000 ? `Windows 11 (yapi ${buildNo})` : `Windows 10 (yapi ${buildNo})`;
}

/**
 * Raporu sohbete gorsel kart olarak basar, sozlu ozeti dondurur.
 * Eksik alanlar sessizce atlanir: rapor hic gelmemesinden iyidir.
 */
function raporuSun(r) {
  const bolumler = [];
  const sistemSatirlari = [];

  const ad = r.os.platform === "win32" ? windowsAdi(r.os.release) : null;
  sistemSatirlari.push(["Isletim sistemi", ad || `${r.os.platform} ${r.os.release}`]);
  sistemSatirlari.push(["Bilgisayar", r.os.host]);
  sistemSatirlari.push(["Islemci", `${r.cpu.cores} cekirdek`]);
  sistemSatirlari.push(["Acik kalma suresi", r.uptime.text]);
  sistemSatirlari.push([
    "Bellek",
    `${r.memory.totalText} — %${r.memory.percentUsed} dolu`,
    r.memory.percentUsed,
  ]);
  if (r.disk) {
    sistemSatirlari.push([
      "Disk",
      `${r.disk.freeText} bos / ${r.disk.totalText}`,
      r.disk.percentUsed,
    ]);
  }
  bolumler.push({ heading: "Bilgisayar", rows: sistemSatirlari });

  /* --- guncellemeler --- */
  const sozlu = [];
  if (r.updates) {
    const u = r.updates;
    const satirlar = [];

    if (u.lastInstalled) {
      const gun = Math.floor((Date.now() - u.lastInstalled) / 86400000);
      satirlar.push([
        "Son guncelleme",
        `${new Date(u.lastInstalled).toLocaleDateString("tr")}${
          u.lastId ? ` (${u.lastId})` : ""
        } — ${gun} gun once`,
      ]);
    } else {
      satirlar.push(["Son guncelleme", "okunamadi"]);
    }

    let not = null;
    let seviye = null;
    if (u.pending === null) {
      not = "Bekleyen guncellemeler kontrol edilemedi.";
      seviye = "warn";
    } else if (u.pending === 0) {
      not = "Bekleyen guncelleme yok, sistem guncel.";
      seviye = "ok";
      sozlu.push("sisteminiz guncel");
    } else {
      not = `${u.pending} guncelleme bekliyor.`;
      seviye = u.pending > 5 ? "error" : "warn";
      sozlu.push(`${u.pending} guncelleme bekliyor`);
    }

    bolumler.push({
      heading: "Guncellemeler",
      note: not,
      level: seviye,
      rows: satirlar,
      items: u.pendingList?.length ? u.pendingList : null,
    });
  } else if (r.os.platform !== "win32") {
    bolumler.push({
      heading: "Guncellemeler",
      note: "Guncelleme bilgisi yalnizca Windows'ta okunuyor.",
    });
  }

  hud.logCard({
    title: "Bilgisayar raporu",
    subtitle: new Date(r.at).toLocaleString("tr"),
    sections: bolumler,
  });

  /* --- sozlu ozet --- */
  const parcalar = [];
  if (r.disk) parcalar.push(`diskin yuzde ${r.disk.percentUsed} dolu`);
  parcalar.push(`bellegin yuzde ${r.memory.percentUsed} kullaniliyor`);
  if (sozlu.length) parcalar.unshift(sozlu[0]);

  return `Raporu ekrana cikardim. Kisaca: ${parcalar.join(", ")}.`;
}

/* ============================================================ arastirma */

/**
 * Arama sonucunu gorsel kart olarak basar.
 * Her kaynak tiklanabilir bir bag olarak veriliyor: DRA'nin ne
 * soyledigi kadar NEREDEN aldigi da onemli.
 */
function arastirmaSun(r) {
  const bolumler = [];

  if (r.summary) {
    bolumler.push({
      heading: r.summary.source || "Ozet",
      note: r.summary.text,
    });
  }

  if (r.images?.length) {
    bolumler.push({ images: r.images.slice(0, 4) });
  }

  if (r.results?.length) {
    bolumler.push({
      heading: "Kaynaklar",
      links: r.results.map((k) => ({
        title: k.title,
        url: k.url,
        site: k.site,
        snippet: k.snippet,
      })),
    });
  }

  hud.logCard({
    title: `Arastirma: ${r.query}`,
    subtitle: `${r.provider || "?"} — ${r.results?.length || 0} kaynak`,
    sections: bolumler,
  });

  if (r.summary) return r.summary.text;
  const ilk = r.results?.[0];
  return ilk ? `${ilk.snippet || ilk.title} (${ilk.site})` : "Bir sey bulamadim.";
}

/* ====================================================== musteri mesajlari */

const KAYNAK_ADI = {
  gmail: "Gmail",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  manuel: "Elle giris",
};

/** Toplama sonucunu kart olarak gosterir. */
function toplamaSun(s) {
  const bolumler = [];
  const satirlar = Object.entries(s.bySource).map(
    ([id, n]) => [KAYNAK_ADI[id] || id, String(n)],
  );

  bolumler.push({
    heading: "Toplanan mesajlar",
    note: s.added ? `${s.added} yeni mesaj alindi.` : "Yeni mesaj yok.",
    level: s.added ? "ok" : null,
    rows: satirlar.length ? satirlar : null,
  });

  // Bir kaynak patladiysa digerleri yine calisti; hangisi neden
  // calismadi acikca yazilmali.
  const sorunlar = Object.entries(s.errors || {});
  if (sorunlar.length) {
    bolumler.push({
      heading: "Ulasilamayan kaynaklar",
      level: "warn",
      items: sorunlar.map(([id, hata]) => `${KAYNAK_ADI[id] || id}: ${hata}`),
    });
  }

  hud.logCard({
    title: "Musteri mesajlari",
    subtitle: new Date().toLocaleString("tr"),
    sections: bolumler,
  });

  if (!s.added && sorunlar.length) {
    return `Yeni mesaj alamadim. ${sorunlar.length} kaynakta sorun var, ekrana yazdim.`;
  }
  return s.added
    ? `${s.added} yeni musteri mesaji topladim.`
    : "Yeni musteri mesaji yok efendim.";
}

/** Mesaj listesini kart olarak gosterir. */
function mesajlariSun(veri) {
  const o = veri.summary;
  if (!o.total) {
    hud.logCard({
      title: "Musteri mesajlari",
      sections: [{ note: "Henuz mesaj yok. «Mesajlari topla» ile cekebilirim." }],
    });
    return "Kayitli musteri mesaji yok efendim.";
  }

  const bolumler = [{
    heading: `Son ${o.days} gun — ${o.total} mesaj`,
    rows: Object.entries(o.bySource).map(([id, n]) => [
      KAYNAK_ADI[id] || id, String(n), Math.round((n / o.total) * 100),
    ]),
  }];

  const yanitsiz = veri.messages.filter((m) => m.status !== "yanitlandi").slice(0, 8);
  if (yanitsiz.length) {
    bolumler.push({
      heading: `Yanit bekleyenler (${o.unanswered})`,
      items: yanitsiz.map((m) => {
        const kisa = m.text.length > 70 ? `${m.text.slice(0, 70)}…` : m.text;
        return `${m.from} (${KAYNAK_ADI[m.source] || m.source}) — ${kisa}`;
      }),
    });
  }

  hud.logCard({
    title: "Musteri mesajlari",
    subtitle: new Date().toLocaleString("tr"),
    sections: bolumler,
  });

  return `Son ${o.days} gunde ${o.total} musteri mesaji var, ` +
    `${o.unanswered} tanesi yanit bekliyor.`;
}

/* ========================================================= otomatik yanit */

function otomatikYanitSun(s, deneme) {
  if (s.skipped === "kapali") {
    hud.logCard({
      title: "Otomatik yanit",
      sections: [{
        note: "Otomatik yanit kapali. Modlar sekmesinden acabilirsiniz; " +
          "once «Deneme» ile ne gidecegini gormenizi oneririm.",
        level: "warn",
      }],
    });
    return "Otomatik yanit kapali efendim.";
  }

  const bolumler = [];

  if (deneme) {
    bolumler.push({
      note: s.planned.length
        ? `${s.planned.length} mesaj icin yanit hazir. HICBIRI GONDERILMEDI — ` +
          "bu yalnizca deneme."
        : "Kurallara uyan bekleyen mesaj yok.",
      level: s.planned.length ? "warn" : null,
    });
  }

  const gosterilecek = deneme ? s.planned : s.sent;
  if (gosterilecek.length) {
    bolumler.push({
      heading: deneme ? "Gonderilecekler" : "Gonderilenler",
      items: gosterilecek.map(
        (p) => `${p.from}: "${p.text.slice(0, 45)}…" → ${p.reply.slice(0, 60)}`,
      ),
    });
  }

  if (s.errors?.length) {
    bolumler.push({
      heading: "Gonderilemeyenler",
      level: "error",
      // Gonderilemeyen mesaj yanitlanmis sayilmiyor; elde kaldigi soylensin.
      note: "Bu mesajlar yanitlanmadi, sirada duruyor.",
      items: s.errors.map((e) => `${e.from}: ${e.error}`),
    });
  }

  hud.logCard({
    title: deneme ? "Otomatik yanit — deneme" : "Otomatik yanit",
    subtitle: new Date().toLocaleString("tr"),
    sections: bolumler,
  });

  if (deneme) {
    return s.planned.length
      ? `${s.planned.length} mesaj icin yanit hazirladim ama gondermedim. ` +
        "Ekranda gorup onaylarsaniz «simdi yanitla» diyebilirsiniz."
      : "Kurallara uyan bekleyen mesaj yok.";
  }
  if (!s.sent.length && !s.errors.length) return "Yanitlanacak mesaj yok efendim.";
  return `${s.sent.length} mesaji yanitladim` +
    (s.errors.length ? `, ${s.errors.length} tanesi gonderilemedi.` : ".");
}

/* =============================================================== isletme */

function isletmeSun(r) {
  const m = r.satisfaction;
  const s = r.complaints;
  const y = r.responsiveness;

  const bolumler = [];

  /* --- memnuniyet --- */
  bolumler.push({
    heading: `Memnuniyet — son ${r.days} gun`,
    note: m.rate === null
      // Duygu tasiyan mesaj yoksa oran uydurulmaz.
      ? "Henuz memnuniyet olcecek kadar duygu tasiyan mesaj yok."
      : `%${m.rate} memnuniyet (${m.basis} duygu tasiyan mesaj uzerinden).`,
    level: m.rate === null ? null : m.rate >= 70 ? "ok" : m.rate >= 40 ? "warn" : "error",
    rows: [
      ["Memnun", String(m.memnun), m.total ? Math.round((m.memnun / m.total) * 100) : 0],
      ["Sikayet", String(m.sikayet), m.total ? Math.round((m.sikayet / m.total) * 100) : 0],
      ["Soru", String(m.soru)],
      ["Notr", String(m.notr)],
    ],
  });

  /* --- sikayetler --- */
  if (s.total) {
    bolumler.push({
      heading: `Sikayetler (${s.total})`,
      note: s.unanswered
        ? `${s.unanswered} sikayet hala yanitsiz.`
        : "Tum sikayetler yanitlanmis.",
      level: s.unanswered ? "error" : "ok",
      items: s.items.slice(0, 5).map(
        (x) => `${x.from}: ${x.text.slice(0, 80)}`,
      ),
    });
    if (s.topics.length) {
      bolumler.push({
        heading: "En sik gecen konular",
        rows: s.topics.slice(0, 5).map((k) => [k.topic, String(k.count)]),
      });
    }
  }

  /* --- yanit performansi --- */
  bolumler.push({
    heading: "Yanit performansi",
    rows: [
      ["Yanitlanan", `${y.answered} / ${y.total}`, y.rate ?? 0],
      ["Yanitsiz", String(y.unanswered)],
      ...(y.medianMinutes === null
        ? []
        : [["Ortanca yanit suresi", `${y.medianMinutes} dakika`]]),
    ],
  });

  hud.logCard({
    title: store.businessName ? `${store.businessName} — isletme raporu` : "Isletme raporu",
    subtitle: new Date(r.at).toLocaleString("tr"),
    sections: bolumler,
  });

  const parcalar = [];
  if (m.rate !== null) parcalar.push(`memnuniyet yuzde ${m.rate}`);
  if (s.total) parcalar.push(`${s.total} sikayet`);
  if (y.unanswered) parcalar.push(`${y.unanswered} yanitsiz mesaj`);

  return parcalar.length
    ? `Son ${r.days} gunun raporu: ${parcalar.join(", ")}.`
    : `Son ${r.days} gunde raporlanacak bir sey yok.`;
}

/* ================================================================ youtube */

function kanalSun(k, sira) {
  const bolumler = [{
    heading: k.title,
    rows: [
      ["Abone", k.subscribers.toLocaleString("tr")],
      ["Toplam izlenme", k.views.toLocaleString("tr")],
      ["Video sayisi", String(k.videos)],
    ],
  }];

  if (sira?.summary?.total) {
    const o = sira.summary;
    bolumler.push({
      heading: "Yayin sirasi",
      rows: [
        ["Bekleyen", String(o.bekliyor)],
        ["Yuklenen", String(o.yuklendi)],
        ...(o.hata ? [["Hata", String(o.hata)]] : []),
      ],
      items: sira.videos
        .filter((v) => v.status === "bekliyor" && v.publishAt)
        .slice(0, 5)
        .map((v) => `${new Date(v.publishAt).toLocaleString("tr")} — ${v.title}`),
    });
  }

  hud.logCard({
    title: "YouTube kanali",
    subtitle: new Date().toLocaleString("tr"),
    sections: bolumler,
  });

  const bekleyen = sira?.summary?.bekliyor || 0;
  return `${k.title} kanalinda ${k.subscribers.toLocaleString("tr")} abone ve ` +
    `${k.videos} video var.` +
    (bekleyen ? ` Sirada ${bekleyen} video yayin bekliyor.` : "");
}

/* ================================================================= montaj */

/** Proje dosyasindan cikan uslubu kart olarak gosterir. */
function uslubuSun(u) {
  const satirlar = [
    ["Bicim", u.source.label],
    ["Kesim sayisi", String(u.clipCount)],
  ];
  if (u.cut) {
    satirlar.push(["Ortalama kesim", `${u.cut.avg} sn`]);
    satirlar.push(["Ortanca kesim", `${u.cut.median} sn`]);
    satirlar.push(["En kisa / en uzun", `${u.cut.min} sn / ${u.cut.max} sn`]);
  }
  satirlar.push(["Toplam sure", `${u.totalSeconds} sn`]);
  if (u.width && u.height) satirlar.push(["Cozunurluk", `${u.width}x${u.height}`]);
  satirlar.push(["Kare hizi", `${u.fps} fps`]);
  if (u.titles.count) {
    satirlar.push([
      "Basliklar",
      u.titles.everySeconds
        ? `${u.titles.count} adet — ~${u.titles.everySeconds} sn'de bir`
        : `${u.titles.count} adet`,
    ]);
  }

  const bolumler = [{ heading: u.source.file, rows: satirlar }];
  if (u.transitions.count) {
    bolumler.push({
      heading: "Gecisler",
      note: `${u.transitions.count} gecis kullanilmis.`,
      items: u.transitions.kinds,
    });
  }
  if (u.incomplete && u.advice) {
    bolumler.push({ note: u.advice, level: "warn" });
  }

  hud.logCard({ title: "Montaj uslubunuz", subtitle: "Projenizden okundu", sections: bolumler });

  if (u.incomplete) return u.advice;
  return `Projenizi okudum: ${u.clipCount} kesim, ortanca ${u.cut?.median ?? "?"} saniye. ` +
    "Yeni videoyu ayni olculerle keserim.";
}

/** Biten montaji kart olarak gosterir. */
function montajiSun(s) {
  const mb = (s.bytes / 1024 / 1024).toFixed(1);
  const bolumler = [
    {
      heading: "Uretilen video",
      rows: [
        ["Dosya", s.file],
        ["Sure", s.seconds ? `${s.seconds} sn` : "—"],
        ["Boyut", `${mb} MB`],
        ["Kullanilan klip", String(s.clips)],
        ["Cozunurluk", `${s.plan.width}x${s.plan.height}`],
        ["Kesim uzunlugu", `${s.plan.cutSeconds} sn`],
        ["Uslup", s.plan.source || s.plan.label || "—"],
      ],
    },
  ];
  if (s.notes?.length) bolumler.push({ note: s.notes.join(" "), level: "warn" });

  hud.logCard({
    title: "Montaj tamamlandi",
    subtitle: new Date().toLocaleString("tr"),
    sections: bolumler,
  });

  return `Montaj bitti efendim. ${s.clips} klipten ${s.seconds ?? "?"} saniyelik ` +
    "video cikardim. Dosya kaynak klasorunuzda.";
}

/* ================================================================ e-posta */

/** Kutudaki mesaj siniflarinin ekranda gorunecek sirasi ve adi. */
const EPOSTA_SIRA = [
  ["sponsor", "Sponsor / isbirligi"],
  ["is", "Is / gorusme"],
  ["kisisel", "Kisisel"],
  ["bulten", "Bulten"],
  ["reklam", "Reklam"],
  ["diger", "Otomatik bildirim"],
];

/** Onemli sayilan siniflar: bunlar tek tek listelenir. */
const ONEMLI = new Set(["sponsor", "is", "kisisel"]);

function epostaSun(o) {
  if (!o.total) {
    hud.logCard({
      title: "E-posta raporu",
      subtitle: new Date(o.at).toLocaleString("tr"),
      sections: [{ note: `Son ${o.days} gunde yeni mesaj yok.`, level: "ok" }],
    });
    return `Son ${o.days} gunde yeni mesajiniz yok efendim.`;
  }

  const bolumler = [];

  // --- sayim tablosu ---
  const satirlar = [];
  for (const [id, ad] of EPOSTA_SIRA) {
    const n = o.counts[id] || 0;
    if (n) satirlar.push([ad, String(n), Math.round((n / o.total) * 100)]);
  }
  bolumler.push({
    heading: `Son ${o.days} gun — ${o.total} mesaj`,
    rows: satirlar,
  });

  // --- ise yarar olanlar tek tek ---
  for (const [id, ad] of EPOSTA_SIRA) {
    if (!ONEMLI.has(id)) continue;
    const liste = o.groups[id];
    if (!liste?.length) continue;
    bolumler.push({
      heading: ad,
      // En yeniler once; cok uzun listeyi kirpiyoruz.
      items: liste
        .slice()
        .sort((a, b) => (b.date || 0) - (a.date || 0))
        .slice(0, 6)
        .map((m) => `${m.from} — ${m.subject}`),
    });
  }

  // --- ayiklananlar ---
  const gurultu = (o.counts.reklam || 0) + (o.counts.bulten || 0) + (o.counts.diger || 0);
  if (gurultu) {
    bolumler.push({
      note:
        `${gurultu} mesaji ayikladim: ${o.counts.reklam || 0} reklam, ` +
        `${o.counts.bulten || 0} bulten, ${o.counts.diger || 0} otomatik bildirim.`,
      level: "warn",
    });
  }

  hud.logCard({
    title: "E-posta raporu",
    subtitle: new Date(o.at).toLocaleString("tr"),
    sections: bolumler,
  });

  /* --- sozlu ozet: yalnizca ise yarar olani soyle --- */
  const onemliParca = [];
  if (o.counts.sponsor) onemliParca.push(`${o.counts.sponsor} sponsor teklifi`);
  if (o.counts.is) onemliParca.push(`${o.counts.is} is mesaji`);
  if (o.counts.kisisel) onemliParca.push(`${o.counts.kisisel} kisisel mesaj`);

  const bas = `Son ${o.days} gunde ${o.total} mesaj geldi.`;
  if (!onemliParca.length) {
    return `${bas} Ise yarar bir sey yok; ${gurultu} tanesi reklam, bulten ya da bildirim.`;
  }
  return `${bas} Dikkatinizi cekecekler: ${onemliParca.join(", ")}. ` +
    `${gurultu} tanesini ayikladim.`;
}

/* ================================================================= izinler */

/** "evet/olur/tamam" → true, "hayir/olmaz/iptal" → false, baska → null. */
function izinCevabi(text) {
  const t = text.toLocaleLowerCase("tr").trim();
  // `\b` yalnizca ASCII harfleri sozcuk sayar: "vazgeç" kaliba HIC
  // uymuyordu cunku "ç" sozcuk karakteri degil. Sinir yerine "sonu ya da
  // bosluk" diyoruz.
  const S = "(?=$|[\\s,.!?])";
  if (new RegExp(`^(evet|tamam|olur|ver|izin ver|onayla|kabul|peki)${S}`).test(t)) return true;
  if (new RegExp(
    `^(hayir|hayır|olmaz|yok|verme|iptal|vazgec|vazgeç|istemiyorum|dur)${S}`,
  ).test(t)) return false;
  return null;
}

/**
 * Izin gerektiren bir isi yapar.
 *
 * Is once dogrudan denenir. Yetki yoksa sunucu/ana surec NEED_PERMISSION
 * ile reddeder; o zaman kullaniciya sorulur ve onay alinirsa is BIR KEZ
 * yeniden denenir. Boylece izin sorusu gercek bir ihtiyac aninda cikar,
 * kullanici pesin pesin yetki dagitmak zorunda kalmaz.
 */
async function izinliCalis(is) {
  try {
    return await is();
  } catch (err) {
    if (err?.code !== "NEED_PERMISSION") throw err;

    const baslik = err.title || "Erisim izni";
    hud.log("system", `Bunun icin izniniz gerekiyor: ${baslik}`);
    // Ses acikken soruyu ayrica soyluyoruz; kullanici ekrana bakmiyor olabilir.
    await respond(`${baslik} icin izin istiyorum. Veriyor musunuz?`);

    const onay = await hud.askPermission({ title: baslik, detail: err.detail });
    if (!onay) {
      await respond("Tamam, dokunmuyorum.");
      return null;
    }

    await system.grantPermission(err.scope);
    hud.log("system", `"${baslik}" izni verildi.`);
    panel.renderPermissions();

    // Tek bir yeniden deneme: burada da reddedilirse gercek bir sorun var.
    return await is();
  }
}

/* ============================================================ komut baglami */

const ctx = {
  sleep: () => goToSleep(),

  openUrl: (url) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) hud.toast("Tarayici acilir pencereyi engelledi", 4000);
  },

  /* --- notlar --- */
  addNote: (text) => panel.addNote(text),
  getNotes: () => store.notes.slice(),
  clearNotes: () => {
    store.notes = [];
    saveStore();
    panel.renderNotes();
  },

  /* --- alarmlar --- */
  addAlarm: (time, label, repeat) => {
    const alarm = alarms.addAlarm(time, label, repeat);
    if (alarm) {
      panel.renderAlarms();
      panel.openTab("alarm");
    }
    return alarm;
  },
  getAlarms: () => alarms.listAlarms(),
  clearAlarms: () => {
    alarms.clearAlarms();
    panel.markRinging(null);
  },
  describeAlarm: (alarm) => alarms.describeUntil(alarm),

  /* --- zamanlayicilar --- */
  addTimer,

  /* --- arayuz --- */
  setTheme: (rgb) => {
    applyTheme(rgb);
    panel.syncSettings();
  },
  setVoice: (enabled) => {
    store.voiceEnabled = enabled;
    saveStore();
    dom.btnVoice.setAttribute("aria-pressed", String(enabled));
    if (!enabled) speech.shutUp();
  },
  toggleFullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  },
  clearLog: () => hud.clearLog(),
  openPanel: (name) => panel.openTab(name),
  toast: (text, ms) => hud.toast(text, ms),
  log: (who, text) => hud.log(who, text),

  /* --- ayar geri cagrilari --- */
  isMicOn: () => speech.isListening(),
  toggleMic: () => dom.btnMic.click(),
  onAutoSleepChanged: () => touch(),
  onWakeWordsChanged: () => rebuildWakeWords(),
  /**
   * BILGISAYAR raporu — donanim, disk, guncellemeler. Izin gerektirir.
   * Sonucu sohbete gorsel bir kart olarak basar ve sozlu bir ozet doner.
   *
   * Asagidaki `systemReport` ile karistirilmamali: o, DRA'nin KENDI
   * durumunu (saat, mikrofon, alarm, not) anlatir ve izin gerektirmez.
   */
  computerReport: async () => {
    const rapor = await izinliCalis(() => system.systemReport());
    if (!rapor) return null;
    return raporuSun(rapor);
  },

  /**
   * E-posta raporu. Izin gerektirir; yoksa DRA once sorar.
   * Reklam/bulten ayiklanir, ise yarar mesajlar one cikarilir.
   */
  mailReport: async () => {
    // Mod kapaliysa hesap kayitli olsa bile ag'a cikmiyoruz: anahtari
    // kapatmak "artik kullanma" demek.
    if (!store.mailMode) {
      return "E-posta raporu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    if (!store.mailUser || !store.mailPass) {
      return "E-posta hesabi tanimli degil. Modlar sekmesinden Gmail adresinizi " +
        "ve uygulama sifrenizi girin.";
    }
    const ozet = await izinliCalis(async () => {
      // Ayarlar her acilista yeniden bildirilir; sifre surecte tutulmaz.
      await system.configureMail(store.mailUser, store.mailPass);
      return system.mailSummary(2);
    });
    if (!ozet) return null;
    return epostaSun(ozet);
  },

  /** Proje dosyasindan cikarilan uslubu kart olarak gosterir. */
  showStyleCard: (u) => uslubuSun(u),

  /**
   * Montaji baslatir. Izin gerektirir; yoksa DRA once sorar.
   * Uzun surebilir, bu yuzden ilerleme sohbete yaziliyor.
   */
  runMontage: async () => {
    if (!store.montageMode) {
      return "Montaj modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    if (!store.montageClips) {
      return "Once video klasorunu secin: Modlar sekmesi, Video montaji.";
    }

    const durum = await system.montageStatus().catch(() => null);
    if (!durum?.ffmpeg?.ready) {
      return durum?.ffmpeg?.advice || "Montaj icin ffmpeg kurulu olmali.";
    }

    // Cikti KAYNAK KLASORUNE yazilmamali: ikinci calistirmada onceki
    // montaj da kaynak klip olarak iceri giriyordu. Alt klasore koyuyoruz.
    const cikti = `${store.montageClips}/dra-montaj/dra-montaj-${Date.now()}.mp4`;
    hud.log("system", "Montaj basladi. Kliplerin sayisina gore birkac dakika surebilir…");
    panel.setMontageStatus("Montaj suruyor…");

    const bitir = system.onMontageProgress(({ step, done, total }) => {
      panel.setMontageStatus(`${step === "kart" ? "Giris karti" : "Kesim"} ${done}/${total}`);
    });

    try {
      const sonuc = await izinliCalis(() =>
        system.montageRender({
          clipsDir: store.montageClips,
          // "proje" secildiyse uslup dosyadan, degilse hazir sablondan.
          stylePath: store.montageTemplate === "proje" ? store.montageProject : null,
          template: store.montageTemplate === "proje" ? "hizli" : store.montageTemplate,
          title: store.montageTitle,
          titleImage: store.montageImage || null,
          music: store.montageMusic || null,
          out: cikti,
        }),
      );
      if (!sonuc) {
        panel.setMontageStatus("Izin verilmedi");
        return null;
      }
      panel.setMontageStatus(`Bitti: ${sonuc.file}`);
      return montajiSun(sonuc);
    } catch (err) {
      panel.setMontageStatus(`Hata: ${err.message}`);
      hud.log("error", err.message);
      return `Montaj tamamlanamadi: ${err.message}`;
    } finally {
      bitir();
    }
  },

  /**
   * Arastirma: birkac kaynak, ozet, gorseller ve LINKLER.
   * Bilginin nereden geldigi gorunur olmali — kullanici kendi
   * dogrulamasini yapabilsin.
   */
  research: async (query) => {
    try {
      const sonuc = await system.richSearch(query, 4);
      return arastirmaSun(sonuc);
    } catch (err) {
      /*
       * Arastirma yapilamadiysa kullaniciyi elde birakmiyoruz. Hangi
       * kaynaklarin denendigi de ekrana yaziliyor: "arastirmiyor"
       * sikayetini tahminle degil sebeple konusabilmek icin.
       */
      // NO_SOURCE: hicbir kaynaga ULASILAMADI (ag/guvenlik duvari).
      // NO_RESULT: ulasildi ama sonuc yok — bu ayri bir sey.
      if (err?.code === "NO_SOURCE") {
        hud.logCard({
          title: "Arastirma yapilamadi",
          subtitle: query,
          sections: [
            {
              note: "Hicbir kaynaga ulasamadim. Internet baglantinizi ve " +
                "guvenlik duvarini kontrol edin.",
              level: "error",
            },
            ...(Array.isArray(err.tried) && err.tried.length
              ? [{ heading: "Denenen kaynaklar", items: err.tried }]
              : []),
          ],
        });
        // Ag yoksa kullanici elde kalmasin: ne YAPABILDIGIMIZI da soyle.
        return "Hicbir arastirma kaynagina ulasamadim; sebepleri ekrana yazdim. " +
          suggestCommand(query);
      }

      const sebep = err?.code === "NO_RESULT"
        ? `"${query}" icin bir sey bulamadim.`
        : `Arastiramadim (${err.message}).`;
      return `${sebep} ${suggestCommand(query)}`;
    }
  },

  /** Isimli bilgisayar islemleri. Izin gerektirir. */
  control: async (o) => izinliCalis(() => system.control(o)),

  /** Secili kaynaklardan mesaj toplar. Izin gerektirir. */
  collectMessages: async () => {
    if (!store.businessMode) {
      return "Isletme modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    if (!store.sourcesOn.length) {
      return "Once musteri mesajlarinin nereden gelecegini secin.";
    }

    const sonuc = await izinliCalis(async () => {
      // Her acilista bilgileri yeniden bildiriyoruz; jetonlar surecte durmuyor.
      for (const id of store.sourcesOn) {
        const degerler = store.sourceValues[id] || {};
        try {
          await system.sourceConfigure(id, degerler);
        } catch {
          /* eksik yapilandirma asagida "errors" olarak bildirilecek */
        }
      }
      return system.sourceCollect(store.sourcesOn);
    });
    if (!sonuc) return null;
    return toplamaSun(sonuc);
  },

  /**
   * Otomatik yaniti calistirir.
   * Deneme kipinde HICBIR SEY gonderilmez; ne gidecegi gosterilir.
   */
  runAutoreply: async (dryRun) => {
    if (!store.businessMode) {
      return "Isletme modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    const sonuc = await izinliCalis(() => system.autoreplyRun(Boolean(dryRun)));
    if (!sonuc) return null;
    return otomatikYanitSun(sonuc, Boolean(dryRun));
  },

  /** Isletme raporu: memnuniyet, sikayet, yanit performansi. */
  businessReport: async () => {
    if (!store.businessMode) {
      return "Isletme modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    const rapor = await system.businessReport(30);
    return isletmeSun(rapor);
  },

  /** Musteri mesajlari raporu. */
  messageReport: async () => {
    if (!store.businessMode) {
      return "Isletme modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    const veri = await system.messageList({ limit: 100 });
    return mesajlariSun(veri);
  },

  /** YouTube kanal raporu. Izin gerektirir. */
  youtubeReport: async () => {
    if (!store.youtubeMode) {
      return "YouTube modu kapali. Modlar sekmesinden acabilirsiniz.";
    }
    if (!store.ytRefreshToken) {
      return "YouTube kanali bagli degil. Modlar sekmesinden «Kanali bagla» deyin.";
    }
    const veri = await izinliCalis(async () => {
      await system.configureYoutube(store.ytClientId, store.ytClientSecret, store.ytRefreshToken);
      const [kanal, sira] = await Promise.all([
        system.youtubeChannel(),
        system.videoList().catch(() => null),
      ]);
      return { kanal, sira };
    });
    if (!veri) return null;
    return kanalSun(veri.kanal, veri.sira);
  },

  /** Panelden gelen, izin gerektiren isler icin ayni akis. */
  withPermission: (is) => izinliCalis(is),

  onBackgroundChanged: () => {
    // Arka plan dinleme acildiysa mikrofonu hemen baslat.
    if (store.backgroundListen && !speech.isListening()) enableMic();
  },

  /**
   * Ses tanima teshisi.
   * Tarayicinin ne destekledigini tahmin etmek yerine dogrudan sorup
   * sonucu sade Turkce olarak sohbete yazar.
   */
  runDiagnostics: async () => {
    hud.log("system", "Ses tanima siniyor…");

    const gomulu = speech.embeddedAvailable() ? await speech.embeddedStatus() : null;
    const localStatus = await speech.probeLocalRecognition();
    const statusText = {
      available: "hazir (ses cihazdan cikmaz)",
      downloadable: "indirilebilir ama henuz yuklu degil",
      downloading: "su anda indiriliyor",
      unavailable: "bu cihazda yok",
      unsupported: "tarayici bu ozelligi hic sunmuyor",
    }[localStatus] || localStatus;

    const sinceResult = speech.isListening()
      ? Math.round((Date.now() - speech.getLastResultAt()) / 1000)
      : null;

    const stats = speech.getStats();
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const trVoice = voices.find((v) => v.lang?.toLowerCase().startsWith("tr"));

    const lines = [
      gomulu
        ? `Gomulu motor (Vosk): ${gomulu.modelReady ? "model hazir" : "MODEL KURULU DEGIL"}`
        : "Gomulu motor: yok (tarayici surumu)",
      `Secili motor: ${store.speechEngine === "tarayici" ? "tarayici" : "gomulu"}`,
      `Tarayici ses tanima destegi: ${speech.speechSupported ? "var" : "YOK"}`,
      `Cihaz ustu Turkce tanima: ${statusText}`,
      `Su anki mod: ${
        !speech.isListening()
          ? "mikrofon kapali"
          : speech.isLocalRecognition()
            ? "cihazda"
            : "tarayici servisi"
      }`,
      `Mikrofon seviyesi: ${Math.round(state.level * 100)}%`,
      sinceResult === null
        ? "Son tanima sonucu: mikrofon kapali"
        : `Son tanima sonucu: ${sinceResult} saniye once`,
      `Turkce konusma sesi: ${trVoice ? trVoice.name : "yok (sistem varsayilani kullanilacak)"}`,
      `Kullanilan ayar: ${speech.currentProfile()?.name ?? "—"}`,
      `Motor: ${stats.starts} kez basladi, ${stats.ends} kez bitti, ` +
        `${stats.results} sonuc uretti` +
        (stats.lastError ? `, son hata: ${stats.lastError}` : ""),
    ];

    /*
     * YAKALAMA OLCUMU — "ses gidiyor ama cevap yok" sikayetini tahminle
     * degil olcumle ayirt etmek icin. Gostergenin oynamasi sesin MOTORA
     * ulastigi anlamina gelmiyor: gosterge ayri bir dugumden besleniyor.
     */
    // Bu olcumler yalnizca GOMULU motor yolunda dolduruluyor. Tarayici
    // motorunda hep sifir kalir; oraya bakip "ses ulasmiyor" demek
    // yanlis yonlendirir.
    const gomuluKipte = speech.embeddedAvailable() && store.speechEngine !== "tarayici";
    const yakalama = gomuluKipte ? speech.micHealth?.() : null;
    if (yakalama) {
      const gecen = yakalama.lastChunkAt
        ? Math.round((Date.now() - yakalama.lastChunkAt) / 1000)
        : null;
      lines.push(
        `Motora giden ses: ${yakalama.chunks} parca` +
          (gecen === null ? " (hic gelmedi)" : `, sonuncusu ${gecen} sn once`),
        `Parcalardaki en yuksek seviye: ${(yakalama.peak * 100).toFixed(1)}%`,
        `Ornekleme: ${yakalama.contextRate || "—"} Hz` +
          (yakalama.resampled ? " → 16000 Hz'e indiriliyor" : ""),
      );
    }

    hud.log("system", lines.join("\n"));

    // Yorum: en olasi sorunu isaret et.
    // Gomulu motor secili ve model eksikse, klasorde ne oldugunu goster.
    if (gomulu && !gomulu.modelReady) {
      const detay = await speech.inspectEmbeddedModel();
      hud.log(
        "system",
        `Model klasoru: ${detay?.root || "bilinmiyor"}\nIcerik:\n${detay?.tree || "(yok)"}`,
      );
    }

    if (!speech.speechSupported) {
      hud.log("system", "Bu tarayicida ses tanima yok. Chrome ya da Edge deneyin; yazarak kullanmaya devam edebilirsiniz.");
    } else if (yakalama && speech.isListening() && yakalama.chunks === 0) {
      // En sinsi durum: gosterge oynuyor ama motora TEK PARCA bile
      // gitmiyor. Bunu ayrica soylemek gerekiyor.
      hud.log(
        "system",
        "Mikrofon acik gorunuyor ama ses motora HIC ulasmiyor. Bu genelde " +
          "ses cihazinin ikinci bir akis vermemesinden olur: Windows ses " +
          "ayarlarindan giris cihazini degistirip tekrar deneyin.",
      );
    } else if (yakalama && speech.isListening() && yakalama.peak < 0.01) {
      hud.log(
        "system",
        "Ses parcalari motora ulasiyor ama icleri neredeyse SESSIZ " +
          `(en yuksek %${(yakalama.peak * 100).toFixed(1)}). Windows'ta yanlis ` +
          "giris cihazi secili olabilir ya da mikrofon kisik olabilir.",
      );
    } else if (speech.isListening() && sinceResult > 20) {
      hud.log(
        "system",
        speech.isLocalRecognition()
          ? "Mikrofon acik ama tanima sonuc uretmiyor. \"Sesi cihazda tut\" anahtarini kapatip tekrar deneyin."
          : "Mikrofon acik ama tanima sonuc uretmiyor. Chrome dil ayarlarini ve internet baglantisini kontrol edin.",
      );
    } else if (!speech.isListening()) {
      hud.log("system", "Mikrofon kapali. Sinamayi anlamli kilmak icin once mikrofonu acin.");
    }
    panel.openTab("sistem");
  },
  /* --- sunucu yetenekleri (uygulama, arama, moderasyon) --- */
  findApp: (query) => system.findApp(query),
  launchApp: (id) => system.launchApp(id),
  closeApp: (id) => system.closeApp(id),
  // Web aramasi artik hep acik: DRA bilmedigi bir soruyu uydurmak yerine
  // arastirip kaynagiyla birlikte gosteriyor.
  searchEnabled: () => true,
  webSearch: (query) => system.webSearch(query),
  kickReady: () => store.streamerMode && system.kickReady(),
  kickAction: (action, args) => system.kickAction(action, args),

  onSpeechModeChanged: () => {
    if (!speech.isListening()) return;
    speech.stopListening();
    audio.stopMeter();
    state.micEnabled = false;
    dom.btnEnable.disabled = false;
    enableMic();
  },

  systemReport: () => {
    const nextAlarm = alarms.listAlarms().filter((a) => a.enabled)[0];
    const parts = [
      `Saat ${hud.formatTime()}.`,
      state.micEnabled ? "Mikrofon acik." : "Mikrofon kapali.",
      navigator.onLine ? "Ag baglantisi var." : "Ag baglantisi yok.",
      "Tum islemler bu cihazda yurutuluyor.",
      timers.length ? `${timers.length} aktif zamanlayici var.` : "Aktif zamanlayici yok.",
      nextAlarm ? `Siradaki alarm ${nextAlarm.time}.` : "Kurulu alarm yok.",
      store.notes.length ? `${store.notes.length} kayitli not var.` : "Kayitli not yok.",
    ];
    return parts.join(" ");
  },
};

/* ============================================================ masaustu */

/**
 * Arka plan kipinde miyiz?
 * Yalnizca uygulama gizli baslatildiysa VE kullanici bunu actiysa.
 */
function arkaPlandaMi() {
  return system.isDesktop() && system.hiddenLaunch() && store.backgroundListen;
}

/**
 * Masaustu surumunde tepsi menusu ve kisayol tusu (Alt+Space) ana surecten
 * olay gonderir. Tarayici surumunde bu abonelikler sessizce bos doner.
 */
function bindDesktopEvents() {
  if (!system.isDesktop()) return;

  system.onDesktopEvent("dra:wake", () => {
    if (state.current === S.SLEEPING) wakeUp();
  });
  system.onDesktopEvent("dra:sleep", () => {
    if (state.current !== S.SLEEPING) goToSleep();
  });
  system.onDesktopEvent("dra:toggle-mic", () => dom.btnMic.click());

  document.body.dataset.desktop = "true";
}

/* ============================================================ sunucu */

/**
 * Sunucuya baglanir: oturum jetonunu alir, uygulama listesini yukler,
 * kayitli ayarlari (arama, Kick) sunucuya bildirir.
 */
async function connectServer() {
  try {
    await system.connect();
    await system.loadApps();
    panel.renderApps();

    // Bilgisayar acilisinda gizli baslatildiysa ve arka plan dinleme
    // aciksa mikrofonu kendimiz aciyoruz — kullanicinin tiklamasi gerekmez.
    if (arkaPlandaMi()) {
      hud.log("system", "Arka planda dinliyorum. Adimi soyleyince gorunecegim.");
      enableMic();
    }

    // Ayarlar tarayicida saklaniyor; sunucu her acilista bilgilendirilir.
    if (store.streamerMode && store.kickToken) {
      await system.configureKick(store.kickToken, store.kickChannel);
    }
    // Ses ElevenLabs'a alinmissa anahtari her acilista yeniden bildiriyoruz;
    // anahtar sunucuda/ana surecte tutulmaz, surec kapaninca kaybolur.
    if (store.youtubeMode && store.ytClientId && store.ytRefreshToken) {
      await system.configureYoutube(store.ytClientId, store.ytClientSecret, store.ytRefreshToken);
    }
    if (store.ttsProvider === "elevenlabs" && store.elevenKey) {
      await system.configureTts(store.elevenKey, store.elevenVoice, store.elevenModel);
    }
    panel.syncSettings();
  } catch (err) {
    console.warn("[dra] sunucu yetenekleri kullanilamiyor:", err.message);
    hud.log(
      "system",
      "Sunucuya baglanamadim. Uygulama baslatma ve arama calismayacak; " +
        "diger komutlar etkilenmez.",
    );
  }
}

/* ============================================================ olcerler */

function updateNetGauge() {
  // Ag durumu yalnizca bilgi amacli; DRA calismak icin internete ihtiyac duymaz.
  const online = navigator.onLine;
  hud.setGauge("net", online ? 100 : 0, online ? "var" : "yok", null);
}

window.addEventListener("online", updateNetGauge);
window.addEventListener("offline", updateNetGauge);

async function initBattery() {
  if (!navigator.getBattery) {
    hud.setGauge("battery", 100, "sabit");
    return;
  }
  try {
    const battery = await navigator.getBattery();
    const paint = () => {
      const pct = Math.round(battery.level * 100);
      hud.setGauge(
        "battery",
        pct,
        `${pct}%${battery.charging ? " ⚡" : ""}`,
        pct < 20 && !battery.charging ? "error" : pct < 40 ? "warn" : null,
      );
    };
    battery.addEventListener("levelchange", paint);
    battery.addEventListener("chargingchange", paint);
    paint();
  } catch {
    hud.setGauge("battery", 100, "sabit");
  }
}

/* ============================================================ girdi baglama */

dom.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = dom.input.value.trim();
  if (!text) return;
  dom.input.value = "";
  if (state.current === S.SLEEPING) {
    wakeUp(text);
    return;
  }
  handleUtterance(text);
});

// Uyku ekranindan yazarak baslatma — mikrofon hic acilmasa da calisir.
$("sleep-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("sleep-input");
  const text = input.value.trim();
  input.value = "";
  wakeUp(text);
});

dom.btnEnable.addEventListener("click", enableMic);
dom.btnManualWake.addEventListener("click", () => wakeUp());
dom.btnSleep.addEventListener("click", () => goToSleep());
dom.btnFull.addEventListener("click", ctx.toggleFullscreen);

dom.btnVoice.addEventListener("click", () => {
  ctx.setVoice(!store.voiceEnabled);
  panel.syncSettings();
  hud.toast(store.voiceEnabled ? "Sesli yanit acik" : "Sesli yanit kapali");
});

dom.btnMic.addEventListener("click", () => {
  if (speech.isListening()) {
    speech.stopListening();
    audio.stopMeter();
    state.micEnabled = false;
    dom.btnEnable.disabled = false;
    dom.btnEnable.textContent = "Mikrofonu baslat";
    hud.toast("Mikrofon kapatildi");
  } else {
    enableMic();
  }
});

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement;

  if (event.key === "Escape") {
    speech.shutUp();
    if (state.current !== S.SLEEPING) goToSleep();
    return;
  }

  if (typing) return;

  if (event.code === "Space" && state.current === S.SLEEPING) {
    event.preventDefault();
    wakeUp();
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "m") dom.btnMic.click();
  else if (key === "s") dom.btnVoice.click();
  else if (key === "f") dom.btnFull.click();
  else if (key === "/" && state.current !== S.SLEEPING) {
    event.preventDefault();
    dom.input.focus();
  }
});

/* ============================================================ mikrofon acma */

/**
 * Mikrofonu acar.
 *
 * "Sesi cihazda tut" aciksa once tarayicinin cihaz ustu ses tanimasini arar.
 * Yoksa mikrofonu ACMAZ — sessizce bulut servisine dusmek, kullanicinin
 * acikca istemedigi bir sey yapmak olurdu.
 */
let micBusy = false;

async function enableMic() {
  // Dil paketi indirmesi dakikalar surebilir; ikinci tiklama ikinci
  // indirme baslatmasin.
  if (micBusy) {
    hud.toast("Ses tanima hazirlaniyor, lutfen bekleyin");
    return;
  }
  micBusy = true;
  try {
    await enableMicInner();
  } catch (err) {
    // enableMic cagrilarinin cogu "await"siz; buradan disari cikan bir
    // hata hicbir yerde gorunmuyordu. Kullanicinin gordugu sey
    // "mikrofon acilmiyor ama bir sey de yazmiyor" oluyordu.
    const mesaj = err?.message || "Mikrofon acilamadi.";
    hud.log("error", mesaj);
    hud.sleepStatus("Mikrofon acilamadi", "error");
    hud.toast(mesaj, 9000);
    state.micEnabled = false;
    dom.btnEnable.disabled = false;
    dom.btnEnable.textContent = "Mikrofonu baslat";
    hud.setPrivacyPill("off");
    audio.stopMeter();
  } finally {
    micBusy = false;
  }
}

async function enableMicInner() {
  /* --- Gomulu motor: uygulama surumunun varsayilan yolu --------------
   * Tarayicinin motoruna hic dokunmaz. Ses cihazdan cikmaz, internet
   * gerekmez, Chrome'un dil modeline bagimli degildir. */
  if (speech.embeddedAvailable() && store.speechEngine !== "tarayici") {
    const info = await speech.embeddedStatus();

    if (!info.modelReady) {
      hud.sleepStatus("Ses modeli kurulu degil", "warn");
      hud.log(
        "system",
        "Gomulu ses motoru icin Turkce model gerekiyor (bir kerelik, yaklasik 45 MB). " +
          "Ayar sekmesindeki \"Ses modelini kur\" dugmesine basin. Kurulduktan sonra " +
          "ses tamamen cihazinizda islenir, internet gerekmez.",
      );
      hud.toast("Ses modeli kurulu degil — Ayar sekmesine bakin", 8000);
      return;
    }

    hud.sleepStatus("Mikrofon izni bekleniyor…", null);
    const metered = await audio.startMeter();
    resetRecognitionHealth();

    // ONEMLI: mikrofon GERCEKTEN acilmadan "acik" demiyoruz.
    // Onceki hali baslatmayi ateşleyip hemen "Mikrofon acik" yaziyordu;
    // izin reddedilse ya da cihaz olmasa bile dugme acik gorunuyor,
    // kullaniciya hicbir sey soylenmiyordu.
    try {
      await speech.startEmbeddedAndWait();
    } catch (err) {
      const mesaj = err?.message || "Mikrofon acilamadi.";
      hud.log("error", mesaj);
      hud.sleepStatus("Mikrofon acilamadi", "error");
      hud.toast(mesaj, 9000);
      state.micEnabled = false;
      dom.btnEnable.disabled = false;
      dom.btnEnable.textContent = "Mikrofonu baslat";
      hud.setPrivacyPill("off");
      audio.stopMeter();
      return;
    }

    state.micEnabled = true;
    dom.btnEnable.textContent = "Mikrofon acik";
    dom.btnEnable.disabled = true;
    hud.setPrivacyPill("local");
    if (metered) pollLevel();
    return;
  }

  const wantLocal = store.localSpeechOnly;
  let processLocally = false;

  if (wantLocal) {
    hud.sleepStatus("Cihaz uzerinde ses tanima araniyor…", null);
    let status = await speech.probeLocalRecognition();

    if (status === "downloadable" || status === "downloading") {
      // Kullanici HUD'daysa uyku ekranindaki yaziyi gormez — sohbete de yaz.
      const note =
        "Turkce ses tanima paketi cihaza indiriliyor. Bu bir kerelik ve " +
        "birkac dakika surebilir; bittiginde ses cihazdan hic cikmayacak.";
      hud.sleepStatus("Turkce dil paketi indiriliyor…", "warn");
      hud.log("system", note);
      hud.toast("Dil paketi indiriliyor…", 6000);
      dom.btnEnable.textContent = "Indiriliyor…";

      const ok = await speech.installLocalRecognition();
      status = ok ? "available" : await speech.probeLocalRecognition();

      if (status === "available") hud.log("system", "Cihaz ustu ses tanima hazir.");
      dom.btnEnable.textContent = "Mikrofonu baslat";
    }

    if (status === "available") {
      processLocally = true;
    } else {
      const why =
        status === "unsupported"
          ? "Bu tarayici cihaz ustu ses tanima sunmuyor."
          : "Turkce dil paketi cihaza indirilemedi.";
      hud.sleepStatus("Cihaz ustu ses tanima yok", "warn");
      hud.setPrivacyPill("off");
      hud.toast(`${why} Yazarak kullanabilirsiniz.`, 8000);
      hud.log(
        "system",
        `${why} Mikrofon acilmadi — sesinizin disari cikmasini istemediginizi ` +
          "varsayiyorum. Yazili komutlar calismaya devam ediyor. Tarayicinin kendi " +
          "ses servisine izin vermek isterseniz Ayar'dan \"Sesi cihazda tut\" " +
          "anahtarini kapatin.",
      );
      return;
    }
  }

  hud.sleepStatus("Mikrofon izni bekleniyor…", null);

  const metered = await audio.startMeter();
  if (!metered) {
    hud.sleepStatus("Mikrofona erisilemedi. Tarayici izinlerini kontrol edin.", "error");
  }

  resetRecognitionHealth();
  const profiles = processLocally ? speech.LOCAL_PROFILES : speech.CLOUD_PROFILES;
  const started = speech.startListening(profiles[0]);
  if (!started) return;

  state.micEnabled = true;
  dom.btnEnable.textContent = "Mikrofon acik";
  dom.btnEnable.disabled = true;
  hud.setPrivacyPill(speech.isLocalRecognition() ? "local" : "cloud");

  if (metered) pollLevel();
}

let levelRaf = null;

/* --- sessiz ariza gozcusu ------------------------------------------------
 * Mikrofon ses aliyor ama tanima motoru hic sonuc uretmiyorsa, sorun
 * genelde o tarayici surumunun secenek kombinasyonunu desteklememesidir —
 * hata vermez, sadece susar. Bu gozcu durumu yakalar ve siradaki ayari
 * dener. Hepsi tukenirse kullaniciya durumu acikca soyler.
 */
const SPEECH_LEVEL = 0.18;      // "konusuluyor" sayilan seviye
const SPEECH_NEEDED_MS = 3000;  // bu kadar konusma birikince
const SILENCE_LIMIT_MS = 9000;  // ve bu sure sonuc gelmezse profili degistir

let speakingMs = 0;
let lastFrameAt = 0;
let profileIndex = 0;
let gaveUp = false;

/**
 * Gizlilik ayarina gore denenebilecek profiller.
 * Anahtar aciksa ses cihazdan cikmamali — yalnizca yerel profiller.
 * Kapaliysa kullanici tarayici servisini bilerek secmis demektir.
 */
function availableProfiles() {
  return store.localSpeechOnly ? speech.LOCAL_PROFILES : speech.CLOUD_PROFILES;
}

function checkRecognitionHealth(level, now) {
  if (!speech.isListening() || gaveUp) return;

  const delta = lastFrameAt ? now - lastFrameAt : 0;
  lastFrameAt = now;

  if (level > SPEECH_LEVEL) speakingMs += delta;

  // Sonuc geliyorsa her sey yolunda.
  if (now - speech.getLastResultAt() < SILENCE_LIMIT_MS) {
    speakingMs = 0;
    return;
  }
  if (speakingMs < SPEECH_NEEDED_MS) return;

  // Konusma duyuldu ama sonuc yok: siradaki ayari dene.
  speakingMs = 0;
  const profiles = availableProfiles();
  profileIndex += 1;

  if (profileIndex < profiles.length) {
    const next = profiles[profileIndex];
    hud.log(
      "system",
      `Ses geliyor ama tanima sonuc uretmedi. Farkli bir ayar deneniyor: ${next.name}`,
    );
    hud.toast(`Ses tanima ayari deneniyor: ${next.name}`, 4000);
    speech.startListening(next);
    hud.setPrivacyPill(speech.isLocalRecognition() ? "local" : "cloud");
    return;
  }

  gaveUp = true;
  hud.log(
    "system",
    store.localSpeechOnly
      ? "Cihaz uzerindeki ses tanimanin tum ayarlari denendi, hicbiri sonuc " +
        "uretmedi. Bu tarayici surumunde cihaz ustu Turkce tanima calismiyor " +
        "gorunuyor. Ayar sekmesinden \"Sesi cihazda tut\" anahtarini kapatirsaniz " +
        "tarayicinin kendi servisi denenir (sesiniz tarayici saticisina gider). " +
        "Ya da yazarak devam edin — tum komutlar ayni sekilde calisir."
      : "Ses tanimanin hicbir ayari sonuc uretmedi. Chrome dil ayarlarini ve " +
        "internet baglantinizi kontrol edin. Yazarak devam edebilirsiniz.",
  );
  hud.toast("Ses tanima calismiyor — sohbet paneline bakin", 8000);
  if (state.current === S.SLEEPING) {
    hud.sleepStatus("Ses tanima sonuc uretmiyor — yazarak kullanin", "error");
  }
}

/** Gozcuyu sifirlar (mikrofon yeniden acildiginda). */
function resetRecognitionHealth() {
  speakingMs = 0;
  lastFrameAt = 0;
  profileIndex = 0;
  gaveUp = false;
}

function pollLevel() {
  if (levelRaf) return;
  const loop = () => {
    const level = audio.readLevel();
    emit("level", level);
    checkRecognitionHealth(level, Date.now());
    levelRaf = requestAnimationFrame(loop);
  };
  levelRaf = requestAnimationFrame(loop);
}

/* ============================================================ acilis */

/**
 * Kuresel hata agi.
 *
 * Arayuzdeki islerin cogu bir dugmeye basildiginda baslayan, sonucu
 * beklenmeyen async cagrilar. Boyle bir cagri hata verdiginde tarayici
 * onu yalnizca gelistirici konsoluna yaziyor — kullanici hicbir sey
 * gormuyor, DRA da hicbir sey soylemiyor. "Calismiyor ama bir sey de
 * yazmiyor" sikayetinin kaynagi buydu.
 *
 * Buradan sonra her yakalanmamis hata hem sohbete dusuyor hem de kisa
 * bir uyari olarak gosteriliyor.
 */
function installErrorNet() {
  const bildir = (nereden, hata) => {
    const mesaj = hata?.message || String(hata || "bilinmeyen hata");
    console.error(`[dra] ${nereden}:`, hata);
    try {
      hud.log("error", `Beklenmedik hata: ${mesaj}`);
      hud.toast(`Hata: ${mesaj}`, 7000);
    } catch {
      /* HUD henuz hazir degilse en azindan konsolda duruyor */
    }
  };

  window.addEventListener("unhandledrejection", (olay) => {
    bildir("beklenmeyen soz reddi", olay.reason);
  });

  window.addEventListener("error", (olay) => {
    // Kaynak yukleme hatalari (resim, ses) ayri bir sey; onlari gecelim.
    if (olay.target && olay.target !== window) return;
    bildir("betik hatasi", olay.error || olay.message);
  });
}

function boot() {
  installErrorNet();
  loadStore();
  applyTheme(store.theme);
  rebuildWakeWords();

  mountReactor($("reactor"));
  mountWave($("wave"));

  panel.mountPanel(ctx);
  alarms.startAlarmClock(onAlarmFired);
  hud.renderTimers(timers);
  hud.showSleep();
  updateNetGauge();
  initBattery();
  hud.setPrivacyPill("off");
  hud.setGauge("engine", 100, "yerel", "ok");
  bindDesktopEvents();

  // Ilk acilista tum yetkiler tek ekranda soruluyor. Izin listesi
  // sunucudan geldigi icin BAGLANTI KURULDUKTAN SONRA gosteriliyor;
  // sabit bir gecikme yavas makinelerde ekrani hic gostermiyordu.
  connectServer().finally(() => {
    if (!store.firstRunDone) panel.showFirstRun();
  });

  dom.btnVoice.setAttribute("aria-pressed", String(store.voiceEnabled));
  dom.btnMic.setAttribute("aria-pressed", "false");

  if (!speech.speechSupported) {
    hud.sleepStatus("Bu tarayicida ses tanima yok — yazarak kullanabilirsiniz", "warn");
    dom.btnEnable.disabled = true;
  } else {
    hud.sleepStatus("Mikrofonu acin ya da yazarak baslayin", null);
  }

  console.log(
    "%cDRA%c hazir. Mikrofonu acip \"DRA\" deyin.",
    "background:#35e6ff;color:#04070c;padding:2px 8px;letter-spacing:3px",
    "color:#35e6ff",
  );
}

boot();
