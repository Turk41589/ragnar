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

/**
 * Donen glif halkasi: cevrede akan karakter dizisi.
 * Her karede 60 harf dondurmek pahali oldugu icin bir kez cizilip
 * onbellege alinir; sonra sadece drawImage + rotate ile dondurulur.
 */
function buildGlyphRing(size, R, dpr, accent) {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const c = off.getContext("2d");
  c.translate(size / 2, size / 2);
  c.font = `${8 * dpr}px ui-monospace, monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = rgba(accent, 0.4);

  const glyphs = "DRA0123456789ABCDEF//::..↑↓<>[]{}";
  const count = 68;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU;
    c.save();
    c.rotate(a);
    c.translate(0, -R);
    c.fillText(glyphs[i % glyphs.length], 0, 0);
    c.restore();
  }
  return off;
}

/**
 * Donen parca halkasi: farkli uzunlukta yay dilimleri ve uc tirnaklari.
 * Reaktorun "etrafinda donen parcalar" hissini veren ana katman.
 */
function buildSegmentRing(size, R, dpr, accent, spec) {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const c = off.getContext("2d");
  c.translate(size / 2, size / 2);
  c.lineCap = "butt";

  for (const seg of spec) {
    const start = seg.at * TAU;
    const end = start + seg.len * TAU;
    c.strokeStyle = rgba(accent, seg.alpha);
    c.lineWidth = seg.weight * dpr;
    c.beginPath();
    c.arc(0, 0, R, start, end);
    c.stroke();

    // Dilim uclarindaki kisa tirnaklar
    c.lineWidth = 1 * dpr;
    for (const a of [start, end]) {
      const inner = R - seg.weight * 2.5 * dpr;
      const outer = R + seg.weight * 2.5 * dpr;
      c.beginPath();
      c.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      c.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      c.stroke();
    }
  }
  return off;
}

/** Kose ayraclari — donerken cerceve hissi verir. */
function buildBrackets(size, R, dpr, accent) {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const c = off.getContext("2d");
  c.translate(size / 2, size / 2);
  c.strokeStyle = rgba(accent, 0.5);
  c.lineWidth = 1.5 * dpr;
  const span = TAU * 0.045;
  for (let i = 0; i < 4; i += 1) {
    const mid = (i / 4) * TAU + Math.PI / 4;
    c.beginPath();
    c.arc(0, 0, R, mid - span, mid + span);
    c.stroke();
    for (const a of [mid - span, mid + span]) {
      c.beginPath();
      c.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      c.lineTo(Math.cos(a) * (R - 9 * dpr), Math.sin(a) * (R - 9 * dpr));
      c.stroke();
    }
  }
  return off;
}

export function mountReactor(canvas) {
  const ctx = canvas.getContext("2d");
  let accent = readAccent();
  let accentAge = 0;
  // Onbelleklenen donen katmanlar (boyut ya da renk degisince yenilenir)
  let layers = null;
  let layerKey = "";

  // Yumusatilmis degerler — ani sicramalari onler.
  let smoothLevel = 0;
  let spin = 0;
  let sweep = 0;
  let speakPhase = 0;

  const bars = new Float32Array(56);
  // Cekirdegin cevresinde donen kucuk noktalar
  const orbit = Array.from({ length: 7 }, (_, i) => ({
    r: 0.6 + (i % 3) * 0.06,
    speed: (i % 2 ? -1 : 1) * (0.12 + i * 0.04),
    phase: (i / 7) * TAU,
  }));

  // Yorungede donen "parcalar": her biri kendi hizinda, merkeze bir
  // baglanti cizgisiyle bagli kucuk bloklar.
  const shards = [
    { r: 0.97, size: 13, speed: 0.10, phase: 0.0, alpha: 0.85, ticks: 3 },
    { r: 0.97, size: 8, speed: 0.10, phase: TAU * 0.5, alpha: 0.6, ticks: 2 },
    { r: 0.88, size: 10, speed: -0.17, phase: TAU * 0.25, alpha: 0.7, ticks: 2 },
    { r: 0.88, size: 6, speed: -0.17, phase: TAU * 0.72, alpha: 0.5, ticks: 1 },
    { r: 0.74, size: 7, speed: 0.24, phase: TAU * 0.12, alpha: 0.65, ticks: 2 },
    { r: 0.74, size: 5, speed: 0.24, phase: TAU * 0.62, alpha: 0.45, ticks: 1 },
  ];

  // Yorungede donen ama dik duran kucuk veri levhalari
  const slabs = [
    { r: 0.93, speed: -0.07, phase: TAU * 0.16, w: 26, h: 15, rows: 3 },
    { r: 0.93, speed: -0.07, phase: TAU * 0.66, w: 20, h: 11, rows: 2 },
    { r: 0.8, speed: 0.13, phase: TAU * 0.42, w: 17, h: 9, rows: 2 },
  ];

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

    // --- katman onbellegi ---------------------------------------------
    const key = `${w}x${h}|${accent.r},${accent.g},${accent.b}`;
    if (key !== layerKey) {
      const size = Math.min(w, h);
      layers = {
        ticks: buildTickRing(size, R, dpr, accent),
        glyphs: buildGlyphRing(size, R * 0.955, dpr, accent),
        outerSegs: buildSegmentRing(size, R * 0.9, dpr, accent, [
          { at: 0.0, len: 0.14, weight: 3, alpha: 0.8 },
          { at: 0.22, len: 0.05, weight: 3, alpha: 0.45 },
          { at: 0.4, len: 0.19, weight: 3, alpha: 0.65 },
          { at: 0.68, len: 0.08, weight: 3, alpha: 0.5 },
          { at: 0.82, len: 0.11, weight: 3, alpha: 0.75 },
        ]),
        midSegs: buildSegmentRing(size, R * 0.7, dpr, accent, [
          { at: 0.1, len: 0.22, weight: 2, alpha: 0.55 },
          { at: 0.46, len: 0.1, weight: 2, alpha: 0.4 },
          { at: 0.64, len: 0.26, weight: 2, alpha: 0.6 },
        ]),
        brackets: buildBrackets(size, R * 0.78, dpr, accent),
      };
      layerKey = key;
    }

    /** Onbellekli bir katmani verilen aci kadar dondurup basar. */
    const stamp = (layer, angle, alpha = 1) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha * baseAlpha;
      ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    // --- 1. sabit tik halkasi -----------------------------------------
    ctx.globalAlpha = baseAlpha;
    ctx.drawImage(layers.ticks, cx - layers.ticks.width / 2, cy - layers.ticks.height / 2);
    ctx.globalAlpha = 1;

    // --- 1b. birbirine gore donen parca halkalari ---------------------
    stamp(layers.glyphs, spin * 0.5);
    stamp(layers.outerSegs, -spin * 1.9);
    stamp(layers.midSegs, spin * 2.6);
    stamp(layers.brackets, -spin * 0.9, 0.9);

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

    // --- 7b. yorungede donen parcalar ---------------------------------
    // Her parca merkeze bakan kisa bir baglanti cizgisiyle birlikte doner.
    ctx.save();
    ctx.translate(cx, cy);
    for (const shard of shards) {
      const a = shard.phase + spin * shard.speed * 22;
      const rr = R * shard.r;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(rr, 0);

      const size = shard.size * dpr;
      ctx.strokeStyle = rgba(accent, shard.alpha * baseAlpha);
      ctx.fillStyle = rgba(accent, shard.alpha * 0.12 * baseAlpha);
      ctx.lineWidth = 1.2 * dpr;

      // Govde
      ctx.beginPath();
      ctx.rect(-size / 2, -size / 2, size, size);
      ctx.fill();
      ctx.stroke();

      // Ic tirnaklar
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = rgba(accent, shard.alpha * 0.6 * baseAlpha);
      for (let t = 0; t < shard.ticks; t += 1) {
        const y = -size / 2 + ((t + 1) * size) / (shard.ticks + 1);
        ctx.beginPath();
        ctx.moveTo(-size / 2 + 2 * dpr, y);
        ctx.lineTo(size / 2 - 2 * dpr, y);
        ctx.stroke();
      }

      // Merkeze uzanan baglanti
      ctx.strokeStyle = rgba(accent, shard.alpha * 0.35 * baseAlpha);
      ctx.beginPath();
      ctx.moveTo(-size / 2, 0);
      ctx.lineTo(-size / 2 - 10 * dpr, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // --- 7c. yorungede donen veri levhalari ---------------------------
    // Yorungede tasinirlar ama okunabilir kalmalari icin dik dururlar.
    ctx.save();
    ctx.translate(cx, cy);
    for (const slab of slabs) {
      const a = slab.phase + spin * slab.speed * 22;
      const x = Math.cos(a) * R * slab.r;
      const y = Math.sin(a) * R * slab.r;
      const w2 = slab.w * dpr;
      const h2 = slab.h * dpr;

      ctx.save();
      ctx.translate(x, y);

      ctx.strokeStyle = rgba(accent, 0.45 * baseAlpha);
      ctx.fillStyle = rgba(accent, 0.07 * baseAlpha);
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.rect(-w2 / 2, -h2 / 2, w2, h2);
      ctx.fill();
      ctx.stroke();

      // Icindeki sahte veri satirlari — canliligi seviyeye bagli
      ctx.strokeStyle = rgba(accent, (0.3 + smoothLevel * 0.5) * baseAlpha);
      ctx.lineWidth = 1 * dpr;
      for (let r = 0; r < slab.rows; r += 1) {
        const ly = -h2 / 2 + ((r + 1) * h2) / (slab.rows + 1);
        const seed = Math.sin(time / 420 + r * 2.1 + slab.phase) * 0.5 + 0.5;
        const len = (w2 - 6 * dpr) * (0.35 + seed * 0.6);
        ctx.beginPath();
        ctx.moveTo(-w2 / 2 + 3 * dpr, ly);
        ctx.lineTo(-w2 / 2 + 3 * dpr + len, ly);
        ctx.stroke();
      }
      ctx.restore();
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
