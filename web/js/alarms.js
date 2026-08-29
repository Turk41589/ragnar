/**
 * Alarm motoru.
 *
 * Alarmlar saat:dakika olarak kurulur. Her saniye kontrol edilir; gun
 * icinde ayni alarmin iki kez calmasini `lastFired` engeller.
 * Tek seferlik alarmlar caldiktan sonra kendini kapatir; tekrarli
 * alarmlar her gun ayni saatte calar.
 */

import { store, saveStore } from "./store.js";

const pad = (n) => String(n).padStart(2, "0");

/** Bugunun "YYYY-MM-DD" anahtari. */
function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "HH:MM" bicimini dogrular. */
export function isValidTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((text || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function listAlarms() {
  return store.alarms
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function addAlarm(time, label = "", repeat = false) {
  const normalized = isValidTime(time);
  if (!normalized) return null;
  const alarm = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: normalized,
    label: (label || "").trim().slice(0, 60),
    enabled: true,
    repeat,
    lastFired: null,
  };
  store.alarms.push(alarm);
  if (store.alarms.length > 30) store.alarms.shift();
  saveStore();
  return alarm;
}

export function removeAlarm(id) {
  const before = store.alarms.length;
  store.alarms = store.alarms.filter((a) => a.id !== id);
  if (store.alarms.length !== before) saveStore();
  return store.alarms.length !== before;
}

export function toggleAlarm(id) {
  const alarm = store.alarms.find((a) => a.id === id);
  if (!alarm) return null;
  alarm.enabled = !alarm.enabled;
  saveStore();
  return alarm;
}

export function clearAlarms() {
  store.alarms = [];
  saveStore();
}

/** Bir sonraki calacak alarma kalan sureyi dakika olarak dondurur. */
export function minutesUntil(alarm, now = new Date()) {
  const [h, m] = alarm.time.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.round((target - now) / 60000);
}

/** Insan diliyle "3 saat 12 dakika sonra". */
export function describeUntil(alarm, now = new Date()) {
  const total = minutesUntil(alarm, now);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} saat ${m} dakika sonra`;
  if (h) return `${h} saat sonra`;
  return `${m} dakika sonra`;
}

/* ------------------------------------------------------------------- zil */

let audioCtx = null;

/**
 * Kisa bir alarm tonu calar.
 * Sesli yanit kapali olsa bile alarmin duyulmasi gerekir; bu yuzden
 * konusma sentezinden bagimsiz kendi sesini uretir.
 */
export function ring(times = 3) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtx = audioCtx || new AudioCtx();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

    const start = audioCtx.currentTime;
    for (let i = 0; i < times; i += 1) {
      const at = start + i * 0.42;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, at);
      osc.frequency.setValueAtTime(1174, at + 0.14);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.36);
    }
  } catch {
    /* ses cikarilamadi — gorsel ve sozlu uyari yeterli */
  }
}

/* -------------------------------------------------------------- zamanlayici */

/**
 * Alarm kontrolunu baslatir. Vakti gelen her alarm icin `onFire(alarm)` cagrilir.
 */
export function startAlarmClock(onFire) {
  let lastMinute = "";

  const check = () => {
    const now = new Date();
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    // Dakika degismedikce is yapma.
    if (stamp === lastMinute) return;
    lastMinute = stamp;

    const day = today(now);
    let changed = false;

    for (const alarm of store.alarms) {
      if (!alarm.enabled || alarm.time !== stamp) continue;
      if (alarm.lastFired === day) continue;

      alarm.lastFired = day;
      if (!alarm.repeat) alarm.enabled = false;
      changed = true;
      onFire(alarm);
    }

    if (changed) saveStore();
  };

  check();
  return setInterval(check, 1000);
}
