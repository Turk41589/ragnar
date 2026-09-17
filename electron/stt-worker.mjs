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
  }

  /*
   * GUNLUKLERI SUSTURMUYORUZ — en azindan model yuklenene kadar.
   *
   * Eskiden burada setLogLevel(-1) vardi. Vosk basarisiz bir yuklemenin
   * SEBEBINI stderr'e yaziyor ("Folder '...' does not contain model
   * files" gibi) ve biz tam o mesaji susturuyorduk. Geriye yalnizca bir
   * cokme kodu kaliyordu.
   */
  vosk.setLogLevel?.(0);

  model = new vosk.Model(modelPath);

  /*
   * EN ONEMLI KONTROL.
   *
   * `vosk_model_new` basarisiz oldugunda HATA FIRLATMIYOR — NULL
   * donduruyor ve yoluna devam ediyor. Sonraki satirdaki Recognizer o
   * NULL'u yerel kodda cozmeye calisiyor ve surec aninda cokuyor:
   * Windows'ta 0xC0000005 erisim ihlali (kod 3221225477), Linux'ta
   * SIGSEGV. Kullanicinin gordugu sey anlamsiz bir sayi oluyordu.
   *
   * Bu yuzden Recognizer'a gecmeden ONCE bakiyoruz. Model neden
   * yuklenmemis olursa olsun (yol bulunamadi, dosyalar okunamadi,
   * yolda Vosk'un cozemedigi karakterler var) artik anlasilir bir
   * hata donuyor.
   */
  if (!model.handle) {
    model = null;
    throw new Error(
      `Ses modeli yuklenemedi.\nDenenen yol: ${modelPath}\n` +
        "Klasor okunabiliyor mu ve icinde model dosyalari var mi?",
    );
  }

  recognizer = new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });

  // Ayni tuzak burada da var: Recognizer da NULL donebiliyor.
  if (!recognizer.handle) {
    recognizer = null;
    throw new Error("Ses tanimlayici kurulamadi (model yuklendi ama tanimlayici acilmadi).");
  }

  // Model yuklendi; bundan sonraki gunlukler yalnizca gurultu.
  vosk.setLogLevel?.(-1);

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
