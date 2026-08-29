/**
 * Sol kontrol paneli: sekmeler, notlar, alarmlar ve ayarlar.
 *
 * Bu modul yalnizca arayuzu yonetir. Tema uygulamak, mikrofonu acmak,
 * konusmak gibi isler `ctx` uzerinden ana module devredilir.
 */

import { store, saveStore, resetStore } from "./store.js";
import {
  listAlarms, addAlarm, removeAlarm, toggleAlarm, clearAlarms,
  isValidTime, describeUntil,
} from "./alarms.js";

const $ = (id) => document.getElementById(id);

/** Ayarlardaki hazir tema renkleri. */
export const THEMES = [
  { name: "camgobegi", rgb: [53, 230, 255] },
  { name: "yesil", rgb: [77, 255, 168] },
  { name: "altin", rgb: [255, 200, 90] },
  { name: "sari", rgb: [255, 226, 84] },
  { name: "turuncu", rgb: [255, 180, 84] },
  { name: "kirmizi", rgb: [255, 77, 94] },
  { name: "mor", rgb: [186, 122, 255] },
  { name: "pembe", rgb: [255, 122, 200] },
  { name: "beyaz", rgb: [226, 240, 255] },
];

let ctx = null;
let ringingId = null;

/* ------------------------------------------------------------------ notlar */

export function renderNotes() {
  const list = $("notes");
  list.replaceChildren();

  if (!store.notes.length) {
    const li = document.createElement("li");
    li.className = "list__empty";
    li.textContent = "Kayitli not yok";
    list.append(li);
    return;
  }

  store.notes.forEach((note, index) => {
    const li = document.createElement("li");

    const body = document.createElement("span");
    body.className = "alarms__body";
    body.textContent = note;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconbtn iconbtn--danger";
    del.textContent = "×";
    del.title = "Notu sil";
    del.setAttribute("aria-label", `Notu sil: ${note}`);
    del.addEventListener("click", () => {
      store.notes.splice(index, 1);
      saveStore();
      renderNotes();
    });

    li.append(body, del);
    list.append(li);
  });
}

export function addNote(text) {
  const clean = (text || "").trim().slice(0, 140);
  if (!clean) return false;
  store.notes.push(clean);
  if (store.notes.length > 60) store.notes.shift();
  saveStore();
  renderNotes();
  return true;
}

/* ----------------------------------------------------------------- alarmlar */

