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
import { startCapture, stopCapture, capturing } from "./mic-capture.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(SpeechRecognition);
export const voiceSupported = "speechSynthesis" in window;

/* ------------------------------------------------------- gomulu motor */

/**
 * Uygulama surumunde kendi ses tanima motorumuz calisir (Vosk).
 * Tarayicinin motoruna hic dokunmaz: ses cihazdan cikmaz, internet
 * gerekmez ve Chrome'un dil modeline bagimli degildir.
 */
const embedded = typeof window !== "undefined" && Boolean(window.dra?.stt);

export const embeddedAvailable = () => embedded;

let embeddedRunning = false;

/** Gomulu motorun ve modelin durumu. */
export async function embeddedStatus() {
  if (!embedded) return { engine: "yok", modelReady: false };
  const { status } = await window.dra.stt.status();
  return status;
}

/** Modeli indirir; ilerlemeyi `onProgress` ile bildirir. */
export async function installEmbeddedModel(onProgress) {
  if (!embedded) throw new Error("Gomulu motor yalnizca uygulama surumunde var.");
  const off = onProgress ? window.dra.stt.onProgress(({ percent }) => onProgress(percent)) : null;
  try {
    return await window.dra.stt.install();
  } finally {
    off?.();
  }
}

/** Kullaniciya model klasoru sectirir (indirme engellenirse). */
export async function pickEmbeddedModel() {
  if (!embedded) throw new Error("Gomulu motor yalnizca uygulama surumunde var.");
  return window.dra.stt.pickFolder();
}

/** Model klasorunun icerigi — teshis icin. */
export async function inspectEmbeddedModel() {
  if (!embedded) return null;
  const { info } = await window.dra.stt.inspect();
  return info;
}

/**
 * Tanima sonuclarini karsilar.
 *
 * Abonelik motor baslatilirken degil, modul yuklenirken bir kez kuruluyor.
 * Boylece sonuc yolu motorun durumundan bagimsiz ve tek parca kaliyor;
 * motor calismiyorsa zaten sonuc gelmiyor.
 */
/**
 * Motordan gelen bir tanima sonucunu isler.
 * Ses tanimadan gelen metin buradan sonra uygulamanin geri kalanina
 * "heard" olayi olarak akar — tarayici motoruyla ayni yol.
 */
export function handleRecognitionResult({ partial, final }) {
  if (Date.now() < deafUntil) return false;
  const text = (final || partial || "").trim();
  if (!text) return false;

  lastResultAt = Date.now();
  stats.results += 1;
  emit("heard", {
    text,
    alternatives: [text],
    final: Boolean(final),
    confidence: 1,
  });
  return true;
}

if (embedded) {
  // Motor ayri surecte; coktugunde ya da hata verdiginde dinlemeyi
  // duzgunce sonlandirip kullaniciya bildiriyoruz.
  window.dra.stt.onEngine?.(({ type, message }) => {
    if (type !== "crashed" && type !== "error") return;
    embeddedRunning = false;
    stopCapture();
    emit("mic", {
      status: "error",
      message:
        type === "crashed"
          ? "Ses motoru coktu. Uygulama calismaya devam ediyor; yazarak kullanabilirsiniz. " +
            "Model bozuk olabilir — Ayar'dan yeniden kurmayi deneyin."
          : `Ses motoru hata verdi: ${message}`,
    });
  });

  window.dra.stt.onResult((data) => {
    // Mikrofon kapatildiktan sonra da kuyruktaki ses parcalarindan sonuc
    // gelebilir. O sonuclar komut sayilmamali; aksi halde kapali mikrofonla
    // gecikmeli bir "dra" uygulamayi uyandirabiliyor.
    if (!embeddedRunning) return;
    handleRecognitionResult(data);
  });
}

