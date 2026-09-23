/**
 * Kalici veri: notlar, alarmlar ve ayarlar.
 * Hepsi tarayicinin localStorage'inda durur — sunucuya hicbir sey gitmez.
 */

const KEY = "dra.state.v2";
const LEGACY_KEY = "dra.state.v1";

/** Varsayilan ayarlar. */
const DEFAULTS = {
  voiceEnabled: true,
  // Varsayilan olarak ses cihazdan cikmaz. Tarayici cihaz ustu tanima
  // sunmuyorsa mikrofon acilmaz; kullanici bilerek kapatabilir.
  localSpeechOnly: true,
  // "gomulu" = uygulamanin kendi motoru (Vosk), "tarayici" = Web Speech.
  speechEngine: "gomulu",
  /*
   * KOMUT KIPI — ses motoruna yalnizca DRA'nin anladigi sozcukleri
   * duyabilecegini soyler. Kucuk model serbest konusmada zayif ("dra"
   * yerine "bira" duyuyor); liste verilince dogruluk carpici bicimde
   * artiyor. Karsiligi: serbest soru sormak zorlasir.
   */
  commandMode: true,
  /*
   * Konusmayi yaziya ceviren taraf. "elevenlabs" = DRA uyaninca
   * cumleler ElevenLabs'e gider (WhatsApp'taki gibi dogru yazi;
   * anahtar yoksa kendiliginden cihazdaki motora duser).
   * "yerel" = her sey cihazda kalir, dogruluk dusuk.
   */
  sttProvider: "elevenlabs",
  speechRate: 1.05,
  bootSequence: true,
  autoSleepMinutes: 2.5, // 0 = otomatik uyku kapali
  theme: [53, 230, 255],
  extraWakeWords: [],
  // Ilk acilis izin ekrani gosterildi mi?
  firstRunDone: false,
  // Yayinci destegi: Kick moderasyon komutlari.
  streamerMode: false,
  // Bilgisayar acilinca DRA pencere gostermeden dinlemeye baslasin.
  backgroundListen: false,
  kickToken: "",
  kickChannel: "",
  // DRA'nin sesi: "yerel" = isletim sisteminin kendi sentezi (disari
  // hicbir sey gitmez), "elevenlabs" = ElevenLabs (kullanici acarsa;
  // o zaman SOYLENEN metin ElevenLabs'a gider).
  ttsProvider: "yerel",
  elevenKey: "",
  elevenVoice: "",
  elevenModel: "eleven_flash_v2_5",
  // Piper: cihazda calisan ucretsiz ses. Program ve ses modeli yolu.
  piperBin: "",
  piperVoice: "",
  // Google arama (Programmable Search). Anahtar ve arama motoru kimligi
  // bu bilgisayarda kalir; girilmezse DRA anahtarsiz kaynaklarla calisir.
  googleKey: "",
  googleCx: "",
  // E-posta raporu: Gmail adresi + UYGULAMA SIFRESI (normal sifre degil).
  mailMode: false,
  mailUser: "",
  mailPass: "",
  // Montaj: kaynak klasoru, uslup projesi, kapak, muzik ve sablon.
  montageMode: false,
  montageClips: "",
  montageProject: "",
  montageImage: "",
  montageMusic: "",
  montageTemplate: "hizli",
  montageTitle: "",
  // YouTube: istemci bilgileri ve yenileme jetonu bu bilgisayarda kalir.
  youtubeMode: false,
  ytClientId: "",
  ytClientSecret: "",
  ytRefreshToken: "",
  // Isletme modu: hangi kaynaklardan musteri mesaji alinacak ve
  // her kaynak icin girilen bilgiler.
  businessMode: false,
  businessName: "",
  sourcesOn: [],
  sourceValues: {},
  notes: [],
  alarms: [],
};

