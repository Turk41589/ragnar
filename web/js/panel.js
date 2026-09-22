/**
 * Sol kontrol paneli: sekmeler, notlar, alarmlar ve ayarlar.
 *
 * Bu modul yalnizca arayuzu yonetir. Tema uygulamak, mikrofonu acmak,
 * konusmak gibi isler `ctx` uzerinden ana module devredilir.
 */

import { store, saveStore, resetStore } from "./store.js";
import * as system from "./system.js";
import * as speech from "./speech.js";
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

/* -------------------------------------------------------------- uygulamalar */

/** Sistem sekmesindeki uygulama ozeti. */
export function renderApps() {
  const el = $("apps-info");
  if (!el) return;
  const list = system.appList();
  if (!list.length) {
    el.textContent = "Henuz taranmadi";
    return;
  }
  const oyun = list.filter((a) => a.kind === "steam oyunu").length;
  el.textContent = oyun
    ? `${list.length} uygulama · ${oyun} oyun bulundu`
    : `${list.length} uygulama bulundu`;
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
  syncSwitch($("set-local"), store.localSpeechOnly);

  // Gomulu motor yalnizca uygulama surumunde var.
  const engineRow = $("row-engine");
  engineRow.hidden = !speech.embeddedAvailable();
  if (speech.embeddedAvailable()) {
    $("set-engine").value = store.speechEngine;
    refreshModelStatus();
  }

  // Acilista baslatma yalnizca masaustu surumunde anlamli.
  const autostartRow = $("row-autostart");
  autostartRow.hidden = !system.isDesktop();
  $("row-background").hidden = !system.isDesktop();
  $("row-background-hint").hidden = !system.isDesktop();
  syncSwitch($("set-background"), store.backgroundListen);
  if (system.isDesktop()) {
    system.getAutoStart().then((on) => syncSwitch($("set-autostart"), on)).catch(() => {});
  }
  syncSwitch($("set-streamer"), store.streamerMode);

  $("kick-fields").hidden = !store.streamerMode;
  $("set-kick-channel").value = store.kickChannel;
  $("set-kick-token").value = store.kickToken;

  syncSwitch($("set-business"), store.businessMode);
  $("business-fields").hidden = !store.businessMode;
  $("set-business-name").value = store.businessName;

  syncSwitch($("set-youtube"), store.youtubeMode);
  $("youtube-fields").hidden = !store.youtubeMode;
  $("set-yt-id").value = store.ytClientId;
  $("set-yt-secret").value = store.ytClientSecret;
  $("set-video-title").value = videoTaslak.title;
  $("video-file-info").textContent = videoTaslak.file || "Dosya secilmedi";
  $("video-thumb-info").textContent = videoTaslak.thumbnail || "Gorsel secilmedi";

  syncSwitch($("set-montage"), store.montageMode);
  $("montage-fields").hidden = !store.montageMode;
  // Mod acik kaydedilmis olabilir; ffmpeg denetimi yalnizca anahtara
  // basildiginda yapilsaydi dugme ffmpeg'siz acik kalirdi.
  if (store.montageMode && !montageChecked) {
    montageChecked = true;
    refreshMontageStatus();
  }
  $("set-montage-template").value = store.montageTemplate;
  $("montage-project-row").hidden = store.montageTemplate !== "proje";
  $("set-montage-title").value = store.montageTitle;
  $("montage-clips-info").textContent = store.montageClips || "Klasor secilmedi";
  $("montage-project-info").textContent = store.montageProject || "Proje secilmedi";
  $("montage-image-info").textContent = store.montageImage || "Gorsel secilmedi";
  $("montage-music-info").textContent = store.montageMusic || "Muzik secilmedi";

  syncSwitch($("set-command-mode"), store.commandMode);
  $("set-google-key").value = store.googleKey;
  $("set-google-cx").value = store.googleCx;
  refreshGoogleStatus();

  syncSwitch($("set-mail"), store.mailMode);
  $("mail-fields").hidden = !store.mailMode;
  $("set-mail-user").value = store.mailUser;
  $("set-mail-pass").value = store.mailPass;

  $("set-tts").value = store.ttsProvider;
  $("row-eleven").hidden = store.ttsProvider !== "elevenlabs";
  $("row-piper").hidden = store.ttsProvider !== "piper";
  $("piper-bin-info").textContent = store.piperBin || "Secilmedi";
  $("piper-voice-info").textContent = store.piperVoice || "Secilmedi";
  $("set-eleven-key").value = store.elevenKey;
  syncElevenOption($("set-eleven-voice"), store.elevenVoice);
  syncElevenOption($("set-eleven-model"), store.elevenModel);
  refreshElevenStatus();
  refreshMailStatus();

  $("set-rate").value = String(store.speechRate);
  $("set-rate-val").textContent = `${store.speechRate.toFixed(2)}×`;
  $("set-sleep").value = String(store.autoSleepMinutes);
  $("set-wake").value = store.extraWakeWords.join(", ");
  renderSwatches();
}

/* ---------------------------------------------------------- otomatik yanit */

/** Kural listesini ve otomatik yanit durumunu cizer. */
export async function renderRules() {
  const liste = $("rule-list");
  if (!liste) return;

  let veri;
  try {
    veri = await system.autoreplyList();
  } catch {
    return;
  }

  syncSwitch($("set-autoreply"), veri.status.enabled);
  $("autoreply-status").textContent = veri.status.enabled
    ? `Acik — ${veri.status.activeRules} kural calisiyor`
    : "Otomatik yanit kapali";

  liste.replaceChildren();
  for (const kural of veri.rules) {
    const li = document.createElement("li");
    li.className = "settings__stack";
    li.dataset.rule = kural.id;

    const satir = document.createElement("div");
    satir.className = "permrow";
    const ad = document.createElement("span");
    ad.textContent = kural.name;
    const durum = document.createElement("b");
    durum.className = "permrow__state";
    durum.dataset.granted = String(kural.enabled);
    durum.textContent = kural.enabled ? "acik" : "kapali";
    durum.style.cursor = "pointer";
    durum.addEventListener("click", async () => {
      await system.autoreplyToggle(kural.id).catch(() => {});
      renderRules();
    });
    satir.append(ad, durum);
    li.append(satir);

    const bilgi = document.createElement("small");
    bilgi.className = "hint";
    bilgi.textContent =
      `${kural.keywords.join(", ")} → "${kural.reply}"` +
      (kural.answerComplaints ? " (sikayetlere de yanit verir)" : "") +
      (kural.used ? ` — ${kural.used} kez kullanildi` : "");
    li.append(bilgi);

    const sil = document.createElement("button");
    sil.className = "btn btn--icon btn--wide btn--danger";
    sil.type = "button";
    sil.textContent = "Kurali sil";
    sil.addEventListener("click", async () => {
      await system.autoreplyRemove(kural.id).catch(() => {});
      renderRules();
    });
    li.append(sil);

    liste.append(li);
  }
}

/* -------------------------------------------------------- musteri kaynaklari */

