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
import { runCommand, normalize, suggestCommand, searchAnswer } from "./commands.js";
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
  if (!text || busy) return;
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
    if (ctx.searchEnabled()) {
      hud.log("system", "Bunu komutlarimda bulamadim, internette ariyorum…");
      await respond(await searchAnswer(ctx, text));
      return;
    }
    await respond(suggestCommand(text));
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

async function wakeUp(spokenRest = "", { silent = false } = {}) {
  if (waking || state.current !== S.SLEEPING) return;
  waking = true;
  setState(S.WAKING);

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
    if (message) hud.toast(message, 5000);
  }
  hud.setGauge("mic", state.micEnabled ? 8 : 0, state.micEnabled ? "acik" : "kapali");
});

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
   * Ses tanima teshisi.
   * Tarayicinin ne destekledigini tahmin etmek yerine dogrudan sorup
   * sonucu sade Turkce olarak sohbete yazar.
   */
  runDiagnostics: async () => {
    hud.log("system", "Ses tanima siniyor…");

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

    hud.log("system", lines.join("\n"));

    // Yorum: en olasi sorunu isaret et.
    if (!speech.speechSupported) {
      hud.log("system", "Bu tarayicida ses tanima yok. Chrome ya da Edge deneyin; yazarak kullanmaya devam edebilirsiniz.");
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
  searchEnabled: () => store.webSearch && system.searchEnabled(),
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

    // Ayarlar tarayicida saklaniyor; sunucu her acilista bilgilendirilir.
    if (store.webSearch) await system.setSearchEnabled(true);
    if (store.streamerMode && store.kickToken) {
      await system.configureKick(store.kickToken, store.kickChannel);
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
  } finally {
    micBusy = false;
  }
}

async function enableMicInner() {
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

function boot() {
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
  connectServer();

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
