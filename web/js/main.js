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
import { runCommand, normalize } from "./commands.js";
import { store, loadStore, saveStore } from "./store.js";
import * as panel from "./panel.js";
import * as alarms from "./alarms.js";

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

/* ============================================================ beyin koprusu */

let brain = { ready: false, model: null };

async function checkBrain() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    brain = data.brain || { ready: false };
  } catch {
    brain = { ready: false, reason: "sunucuya ulasilamadi" };
  }
  state.brainReady = brain.ready;
  hud.setBrainPill(brain.ready, brain.model);
  hud.setGauge(
    "brain",
    brain.ready ? 100 : 12,
    brain.ready ? "bagli" : "yerel",
    brain.ready ? "ok" : "warn",
  );
}

/**
 * Claude'a sorar. Gelen metni canli olarak kayda yazar, tamamini dondurur.
 */
async function askBrain(prompt) {
  const line = hud.log("dra", "");
  let full = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      history: state.history,
      context: `Tarih ve saat: ${hud.formatDate()} ${hud.formatTime()}.`,
    }),
  });

  if (!res.ok || !res.body) throw new Error("Beyin yanit vermedi.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE cerceveleri bos satirla ayrilir.
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = "message";
      let data = "";
      for (const raw of frame.split("\n")) {
        if (raw.startsWith("event:")) event = raw.slice(6).trim();
        else if (raw.startsWith("data:")) data += raw.slice(5).trim();
      }
      if (!data) continue;

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (event === "delta") {
        full += payload.text || "";
        line.textContent = full;
        hud.setCaption(full);
      } else if (event === "done") {
        full = payload.text || full;
        line.textContent = full;
      } else if (event === "error") {
        failure = payload.message || "Beyin hata verdi.";
      }
    }
  }

  if (failure) {
    line.parentElement.dataset.who = "error";
    line.textContent = failure;
    return { text: failure, ok: false };
  }

  return { text: full.trim(), ok: true, logged: true };
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
      if (local.then) await local.then();
      return;
    }

    if (!brain.ready) {
      await respond(
        "Bunu yerel komutlarimla karsilayamadim. Yapay zeka beynim de bagli degil — " +
          "sunucuda ANTHROPIC_API_KEY tanimlarsaniz her soruyu yanitlayabilirim.",
      );
      return;
    }

    const answer = await askBrain(text);
    await respond(answer.text, { logged: answer.logged, kind: answer.ok ? null : "error" });
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

  if (store.bootSequence) await hud.playBoot(brain.ready);
  hud.showHud();
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

  /* --- ayar geri cagrilari --- */
  isMicOn: () => speech.isListening(),
  toggleMic: () => dom.btnMic.click(),
  onAutoSleepChanged: () => touch(),
  onWakeWordsChanged: () => rebuildWakeWords(),

  systemReport: () => {
    const nextAlarm = alarms.listAlarms().filter((a) => a.enabled)[0];
    const parts = [
      `Saat ${hud.formatTime()}.`,
      state.micEnabled ? "Mikrofon acik." : "Mikrofon kapali.",
      navigator.onLine ? "Ag baglantisi var." : "Ag baglantisi yok.",
      brain.ready ? "Yapay zeka beynim bagli." : "Yapay zeka beynim cevrimdisi, yerel modda calisiyorum.",
      timers.length ? `${timers.length} aktif zamanlayici var.` : "Aktif zamanlayici yok.",
      nextAlarm ? `Siradaki alarm ${nextAlarm.time}.` : "Kurulu alarm yok.",
      store.notes.length ? `${store.notes.length} kayitli not var.` : "Kayitli not yok.",
    ];
    return parts.join(" ");
  },
};

/* ============================================================ olcerler */

function updateNetGauge() {
  const online = navigator.onLine;
  hud.setGauge("net", online ? 100 : 0, online ? "cevrimici" : "cevrimdisi", online ? "ok" : "error");
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
    state.micEnabled = false;
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

async function enableMic() {
  hud.sleepStatus("Mikrofon izni bekleniyor…", null);

  const metered = await audio.startMeter();
  if (!metered) {
    hud.sleepStatus("Mikrofona erisilemedi. Tarayici izinlerini kontrol edin.", "error");
  }

  const started = speech.startListening();
  if (!started) return;

  state.micEnabled = true;
  dom.btnEnable.textContent = "Mikrofon acik";
  dom.btnEnable.disabled = true;

  if (metered) pollLevel();
}

let levelRaf = null;

function pollLevel() {
  if (levelRaf) return;
  const loop = () => {
    emit("level", audio.readLevel());
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
  checkBrain();
  setInterval(checkBrain, 60_000);

  dom.btnVoice.setAttribute("aria-pressed", String(store.voiceEnabled));
  dom.btnMic.setAttribute("aria-pressed", "false");

  if (!speech.speechSupported) {
    hud.sleepStatus("Bu tarayici ses tanimayi desteklemiyor — Chrome veya Edge kullanin", "error");
    dom.btnEnable.disabled = true;
  } else {
    hud.sleepStatus("Baslamak icin mikrofonu acin", null);
  }

  console.log(
    "%cDRA%c hazir. Mikrofonu acip \"DRA\" deyin.",
    "background:#35e6ff;color:#04070c;padding:2px 8px;letter-spacing:3px",
    "color:#35e6ff",
  );
}

boot();