/**
 * Kaynak listesini cizer.
 *
 * ONEMLI: buradaki alanlarin hicbiri elle yazilmadi. Her kaynak hangi
 * bilgiye ihtiyaci oldugunu kendi taniminda soyluyor (server/sources.mjs),
 * arayuz de onu okuyup ekrani kuruyor. Yeni bir kaynak eklendiginde bu
 * dosyada hicbir sey degismiyor.
 */
export async function renderSources() {
  const liste = $("source-list");
  if (!liste) return;

  let veri;
  try {
    veri = await system.sourceList();
  } catch (err) {
    $("source-info").textContent = `Kaynaklar okunamadi: ${err.message}`;
    return;
  }

  liste.replaceChildren();

  for (const kaynak of veri.sources) {
    const acik = store.sourcesOn.includes(kaynak.id);

    const li = document.createElement("li");
    li.className = "settings__stack";
    li.dataset.source = kaynak.id;

    // --- baslik + anahtar ---
    const satir = document.createElement("div");
    satir.className = "permrow";
    const ad = document.createElement("span");
    ad.textContent = kaynak.label;
    const anahtar = document.createElement("button");
    anahtar.className = "switch";
    anahtar.type = "button";
    anahtar.setAttribute("role", "switch");
    anahtar.setAttribute("aria-checked", String(acik));
    anahtar.addEventListener("click", async () => {
      if (store.sourcesOn.includes(kaynak.id)) {
        store.sourcesOn = store.sourcesOn.filter((x) => x !== kaynak.id);
      } else {
        store.sourcesOn.push(kaynak.id);
        // Acar acmaz ne isteyecegimizi soyluyoruz; kullanici alanlari
        // aramak zorunda kalmasin.
        if (kaynak.fields.length) {
          ctx.log(
            "system",
            `${kaynak.label} icin su bilgiler gerekiyor: ` +
              kaynak.fields.map((f) => f.label).join(", ") + ".",
          );
        }
        if (kaynak.warning) ctx.log("system", kaynak.warning);
      }
      saveStore();
      renderSources();
    });
    satir.append(ad, anahtar);
    li.append(satir);

    const aciklama = document.createElement("small");
    aciklama.className = "hint";
    aciklama.textContent = kaynak.detail;
    li.append(aciklama);

    // --- alanlar: yalnizca acikken ve kaynagin tanimindan ---
    if (acik && kaynak.fields.length) {
      const degerler = store.sourceValues[kaynak.id] || {};

      for (const alan of kaynak.fields) {
        const etiket = document.createElement("label");
        etiket.textContent = alan.required ? alan.label : `${alan.label} (istege bagli)`;
        etiket.htmlFor = `src-${kaynak.id}-${alan.key}`;

        const girdi = document.createElement("input");
        girdi.id = etiket.htmlFor;
        girdi.type = alan.type === "password" ? "password" : "text";
        girdi.autocomplete = "off";
        girdi.maxLength = 400;
        girdi.value = degerler[alan.key] || "";
        girdi.addEventListener("change", async (event) => {
          store.sourceValues[kaynak.id] ??= {};
          store.sourceValues[kaynak.id][alan.key] = event.target.value.trim();
          saveStore();
          await pushSource(kaynak.id);
        });

        const ipucu = document.createElement("small");
        ipucu.className = "hint";
        ipucu.textContent = alan.hint || "";

        li.append(etiket, girdi, ipucu);
      }

      if (kaynak.warning) {
        const uyari = document.createElement("small");
        uyari.className = "hint";
        uyari.textContent = kaynak.warning;
        li.append(uyari);
      }

      const sina = document.createElement("button");
      sina.className = "btn btn--icon btn--wide";
      sina.type = "button";
      sina.textContent = "Baglantiyi sina";
      const durum = document.createElement("p");
      durum.className = "nextalarm";
      durum.textContent = kaynak.ready ? "Hazir" : "Bilgiler eksik";

      sina.addEventListener("click", async () => {
        durum.textContent = "Sinaniyor…";
        try {
          await pushSource(kaynak.id);
          const sonuc = await ctx.withPermission(() => system.sourceTest(kaynak.id));
          if (!sonuc) {
            durum.textContent = "Izin verilmedi";
            return;
          }
          durum.textContent = sonuc.warning
            ? `${sonuc.detail} — ${sonuc.warning}`
            : `Baglanti tamam: ${sonuc.detail}`;
        } catch (err) {
          durum.textContent = `Hata: ${err.message}`;
        }
      });

      li.append(sina, durum);
    }

    liste.append(li);
  }

  const o = veri.summary;
  $("message-summary").textContent = o.total
    ? `Son ${o.days} gunde ${o.total} mesaj, ${o.unanswered} tanesi yanitsiz`
    : "Henuz mesaj yok";
}

/** Girilen bilgileri arka tarafa bildirir. */
async function pushSource(id) {
  const degerler = store.sourceValues[id] || {};
  try {
    await ctx.withPermission(() => system.sourceConfigure(id, degerler));
  } catch (err) {
    // Eksik alan sradan bir hata degil: ne eksik oldugunu soyluyoruz.
    if (err.code === "MISSING_FIELDS") return;
    ctx.toast(`Kaynak ayarlanamadi: ${err.message}`, 5000);
  }
}

/* ----------------------------------------------------------------- youtube */

/** Siraya eklenecek videonun taslagi (kaydedilmez, gecici). */
const videoTaslak = { file: "", thumbnail: "", title: "" };

const DURUM_ETIKET = {
  bekliyor: "bekliyor",
  yukleniyor: "yukleniyor",
  yuklendi: "yuklendi",
  hata: "hata",
};

async function pushYoutube() {
  if (!store.youtubeMode) return;
  try {
    await system.configureYoutube(store.ytClientId, store.ytClientSecret, store.ytRefreshToken);
  } catch (err) {
    ctx.toast(`YouTube ayarlanamadi: ${err.message}`, 5000);
  }
}

async function refreshYoutubeStatus() {
  const el = $("youtube-status");
  if (!el) return;
  if (!store.youtubeMode) {
    el.textContent = "Kapali";
    return;
  }
  if (!store.ytClientId || !store.ytClientSecret) {
    el.textContent = "Istemci bilgileri girilmedi";
    return;
  }
  if (!store.ytRefreshToken) {
    el.textContent = "Kanal bagli degil — «Kanali bagla»";
    return;
  }
  try {
    const kanal = await ctx.withPermission(() => system.youtubeChannel());
    if (!kanal) {
      el.textContent = "Izin verilmedi";
      return;
    }
    el.textContent =
      `${kanal.title} — ${kanal.subscribers.toLocaleString("tr")} abone, ` +
      `${kanal.videos} video`;
  } catch (err) {
    el.textContent = `Kanal okunamadi: ${err.message}`;
  }
}

