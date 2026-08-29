/**
 * Kucuk durum deposu + olay yolu.
 * DRA'nin tum modulleri buradan haberlesir.
 */

/** Gecerli durumlar. */
export const S = {
  SLEEPING: "sleeping",
  WAKING: "waking",
  IDLE: "idle",        // uyanik, komut bekliyor
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  ERROR: "error",
};

/** Durumun merkezde gosterilecek Turkce etiketi. */
export const STATE_LABEL = {
  [S.SLEEPING]: "UYKUDA",
  [S.WAKING]: "UYANIYOR",
  [S.IDLE]: "HAZIR",
  [S.LISTENING]: "DINLIYOR",
  [S.THINKING]: "DUSUNUYOR",
  [S.SPEAKING]: "KONUSUYOR",
  [S.ERROR]: "HATA",
};

const listeners = new Map();

/** Olaya abone ol. Aboneligi iptal eden fonksiyonu dondurur. */
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

/** Olay yayinla. */
export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[dra] "${event}" dinleyicisi hata verdi:`, err);
    }
  }
}

export const state = {
  current: S.SLEEPING,
  micEnabled: false,
  voiceEnabled: true,
  brainReady: false,
  level: 0,           // 0..1 anlik mikrofon seviyesi
  history: [],        // {role, content} — beyne gonderilen konusma gecmisi
};

/** Durumu degistirir; degisiklikte "state" olayi yayinlanir. */
export function setState(next) {
  if (state.current === next) return;
  const prev = state.current;
  state.current = next;
  document.body.dataset.state = next;
  emit("state", { prev, next });
}

/** Konusma gecmisine bir tur ekler (son 24 tur saklanir). */
export function remember(role, content) {
  if (!content) return;
  state.history.push({ role, content });
  if (state.history.length > 24) state.history.splice(0, state.history.length - 24);
}
