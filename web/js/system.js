/**
 * Sunucu koprusu: tarayicinin tek basina yapamadigi isler.
 *
 * Uygulama baslatma, web aramasi ve Kick moderasyonu tarayici icinden
 * mumkun degil; hepsi kendi makinenizde calisan DRA sunucusuna devredilir.
 * Sunucu bu istekleri yalnizca gecerli oturum jetonuyla kabul eder.
 */

import { normalize, tokenize, scorePhrase } from "./match.js";

let token = null;
let apps = [];
let serverInfo = { platform: null, search: { enabled: false }, kick: { ready: false }, apps: {} };

/** Saglik ucundan jetonu ve sunucu durumunu alir. */
export async function connect() {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Sunucuya ulasilamadi.");
  const data = await res.json();
  token = data.token;
  serverInfo = data;
  return data;
}

export const info = () => serverInfo;
export const connected = () => Boolean(token);

/** Islem yapan uclara istek atar. */
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
    const res = await fetch("/api/apps");
    const data = await res.json();
    apps = Array.isArray(data.apps) ? data.apps : [];
  } catch {
    apps = [];
  }
  return apps;
}

export const appList = () => apps;

/** Sistemi yeniden tarar. */
export async function scanApps() {
  const data = await post("/api/apps/scan");
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

export const launchApp = (id) => post("/api/apps/launch", { id });
export const closeApp = (id) => post("/api/apps/close", { id });

/* ------------------------------------------------------------- arama */

export async function setSearchEnabled(enabled) {
  const data = await post("/api/search/toggle", { enabled });
  serverInfo.search = { enabled: data.enabled };
  return data.enabled;
}

export const searchEnabled = () => Boolean(serverInfo.search?.enabled);

export async function webSearch(query) {
  const data = await post("/api/search", { query });
  return data.result;
}

/* -------------------------------------------------------------- kick */

export async function configureKick(tokenValue, channel) {
  const data = await post("/api/kick/configure", { token: tokenValue, channel });
  serverInfo.kick = data.status;
  return data.status;
}

export const kickReady = () => Boolean(serverInfo.kick?.ready);

export async function kickAction(action, args = []) {
  const data = await post("/api/kick/action", { action, args });
  return data.message;
}
