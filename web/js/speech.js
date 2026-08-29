/**
 * Konusma katmani: tanima (kulak) + sentez (ses).
 *
 * Tasarim notu: tanima motoru surekli TEK bir ornek olarak calisir.
 * Durum degistikce baslatip durdurmak yerine, gelen metni uygulama
 * durumuna gore yonlendiririz. Web Speech API'de baslat/durdur yarislari
 * en yaygin hata kaynagi oldugu icin bu yol daha saglam.
 */

import { emit, state } from "./state.js";
import { store } from "./store.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(SpeechRecognition);
export const voiceSupported = "speechSynthesis" in window;

/* ------------------------------------------------- cihaz uzerinde tanima */

/**
 * Tarayicilarin varsayilan ses tanimasi sesi saticinin sunucusuna gonderir.
 * DRA'nin amaci bunun tersi oldugu icin once CIHAZ UZERINDE tanimayi
 * deniyoruz; boyle bir sey yoksa durumu gizlemeden bildiriyoruz.
 *
 * Doner: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported"
 */
export async function probeLocalRecognition(lang = "tr-TR") {
  if (!SpeechRecognition || typeof SpeechRecognition.available !== "function") {
    return "unsupported";
  }
  try {
    const status = await SpeechRecognition.available({
      langs: [lang],
      processLocally: true,
    });
    return typeof status === "string" ? status : status ? "available" : "unavailable";
  } catch {
    return "unsupported";
  }
}

/** Cihaz uzerindeki dil paketini indirir. Basarili olursa true doner. */
export async function installLocalRecognition(lang = "tr-TR") {
  if (!SpeechRecognition || typeof SpeechRecognition.install !== "function") return false;
  try {
    return Boolean(await SpeechRecognition.install({ langs: [lang], processLocally: true }));
  } catch {
    return false;
  }
}

/** Su anki tanima gercekten cihazda mi calisiyor? */
let localActive = false;
export const isLocalRecognition = () => localActive;

/* ------------------------------------------------------------------ tanima */

let recognition = null;
let wantRunning = false;
let running = false;
let restartTimer = null;
/** DRA konusurken kendi sesini komut sanmasin diye kapi. */
let deafUntil = 0;

function buildRecognition({ processLocally }) {
  const rec = new SpeechRecognition();
  rec.lang = "tr-TR";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;

  // Destekleyen tarayicilarda sesin cihazdan cikmamasini saglar.
  if (processLocally && "processLocally" in rec) {
    rec.processLocally = true;
    localActive = true;
  } else {
    localActive = false;
  }

  rec.onstart = () => {
    running = true;
    emit("mic", { status: "on" });
  };

  rec.onresult = (event) => {
    if (Date.now() < deafUntil) return;

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      // Alternatifleri de tasiyoruz: uyandirma kelimesi bazen 2. secenekte cikar.
      const alternatives = [];
      for (let a = 0; a < result.length; a += 1) {
        const t = result[a]?.transcript?.trim();
        if (t) alternatives.push(t);
      }
      if (!alternatives.length) continue;

      emit("heard", {
        text: alternatives[0],
        alternatives,
        final: result.isFinal,
        confidence: result[0]?.confidence ?? 0,
      });
    }
  };

  rec.onerror = (event) => {
    const err = event.error;
    // "no-speech" ve "aborted" normal akisin parcasi — sessizce yeniden baslar.
    if (err === "no-speech" || err === "aborted") return;

    if (err === "not-allowed" || err === "service-not-allowed") {
      wantRunning = false;
      state.micEnabled = false;
      emit("mic", {
        status: "denied",
        message: "Mikrofon izni verilmedi. Tarayici adres cubugundaki kilit simgesinden izin verin.",
      });
      return;
    }

    if (err === "audio-capture") {
      wantRunning = false;
      state.micEnabled = false;
      emit("mic", { status: "error", message: "Mikrofon bulunamadi." });
      return;
    }

    if (err === "network") {
      emit("mic", { status: "warn", message: "Ses tanima motoru yanit vermedi." });
      return;
    }

    emit("mic", { status: "warn", message: `Ses tanima hatasi: ${err}` });
  };

  rec.onend = () => {
    running = false;
    if (!wantRunning) {
      emit("mic", { status: "off" });
      return;
    }
    // Chrome tanimayi periyodik olarak kendiliginden bitirir; hemen geri ac.
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (wantRunning && !running) {
        try {
          rec.start();
        } catch {
          /* zaten baslamissa yok say */
        }
      }
    }, 260);
  };

  return rec;
}