/**
 * Yayilma operatoru (`{...DEFAULTS}`) dizileri KOPYALAMAZ; store.notes ile
 * DEFAULTS.notes ayni nesne olur ve store'a eklenen her not varsayilanlari
 * da kirletir — bu durumda "Sifirla" hicbir seyi temizlemez.
 * Derin kopya bu bagi koparir.
 */
export const store = structuredClone(DEFAULTS);

function coerce(saved) {
  if (!saved || typeof saved !== "object") return;

  if (typeof saved.voiceEnabled === "boolean") store.voiceEnabled = saved.voiceEnabled;
  if (typeof saved.bootSequence === "boolean") store.bootSequence = saved.bootSequence;
  if (typeof saved.commandMode === "boolean") store.commandMode = saved.commandMode;
  if (typeof saved.localSpeechOnly === "boolean") store.localSpeechOnly = saved.localSpeechOnly;
  if (saved.speechEngine === "gomulu" || saved.speechEngine === "tarayici") {
    store.speechEngine = saved.speechEngine;
  }
  if (typeof saved.firstRunDone === "boolean") store.firstRunDone = saved.firstRunDone;
  if (typeof saved.streamerMode === "boolean") store.streamerMode = saved.streamerMode;
  if (typeof saved.backgroundListen === "boolean") store.backgroundListen = saved.backgroundListen;
  if (typeof saved.kickToken === "string") store.kickToken = saved.kickToken.slice(0, 400);
  if (typeof saved.kickChannel === "string") store.kickChannel = saved.kickChannel.slice(0, 80);

  if (saved.sttProvider === "yerel" || saved.sttProvider === "elevenlabs") {
    store.sttProvider = saved.sttProvider;
  }
  if (["yerel", "elevenlabs", "piper"].includes(saved.ttsProvider)) {
    store.ttsProvider = saved.ttsProvider;
  }
  for (const k of ["piperBin", "piperVoice"]) {
    if (typeof saved[k] === "string") store[k] = saved[k].slice(0, 600);
  }
  if (typeof saved.elevenKey === "string") store.elevenKey = saved.elevenKey.slice(0, 300);
  if (typeof saved.elevenVoice === "string") store.elevenVoice = saved.elevenVoice.slice(0, 100);
  if (typeof saved.elevenModel === "string" && saved.elevenModel.trim()) {
    store.elevenModel = saved.elevenModel.trim().slice(0, 80);
  }
  if (typeof saved.mailMode === "boolean") store.mailMode = saved.mailMode;
  if (typeof saved.googleKey === "string") store.googleKey = saved.googleKey;
  if (typeof saved.googleCx === "string") store.googleCx = saved.googleCx;
  if (typeof saved.mailUser === "string") store.mailUser = saved.mailUser.slice(0, 200);
  if (typeof saved.mailPass === "string") store.mailPass = saved.mailPass.slice(0, 100);

  if (typeof saved.montageMode === "boolean") store.montageMode = saved.montageMode;
  for (const k of ["montageClips", "montageProject", "montageImage", "montageMusic", "montageTitle"]) {
    if (typeof saved[k] === "string") store[k] = saved[k].slice(0, 600);
  }
  if (typeof saved.montageTemplate === "string") {
    store.montageTemplate = saved.montageTemplate.slice(0, 40);
  }

  if (typeof saved.youtubeMode === "boolean") store.youtubeMode = saved.youtubeMode;
  for (const k of ["ytClientId", "ytClientSecret", "ytRefreshToken"]) {
    if (typeof saved[k] === "string") store[k] = saved[k].slice(0, 400);
  }

  if (typeof saved.businessMode === "boolean") store.businessMode = saved.businessMode;
  if (typeof saved.businessName === "string") {
    store.businessName = saved.businessName.slice(0, 120);
  }
  if (Array.isArray(saved.sourcesOn)) {
    store.sourcesOn = saved.sourcesOn.filter((x) => typeof x === "string").slice(0, 10);
  }
  if (saved.sourceValues && typeof saved.sourceValues === "object") {
    // Kaynak basina alan degerleri; her biri kisa metin.
    const temiz = {};
    for (const [kaynak, alanlar] of Object.entries(saved.sourceValues)) {
      if (!alanlar || typeof alanlar !== "object") continue;
      temiz[kaynak] = {};
      for (const [k, v] of Object.entries(alanlar)) {
        if (typeof v === "string") temiz[kaynak][k] = v.slice(0, 400);
      }
    }
    store.sourceValues = temiz;
  }

  if (Number.isFinite(saved.speechRate)) {
    store.speechRate = Math.min(1.6, Math.max(0.6, saved.speechRate));
  }
  if (Number.isFinite(saved.autoSleepMinutes)) {
    store.autoSleepMinutes = Math.min(60, Math.max(0, saved.autoSleepMinutes));
  }
  if (Array.isArray(saved.theme) && saved.theme.length === 3) {
    store.theme = saved.theme.map((v) => Math.min(255, Math.max(0, Number(v) || 0)));
  }
  if (Array.isArray(saved.extraWakeWords)) {
    store.extraWakeWords = saved.extraWakeWords
      .filter((w) => typeof w === "string" && w.trim())
      .map((w) => w.trim().toLocaleLowerCase("tr"))
      .slice(0, 12);
  }
  if (Array.isArray(saved.notes)) {
    store.notes = saved.notes.filter((n) => typeof n === "string").slice(0, 60);
  }
  if (Array.isArray(saved.alarms)) {
    store.alarms = saved.alarms
      .filter((a) => a && /^\d{2}:\d{2}$/.test(a.time))
      .map((a) => ({
        id: String(a.id || Date.now() + Math.random()),
        time: a.time,
        label: typeof a.label === "string" ? a.label.slice(0, 60) : "",
        enabled: a.enabled !== false,
        repeat: a.repeat === true,
        lastFired: typeof a.lastFired === "string" ? a.lastFired : null,
      }))
      .slice(0, 30);
  }
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      coerce(JSON.parse(raw));
      return;
    }
    // Onceki surumden gecis: sadece notlar ve ses tercihi vardi.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      coerce({ notes: old.notes, voiceEnabled: old.voiceEnabled, theme: old.theme });
      saveStore();
    }
  } catch {
    /* bozuk veri — varsayilanlarla devam */
  }
}

