/**
 * Ses tanima isci sureci.
 *
 * Vosk yerel (native) kod calistirir. Yerel kodda olusan bir cokme
 * JavaScript hatasi degildir — try/catch yakalayamaz ve icinde bulundugu
 * surecin tamamini oldurur. Bu yuzden Vosk burada, ayri bir surecte
 * calisiyor: coktugunde yalnizca bu isci olur, uygulama ayakta kalir ve
 * kullaniciya ne oldugunu soyleyebilir.
 *
 * Protokol (ana surecle):
 *   gelen : {type:"init", modelPath} | {type:"feed", pcm} | {type:"reset"} | {type:"close"}
 *   giden : {type:"ready"} | {type:"result", partial|final} | {type:"error", message}
 */

const SAMPLE_RATE = 16000;

let vosk = null;
let model = null;
let recognizer = null;

/** Ana surece mesaj yollar. */
function send(message) {
  process.parentPort?.postMessage(message);
}

function fail(message) {
  send({ type: "error", message });
}

async function init(modelPath) {
  if (!vosk) {
    const mod = await import("vosk-koffi");
    vosk = mod.default || mod;
    // Vosk'un kendi gunlukleri isci ciktisini bogmasin.
    vosk.setLogLevel?.(-1);
  }

  model = new vosk.Model(modelPath);
  recognizer = new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });
  // Kelime zamanlamalari gerekmiyor; kapatmak isi hafifletiyor.
  try {
    recognizer.setWords(false);
  } catch {
    /* bu surumde yoksa onemli degil */
  }
  send({ type: "ready" });
}

function feed(pcm) {
  if (!recognizer) return;
  const buffer = Buffer.from(pcm.buffer || pcm, pcm.byteOffset || 0, pcm.byteLength || pcm.length);

  if (recognizer.acceptWaveform(buffer)) {
    const text = (JSON.parse(recognizer.result())?.text || "").trim();
    if (text) send({ type: "result", final: text });
    return;
  }

  const partial = (JSON.parse(recognizer.partialResult())?.partial || "").trim();
  if (partial) send({ type: "result", partial });
}

function reset() {
  if (!recognizer) return;
  const text = (JSON.parse(recognizer.finalResult())?.text || "").trim();
  if (text) send({ type: "result", final: text });
}

function close() {
  try {
    recognizer?.free();
    model?.free();
  } catch {
    /* kapanirken olusan hatalar onemsiz */
  }
  recognizer = null;
  model = null;
  process.exit(0);
}

process.parentPort?.on("message", async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message.modelPath);
    else if (message.type === "feed") feed(message.pcm);
    else if (message.type === "reset") reset();
    else if (message.type === "close") close();
  } catch (err) {
    fail(err?.message || String(err));
  }
});

// Yakalanmamis hatalar da ana surece bildirilsin; sessizce olmesin.
process.on("uncaughtException", (err) => fail(`isci hatasi: ${err?.message || err}`));
process.on("unhandledRejection", (err) => fail(`isci hatasi: ${err?.message || err}`));