/**
 * Surekli dinlemeyi baslatir.
 * `processLocally` true ise tanima cihaz uzerinde zorlanir.
 */
export function startListening({ processLocally = false } = {}) {
  if (!speechSupported) {
    emit("mic", {
      status: "unsupported",
      message: "Bu tarayici ses tanimayi desteklemiyor. Yazarak kullanabilirsiniz.",
    });
    return false;
  }
  // Mod degistiyse tanimayi yeniden kur.
  if (recognition && localActive !== Boolean(processLocally)) {
    stopListening();
    recognition = null;
  }
  if (!recognition) recognition = buildRecognition({ processLocally });
  wantRunning = true;
  if (running) return true;
  try {
    recognition.start();
  } catch {
    /* zaten calisiyor */
  }
  return true;
}

/** Dinlemeyi tamamen durdurur. */
export function stopListening() {
  wantRunning = false;
  clearTimeout(restartTimer);
  if (recognition && running) {
    try {
      recognition.abort();
    } catch {
      /* yok say */
    }
  }
  running = false;
  emit("mic", { status: "off" });
}

export function isListening() {
  return wantRunning;
}

/** DRA konusurken mikrofonu gecici olarak sagirlastirir. */
export function deafen(ms) {
  deafUntil = Math.max(deafUntil, Date.now() + ms);
}

/* ------------------------------------------------------------------ sentez */

let voices = [];
let currentUtterances = [];

function loadVoices() {
  if (!voiceSupported) return;
  voices = window.speechSynthesis.getVoices() || [];
}

if (voiceSupported) {
  loadVoices();
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

/** Turkce bir ses secer; yoksa varsayilana duser. */
function pickVoice() {
  if (!voices.length) loadVoices();
  return (
    voices.find((v) => v.lang === "tr-TR" && v.localService) ||
    voices.find((v) => v.lang === "tr-TR") ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("tr")) ||
    null
  );
}

export function hasTurkishVoice() {
  return Boolean(pickVoice());
}

/**
 * Uzun metinlerde Chrome sentezi ~15 saniyede kesiyor.
 * Cumlelere bolup sirayla okutarak bunu asiyoruz.
 */
function splitForSpeech(text, maxLen = 180) {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…:])\s+/);

  const chunks = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (!sentence) continue;
    if ((buffer + " " + sentence).trim().length > maxLen && buffer) {
      chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = (buffer + " " + sentence).trim();
    }
  }
  if (buffer) chunks.push(buffer.trim());
  return chunks.length ? chunks : [text];
}

/** Konusmayi hemen keser. */
export function shutUp() {
  if (!voiceSupported) return;
  currentUtterances = [];
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* yok say */
  }
}

/**
 * Metni sesli okur. Okuma bitince (veya ses kapaliysa hemen) coz.
 */
export function say(text) {
  return new Promise((resolve) => {
    const clean = (text || "").trim();
    if (!clean) return resolve();

    if (!voiceSupported || !store.voiceEnabled) {
      // Ses kapaliyken de okuma suresi kadar bekliyormus gibi yapmayiz;
      // gorsel durum yonetimi main.js'te hallediliyor.
      return resolve();
    }

    shutUp();

    const chunks = splitForSpeech(clean);
    const voice = pickVoice();
    let remaining = chunks.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      // Hoparlorden gelen sesin kuyrugunu komut sanmamak icin kisa bir tampon.
      deafen(600);
      resolve();
    };

    // Chrome'un sentezi takilirsa diye guvenlik zaman asimi.
    const guard = setTimeout(finish, Math.min(90000, 2500 + clean.length * 90));

    currentUtterances = chunks.map((chunk) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = "tr-TR";
      if (voice) u.voice = voice;
      u.rate = store.speechRate;
      u.pitch = 0.95;
      u.volume = 1;
      u.onend = () => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimeout(guard);
          finish();
        }
      };
      u.onerror = () => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimeout(guard);
          finish();
        }
      };
      return u;
    });

    // Konusma boyunca kendi sesimizi duymayalim.
    deafen(Math.min(90000, 2000 + clean.length * 90));
    for (const u of currentUtterances) window.speechSynthesis.speak(u);
  });
}
