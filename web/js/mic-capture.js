/**
 * Mikrofondan ham ses alir ve gomulu tanima motoruna aktarir.
 *
 * AudioWorklet yerine ScriptProcessorNode kullaniliyor. Worklet daha
 * modern ama ayri bir modul dosyasi yuklemesi gerekiyor; uygulama
 * file:// uzerinden calistigi icin bu yukleme engelleniyor.
 * ScriptProcessor bu is icin fazlasiyla yeterli: saniyede 16 bin ornek,
 * tek kanal, konusma sesi.
 */

const SAMPLE_RATE = 16000;
/** Yaklasik 0.25 saniyelik parcalar — IPC trafigini makul tutar. */
const CHUNK = 4096;

let ctx = null;
let stream = null;
let node = null;
let source = null;
let onChunk = null;

export function capturing() {
  return Boolean(node);
}

/**
 * getUserMedia hatasini KULLANILABILIR bir cumleye cevirir.
 *
 * Onceki hali her hatayi yutup `false` donuyordu. Sonucu: mikrofon
 * acilmiyor ama neden acilmadigi hicbir yerde yazmiyor — kullanicinin
 * elinde hicbir sey kalmiyordu. Hangi hata oldugunu bilmek, ne
 * yapilacagini da belirliyor; o yuzden her biri ayri anlatiliyor.
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
 * Yakalamayi baslatir. Her hazir parca icin `handler(Int16Array)` cagrilir.
 */
export async function startCapture(handler) {
  if (node) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(
      new Error("Bu ortamda mikrofon erisimi yok."),
      { code: "MIC" },
    );
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    // Sessizce false donmek yerine SEBEBI tasiyoruz.
    throw Object.assign(new Error(micError(err)), { code: "MIC", cause: err });
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  // Baglami dogrudan 16 kHz isteyerek acmak, yeniden orneklemeyi
  // tarayiciya birakir; elle desimasyondan hem daha basit hem daha temiz.
  ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  onChunk = handler;
  source = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(CHUNK, 1, 1);

  node.onaudioprocess = (event) => {
    if (!onChunk) return;
    const input = event.inputBuffer.getChannelData(0);
    // Float (-1..1) -> 16-bit tamsayi
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const v = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    onChunk(pcm);
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
  stream?.getTracks().forEach((track) => track.stop());
  ctx?.close().catch(() => {});
  node = null;
  source = null;
  stream = null;
  ctx = null;
}