/** Yayin sirasini listeler. */
export async function renderVideos() {
  const liste = $("video-list");
  if (!liste) return;

  let veri;
  try {
    veri = await system.videoList();
  } catch {
    return;
  }

  liste.replaceChildren();
  for (const v of veri.videos) {
    const li = document.createElement("li");
    li.className = "settings__stack";
    li.dataset.video = v.id;

    const satir = document.createElement("div");
    satir.className = "permrow";
    const ad = document.createElement("span");
    ad.textContent = v.title;
    const durum = document.createElement("b");
    durum.className = "permrow__state";
    durum.dataset.granted = String(v.status === "yuklendi");
    durum.textContent = DURUM_ETIKET[v.status] || v.status;
    satir.append(ad, durum);
    li.append(satir);

    const bilgi = document.createElement("small");
    bilgi.className = "hint";
    bilgi.textContent = v.publishAt
      ? `${new Date(v.publishAt).toLocaleString("tr")} — ${v.name}`
      : `Zamansiz (elle yuklenir) — ${v.name}`;
    li.append(bilgi);

    if (v.error) {
      const h = document.createElement("small");
      h.className = "hint";
      h.textContent = `Hata: ${v.error}`;
      li.append(h);
    }

    const sil = document.createElement("button");
    sil.className = "btn btn--icon btn--wide btn--danger";
    sil.type = "button";
    sil.textContent = "Siradan cikar";
    sil.addEventListener("click", async () => {
      try {
        await system.videoRemove(v.id);
        renderVideos();
      } catch (err) {
        ctx.toast(`Silinemedi: ${err.message}`, 5000);
      }
    });
    li.append(sil);

    liste.append(li);
  }

  const o = veri.summary;
  $("video-summary").textContent = o.total
    ? `${o.bekliyor} bekliyor, ${o.yuklendi} yuklendi` +
      (o.hata ? `, ${o.hata} hata` : "") +
      (o.next ? ` — siradaki: ${new Date(o.next.publishAt).toLocaleString("tr")}` : "")
    : "Sirada video yok";
}

/* ------------------------------------------------------------------ montaj */

/** Acilista bir kez denetlemek icin. */
let montageChecked = false;

/** ffmpeg var mi? Yoksa nasil kurulacagini yaziyoruz. */
async function refreshMontageStatus() {
  const el = $("montage-ffmpeg");
  if (!el) return;
  // Denetim bitene kadar dugme kapali dursun: ffmpeg yoksa tiklanip
  // anlamsiz bir hataya dusmesin.
  $("montage-run").disabled = true;
  try {
    const { ffmpeg } = await system.montageStatus();
    el.textContent = ffmpeg.ready
      ? `ffmpeg hazir (${ffmpeg.version})`
      : ffmpeg.advice || "ffmpeg kurulu degil";
    $("montage-run").disabled = !ffmpeg.ready;
  } catch (err) {
    el.textContent = `Denetlenemedi: ${err.message}`;
  }
}

/** Secilen projeden cikarilan uslubu sohbete kart olarak basar. */
async function showStyle(path) {
  try {
    const uslup = await ctx.withPermission(() => system.montageStyle(path));
    if (!uslup) return;
    ctx.showStyleCard(uslup);
  } catch (err) {
    ctx.toast(`Proje okunamadi: ${err.message}`, 6000);
    $("montage-project-info").textContent = `Okunamadi: ${err.message}`;
  }
}

export function setMontageStatus(text) {
  const el = $("montage-status");
  if (el) el.textContent = text;
}

/* ----------------------------------------------------------------- e-posta */

/**
 * Google arama anahtarinin durumu.
 *
 * "Anahtar girildi" ile "anahtar CALISIYOR" ayri seyler: bicimi dogru
 * ama gecersiz bir anahtar da girilmis gorunur. Onun icin yalnizca
 * "Kaydet ve sina" gercek bir sorgu atip sonucu buraya yaziyor.
 */
function refreshGoogleStatus() {
  const el = $("google-status");
  if (!el) return;
  if (!store.googleKey && !store.googleCx) {
    el.textContent = "Anahtar girilmedi — Wikipedia ve DuckDuckGo ile calisiyor";
  } else if (!store.googleKey || !store.googleCx) {
    el.textContent = "Eksik: hem anahtar hem arama motoru kimligi gerekiyor";
  } else {
    el.textContent = "Kaydedildi — «Kaydet ve sina» ile dogrulayin";
  }
}

function refreshMailStatus() {
  const el = $("mail-status");
  if (!el) return;
  if (!store.mailMode) el.textContent = "Kapali";
  else if (!store.mailUser) el.textContent = "Adres girilmedi";
  else if (!store.mailPass) el.textContent = "Uygulama sifresi girilmedi";
  else el.textContent = "Hazir — «Baglantiyi sina» ile dogrulayin";
}

/* ------------------------------------------------------------ ilk acilis */

/**
 * Ilk acilista tum yetkileri tek ekranda gosterir.
 *
 * Kullanici "izni ilk acilista istesin" dedi. Yine de hicbiri ONCEDEN
 * SECILI degil: toplu bir "hepsine izin ver" dugmesi, okumadan
 * tiklamayi tesvik eder. Her satiri kullanici kendi aciyor.
 */
export async function showFirstRun() {
  const kutu = $("firstrun");
  const liste = $("firstrun-list");
  if (!kutu || !liste) return;

  let izinler;
  try {
    izinler = await system.permissions();
  } catch {
    return;
  }

  liste.replaceChildren();
  for (const izin of izinler) {
    const li = document.createElement("li");
    li.className = "settings__stack";

    const satir = document.createElement("div");
    satir.className = "permrow";
    const ad = document.createElement("span");
    ad.textContent = izin.title;

    const anahtar = document.createElement("button");
    anahtar.className = "switch";
    anahtar.type = "button";
    anahtar.setAttribute("role", "switch");
    // Onceden secili DEGIL: bilincli bir tercih olsun.
    anahtar.setAttribute("aria-checked", String(izin.granted));
    anahtar.dataset.scope = izin.id;
    anahtar.addEventListener("click", () => {
      const acik = anahtar.getAttribute("aria-checked") === "true";
      anahtar.setAttribute("aria-checked", String(!acik));
    });

    satir.append(ad, anahtar);
    const aciklama = document.createElement("small");
    aciklama.className = "hint";
    aciklama.textContent = izin.detail;

    li.append(satir, aciklama);
    liste.append(li);
  }

  kutu.hidden = false;
}

/* ----------------------------------------------------------------- izinler */

/**
 * Verilen yetkileri listeler. Her satir tek tikla geri alinabilir —
 * "her seye erisebilir" demenin karsiligi, her seyi geri alabilmek.
 */
