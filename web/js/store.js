/**
 * Kalici veri: notlar, alarmlar ve ayarlar.
 * Hepsi tarayicinin localStorage'inda durur — sunucuya hicbir sey gitmez.
 */

const KEY = "dra.state.v2";
const LEGACY_KEY = "dra.state.v1";

/** Varsayilan ayarlar. */
const DEFAULTS = {
  voiceEnabled: true,
  speechRate: 1.05,
  bootSequence: true,
  autoSleepMinutes: 2.5, // 0 = otomatik uyku kapali
  theme: [53, 230, 255],
  extraWakeWords: [],
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

export function saveStore() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* depolama kapali olabilir */
  }
}

/** Her seyi fabrika ayarlarina dondurur. */
export function resetStore() {
  Object.assign(store, structuredClone(DEFAULTS));
  saveStore();
}