export function renderAlarms() {
  const list = $("alarms");
  list.replaceChildren();
  const alarms = listAlarms();

  if (!alarms.length) {
    const li = document.createElement("li");
    li.className = "list__empty";
    li.textContent = "Kurulu alarm yok";
    list.append(li);
    renderNextAlarm();
    return;
  }

  for (const alarm of alarms) {
    const li = document.createElement("li");
    li.dataset.enabled = String(alarm.enabled);
    if (alarm.id === ringingId) li.dataset.ringing = "true";

    const time = document.createElement("span");
    time.className = "alarms__time";
    time.textContent = alarm.time;

    const body = document.createElement("span");
    body.className = "alarms__body";
    if (alarm.label) {
      const label = document.createElement("span");
      label.className = "alarms__label";
      label.textContent = alarm.label;
      body.append(label);
    }
    const meta = document.createElement("span");
    meta.className = "alarms__meta";
    meta.textContent = alarm.enabled
      ? `${alarm.repeat ? "her gun · " : ""}${describeUntil(alarm)}`
      : "kapali";
    body.append(meta);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "iconbtn";
    toggle.textContent = alarm.enabled ? "‖" : "▶";
    toggle.title = alarm.enabled ? "Alarmi kapat" : "Alarmi ac";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.addEventListener("click", () => {
      toggleAlarm(alarm.id);
      renderAlarms();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconbtn iconbtn--danger";
    del.textContent = "×";
    del.title = "Alarmi sil";
    del.setAttribute("aria-label", `Alarmi sil: ${alarm.time}`);
    del.addEventListener("click", () => {
      removeAlarm(alarm.id);
      if (ringingId === alarm.id) ringingId = null;
      renderAlarms();
    });

    li.append(time, body, toggle, del);
    list.append(li);
  }

  renderNextAlarm();
}

/** Sistem sekmesindeki "siradaki alarm" ozeti. */
function renderNextAlarm() {
  const el = $("next-alarm");
  if (!el) return;

  const active = listAlarms().filter((a) => a.enabled);
  if (!active.length) {
    el.textContent = "Kurulu alarm yok";
    delete el.dataset.ringing;
    return;
  }

  const next = active.reduce((best, a) =>
    describeMinutes(a) < describeMinutes(best) ? a : best,
  );
  el.textContent = `${next.time}${next.label ? ` · ${next.label}` : ""} — ${describeUntil(next)}`;
  if (ringingId) el.dataset.ringing = "true";
  else delete el.dataset.ringing;
}

function describeMinutes(alarm) {
  const [h, m] = alarm.time.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

/** Calan alarmi isaretler; `null` verilince isareti kaldirir. */
export function markRinging(id) {
  ringingId = id;
  renderAlarms();
}

/* ------------------------------------------------------------------ ayarlar */

function syncSwitch(el, value) {
  el.setAttribute("aria-checked", String(Boolean(value)));
}

function renderSwatches() {
  const wrap = $("swatches");
  wrap.replaceChildren();
  for (const theme of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.style.background = `rgb(${theme.rgb.join(" ")})`;
    btn.style.color = `rgb(${theme.rgb.join(" ")})`;
    btn.title = theme.name;
    btn.setAttribute("aria-label", `Tema: ${theme.name}`);
    btn.setAttribute(
      "aria-pressed",
      String(theme.rgb.join(",") === store.theme.join(",")),
    );
    // ctx.setTheme zaten syncSettings cagirip kareleri tazeliyor.
    btn.addEventListener("click", () => ctx.setTheme(theme.rgb));
    wrap.append(btn);
  }
}

/** Ayar denetimlerini depodaki degerlerle esitler. */
export function syncSettings() {
  syncSwitch($("set-voice"), store.voiceEnabled);
  syncSwitch($("set-mic"), ctx.isMicOn());
  syncSwitch($("set-boot"), store.bootSequence);

  $("set-rate").value = String(store.speechRate);
  $("set-rate-val").textContent = `${store.speechRate.toFixed(2)}×`;
  $("set-sleep").value = String(store.autoSleepMinutes);
  $("set-wake").value = store.extraWakeWords.join(", ");
  renderSwatches();
}

/* ------------------------------------------------------------------ sekmeler */

function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  for (const pane of document.querySelectorAll(".pane")) {
    pane.hidden = pane.dataset.pane !== name;
  }
}

/* ------------------------------------------------------------------- kurulum */

export function mountPanel(context) {
  ctx = context;

  // --- sekmeler -----------------------------------------------------
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  }

  // --- notlar -------------------------------------------------------
  $("note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("note-input");
    if (addNote(input.value)) {
      input.value = "";
      ctx.toast("Not eklendi");
    }
  });

  $("notes-clear").addEventListener("click", () => {
    if (!store.notes.length) return;
    store.notes = [];
    saveStore();
    renderNotes();
    ctx.toast("Notlar silindi");
  });

  // --- alarmlar -----------------------------------------------------
  $("alarm-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const time = isValidTime($("alarm-time").value);
    if (!time) {
      ctx.toast("Gecerli bir saat girin");
      return;
    }
    const alarm = addAlarm(time, $("alarm-label").value, $("alarm-repeat").checked);
    $("alarm-label").value = "";
    $("alarm-repeat").checked = false;
    renderAlarms();
    ctx.toast(`Alarm kuruldu: ${alarm.time}`);
  });

  $("alarms-clear").addEventListener("click", () => {
    if (!listAlarms().length) return;
    clearAlarms();
    ringingId = null;
    renderAlarms();
    ctx.toast("Alarmlar silindi");
  });

  // --- ayarlar ------------------------------------------------------
  $("set-voice").addEventListener("click", () => {
    ctx.setVoice(!store.voiceEnabled);
    syncSettings();
  });

  $("set-mic").addEventListener("click", () => {
    ctx.toggleMic();
    // Mikrofon durumu asenkron olusur; olay geldiginde tekrar esitlenir.
    setTimeout(syncSettings, 300);
  });

  $("set-boot").addEventListener("click", () => {
    store.bootSequence = !store.bootSequence;
    saveStore();
    syncSettings();
  });

  $("set-rate").addEventListener("input", (event) => {
    store.speechRate = Number(event.target.value);
    $("set-rate-val").textContent = `${store.speechRate.toFixed(2)}×`;
    saveStore();
  });

  $("set-sleep").addEventListener("change", (event) => {
    store.autoSleepMinutes = Number(event.target.value);
    saveStore();
    ctx.onAutoSleepChanged();
  });

  $("set-wake").addEventListener("change", (event) => {
    store.extraWakeWords = event.target.value
      .split(",")
      .map((w) => w.trim().toLocaleLowerCase("tr"))
      .filter(Boolean)
      .slice(0, 12);
    saveStore();
    ctx.onWakeWordsChanged();
    ctx.toast(
      store.extraWakeWords.length
        ? `${store.extraWakeWords.length} ek sozcuk kaydedildi`
        : "Ek sozcukler temizlendi",
    );
  });

  $("set-clear-log").addEventListener("click", () => {
    ctx.clearLog();
    ctx.toast("Kayit silindi");
  });

  $("set-reset").addEventListener("click", () => {
    resetStore();
    ringingId = null;
    ctx.setTheme(store.theme);
    ctx.setVoice(store.voiceEnabled);
    renderNotes();
    renderAlarms();
    syncSettings();
    ctx.onAutoSleepChanged();
    ctx.onWakeWordsChanged();
    ctx.toast("Ayarlar sifirlandi");
  });

  showTab("sistem");
  renderNotes();
  renderAlarms();
  syncSettings();

  // Alarm geri sayimlari dakikada bir tazelenir.
  setInterval(renderAlarms, 30_000);
}

/** Belirli bir sekmeyi disaridan acar (sesli komutlar icin). */
export function openTab(name) {
  showTab(name);
}