export async function renderPermissions() {
  const list = $("perm-list");
  if (!list) return;

  let izinler;
  try {
    izinler = await system.permissions();
  } catch (err) {
    list.replaceChildren();
    $("perm-info").textContent = `Izinler okunamadi: ${err.message}`;
    return;
  }

  list.replaceChildren();
  const verilen = izinler.filter((p) => p.granted).length;
  $("perm-info").textContent = verilen
    ? `${verilen} yetki verildi. Her birini buradan geri alabilirsiniz.`
    : "Henuz hicbir yetki verilmedi. DRA ihtiyac duydugunda size soracak.";

  for (const izin of izinler) {
    const li = document.createElement("li");
    li.className = "settings__stack";
    li.dataset.perm = izin.id;

    const satir = document.createElement("div");
    satir.className = "permrow";

    const ad = document.createElement("span");
    ad.textContent = izin.title;

    const durum = document.createElement("b");
    durum.className = "permrow__state";
    durum.dataset.granted = String(izin.granted);
    durum.textContent = izin.granted ? "verildi" : "kapali";

    satir.append(ad, durum);
    li.append(satir);

    const aciklama = document.createElement("small");
    aciklama.className = "hint";
    aciklama.textContent = izin.detail;
    li.append(aciklama);

    if (izin.granted) {
      const dugme = document.createElement("button");
      dugme.className = "btn btn--icon btn--wide btn--danger";
      dugme.type = "button";
      dugme.textContent = "Bu izni geri al";
      dugme.addEventListener("click", async () => {
        try {
          await system.revokePermission(izin.id);
          ctx.log("system", `"${izin.title}" izni geri alindi.`);
          ctx.toast("Izin geri alindi");
        } catch (err) {
          ctx.toast(`Izin geri alinamadi: ${err.message}`, 5000);
        }
        renderPermissions();
      });
      li.append(dugme);
    }

    list.append(li);
  }
}

/* ------------------------------------------------------------------- piper */

async function pushPiper() {
  if (store.ttsProvider !== "piper") return;
  try {
    await system.configurePiper(store.piperBin, store.piperVoice);
  } catch (err) {
    ctx.toast(`Piper ayarlanamadi: ${err.message}`, 5000);
  }
}

async function refreshPiperStatus() {
  const el = $("piper-status");
  if (!el) return;
  if (store.ttsProvider !== "piper") return;
  if (!store.piperBin) { el.textContent = "Piper programi secilmedi"; return; }
  if (!store.piperVoice) { el.textContent = "Ses modeli secilmedi"; return; }

  el.textContent = "Deneniyor…";
  try {
    const sonuc = await system.piperTest();
    el.textContent = `Calisiyor — ${sonuc.voice}`;
  } catch (err) {
    el.textContent = `Calismadi: ${err.message}`;
  }
}

/* -------------------------------------------------------------- ElevenLabs */

/**
 * Secim kutusunda kayitli deger yoksa onu gecici bir secenek olarak ekler.
 * Boylece sesler henuz yuklenmemisken de secili ses gorunur kalir.
 */
