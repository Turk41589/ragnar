/**
 * Mikrofonun ham dalga formunu okur.
 * Sadece gorsellestirme icin: reaktor halkalari ve alt serideki dalga
 * bu veriyle canlanir. Ses tanima ayri bir kanaldan (speech.js) yurur.
 */

let ctx = null;
let analyser = null;
let stream = null;
let timeData = null;
let freqData = null;

export async function startMeter() {
  if (analyser) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    return false;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  ctx = new AudioCtx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);

  timeData = new Uint8Array(analyser.fftSize);
  freqData = new Uint8Array(analyser.frequencyBinCount);
  return true;
}

export function stopMeter() {
  stream?.getTracks().forEach((track) => track.stop());
  ctx?.close().catch(() => {});
  ctx = null;
  analyser = null;
  stream = null;
  timeData = null;
  freqData = null;
}

export function meterActive() {
  return Boolean(analyser);
}

/** Anlik yuksekligi 0..1 araliginda dondurur (RMS tabanli). */
export function readLevel() {
  if (!analyser || !timeData) return 0;
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const v = (timeData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeData.length);
  // Konusma sesini gorunur araliga tasimak icin egri uygulanir.
  return Math.min(1, Math.pow(rms * 5.2, 0.75));
}

/** Dalga formu ornekleri (-1..1), `count` adet. */
export function readWave(count = 64) {
  const out = new Float32Array(count);
  if (!analyser || !timeData) return out;
  analyser.getByteTimeDomainData(timeData);
  const step = Math.floor(timeData.length / count) || 1;
  for (let i = 0; i < count; i += 1) {
    out[i] = (timeData[i * step] - 128) / 128;
  }
  return out;
}

/** Frekans bantlari (0..1), `count` adet — reaktor cubuklari icin. */
export function readSpectrum(count = 72) {
  const out = new Float32Array(count);
  if (!analyser || !freqData) return out;
  analyser.getByteFrequencyData(freqData);
  // Insan sesinin yasadigi alt-orta bantlara agirlik ver.
  const usable = Math.floor(freqData.length * 0.55);
  const step = Math.max(1, Math.floor(usable / count));
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    for (let j = 0; j < step; j += 1) sum += freqData[i * step + j] || 0;
    out[i] = sum / step / 255;
  }
  return out;
}
