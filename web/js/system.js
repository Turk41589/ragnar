/**
 * Sunucu koprusu: tarayicinin tek basina yapamadigi isler.
 *
 * Uygulama baslatma, web aramasi ve Kick moderasyonu tarayici icinden
 * mumkun degil; hepsi kendi makinenizde calisan DRA sunucusuna devredilir.
 * Sunucu bu istekleri yalnizca gecerli oturum jetonuyla kabul eder.
 */

import { normalize, tokenize, scorePhrase } from "./match.js";

/**
 * Iki ortam, tek arayuz.
 *
 * Masaustu uygulamasinda (Electron) makineye erisim IPC ile yapilir:
 * ortada dinlenecek bir port, korunacak bir jeton yoktur.
 * Tarayicida ise ayni isler yerel HTTP sunucusuna gider.
 *
 * Bu modulun disindaki hicbir kod farki bilmez.
 */
const desktop = typeof window !== "undefined" && window.dra?.desktop === true;

export const isDesktop = () => desktop;

let token = null;
let apps = [];
let serverInfo = {
  platform: null,
  search: { enabled: false },
  kick: { ready: false },
  tts: { ready: false },
  apps: {},
};

/** Baglantiyi kurar ve ortam bilgisini alir. */
export async function connect() {
  if (desktop) {
    serverInfo = await window.dra.health();
    return serverInfo;
  }
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Sunucuya ulasilamadi.");
  const data = await res.json();
  token = data.token;
  serverInfo = data;
  return data;
}

export const info = () => serverInfo;
export const connected = () => desktop || Boolean(token);

/** Tarayici surumunde islem yapan uclara istek atar. */
async function post(path, body = {}) {
  if (!token) throw new Error("Sunucu baglantisi yok. Sayfayi yenileyin.");
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dra-token": token },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Sunucu ${res.status} dondu.`);
  if (data.ok === false) throw new Error(data.error || "Islem basarisiz.");
  return data;
}

/* ------------------------------------------------------- uygulamalar */

export async function loadApps() {
  try {
    const data = desktop ? await window.dra.apps.list() : await (await fetch("/api/apps")).json();
    apps = Array.isArray(data.apps) ? data.apps : [];
  } catch {
    apps = [];
  }
  return apps;
}

export const appList = () => apps;

/** Sistemi yeniden tarar. */
export async function scanApps() {
  const data = desktop ? await window.dra.apps.scan() : await post("/api/apps/scan");
  apps = data.apps || [];
  return apps;
}

/**
 * Soylenen adi kurulu uygulamalarla eslestirir.
 *
 * Esik yuksek tutuldu: yanlis duyulan bir kelime yanlis programi
 * acmasin. Emin olunamayan durumda null doner ve DRA sorar.
 */
export function findApp(query) {
  const n = normalize(query);
  if (!n || !apps.length) return null;

  const tokens = tokenize(n);
  let best = null;
  let bestScore = 0;

  for (const app of apps) {
    const score = scorePhrase(tokens, normalize(app.name));
    // Kisa adlar tam tutmali; uzun adlarda kismi eslesme kabul edilir.
    if (score > bestScore) {
      bestScore = score;
      best = app;
    }
  }

  return bestScore >= 0.8 ? { app: best, score: bestScore } : null;
}

export const launchApp = (id) =>
  desktop ? window.dra.apps.launch(id) : post("/api/apps/launch", { id });

export const closeApp = (id) =>
  desktop ? window.dra.apps.close(id) : post("/api/apps/close", { id });

/* ------------------------------------------------------------- arama */

export async function setSearchEnabled(enabled) {
  const data = desktop
    ? await window.dra.search.setEnabled(enabled)
    : await post("/api/search/toggle", { enabled });
  serverInfo.search = { enabled: data.enabled };
  return data.enabled;
}

export const searchEnabled = () => Boolean(serverInfo.search?.enabled);

export async function webSearch(query) {
  const data = desktop
    ? await window.dra.search.query(query)
    : await post("/api/search", { query });
  return data.result;
}

/* -------------------------------------------------------------- kick */

export async function configureKick(tokenValue, channel) {
  const data = desktop
    ? await window.dra.kick.configure(tokenValue, channel)
    : await post("/api/kick/configure", { token: tokenValue, channel });
  serverInfo.kick = data.status;
  return data.status;
}

export const kickReady = () => Boolean(serverInfo.kick?.ready);

export async function kickAction(action, args = []) {
  const data = desktop
    ? await window.dra.kick.action(action, args)
    : await post("/api/kick/action", { action, args });
  return data.message;
}

/* ----------------------------------------------------- seslendirme (TTS) */

/**
 * ElevenLabs ayarlarini sunucuya/ana surece bildirir.
 * Anahtar burada birakilmaz: istek yapan taraf her zaman o taraftir.
 */
export async function configureTts(apiKey, voiceId, model) {
  const data = desktop
    ? await window.dra.tts.configure(apiKey, voiceId, model)
    : await post("/api/tts/configure", { apiKey, voiceId, model });
  serverInfo.tts = data.status;
  return data.status;
}

export const ttsReady = () => Boolean(serverInfo.tts?.ready);

export async function ttsVoices() {
  const data = desktop
    ? await window.dra.tts.voices()
    : await post("/api/tts/voices");
  return data.voices || [];
}

export async function ttsModels() {
  const data = desktop
    ? await window.dra.tts.models()
    : await post("/api/tts/models");
  return data.models || [];
}

export async function ttsTest() {
  return desktop ? await window.dra.tts.test() : await post("/api/tts/test");
}

/**
 * Metni seslendirir; ses baytlarini Blob olarak dondurur.
 * ElevenLabs ile konusan taraf hep sunucu/ana surec — arayuz degil.
 */
export async function ttsSpeak(text) {
  const data = desktop
    ? await window.dra.tts.speak(text)
    : await post("/api/tts/speak", { text });

  const ikili = atob(data.audio);
  const bytes = new Uint8Array(ikili.length);
  for (let i = 0; i < ikili.length; i += 1) bytes[i] = ikili.charCodeAt(i);
  return {
    blob: new Blob([bytes], { type: data.type || "audio/mpeg" }),
    truncated: Boolean(data.truncated),
  };
}

/* --------------------------------------------------- masaustu ozellikleri */

/** Acilista baslatma (yalnizca masaustu surumunde). */
export async function getAutoStart() {
  if (!desktop) return null;
  return (await window.dra.window.getAutoStart()).enabled;
}

export async function setAutoStart(enabled) {
  if (!desktop) return false;
  return (await window.dra.window.setAutoStart(enabled)).enabled;
}

/** Uygulama gizli mi baslatildi? (bilgisayar acilisinda) */
export const hiddenLaunch = () => Boolean(serverInfo.hiddenLaunch);

/** Pencereyi gosterir — DRA adini duyunca kendini one cikarir. */
export function showWindow() {
  if (!desktop) return;
  window.dra.window.show();
}

/** Pencereyi tepsiye indirir. */
export function hideWindow() {
  if (!desktop) return;
  window.dra.window.hide();
}

/** Ana surecten gelen olaylara abone olur (kisayol tusu, tepsi menusu). */
export function onDesktopEvent(event, handler) {
  if (!desktop) return () => {};
  return window.dra.on(event, handler);
}
