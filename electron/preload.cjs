/**
 * Yalitim koprusu.
 *
 * Arayuz kodu Node'a dogrudan erisemez. Yalnizca burada acikca listelenen
 * islevleri gorur. Boylece arayuzde bir acik olsa bile makineye erisim
 * bu dar yuzeyle sinirli kalir.
 */

const { contextBridge, ipcRenderer } = require("electron");

/** Ana surece istek atar; hata mesajlarini duz metne cevirir. */
const call = (channel, payload) =>
  ipcRenderer.invoke(channel, payload).then((res) => {
    if (res && res.ok === false) throw new Error(res.error || "Islem basarisiz.");
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

  window: {
    minimize: () => ipcRenderer.send("dra:window:minimize"),
    close: () => ipcRenderer.send("dra:window:close"),
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