/** Gomulu motorla dinlemeyi baslatir. */
async function startEmbedded() {
  await window.dra.stt.start();

  const started = await startCapture((pcm) => {
    // Kopyanin sahibi IPC oldugu icin altta yatan tamponu gonderiyoruz.
    window.dra.stt.feed(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });

  if (!started) {
    emit("mic", { status: "error", message: "Mikrofona erisilemedi." });
    return false;
  }

  embeddedRunning = true;
  localActive = true;
  stats.starts += 1;
  lastResultAt = Date.now();
  emit("mic", { status: "on" });
  return true;
}

function stopEmbedded() {
  stopCapture();
  window.dra?.stt?.stop?.();
  embeddedRunning = false;
  stats.ends += 1;
  emit("mic", { status: "off" });
}

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
/** Ses tanimadan en son ne zaman sonuc geldi? (teshis icin) */
let lastResultAt = 0;
export const getLastResultAt = () => lastResultAt;

/**
 * Tanima motorunun yasam dongusu sayaclari.
 * Motor baslayip hemen bitiyorsa (sessiz ariza) bunu ancak buradan gorurus.
 */
const stats = { starts: 0, ends: 0, results: 0, lastError: null };
export const getStats = () => ({ ...stats, profile: currentOptions?.name ?? null });

function buildRecognition(options) {
  const rec = new SpeechRecognition();
  rec.lang = "tr-TR";
  rec.continuous = options.continuous;
  rec.interimResults = options.interimResults;
  rec.maxAlternatives = options.maxAlternatives;

  // Destekleyen tarayicilarda sesin cihazdan cikmamasini saglar.
  if (options.processLocally && "processLocally" in rec) {
    rec.processLocally = true;
    localActive = true;
  } else {
    localActive = false;
  }

  rec.onstart = () => {
    running = true;
    stats.starts += 1;
    emit("mic", { status: "on" });
  };

  rec.onresult = (event) => {
    lastResultAt = Date.now();
    stats.results += 1;
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
    stats.lastError = err;
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
    stats.ends += 1;
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
 * Denenecek tanima ayarlari, sirayla.
 *
 * Cihaz ustu tanima her tarayici surumunde ayni secenekleri desteklemiyor;
 * bazi kombinasyonlarda hata vermeden hic sonuc uretmiyor. Tek bir ayara
 * bel baglamak yerine calisani buluyoruz.
 */
export const PROFILES = [
  {
    name: "cihazda · surekli",
    processLocally: true, continuous: true, interimResults: true, maxAlternatives: 3,
  },
  {
    name: "cihazda · sade",
    processLocally: true, continuous: true, interimResults: false, maxAlternatives: 1,
  },
  {
    name: "cihazda · kisa dinleme",
    processLocally: true, continuous: false, interimResults: true, maxAlternatives: 1,
  },
  {
    name: "tarayici servisi · surekli",
    processLocally: false, continuous: true, interimResults: true, maxAlternatives: 3,
  },
];

/** Cihazdan cikmayan profiller (gizlilik anahtari acikken kullanilir). */
export const LOCAL_PROFILES = PROFILES.filter((p) => p.processLocally);

/** Tarayicinin kendi servisini kullanan profiller (anahtar kapaliyken). */
export const CLOUD_PROFILES = PROFILES.filter((p) => !p.processLocally);

let currentOptions = null;

/** Surekli dinlemeyi verilen profil ile baslatir. */
export function startListening(profile = PROFILES[0]) {
  // Gomulu motor varsa ve secilmisse tarayicinin motoruna hic gidilmez.
  if (embedded && store.speechEngine !== "tarayici") {
    if (embeddedRunning) return true;
    startEmbedded().catch((err) => {
      emit("mic", {
        status: err?.message?.includes("model") ? "warn" : "error",
        message: err?.message || "Gomulu ses motoru baslatilamadi.",
      });
    });
    return true;
  }

  if (!speechSupported) {
    emit("mic", {
      status: "unsupported",
      message: "Bu tarayici ses tanimayi desteklemiyor. Yazarak kullanabilirsiniz.",
    });
    return false;
  }

  // Profil degistiyse motoru bastan kur.
  if (recognition && currentOptions?.name !== profile.name) {
    stopListening();
    recognition = null;
  }

  if (!recognition) {
    currentOptions = profile;
    recognition = buildRecognition(profile);
  }

  wantRunning = true;
  lastResultAt = Date.now();
  if (running) return true;
  try {
    recognition.start();
  } catch {
    /* zaten calisiyor */
  }
  return true;
}

/** Su an kullanilan profil. */
export const currentProfile = () => currentOptions;

/** Dinlemeyi tamamen durdurur. */
export function stopListening() {
  if (embeddedRunning) {
    stopEmbedded();
    return;
  }
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
  return wantRunning || embeddedRunning;
}

/** Su an gomulu motor mu calisiyor? */
export const embeddedRunningNow = () => embeddedRunning;

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
