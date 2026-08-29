/**
 * Reaktor: DRA'nin merkezindeki JARVIS tarzi halka animasyonu.
 *
 * Cizim tamamen canvas uzerinde yapilir ve uygulama durumuna gore davranir:
 *  - idle       : yavas donen halkalar, nefes alan cekirdek
 *  - listening  : mikrofondan gelen spektrum halkayi besler
 *  - thinking   : hizli donus + radar taramasi
 *  - speaking   : konusma temposunu taklit eden dalga halkasi
 */

import { S, state } from "./state.js";
import { readSpectrum, readWave, meterActive } from "./audio.js";

const TAU = Math.PI * 2;

/** CSS degiskeninden tema rengini okur (renk komutu ile degisebilir). */
function readAccent() {
  const css = getComputedStyle(document.documentElement);
  const r = Number(css.getPropertyValue("--hue-r")) || 53;
  const g = Number(css.getPropertyValue("--hue-g")) || 230;
  const b = Number(css.getPropertyValue("--hue-b")) || 255;
  return { r, g, b };
}

function rgba({ r, g, b }, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Canvas'i cihaz piksel oranina gore olceklendirir. */
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

/**
 * Sabit tik halkasi her karede 120 cizgi demek. Boyut ya da renk
 * degismedikce ayni goruntuyu yeniden uretmenin anlami yok — bir kez
 * cizip onbellekten basiyoruz.
 */
function buildTickRing(size, R, dpr, accent) {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const c = off.getContext("2d");
  c.translate(size / 2, size / 2);
  c.lineWidth = 1 * dpr;
  for (let i = 0; i < 120; i += 1) {
    const a = (i / 120) * TAU - Math.PI / 2;
    const major = i % 10 === 0;
    const len = (major ? 12 : 5) * dpr;
    c.strokeStyle = rgba(accent, major ? 0.5 : 0.18);
    c.beginPath();
    c.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    c.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
    c.stroke();
  }
  return off;
}

export function mountReactor(canvas) {
  const ctx = canvas.getContext("2d");
  let accent = readAccent();
  let accentAge = 0;
  let tickRing = null;
  let tickKey = "";

  // Yumusatilmis degerler — ani sicramalari onler.
  let smoothLevel = 0;
  let spin = 0;
  let sweep = 0;
  let speakPhase = 0;

  const bars = new Float32Array(56);
  const orbit = Array.from({ length: 5 }, (_, i) => ({
    r: 0.62 + i * 0.055,
    speed: (i % 2 ? -1 : 1) * (0.14 + i * 0.05),
    phase: (i / 5) * TAU,
  }));

  function draw(time) {
    const dpr = fitCanvas(canvas);
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 4 * dpr;

    // Canvas gizliyken ya da cok kucukken cizim yapma: negatif yaricap
    // canvas API'sinde hata firlatir.
    if (R < 8) {
      requestAnimationFrame(draw);
      return;
    }

    // Tema rengini saniyede bir tazele (surekli okumak pahali).
    if (time - accentAge > 900) {
      accent = readAccent();
      accentAge = time;
    }

    ctx.clearRect(0, 0, w, h);

    const st = state.current;
    const busy = st === S.THINKING;
    const listening = st === S.LISTENING;
    const speaking = st === S.SPEAKING;
    const asleep = st === S.SLEEPING || st === S.WAKING;

    // --- kaynak sinyal ------------------------------------------------
    const live = meterActive() && (listening || st === S.IDLE);
    const rawLevel = live ? state.level : 0;
    smoothLevel += (rawLevel - smoothLevel) * 0.18;

    spin += busy ? 0.016 : asleep ? 0.0018 : 0.0045;
    sweep += busy ? 0.055 : 0.012;
    speakPhase += speaking ? 0.22 : 0.05;

    const baseAlpha = asleep ? 0.35 : 1;
    const pulse = 0.5 + 0.5 * Math.sin(time / (busy ? 220 : 1100));

    // --- 1. dis tik halkasi (onbellekli) ------------------------------
    const key = `${w}x${h}|${accent.r},${accent.g},${accent.b}`;
    if (key !== tickKey) {
      tickRing = buildTickRing(Math.min(w, h), R, dpr, accent);
      tickKey = key;
    }
    ctx.globalAlpha = baseAlpha;
    ctx.drawImage(tickRing, cx - tickRing.width / 2, cy - tickRing.height / 2);
    ctx.globalAlpha = 1;

    // --- 2. donen kesik halka -----------------------------------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.strokeStyle = rgba(accent, 0.32 * baseAlpha);
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([2 * dpr, 9 * dpr]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.9, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // --- 3. ters yonde donen kalin yaylar ------------------------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-spin * 1.7);
    ctx.lineCap = "round";
    ctx.lineWidth = 2.5 * dpr;
    for (let i = 0; i < 3; i += 1) {
      const start = (i / 3) * TAU;
      ctx.strokeStyle = rgba(accent, (0.75 - i * 0.16) * baseAlpha);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.82, start, start + TAU * 0.17);
      ctx.stroke();
    }
    ctx.restore();

    // --- 4. spektrum cubuklari ----------------------------------------
    const spectrum = live ? readSpectrum(bars.length) : null;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    for (let i = 0; i < bars.length; i += 1) {
      let target = 0;
      if (spectrum) {
        target = spectrum[i];
      } else if (speaking) {
        // TTS sesine erisemiyoruz; konusma temposunu taklit ediyoruz.
        target =
          0.28 +
          0.3 * Math.abs(Math.sin(speakPhase + i * 0.34)) +
          0.16 * Math.abs(Math.sin(speakPhase * 0.53 + i * 0.11));
      } else if (busy) {
        target = 0.16 + 0.2 * Math.abs(Math.sin(time / 300 + i * 0.45));
      } else {
        target = 0.05 + 0.04 * Math.sin(time / 900 + i * 0.3);
      }
      bars[i] += (target - bars[i]) * 0.24;

      const a = (i / bars.length) * TAU;
      const inner = R * 0.62;
      const outer = inner + bars[i] * R * 0.16;
      ctx.strokeStyle = rgba(accent, (0.25 + bars[i] * 0.75) * baseAlpha);
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();

    // --- 5. dairesel osiloskop ----------------------------------------
    const wave = live ? readWave(128) : null;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.strokeStyle = rgba(accent, 0.7 * baseAlpha);
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    const N = 96;
    for (let i = 0; i <= N; i += 1) {
      const idx = i % N;
      let v;
      if (wave) v = wave[idx] * 1.4;
      else if (speaking) v = 0.42 * Math.sin(speakPhase * 1.6 + idx * 0.29) * Math.sin(speakPhase * 0.4);
      else v = 0.06 * Math.sin(time / 700 + idx * 0.24);

      const a = (idx / N) * TAU;
      const r = R * 0.5 + v * R * 0.09;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // --- 6. radar taramasi (dusunurken) -------------------------------
    if (busy) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweep);
      const grad = ctx.createLinearGradient(0, 0, R * 0.78, 0);
      grad.addColorStop(0, rgba(accent, 0));
      grad.addColorStop(1, rgba(accent, 0.55));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R * 0.78, 0);
      ctx.stroke();
      ctx.restore();
    }

    // --- 7. yorunge noktalari -----------------------------------------
    ctx.save();
    ctx.translate(cx, cy);
    for (const dot of orbit) {
      const a = dot.phase + spin * dot.speed * 24;
      const x = Math.cos(a) * R * dot.r;
      const y = Math.sin(a) * R * dot.r;
      ctx.fillStyle = rgba(accent, 0.85 * baseAlpha);
      ctx.beginPath();
      ctx.arc(x, y, 1.9 * dpr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // --- 8. ic ucgen cerceve ------------------------------------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin * 2.4);
    ctx.strokeStyle = rgba(accent, 0.3 * baseAlpha);
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU;
      const x = Math.cos(a) * R * 0.34;
      const y = Math.sin(a) * R * 0.34;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // --- 9. cekirdek ---------------------------------------------------
    const coreBoost = speaking ? 0.35 + 0.2 * Math.abs(Math.sin(speakPhase)) : smoothLevel * 0.75;
    const coreR = R * (0.13 + coreBoost * 0.1 + pulse * 0.012);

    // Merkezdeki durum etiketi cekirdegin uzerinde durdugu icin parlaklik
    // bilerek dusuk tutulur — aksi halde yazi okunmuyor.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.4);
    glow.addColorStop(0, rgba(accent, 0.5 * baseAlpha));
    glow.addColorStop(0.35, rgba(accent, 0.14 * baseAlpha));
    glow.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 3.4, 0, TAU);
    ctx.fill();

    ctx.fillStyle = rgba(accent, (asleep ? 0.4 : 0.7) * baseAlpha);
    ctx.shadowBlur = 26 * dpr;
    ctx.shadowColor = rgba(accent, 0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = rgba(accent, 0.5 * baseAlpha);
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.9, 0, TAU);
    ctx.stroke();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

/** Alt seritteki kucuk dalga formu. */
export function mountWave(canvas) {
  const ctx = canvas.getContext("2d");

  function draw(time) {
    const dpr = fitCanvas(canvas);
    const w = canvas.width;
    const h = canvas.height;
    const accent = readAccent();

    ctx.clearRect(0, 0, w, h);

    const live = meterActive();
    const wave = live ? readWave(96) : null;
    const speaking = state.current === S.SPEAKING;

    ctx.strokeStyle = rgba(accent, 0.85);
    ctx.lineWidth = 1.3 * dpr;
    ctx.beginPath();

    const N = 96;
    for (let i = 0; i < N; i += 1) {
      let v;
      if (wave) v = wave[i];
      else if (speaking) v = 0.5 * Math.sin(time / 90 + i * 0.4) * Math.sin(time / 380);
      else v = 0.05 * Math.sin(time / 600 + i * 0.3);

      const x = (i / (N - 1)) * w;
      const y = h / 2 + v * h * 0.42;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Orta eksen
    ctx.strokeStyle = rgba(accent, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}
