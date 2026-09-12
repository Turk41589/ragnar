/**
 * Yalitim koprusu.
 *
 * Arayuz kodu Node'a dogrudan erisemez. Yalnizca burada acikca listelenen
 * islevleri gorur. Boylece arayuzde bir acik olsa bile makineye erisim
 * bu dar yuzeyle sinirli kalir.
 */

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ana surece istek atar.
 *
 * DIKKAT — hata neden Error DEGIL de duz nesne:
 * contextBridge, dunyalar arasinda gecen Error nesnelerini sadelestirir
 * ve UZERINE EKLENEN ALANLARI SILER. Yani `err.code = "..."` yazsak
 * arayuz tarafinda yalnizca mesaj kalir; izin eksikligi sradan bir
 * hatadan ayirt edilemez. Duz nesneler ise oldugu gibi geciyor, bu
 * yuzden basarisizligi VERI olarak reddediyoruz.
 *
 * Arayuz tarafinda system.js bunu tekrar gercek bir Error'a cevirir;
 * geri kalan kod farki gormez (`err.message` her iki durumda da calisir).
 */
const call = (channel, payload) =>
  ipcRenderer.invoke(channel, payload).then((res) => {
    if (res && res.ok === false) {
      return Promise.reject({
        message: res.error || "Islem basarisiz.",
        ...(res.code ? { code: res.code } : {}),
        ...(res.scope ? { scope: res.scope, title: res.title, detail: res.detail } : {}),
      });
    }
    return res;
  });