function syncElevenOption(select, value) {
  if (!select) return;
  if (value && !Array.from(select.options).some((o) => o.value === value)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value || "";
}

/** Ayarlari sunucuya/ana surece bildirir (anahtar arayuzde birakilmaz). */
async function pushEleven() {
  if (store.ttsProvider !== "elevenlabs") return;
  try {
    await system.configureTts(store.elevenKey, store.elevenVoice, store.elevenModel);
  } catch (err) {
    ctx.toast(`ElevenLabs ayarlanamadi: ${err.message}`, 5000);
  }
}

/** Ornek cumle: kisa, Turkce ve sesin tonunu belli eden bir sey. */
const ELEVEN_ORNEK = "Merhaba efendim, ben DRA. Sizi dinliyorum.";

/**
 * Sesleri (ve varsa modelleri) cekip secim kutularini doldurur.
 * Hem anahtar girilince kendiliginden, hem de "Sesleri yenile" ile calisir.
 */
async function loadElevenVoices({ sessiz = false } = {}) {
  if (!store.elevenKey) return false;
  $("eleven-status").textContent = "Sesler yukleniyor…";
  try {
    await pushEleven();
    const [sesler, modeller] = await Promise.all([
      system.ttsVoices(),
      system.ttsModels().catch(() => []),
    ]);

    fillVoices(sesler);
    if (modeller.length) fillModels(modeller);

    // Hic ses secilmediyse ilkini secip kullaniciyi bir adimdan kurtaralim.
    if (!store.elevenVoice && sesler.length) {
      store.elevenVoice = sesler[0].id;
      saveStore();
      $("set-eleven-voice").value = store.elevenVoice;
      await pushEleven();
    }

    if (!sessiz) ctx.toast(`${sesler.length} ses hazir`);
    refreshElevenStatus();
    return true;
  } catch (err) {
    $("eleven-status").textContent = `Sesler alinamadi: ${err.message}`;
    if (!sessiz) ctx.toast(`Sesler alinamadi: ${err.message}`, 6000);
    return false;
  }
}

function fillVoices(list) {
  const select = $("set-eleven-voice");
  select.innerHTML = "";
  if (!list.length) {
    select.appendChild(new Option("— hesapta ses bulunamadi —", ""));
    return;
  }
  for (const v of list) {
    // Etiketler hangi sesin ne oldugunu anlatir (cinsiyet, tarz, aksan).
    const etiket = Object.values(v.labels || {}).filter(Boolean).join(", ");
    select.appendChild(new Option(etiket ? `${v.name} (${etiket})` : v.name, v.id));
  }
  select.value = store.elevenVoice || "";
}

function fillModels(list) {
  const select = $("set-eleven-model");
  select.innerHTML = "";
  for (const m of list) {
    // Turkce desteklemeyen model secilirse DRA anlasilmaz konusur.
    select.appendChild(new Option(m.turkish ? `${m.name} — Turkce` : m.name, m.id));
  }
  syncElevenOption(select, store.elevenModel);
}

/** Ayar panelindeki tek satirlik durum yazisi. */
function refreshElevenStatus() {
  const el = $("eleven-status");
  if (!el) return;
  if (store.ttsProvider !== "elevenlabs") {
    el.textContent = "Kapali — bilgisayarin kendi sesi kullaniliyor";
  } else if (!store.elevenKey) {
    el.textContent = "Anahtar girilmedi";
  } else if (!store.elevenVoice) {
    el.textContent = "Ses secilmedi";
  } else if (system.ttsReady()) {
    el.textContent = "Hazir";
  } else {
    el.textContent = "Ayarlar henuz bildirilmedi";
  }
}

/* -------------------------------------------------------------- ses modeli */

/** Model durumunu ayar panelinde gosterir. */
async function refreshModelStatus() {
  const el = $("model-status");
  const button = $("set-model-install");
  if (!el) return;
  try {
    const info = await speech.embeddedStatus();
    if (info.modelReady) {
      el.textContent = "Turkce model kurulu — ses cihazdan cikmiyor";
      button.hidden = true;
    } else {
      el.textContent = "Turkce model kurulu degil";
      button.hidden = false;
    }
  } catch {
    el.textContent = "Model durumu okunamadi";
  }
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
    tab.addEventListener("click", () => {
      showTab(tab.dataset.tab);
      // Izin listesi her acilista tazelenir: yetki sesli bir soruyla da
      // verilmis olabilir, sekme eski halini gostermesin.
      if (tab.dataset.tab === "modlar") renderPermissions();
    });
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

  $("set-local").addEventListener("click", () => {
    store.localSpeechOnly = !store.localSpeechOnly;
    saveStore();
    syncSettings();
    // Tanima modu degistigi icin mikrofonun yeniden kurulmasi gerekir.
    ctx.onSpeechModeChanged();
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

  /* --- uygulama taramasi --- */
  $("apps-scan").addEventListener("click", async () => {
    const button = $("apps-scan");
    button.disabled = true;
    button.textContent = "Taraniyor…";
    ctx.toast("Bilgisayar taraniyor, bu biraz surebilir", 6000);
    try {
      const list = await system.scanApps();
      renderApps();
      ctx.toast(`${list.length} uygulama bulundu`);
      ctx.log("system", `${list.length} uygulama bulundu. Artik "spotify ac" gibi soyleyebilirsiniz.`);
    } catch (err) {
      ctx.toast(`Tarama basarisiz: ${err.message}`, 6000);
    } finally {
      button.disabled = false;
      button.textContent = "Bilgisayari tara";
    }
  });

  /* --- ilk acilis izin ekrani --- */
  $("firstrun-accept").addEventListener("click", async () => {
    const secili = [...document.querySelectorAll("#firstrun-list [data-scope]")]
      .filter((el) => el.getAttribute("aria-checked") === "true")
      .map((el) => el.dataset.scope);

    let verilen = 0;
    for (const scope of secili) {
      try {
        await system.grantPermission(scope);
        verilen += 1;
      } catch (err) {
        ctx.toast(`${scope} verilemedi: ${err.message}`, 5000);
      }
    }

    store.firstRunDone = true;
    saveStore();
    $("firstrun").hidden = true;
    ctx.log(
      "system",
      verilen
        ? `${verilen} yetki verildi. Hepsini Modlar sekmesinden geri alabilirsiniz.`
        : "Hicbir yetki verilmedi. Ihtiyac duydugumda ayrica soracagim.",
    );
    renderPermissions();
  });

  $("firstrun-skip").addEventListener("click", () => {
    store.firstRunDone = true;
    saveStore();
    $("firstrun").hidden = true;
    ctx.log(
      "system",
      "Tamam. Bir yetkiye ihtiyac duydugumda o an size soracagim.",
    );
  });

  /* --- yayinci destegi --- */
  $("set-streamer").addEventListener("click", () => {
    store.streamerMode = !store.streamerMode;
    saveStore();
    syncSettings();
    ctx.toast(store.streamerMode ? "Yayinci destegi acildi" : "Yayinci destegi kapatildi");
    if (store.streamerMode && !store.kickToken) {
      ctx.log("system", "Yayinci destegi acildi. Moderasyon icin kanal adi ve erisim jetonu girin.");
    }
  });

  for (const id of ["set-kick-channel", "set-kick-token"]) {
    $(id).addEventListener("change", async (event) => {
      if (id === "set-kick-channel") store.kickChannel = event.target.value.trim();
      else store.kickToken = event.target.value.trim();
      saveStore();
      if (store.kickToken) {
        try {
          await system.configureKick(store.kickToken, store.kickChannel);
        } catch (err) {
          ctx.toast(`Kick ayarlanamadi: ${err.message}`, 5000);
        }
      }
    });
  }

  /* -------------------------------------------------------- isletme -- */

  $("set-business").addEventListener("click", async () => {
    store.businessMode = !store.businessMode;
    saveStore();
    syncSettings();
    if (store.businessMode) {
      ctx.log(
        "system",
        "Isletme modu acildi. Musteri mesajlarinin hangi kaynaktan gelecegini " +
          "secin; her kaynak icin gereken bilgileri ayri ayri isteyecegim.",
      );
      await renderSources();
      await renderRules();
    }
  });

  $("set-business-name").addEventListener("change", (event) => {
    store.businessName = event.target.value.trim();
    saveStore();
  });

  /* --- otomatik yanit --- */

  $("set-autoreply").addEventListener("click", async () => {
    const acik = $("set-autoreply").getAttribute("aria-checked") === "true";
    try {
      const durum = await ctx.withPermission(() => system.autoreplySetMode(!acik));
      if (!durum) return;
      ctx.log(
        "system",
        durum.enabled
          ? "Otomatik yanit ACIK. Kurallariniza uyan mesajlara kendim yanit verecegim."
          : "Otomatik yanit kapatildi.",
      );
      renderRules();
    } catch (err) {
      ctx.toast(`Degistirilemedi: ${err.message}`, 5000);
    }
  });

  $("set-rule-complaints").addEventListener("click", () => {
    const dugme = $("set-rule-complaints");
    const acik = dugme.getAttribute("aria-checked") === "true";
    dugme.setAttribute("aria-checked", String(!acik));
  });

  $("rule-add").addEventListener("click", async () => {
    try {
      await system.autoreplyAdd({
        name: $("set-rule-name").value.trim(),
        keywords: $("set-rule-words").value,
        reply: $("set-rule-reply").value.trim(),
        answerComplaints: $("set-rule-complaints").getAttribute("aria-checked") === "true",
      });
      $("set-rule-name").value = "";
      $("set-rule-words").value = "";
      $("set-rule-reply").value = "";
      $("set-rule-complaints").setAttribute("aria-checked", "false");
      ctx.toast("Kural eklendi");
      renderRules();
    } catch (err) {
      ctx.toast(`Kural eklenemedi: ${err.message}`, 6000);
    }
  });

  $("autoreply-dry").addEventListener("click", async () => {
    const sonuc = await ctx.runAutoreply(true);
    if (sonuc) ctx.log("system", sonuc);
  });

  $("autoreply-run").addEventListener("click", async () => {
    const sonuc = await ctx.runAutoreply(false);
    if (sonuc) ctx.log("system", sonuc);
    renderRules();
  });

  $("source-collect").addEventListener("click", async () => {
    if (!store.sourcesOn.length) {
      ctx.toast("Once en az bir kaynak secin");
      return;
    }
    const sonuc = await ctx.collectMessages();
    if (sonuc) ctx.log("system", sonuc);
    renderSources();
  });

  /* --------------------------------------------------------- youtube -- */

  $("set-youtube").addEventListener("click", async () => {
    store.youtubeMode = !store.youtubeMode;
    saveStore();
    syncSettings();
    if (store.youtubeMode) {
      ctx.log(
        "system",
        "YouTube modu acildi. Google Cloud'dan aldiginiz istemci bilgilerini " +
          "girip «Kanali bagla» deyin.",
      );
      await pushYoutube();
      renderVideos();
    }
    refreshYoutubeStatus();
  });

  for (const [id, alan] of [["set-yt-id", "ytClientId"], ["set-yt-secret", "ytClientSecret"]]) {
    $(id).addEventListener("change", async (event) => {
      store[alan] = event.target.value.trim();
      saveStore();
      await pushYoutube();
      refreshYoutubeStatus();
    });
  }

  $("yt-link").addEventListener("click", async () => {
    if (!store.ytClientId || !store.ytClientSecret) {
      ctx.toast("Once istemci kimligi ve gizli anahtari girin");
      return;
    }
    $("youtube-status").textContent = "Tarayici aciliyor, onayinizi bekliyorum…";
    try {
      await pushYoutube();
      const sonuc = await ctx.withPermission(() => system.linkYoutube());
      if (!sonuc) {
        $("youtube-status").textContent = "Izin verilmedi";
        return;
      }
      // Yenileme jetonu bu bilgisayarda kalir; bir daha giris istenmez.
      store.ytRefreshToken = sonuc.refreshToken;
      saveStore();
      await pushYoutube();
      await refreshYoutubeStatus();
      ctx.toast("Kanal baglandi");
    } catch (err) {
      $("youtube-status").textContent = `Baglanamadi: ${err.message}`;
      ctx.log("system", `YouTube baglanamadi: ${err.message}`);
    }
  });

  for (const [id, kind, alan] of [
    ["pick-video-file", "video", "file"],
    ["pick-video-thumb", "image", "thumbnail"],
  ]) {
    $(id).addEventListener("click", async () => {
      if (!system.isDesktop()) {
        ctx.toast("Dosya secimi yalnizca uygulama surumunde");
        return;
      }
      const yol = await system.montagePick(kind).catch(() => null);
      if (!yol) return;
      videoTaslak[alan] = yol;
      syncSettings();
    });
  }

  $("set-video-title").addEventListener("change", (event) => {
    videoTaslak.title = event.target.value.trim();
  });

  $("video-add").addEventListener("click", async () => {
    if (!videoTaslak.file) {
      ctx.toast("Once video dosyasini secin");
      return;
    }
    const ne_zaman = $("set-video-when").value;
    try {
      const video = await ctx.withPermission(() =>
        system.videoAdd({
          file: videoTaslak.file,
          title: videoTaslak.title || undefined,
          thumbnail: videoTaslak.thumbnail || undefined,
          // datetime-local yerel saat verir; Date bunu dogru yorumluyor.
          publishAt: ne_zaman ? new Date(ne_zaman).getTime() : null,
          privacy: $("set-video-privacy").value,
        }),
      );
      if (!video) return;
      ctx.log(
        "system",
        `"${video.title}" siraya eklendi` +
          (video.publishAt ? ` — ${new Date(video.publishAt).toLocaleString("tr")}` : ""),
      );
      ctx.toast("Siraya eklendi");
      videoTaslak.file = "";
      videoTaslak.thumbnail = "";
      videoTaslak.title = "";
      $("set-video-when").value = "";
      syncSettings();
      renderVideos();
    } catch (err) {
      ctx.toast(`Eklenemedi: ${err.message}`, 6000);
    }
  });

  /* ---------------------------------------------------------- montaj -- */

  $("set-montage").addEventListener("click", async () => {
    store.montageMode = !store.montageMode;
    saveStore();
    syncSettings();
    if (store.montageMode) {
      ctx.log("system", "Montaj modu acildi.");
      await refreshMontageStatus();
    }
  });

  $("set-montage-template").addEventListener("change", (event) => {
    store.montageTemplate = event.target.value;
    saveStore();
    syncSettings();
  });

  $("set-montage-title").addEventListener("change", (event) => {
    store.montageTitle = event.target.value.trim();
    saveStore();
  });

  // Yollari kullanici elle yazmiyor: ana surec sectiriyor.
  const secimler = [
    ["pick-montage-clips", "folder", "montageClips"],
    ["pick-montage-project", "project", "montageProject"],
    ["pick-montage-image", "image", "montageImage"],
    ["pick-montage-music", "music", "montageMusic"],
  ];
  for (const [id, kind, alan] of secimler) {
    $(id).addEventListener("click", async () => {
      if (!system.isDesktop()) {
        ctx.toast("Dosya secimi yalnizca uygulama surumunde");
        return;
      }
      try {
        const yol = await system.montagePick(kind);
        if (!yol) return;
        store[alan] = yol;
        saveStore();
        syncSettings();

        // Proje secildiyse usluğu hemen okuyup kullaniciya gosteriyoruz.
        if (alan === "montageProject") await showStyle(yol);
      } catch (err) {
        ctx.toast(`Secilemedi: ${err.message}`, 5000);
      }
    });
  }

  $("montage-run").addEventListener("click", async () => {
    // runMontage erken donerse ("klasor secilmedi" gibi) bu metin
    // kullaniciya ulasmali; yoksa dugme hicbir sey yapmiyor gorunuyordu.
    const sonuc = await ctx.runMontage();
    if (sonuc) ctx.log("system", sonuc);
  });

  /* --------------------------------------------------------- e-posta -- */

  $("set-mail").addEventListener("click", () => {
    store.mailMode = !store.mailMode;
    saveStore();
    syncSettings();
    if (store.mailMode) {
      ctx.log(
        "system",
        "E-posta raporu acildi. Gmail adresinizi ve UYGULAMA SIFRENIZI girin; " +
          "sonra «mail var mi» diye sorabilirsiniz.",
      );
    } else {
      // Kapatilinca sifreyi surecten de cekiyoruz.
      system.configureMail("", "").catch(() => {});
      ctx.log("system", "E-posta raporu kapatildi.");
    }
    refreshMailStatus();
  });

  for (const id of ["set-google-key", "set-google-cx"]) {
    $(id).addEventListener("change", (event) => {
      if (id === "set-google-key") store.googleKey = event.target.value.trim();
      else store.googleCx = event.target.value.trim();
      saveStore();
      refreshGoogleStatus();
    });
  }

  $("set-google-save").addEventListener("click", async () => {
    if (!store.googleKey || !store.googleCx) {
      ctx.toast("Hem anahtari hem arama motoru kimligini girin");
      return;
    }
    $("google-status").textContent = "Sinaniyor…";
    try {
      await system.configureSearch(store.googleKey, store.googleCx);
      // Gercek bir sorgu atiyoruz: anahtarin KABUL EDILDIGINI ancak
      // boyle bilebiliriz. Bicimi dogru ama gecersiz bir anahtar,
      // yalnizca kaydedilince "tamam" gorunurdu.
      const sonuc = await system.richSearch("test", 1);
      const ozet = `Calisiyor — ${sonuc?.provider || "?"} cevapladi`;
      $("google-status").textContent = ozet;
      ctx.toast("Google aramasi calisiyor");
    } catch (err) {
      $("google-status").textContent = `Hata: ${err.message}`;
      ctx.toast(`Google aramasi calismadi: ${err.message}`, 7000);
    }
  });

  for (const id of ["set-mail-user", "set-mail-pass"]) {
    $(id).addEventListener("change", async (event) => {
      if (id === "set-mail-user") store.mailUser = event.target.value.trim();
      else store.mailPass = event.target.value.trim();
      saveStore();
      if (store.mailUser && store.mailPass) {
        try {
          await system.configureMail(store.mailUser, store.mailPass);
        } catch (err) {
          ctx.toast(`E-posta ayarlanamadi: ${err.message}`, 5000);
        }
      }
      refreshMailStatus();
    });
  }

  $("set-mail-test").addEventListener("click", async () => {
    if (!store.mailUser || !store.mailPass) {
      ctx.toast("Once adres ve uygulama sifresini girin");
      return;
    }
    $("mail-status").textContent = "Sinaniyor…";
    try {
      await system.configureMail(store.mailUser, store.mailPass);
      // Sinama da izin gerektiriyor; yoksa DRA sorar.
      const sonuc = await ctx.withPermission(() => system.mailTest());
      if (!sonuc) {
        $("mail-status").textContent = "Izin verilmedi";
        return;
      }
      const ozet = `Baglanti tamam — ${sonuc.user}, kutuda ${sonuc.total} mesaj`;
      $("mail-status").textContent = ozet;
      ctx.log("system", ozet);
      ctx.toast("E-posta baglantisi calisiyor");
    } catch (err) {
      $("mail-status").textContent = `Hata: ${err.message}`;
      ctx.log("system", `E-posta baglantisi kurulamadi: ${err.message}`);
      ctx.toast("E-posta baglantisi kurulamadi", 6000);
    }
  });

  /* ----------------------------------------------------------- piper -- */

  for (const [id, kind, alan] of [
    ["pick-piper-bin", "bin", "piperBin"],
    ["pick-piper-voice", "voice", "piperVoice"],
  ]) {
    $(id).addEventListener("click", async () => {
      if (!system.isDesktop()) {
        ctx.toast("Dosya secimi yalnizca uygulama surumunde");
        return;
      }
      const yol = await system.piperPick(kind).catch(() => null);
      if (!yol) return;
      store[alan] = yol;
      saveStore();
      syncSettings();
      await pushPiper();
      refreshPiperStatus();
    });
  }

  $("piper-preview").addEventListener("click", async () => {
    if (!store.piperBin || !store.piperVoice) {
      ctx.toast("Once piper programini ve ses modelini secin");
      return;
    }
    $("piper-status").textContent = "Dinleniyor…";
    try {
      await pushPiper();
      await speech.previewVoice(ELEVEN_ORNEK, "piper");
      refreshPiperStatus();
    } catch (err) {
      $("piper-status").textContent = `Calismadi: ${err.message}`;
      ctx.log("system", `Piper calismadi: ${err.message}`);
    }
  });

  /* ------------------------------------------------------ ElevenLabs -- */

  $("set-tts").addEventListener("change", async (event) => {
    const secim = event.target.value;
    store.ttsProvider = ["elevenlabs", "piper"].includes(secim) ? secim : "yerel";
    saveStore();
    syncSettings();
    speech.resetElevenCache();

    if (store.ttsProvider === "piper") {
      ctx.log(
        "system",
        "DRA'nin sesi Piper'a alindi — ses bu bilgisayarda uretilecek, " +
          "disariya hicbir sey gitmeyecek.",
      );
      await pushPiper();
      refreshPiperStatus();
      return;
    }

    if (store.ttsProvider === "elevenlabs") {
      ctx.log("system", "DRA'nin sesi ElevenLabs'a alindi.");
      await pushEleven();
      // Anahtar zaten kayitliysa sesleri hemen getir; kullanici ayara
      // ikinci kez ugramak zorunda kalmasin. Yukleme durumu kendi yazar,
      // asagidaki tazeleme onu ezmesin.
      if (store.elevenKey) {
        await loadElevenVoices({ sessiz: true });
        return;
      }
    } else {
      // Anahtari da geri cekiyoruz ki kapaliyken ortada durmasin.
      try {
        await system.configureTts("", "", store.elevenModel);
      } catch {
        /* onemli degil: kapaliyken zaten istek gitmiyor */
      }
      ctx.log("system", "DRA yeniden bilgisayarin kendi sesiyle konusuyor.");
    }
    refreshElevenStatus();
  });

  $("set-eleven-key").addEventListener("change", async (event) => {
    store.elevenKey = event.target.value.trim();
    saveStore();
    speech.resetElevenCache();
    await pushEleven();
    // Anahtar girilir girilmez sesleri getiriyoruz; kullanicinin ayrica
    // bir dugmeye basmasi gerekmesin. Yukleme basarisiz olursa sebebini
    // yazar — bunun uzerine durum tazelemek o sebebi silerdi.
    if (store.elevenKey) await loadElevenVoices();
    else refreshElevenStatus();
  });

  for (const id of ["set-eleven-voice", "set-eleven-model"]) {
    $(id).addEventListener("change", async (event) => {
      if (id === "set-eleven-voice") store.elevenVoice = event.target.value;
      else store.elevenModel = event.target.value;
      saveStore();
      // Ses ya da model degistiyse onbellekteki eski ses artik yanlis.
      speech.resetElevenCache();
      await pushEleven();
      refreshElevenStatus();
    });
  }

  $("set-eleven-load").addEventListener("click", async () => {
    if (!store.elevenKey) {
      ctx.toast("Once API anahtarini girin");
      return;
    }
    await loadElevenVoices();
  });

  $("set-eleven-preview").addEventListener("click", async () => {
    if (!store.elevenKey) {
      ctx.toast("Once API anahtarini girin");
      return;
    }
    if (!store.elevenVoice) {
      ctx.toast("Once bir ses secin");
      return;
    }
    const dugme = $("set-eleven-preview");
    dugme.disabled = true;
    $("eleven-status").textContent = "Dinleniyor…";
    try {
      await pushEleven();
      await speech.previewVoice(ELEVEN_ORNEK);
      refreshElevenStatus();
    } catch (err) {
      $("eleven-status").textContent = `Dinletilemedi: ${err.message}`;
      ctx.toast(`Ses dinletilemedi: ${err.message}`, 6000);
    } finally {
      dugme.disabled = false;
    }
  });

  $("set-eleven-test").addEventListener("click", async () => {
    if (!store.elevenKey) {
      ctx.toast("Once API anahtarini girin");
      return;
    }
    ctx.log("system", "ElevenLabs baglantisi sinaniyor…");
    $("eleven-status").textContent = "Sinaniyor…";
    try {
      await pushEleven();
      const sonuc = await system.ttsTest();
      const parcalar = [`${sonuc.voiceCount} ses erisilebilir`];
      if (sonuc.voice) parcalar.push(`secili ses: ${sonuc.voice}`);
      if (sonuc.quota) {
        parcalar.push(
          `kalan karakter: ${sonuc.quota.remaining.toLocaleString("tr")}`,
        );
      }
      const ozet = parcalar.join(" — ");
      $("eleven-status").textContent = ozet;
      ctx.log("system", `ElevenLabs calisiyor: ${ozet}`);
      ctx.toast("ElevenLabs baglantisi calisiyor");
    } catch (err) {
      $("eleven-status").textContent = `Hata: ${err.message}`;
      ctx.log("system", `ElevenLabs baglantisi kurulamadi: ${err.message}`);
      ctx.toast("ElevenLabs baglantisi kurulamadi", 5000);
    }
  });

  $("set-kick-test").addEventListener("click", async () => {
    if (!store.kickToken) {
      ctx.toast("Once erisim jetonunu girin");
      return;
    }
    ctx.log("system", "Kick baglantisi sinaniyor…");
    try {
      await system.configureKick(store.kickToken, store.kickChannel);
      const message = await system.kickAction("verify", []);
      ctx.log("system", `Kick baglantisi calisiyor: ${message}`);
      ctx.toast("Kick baglantisi calisiyor");
    } catch (err) {
      ctx.log("error", `Kick baglantisi kurulamadi: ${err.message}`);
      ctx.toast("Kick baglantisi kurulamadi", 5000);
    }
  });

  $("set-autostart").addEventListener("click", async () => {
    const next = $("set-autostart").getAttribute("aria-checked") !== "true";
    try {
      const applied = await system.setAutoStart(next);
      syncSwitch($("set-autostart"), applied);
      ctx.toast(applied ? "Bilgisayar acilinca DRA baslayacak" : "Acilista baslatma kapatildi");
    } catch (err) {
      ctx.toast(`Ayarlanamadi: ${err.message}`, 5000);
    }
  });

  $("set-engine").addEventListener("change", (event) => {
    store.speechEngine = event.target.value;
    saveStore();
    ctx.toast(
      store.speechEngine === "gomulu"
        ? "Gomulu motor secildi — ses cihazda kalir"
        : "Tarayici motoru secildi",
    );
    ctx.onSpeechModeChanged();
  });

  $("set-raw-listen").addEventListener("click", async () => {
    const button = $("set-raw-listen");
    if (button.dataset.calisiyor === "1") return;
    button.dataset.calisiyor = "1";
    try {
      await ctx.rawListen(30, (kalan) => {
        button.textContent = `Dinliyorum… ${kalan} sn`;
      });
    } catch (err) {
      ctx.toast(`Dinlenemedi: ${err.message}`, 6000);
    } finally {
      button.dataset.calisiyor = "0";
      button.textContent = "Ne duyuyorsun? (30 sn)";
    }
  });

  $("set-command-mode").addEventListener("click", async () => {
    store.commandMode = !store.commandMode;
    saveStore();
    syncSwitch($("set-command-mode"), store.commandMode);

    /*
     * Motor calisiyorsa ANINDA uyguluyoruz — model yeniden
     * yuklenmiyor, yalnizca tanimlayici kuruluyor. Kullanici ayari
     * degistirip hemen deneyebilsin.
     */
    try {
      await ctx.applyCommandMode();
      ctx.toast(store.commandMode ? "Komut kipi acik" : "Serbest kip acik");
    } catch (err) {
      ctx.toast(`Uygulanamadi: ${err.message}`, 5000);
    }
  });

  $("set-model-install").addEventListener("click", async () => {
    const button = $("set-model-install");
    button.disabled = true;
    ctx.log("system", "Turkce ses modeli indiriliyor (yaklasik 45 MB). Bu bir kerelik.");
    try {
      await speech.installEmbeddedModel((percent) => {
        button.textContent = `Indiriliyor… %${percent}`;
        $("model-status").textContent = `Indiriliyor… %${percent}`;
      });
      ctx.log("system", "Ses modeli kuruldu. Artik mikrofonu acabilirsiniz; ses cihazdan cikmayacak.");
      ctx.toast("Ses modeli kuruldu");
    } catch (err) {
      ctx.log("error", `Model kurulamadi: ${err.message}`);
      ctx.toast("Model kurulamadi", 6000);
    } finally {
      button.disabled = false;
      button.textContent = "Ses modelini kur";
      refreshModelStatus();
    }
  });

  /*
   * YENIDEN KUR = once sil, sonra kur.
   *
   * Yalnizca "kur" demek yetmiyordu: yarim inmis bir modelden sonra
   * arsiv eski bozuk dosyalarin uzerine aciliyor ve model yine bozuk
   * kaliyordu. Kullanici "yeniden kur" dedigi halde ayni cokmeyi
   * gormeye devam ediyordu.
   */
  $("set-model-reinstall").addEventListener("click", async () => {
    const button = $("set-model-reinstall");
    button.disabled = true;
    ctx.log("system", "Eski model siliniyor…");
    try {
      await speech.removeEmbeddedModel();
      ctx.log("system", "Eski model silindi. Yeniden indiriliyor (yaklasik 45 MB).");
      await speech.installEmbeddedModel((percent) => {
        button.textContent = `Indiriliyor… %${percent}`;
        $("model-status").textContent = `Indiriliyor… %${percent}`;
      });
      ctx.log("system", "Ses modeli yeniden kuruldu. Mikrofonu deneyebilirsiniz.");
      ctx.toast("Ses modeli yeniden kuruldu");
    } catch (err) {
      ctx.log("error", `Yeniden kurulamadi: ${err.message}`);
      ctx.toast("Yeniden kurulamadi — sohbete bakin", 7000);
    } finally {
      button.disabled = false;
      button.textContent = "Ses modelini yeniden kur";
      refreshModelStatus();
    }
  });

  $("set-model-pick").addEventListener("click", async () => {
    try {
      const result = await speech.pickEmbeddedModel();
      if (result.canceled) return;
      ctx.log("system", `Ses modeli tanindi: ${result.modelPath}`);
      ctx.toast("Ses modeli hazir");
    } catch (err) {
      ctx.log("error", `Model tanimadi: ${err.message}`);
      ctx.toast("Model tanimadi — sohbete bakin", 6000);
    } finally {
      refreshModelStatus();
    }
  });

  $("set-background").addEventListener("click", async () => {
    store.backgroundListen = !store.backgroundListen;
    saveStore();
    syncSettings();

    if (store.backgroundListen) {
      // Arka planda dinlemenin anlami olmasi icin acilista baslatma da acik
      // olmali; kullaniciyi ayri bir adima zorlamak yerine birlikte aciyoruz.
      try {
        await system.setAutoStart(true);
        syncSettings();
      } catch {
        /* ayarlanamadiysa asagidaki mesaj yine de yol gosterir */
      }
      ctx.log(
        "system",
        "Arka planda dinleme acildi. Bilgisayar acildiginda DRA pencere " +
          "gostermeden baslayacak ve adini duyunca kendini gosterecek.",
      );
      ctx.toast("Arka planda dinleme acik");
    } else {
      ctx.toast("Arka planda dinleme kapatildi");
    }
    ctx.onBackgroundChanged();
  });

  $("perm-revoke-all").addEventListener("click", async () => {
    try {
      await system.revokePermission("*");
      ctx.log("system", "Tum erisim izinleri geri alindi.");
      ctx.toast("Tum izinler geri alindi");
    } catch (err) {
      ctx.toast(`Izinler geri alinamadi: ${err.message}`, 5000);
    }
    renderPermissions();
  });

  $("set-diag").addEventListener("click", () => ctx.runDiagnostics());

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
  renderApps();
  syncSettings();

  // Alarm geri sayimlari dakikada bir tazelenir.
  setInterval(renderAlarms, 30_000);
}

/** Belirli bir sekmeyi disaridan acar (sesli komutlar icin). */
export function openTab(name) {
  showTab(name);
}
