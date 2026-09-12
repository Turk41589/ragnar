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
  mail: { ready: false },
  youtube: { ready: false },
  apps: {},
};

/** Baglantiyi kurar ve ortam bilgisini alir. */
export async function connect() {
  if (desktop) {
    serverInfo = await bridge(() => window.dra.health());
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

/**
 * Kopruden gelen basarisizligi gercek bir Error'a cevirir.
 *
 * Preload, contextBridge Error'lerin ozel alanlarini sildigi icin
 * basarisizligi duz nesne olarak reddediyor (bkz. preload.cjs). Burada
 * yeniden Error'a ceviriyoruz; boylece cagiran kod iki ortamda da ayni
 * seyi gorur: `err.message`, gerektiginde `err.code` / `err.scope`.
 */
function toError(raw) {
  if (raw instanceof Error) return raw;
  const err = new Error(raw?.message || "Islem basarisiz.");
  if (raw?.code) err.code = raw.code;
  if (raw?.scope) {
    err.scope = raw.scope;
    err.title = raw.title;
    err.detail = raw.detail;
  }
  return err;
}

/** Masaustu koprusune istek atar; hatayi normalize eder. */
async function bridge(fn) {
  try {
    return await fn();
  } catch (raw) {
    throw toError(raw);
  }
}

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
  if (data.ok === false) {
    // Izin eksikliginde hatanin kimligi korunur; cagiran taraf bunu
    // gorup kullaniciya sorabilsin.
    const err = new Error(data.error || "Islem basarisiz.");
    if (data.code) err.code = data.code;
    if (data.scope) {
      err.scope = data.scope;
      err.title = data.title;
      err.detail = data.detail;
    }
    throw err;
  }
  return data;
}

/* ------------------------------------------------------- uygulamalar */

export async function loadApps() {
  try {
    const data = desktop ? await bridge(() => window.dra.apps.list()) : await (await fetch("/api/apps")).json();
    apps = Array.isArray(data.apps) ? data.apps : [];
  } catch {
    apps = [];
  }
  return apps;
}

export const appList = () => apps;

/** Sistemi yeniden tarar. */
export async function scanApps() {
  const data = desktop ? await bridge(() => window.dra.apps.scan()) : await post("/api/apps/scan");
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
  desktop ? bridge(() => window.dra.apps.launch(id)) : post("/api/apps/launch", { id });

export const closeApp = (id) =>
  desktop ? bridge(() => window.dra.apps.close(id)) : post("/api/apps/close", { id });

/* ------------------------------------------------------------- arama */

export async function setSearchEnabled(enabled) {
  const data = desktop
    ? await bridge(() => window.dra.search.setEnabled(enabled))
    : await post("/api/search/toggle", { enabled });
  serverInfo.search = { enabled: data.enabled };
  return data.enabled;
}

export const searchEnabled = () => Boolean(serverInfo.search?.enabled);

export async function webSearch(query) {
  const data = desktop
    ? await bridge(() => window.dra.search.query(query))
    : await post("/api/search", { query });
  return data.result;
}

/* -------------------------------------------------------------- kick */

export async function configureKick(tokenValue, channel) {
  const data = desktop
    ? await bridge(() => window.dra.kick.configure(tokenValue, channel))
    : await post("/api/kick/configure", { token: tokenValue, channel });
  serverInfo.kick = data.status;
  return data.status;
}

export const kickReady = () => Boolean(serverInfo.kick?.ready);

export async function kickAction(action, args = []) {
  const data = desktop
    ? await bridge(() => window.dra.kick.action(action, args))
    : await post("/api/kick/action", { action, args });
  return data.message;
}

/* ------------------------------------------------------------- izinler */

/** Tum yetkiler ve durumlari. */
export async function permissions() {
  const data = desktop ? await bridge(() => window.dra.perm.list()) : await post("/api/permissions");
  return data.permissions || [];
}

export async function grantPermission(scope) {
  return desktop
    ? await bridge(() => window.dra.perm.grant(scope))
    : await post("/api/permissions/grant", { scope });
}

export async function revokePermission(scope) {
  return desktop
    ? await bridge(() => window.dra.perm.revoke(scope))
    : await post("/api/permissions/revoke", { scope });
}

/* --------------------------------------------------------------- rapor */

export async function systemReport() {
  const data = desktop
    ? await bridge(() => window.dra.report.system())
    : await post("/api/report/system");
  return data.report;
}

/* --------------------------------------------------- musteri kaynaklari */

export async function sourceList() {
  return desktop ? await bridge(() => window.dra.sources.list()) : await post("/api/sources");
}

export async function sourceConfigure(id, values) {
  return desktop
    ? await bridge(() => window.dra.sources.configure(id, values))
    : await post("/api/sources/configure", { id, values });
}

export async function sourceTest(id) {
  const data = desktop
    ? await bridge(() => window.dra.sources.test(id))
    : await post("/api/sources/test", { id });
  return data.result;
}

export async function sourceCollect(ids) {
  const data = desktop
    ? await bridge(() => window.dra.sources.collect(ids))
    : await post("/api/sources/collect", { ids });
  return data.result;
}

export async function sourceReply(o) {
  return desktop
    ? await bridge(() => window.dra.sources.reply(o))
    : await post("/api/sources/reply", o);
}

export async function messageList(o = {}) {
  return desktop
    ? await bridge(() => window.dra.messages.list(o))
    : await post("/api/messages", o);
}

export async function messageAdd(from, text) {
  return desktop
    ? await bridge(() => window.dra.messages.add(from, text))
    : await post("/api/messages/add", { from, text });
}

export async function messageMark(id, reply) {
  return desktop
    ? await bridge(() => window.dra.messages.mark(id, reply))
    : await post("/api/messages/mark", { id, reply });
}

/* ------------------------------------------------- otomatik yanit / rapor */

export async function autoreplyList() {
  return desktop ? await bridge(() => window.dra.autoreply.list()) : await post("/api/autoreply");
}

export async function autoreplySetMode(enabled) {
  const d = desktop
    ? await bridge(() => window.dra.autoreply.setMode(enabled))
    : await post("/api/autoreply/toggle-mode", { enabled });
  return d.status;
}

export async function autoreplyAdd(o) {
  const d = desktop
    ? await bridge(() => window.dra.autoreply.add(o))
    : await post("/api/autoreply/add", o);
  return d.rule;
}

export async function autoreplyRemove(id) {
  return desktop
    ? await bridge(() => window.dra.autoreply.remove(id))
    : await post("/api/autoreply/remove", { id });
}

export async function autoreplyToggle(id) {
  return desktop
    ? await bridge(() => window.dra.autoreply.toggle(id))
    : await post("/api/autoreply/toggle", { id });
}

export async function autoreplyRun(dryRun) {
  const d = desktop
    ? await bridge(() => window.dra.autoreply.run(dryRun))
    : await post("/api/autoreply/run", { dryRun });
  return d.result;
}

export async function businessReport(days = 30) {
  const d = desktop
    ? await bridge(() => window.dra.business.report(days))
    : await post("/api/business/report", { days });
  return d.report;
}

/* ------------------------------------------------------------- youtube */

export async function configureYoutube(clientId, clientSecret, refreshToken) {
  const data = desktop
    ? await bridge(() => window.dra.youtube.configure(clientId, clientSecret, refreshToken))
    : await post("/api/youtube/configure", { clientId, clientSecret, refreshToken });
  serverInfo.youtube = data.status;
  return data.status;
}

export const youtubeReady = () => Boolean(serverInfo.youtube?.ready);

/** Tarayiciyi acip kanali baglar (yalnizca uygulama surumunde). */
export async function linkYoutube() {
  if (!desktop) {
    throw new Error("Kanal baglama yalnizca uygulama surumunde yapilabilir.");
  }
  return bridge(() => window.dra.youtube.link());
}

export async function youtubeChannel() {
  const data = desktop
    ? await bridge(() => window.dra.youtube.channel())
    : await post("/api/youtube/channel");
  return data.channel;
}

export function onYoutubeEvent(handler) {
  if (!desktop) return () => {};
  return window.dra.youtube.onEvent(handler);
}

/* ------------------------------------------------------- video deposu */

export async function videoList() {
  return desktop ? await bridge(() => window.dra.videos.list()) : await post("/api/videos");
}

export async function videoAdd(o) {
  const data = desktop
    ? await bridge(() => window.dra.videos.add(o))
    : await post("/api/videos/add", o);
  return data.video;
}

export async function videoRemove(id) {
  return desktop
    ? await bridge(() => window.dra.videos.remove(id))
    : await post("/api/videos/remove", { id });
}

export async function videoUpdate(id, patch) {
  const data = desktop
    ? await bridge(() => window.dra.videos.update(id, patch))
    : await post("/api/videos/update", { id, patch });
  return data.video;
}

/* -------------------------------------------------------------- montaj */

export async function montageStatus() {
  return desktop
    ? await bridge(() => window.dra.montage.status())
    : await post("/api/montage/status");
}

/** Klasor/dosya sectirir (yalnizca uygulama surumunde). */
export async function montagePick(kind) {
  if (!desktop) return null;
  const { path } = await bridge(() => window.dra.montage.pick(kind));
  return path;
}

export async function montageStyle(path) {
  const data = desktop
    ? await bridge(() => window.dra.montage.style(path))
    : await post("/api/montage/style", { path });
  return data.style;
}

export async function montageRender(opts) {
  const data = desktop
    ? await bridge(() => window.dra.montage.render(opts))
    : await post("/api/montage/render", opts);
  return data.result;
}

export function onMontageProgress(handler) {
  if (!desktop) return () => {};
  return window.dra.montage.onProgress(handler);
}

/* ------------------------------------------------------------- e-posta */

export async function configureMail(user, pass, host) {
  const data = desktop
    ? await bridge(() => window.dra.mail.configure(user, pass, host))
    : await post("/api/mail/configure", { user, pass, host });
  serverInfo.mail = data.status;
  return data.status;
}

export const mailReady = () => Boolean(serverInfo.mail?.ready);

export async function mailTest() {
  return desktop ? await bridge(() => window.dra.mail.test()) : await post("/api/mail/test");
}

export async function mailSummary(days = 2) {
  const data = desktop
    ? await bridge(() => window.dra.mail.summary(days))
    : await post("/api/mail/summary", { days });
  return data.summary;
}

/* ----------------------------------------------------- seslendirme (TTS) */

/**
 * ElevenLabs ayarlarini sunucuya/ana surece bildirir.
 * Anahtar burada birakilmaz: istek yapan taraf her zaman o taraftir.
 */
export async function configureTts(apiKey, voiceId, model) {
  const data = desktop
    ? await bridge(() => window.dra.tts.configure(apiKey, voiceId, model))
    : await post("/api/tts/configure", { apiKey, voiceId, model });
  serverInfo.tts = data.status;
  return data.status;
}

export const ttsReady = () => Boolean(serverInfo.tts?.ready);

export async function ttsVoices() {
  const data = desktop
    ? await bridge(() => window.dra.tts.voices())
    : await post("/api/tts/voices");
  return data.voices || [];
}

export async function ttsModels() {
  const data = desktop
    ? await bridge(() => window.dra.tts.models())
    : await post("/api/tts/models");
  return data.models || [];
}

export async function ttsTest() {
  return desktop ? await bridge(() => window.dra.tts.test()) : await post("/api/tts/test");
}

/**
 * Metni seslendirir; ses baytlarini Blob olarak dondurur.
 * ElevenLabs ile konusan taraf hep sunucu/ana surec — arayuz degil.
 */
export async function ttsSpeak(text) {
  const data = desktop
    ? await bridge(() => window.dra.tts.speak(text))
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
  return (await bridge(() => window.dra.window.getAutoStart())).enabled;
}

export async function setAutoStart(enabled) {
  if (!desktop) return false;
  return (await bridge(() => window.dra.window.setAutoStart(enabled))).enabled;
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