contextBridge.exposeInMainWorld("dra", {
  /** Arayuz, masaustu uygulamasinda mi calistigini buradan anlar. */
  desktop: true,
  version: process.versions.electron,

  health: () => call("dra:health"),

  apps: {
    list: () => call("dra:apps:list"),
    scan: () => call("dra:apps:scan"),
    launch: (id) => call("dra:apps:launch", { id }),
    close: (id) => call("dra:apps:close", { id }),
  },

  search: {
    setEnabled: (enabled) => call("dra:search:toggle", { enabled }),
    query: (q) => call("dra:search", { query: q }),
  },

  kick: {
    configure: (token, channel) => call("dra:kick:configure", { token, channel }),
    action: (action, args) => call("dra:kick:action", { action, args }),
  },

  /** Erisim izinleri — her yetki ayri ayri verilir, geri alinabilir. */
  perm: {
    list: () => call("dra:perm:list"),
    grant: (scope) => call("dra:perm:grant", { scope }),
    revoke: (scope) => call("dra:perm:revoke", { scope }),
  },

  /** Bilgisayar raporu (izin gerektirir). */
  report: {
    system: () => call("dra:report:system"),
  },

  /** Musteri mesaji kaynaklari (izin gerektirir). */
  sources: {
    list: () => call("dra:sources:list"),
    configure: (id, values) => call("dra:sources:configure", { id, values }),
    test: (id) => call("dra:sources:test", { id }),
    collect: (ids) => call("dra:sources:collect", { ids }),
    reply: (o) => call("dra:sources:reply", o),
  },

  messages: {
    list: (o) => call("dra:messages:list", o),
    add: (from, text) => call("dra:messages:add", { from, text }),
    mark: (id, reply) => call("dra:messages:mark", { id, reply }),
  },

  /** Otomatik yanit ve isletme raporlari (izin gerektirir). */
  autoreply: {
    list: () => call("dra:auto:list"),
    setMode: (enabled) => call("dra:auto:mode", { enabled }),
    add: (o) => call("dra:auto:add", o),
    remove: (id) => call("dra:auto:remove", { id }),
    toggle: (id) => call("dra:auto:toggle", { id }),
    run: (dryRun) => call("dra:auto:run", { dryRun }),
  },

  business: {
    report: (days) => call("dra:business:report", { days }),
  },

  /** YouTube kanali ve stok video deposu (izin gerektirir). */
  youtube: {
    configure: (clientId, clientSecret, refreshToken) =>
      call("dra:yt:configure", { clientId, clientSecret, refreshToken }),
    link: () => call("dra:yt:link"),
    channel: () => call("dra:yt:channel"),
    onEvent: (handler) => {
      const listener = (_e, data) => handler(data);
      ipcRenderer.on("dra:yt:event", listener);
      return () => ipcRenderer.removeListener("dra:yt:event", listener);
    },
  },

  videos: {
    list: () => call("dra:videos:list"),
    add: (o) => call("dra:videos:add", o),
    remove: (id) => call("dra:videos:remove", { id }),
    update: (id, patch) => call("dra:videos:update", { id, patch }),
  },

  /** Video montaji (izin gerektirir). */
  montage: {
    status: () => call("dra:montage:status"),
    pick: (kind) => call("dra:montage:pick", { kind }),
    style: (path) => call("dra:montage:style", { path }),
    render: (opts) => call("dra:montage:render", opts),
    onProgress: (handler) => {
      const listener = (_e, data) => handler(data);
      ipcRenderer.on("dra:montage:progress", listener);
      return () => ipcRenderer.removeListener("dra:montage:progress", listener);
    },
  },

  /** E-posta raporu (izin gerektirir). */
  mail: {
    configure: (user, pass, host) => call("dra:mail:configure", { user, pass, host }),
    test: () => call("dra:mail:test"),
    summary: (days) => call("dra:mail:summary", { days }),
  },

  /** Piper: cihazda calisan ucretsiz seslendirme. */
  piper: {
    configure: (bin, voice) => call("dra:piper:configure", { bin, voice }),
    test: () => call("dra:piper:test"),
    speak: (text) => call("dra:piper:speak", { text }),
    pick: (kind) => call("dra:piper:pick", { kind }),
  },

  /** ElevenLabs seslendirmesi (istege bagli). */
  tts: {
    configure: (apiKey, voiceId, model) => call("dra:tts:configure", { apiKey, voiceId, model }),
    voices: () => call("dra:tts:voices"),
    models: () => call("dra:tts:models"),
    test: () => call("dra:tts:test"),
    speak: (text) => call("dra:tts:speak", { text }),
  },

  /** Gomulu ses tanima. */
  stt: {
    status: () => call("dra:stt:status"),
    install: () => call("dra:stt:install"),
    useFolder: (path) => call("dra:stt:use-folder", { path }),
    pickFolder: () => call("dra:stt:pick-folder"),
    inspect: () => call("dra:stt:inspect"),
    start: () => call("dra:stt:start"),
    stop: () => call("dra:stt:stop"),
    /** Ses parcasi gonderir (16 kHz, tek kanal, 16-bit). */
    feed: (int16) => ipcRenderer.send("dra:stt:feed", int16),
    /** Tanima sonuclarina abone olur. */
    onResult: (handler) => {
      const listener = (_e, data) => handler(data);
      ipcRenderer.on("dra:stt:result", listener);
      return () => ipcRenderer.removeListener("dra:stt:result", listener);
    },
    /** Motor olaylari (cokme, hata). */
    onEngine: (handler) => {
      const listener = (_e, data) => handler(data);
      ipcRenderer.on("dra:stt:engine", listener);
      return () => ipcRenderer.removeListener("dra:stt:engine", listener);
    },
    /** Model indirme ilerlemesi. */
    onProgress: (handler) => {
      const listener = (_e, data) => handler(data);
      ipcRenderer.on("dra:stt:progress", listener);
      return () => ipcRenderer.removeListener("dra:stt:progress", listener);
    },
  },

  window: {
    minimize: () => ipcRenderer.send("dra:window:minimize"),
    close: () => ipcRenderer.send("dra:window:close"),
    show: () => ipcRenderer.send("dra:window:show"),
    hide: () => ipcRenderer.send("dra:window:hide"),
    setAutoStart: (enabled) => call("dra:autostart", { enabled }),
    getAutoStart: () => call("dra:autostart:get"),
  },

  /** Ana surecten gelen olaylar (kisayol tusu, tepsi menusu). */
  on: (event, handler) => {
    const allowed = ["dra:wake", "dra:sleep", "dra:toggle-mic"];
    if (!allowed.includes(event)) return () => {};
    const listener = () => handler();
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
