/**
 * Mikrofondan ham ses alir ve gomulu tanima motoruna aktarir.
 *
 * AudioWorklet yerine ScriptProcessorNode kullaniliyor. Worklet daha
 * modern ama ayri bir modul dosyasi yuklemesi gerekiyor; uygulama
 * file:// uzerinden calistigi icin bu yukleme engelleniyor.
 *
 * TEK AKIS KURALI — onemli:
 * Bir donem seviye gostergesi ve yakalama AYRI AYRI getUserMedia
 * cagiriyordu. Windows'ta ses surucusu ikinci akisi cogu zaman SESSIZ
 * veriyor: gosterge oynuyor ama motora sifirlar gidiyor, yani "ses
 * geliyor ama DRA duymuyor". Artik tek bir akis acilip paylasiliyor.
 */

const SAMPLE_RATE = 16000;
/** Yaklasik 0.25 saniyelik parcalar — IPC trafigini makul tutar. */
const CHUNK = 4096;

let ctx = null;
let node = null;
let source = null;
let onChunk = null;

/* ------------------------------------------------------- paylasilan akis */

let sharedStream = null;
let streamUsers = 0;

/**
 * getUserMedia hatasini KULLANILABILIR bir cumleye cevirir.
 *
 * Her hatayi yutup `false` donmek, mikrofon acilmadiginda kullanicinin
 * elinde hicbir sey birakmiyordu. Hangi hata oldugunu bilmek ne
 * yapilacagini da belirliyor.
 */
export function micError(err) {
  const ad = err?.name || "";

  if (ad === "NotAllowedError" || ad === "SecurityError") {
    return "Mikrofon izni verilmedi. Windows'ta Ayarlar → Gizlilik ve " +
      "guvenlik → Mikrofon bolumunden masaustu uygulamalarina izin verin, " +
      "sonra DRA'yi yeniden baslatin.";
  }
  if (ad === "NotFoundError" || ad === "DevicesNotFoundError") {
    return "Mikrofon bulunamadi. Cihaz takili mi ve Windows ses ayarlarinda " +
      "goruyor musunuz? Bluetooth kulaklik ise once baglanmasini bekleyin.";
  }
  if (ad === "NotReadableError" || ad === "TrackStartError") {
    return "Mikrofona erisilemedi — baska bir uygulama kullaniyor olabilir " +
      "(Zoom, Discord, OBS). Onu kapatip tekrar deneyin.";
  }
  if (ad === "OverconstrainedError") {
    return "Mikrofon istenen ses ayarlarini desteklemiyor. Windows ses " +
      "ayarlarindan baska bir giris cihazi secmeyi deneyin.";
  }
  return err?.message
    ? `Mikrofon acilamadi: ${err.message}`
    : "Mikrofon acilamadi (bilinmeyen sebep).";
}

/**
 * Mikrofon akisini acar. Zaten aciksa AYNISINI dondurur.
 * Kullanan her taraf bitince `releaseStream` cagirmali.
 */
export async function acquireStream() {
  if (sharedStream && sharedStream.getAudioTracks().some((t) => t.readyState === "live")) {
    streamUsers += 1;
    return sharedStream;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("Bu ortamda mikrofon erisimi yok."), { code: "MIC" });
  }

  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw Object.assign(new Error(micError(err)), { code: "MIC", cause: err });
  }

  streamUsers = 1;
  return sharedStream;
}

/** Akisi birakir; son kullanan kapatir. */
export function releaseStream() {
  streamUsers = Math.max(0, streamUsers - 1);
  if (streamUsers === 0 && sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
}

export function capturing() {
  return Boolean(node);
}

/* --------------------------------------------------------------- teshis */

/**
 * Yakalamanin saglik bilgisi.
 *
 * "Ses gidiyor ama cevap yok" sikayetini tahminle degil OLCUMLE
 * ayirt etmek icin: parca geliyor mu, icinde gercekten ses var mi,
 * ornekleme hizi dogru mu?
 */
const health = {
  chunks: 0,
  peak: 0,
  lastChunkAt: 0,
  contextRate: null,
  resampled: false,
};

export function captureHealth() {
  return { ...health, capturing: Boolean(node) };
}

/* ---------------------------------------------------------- ornekleme */

/**
 * Basit dogrusal yeniden ornekleme.
 *
 * AudioContext'ten 16 kHz istiyoruz ama bazi suruculer bunu vermiyor
 * ve baglam 44.1/48 kHz aciliyor. O durumda motora yanlis hizda ses
 * gonderiliyor ve Vosk hicbir sey tanimiyor — ses "geliyor" ama
 * anlasilmiyor. Hizi olcup gerekiyorsa kendimiz indiriyoruz.
 */
function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const oran = fromRate / toRate;
  const uzunluk = Math.floor(input.length / oran);
  const cikti = new Float32Array(uzunluk);
  for (let i = 0; i < uzunluk; i += 1) {
    const bas = Math.floor(i * oran);
    const son = Math.min(input.length, Math.floor((i + 1) * oran));
    // Aradaki ornekleri ortalayarak takma frekanslari azaltiyoruz.
    let toplam = 0;
    for (let j = bas; j < son; j += 1) toplam += input[j];
    cikti[i] = son > bas ? toplam / (son - bas) : input[bas] || 0;
  }
  return cikti;
}

/** Float (-1..1) → 16-bit tamsayi. */
function toPcm16(input) {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const v = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm;
}

/**
 * Yakalamayi baslatir. Her hazir parca icin `handler(Int16Array)` cagrilir.
 */
export async function startCapture(handler) {
  if (node) return true;

  const stream = await acquireStream();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  // 16 kHz istiyoruz; surucu vermezse asagida kendimiz indiriyoruz.
  try {
    ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
  } catch {
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  health.chunks = 0;
  health.peak = 0;
  health.lastChunkAt = 0;
  health.contextRate = ctx.sampleRate;
  health.resampled = ctx.sampleRate !== SAMPLE_RATE;

  onChunk = handler;
  source = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(CHUNK, 1, 1);

  node.onaudioprocess = (event) => {
    if (!onChunk) return;
    const input = event.inputBuffer.getChannelData(0);

    // Teshis: gercekten ses var mi?
    let tepe = 0;
    for (let i = 0; i < input.length; i += 1) {
      const m = Math.abs(input[i]);
      if (m > tepe) tepe = m;
    }
    health.chunks += 1;
    health.lastChunkAt = Date.now();
    if (tepe > health.peak) health.peak = tepe;

    const hizli = health.resampled
      ? downsample(input, ctx.sampleRate, SAMPLE_RATE)
      : input;
    onChunk(toPcm16(hizli));
  };

  source.connect(node);
  // ScriptProcessor'un calismasi icin bir cikisa baglanmasi gerekiyor.
  // Sessiz bir kazanc dugumu kullaniyoruz ki hoparlorden ses cikmasin.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(silent);
  silent.connect(ctx.destination);

  return true;
}

export function stopCapture() {
  onChunk = null;
  try {
    node?.disconnect();
    source?.disconnect();
  } catch {
    /* onemsiz */
  }
  ctx?.close().catch(() => {});
  node = null;
  source = null;
  ctx = null;
  releaseStream();
}
