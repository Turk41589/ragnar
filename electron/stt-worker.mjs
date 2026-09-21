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

async function init(modelPath, dilbilgisi) {
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

  tanimlayiciKur(dilbilgisi);

  // Model yuklendi; bundan sonraki gunlukler yalnizca gurultu.
  vosk.setLogLevel?.(-1);
  send({ type: "ready", grammar: Boolean(sonDilbilgisi) });
}

/** Son kullanilan sozcuk listesi; yeniden kurarken lazim. */
let sonDilbilgisi = null;

/**
 * Tanimlayiciyi kurar.
 *
 * DILBILGISI (sinirli sozcuk listesi) verilirse Vosk yalnizca o
 * sozcukleri duyabiliyor. Kucuk modeller serbest konusmada zayif:
 * kullanici "dra" diyor, model Turkcedeki butun sozcukler arasindan
 * secim yaptigi icin "bira" duyuyordu. Liste verilince o karisiklik
 * ortadan kalkiyor.
 *
 * Liste bos ya da yoksa normal (serbest) kip.
 */
function tanimlayiciKur(dilbilgisi) {
  // Eskisini birak: model sayaci tutuyor, bosa yer kaplamasin.
  try {
    recognizer?.free();
  } catch {
    /* zaten kapali olabilir */
  }
  recognizer = null;

  const liste = Array.isArray(dilbilgisi) ? dilbilgisi.filter(Boolean) : null;
  sonDilbilgisi = liste && liste.length ? liste : null;

  const secenekler = { model, sampleRate: SAMPLE_RATE };
  if (sonDilbilgisi) {
    /*
     * "[unk]" SART: listede olmayan bir sey duyulursa Vosk bunu
     * isaretleyebilsin. Olmazsa duydugu her sesi listedeki en yakin
     * sozcuge zorluyor ve saglam olmayan sonuclar uretiyor.
     */
    secenekler.grammar = [...sonDilbilgisi, "[unk]"];
  }

  recognizer = new vosk.Recognizer(secenekler);

  // Ayni tuzak burada da var: Recognizer da NULL donebiliyor.
  if (!recognizer.handle) {
    recognizer = null;
    throw new Error("Ses tanimlayici kurulamadi (model yuklendi ama tanimlayici acilmadi).");
  }

  try {
    recognizer.setWords(false);
  } catch {
    /* bu surumde yoksa onemli degil */
  }
}

/*
 * SONUCLAR ZATEN COZULMUS GELIYOR.
 *
 * `result()`, `partialResult()` ve `finalResult()` kutuphanenin kendi
 * icinde JSON.parse'dan geciyor ve NESNE donduruyor. Eskiden ustune bir
 * daha JSON.parse cagiriyordum; nesne once metne cevriliyor ve
 * "[object Object]" ayristirilmaya calisiliyordu:
 *
 *     Ses motoru hata verdi: "[object Object]" is not valid JSON
 *
 * Metin isteyen tek fonksiyon `resultString()`. Asagidaki yardimcilar
 * ikisini de kabul ediyor ki kutuphane surum degistirirse kirilmasin.
 */
export function metniAl(sonuc, alan) {
  if (sonuc === null || sonuc === undefined) return "";

  // Nesne: dogrudan oku.
  if (typeof sonuc === "object") return String(sonuc[alan] ?? "").trim();

  // Metin: JSON olabilir.
  if (typeof sonuc === "string") {
    const ham = sonuc.trim();
    if (!ham) return "";
    try {
      return String(JSON.parse(ham)?.[alan] ?? "").trim();
    } catch {
      // JSON degilse elimizdeki metni bozuk sayip atiyoruz; cagiran
      // tarafta cokme olmasin.
      return "";
    }
  }

  return "";
}

/**
 * "[unk]" isaretini temizler.
 *
 * Sinirli sozcuk listesi kipinde Vosk, listede olmayan sesleri "[unk]"
 * olarak isaretliyor. Bu bir sozcuk degil; komut olarak islenirse
 * anlamsiz sonuclar cikiyor.
 */
function ayikla(metin) {
  return String(metin || "")
    .replace(/\[unk\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function feed(pcm) {
  if (!recognizer) return;
  const buffer = Buffer.from(pcm.buffer || pcm, pcm.byteOffset || 0, pcm.byteLength || pcm.length);

  if (recognizer.acceptWaveform(buffer)) {
    const text = ayikla(metniAl(recognizer.result(), "text"));
    if (text) send({ type: "result", final: text });
    return;
  }

  const partial = ayikla(metniAl(recognizer.partialResult(), "partial"));
  if (partial) send({ type: "result", partial });
}

function reset() {
  if (!recognizer) return;
  const text = ayikla(metniAl(recognizer.finalResult(), "text"));
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
    if (message.type === "init") await init(message.modelPath, message.grammar);
    else if (message.type === "grammar") {
      // Model yerinde kaliyor (pahali olan o); yalnizca tanimlayici
      // yeniden kuruluyor.
      if (model) {
        tanimlayiciKur(message.words);
        send({ type: "grammar", active: Boolean(sonDilbilgisi) });
      }
    }
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