/**
 * Kaydetme basarisiz oldu mu? Notlar, alarmlar ve ayarlar burada
 * duruyor; sessizce kaydedilmemesi kullanicinin emegini kaybetmesi
 * demek. Bir kez soyluyoruz — her tuş vurusunda degil.
 */
let kaydetmeHatasi = null;
export const storeHealth = () => ({ saveError: kaydetmeHatasi });

export function saveStore() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    kaydetmeHatasi = null;
  } catch (err) {
    /*
     * Depolama dolu ya da kapali olabilir. ESKIDEN SESSIZCE GECILIYORDU:
     * kullanici not aliyor, alarm kuruyor, ayar degistiriyor ve
     * hicbiri kaydedilmiyordu — bunu ancak uygulamayi kapatip acinca
     * anliyordu. Artik bir kez haber veriyoruz.
     */
    const ilkKez = !kaydetmeHatasi;
    kaydetmeHatasi = err?.name === "QuotaExceededError"
      ? "Tarayici deposu dolu: notlar ve ayarlar kaydedilemiyor. Eski notlari silin."
      : "Ayarlar kaydedilemiyor (tarayici depolamasi kapali olabilir). " +
        "Gizli sekmede acmadiginizdan emin olun.";

    if (ilkKez && typeof window !== "undefined") {
      console.error("[dra] kaydedilemedi:", err);
      window.dispatchEvent(new CustomEvent("dra:store-error", {
        detail: { message: kaydetmeHatasi },
      }));
    }
  }
}

/** Her seyi fabrika ayarlarina dondurur. */
export function resetStore() {
  Object.assign(store, structuredClone(DEFAULTS));
  saveStore();
}
