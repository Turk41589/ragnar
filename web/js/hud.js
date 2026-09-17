/**
 * HUD: ekrandaki tum metin/gosterge guncellemeleri buradan gecer.
 * Is mantigi yok — sadece DOM.
 */

import { S, STATE_LABEL, state, on } from "./state.js";


/**
 * Yalnizca http/https adreslerini gecirir.
 *
 * Karttaki baglar ve gorseller DISARIDAN geliyor: arama sonuclari,
 * e-posta icerikleri, sayfa onizlemeleri. Bunlarin arasina "javascript:"
 * ile baslayan bir adres karisirsa, tiklandiginda uygulamanin KENDI
 * sayfasinda calisir — ve bu sayfada `window.dra` var, yani bilgisayara
 * erisim var. target="_blank" bunu engellemiyor: tarayicilar
 * "javascript:" baglarini yeni pencerede degil, bulundugu sayfada
 * calistiriyor.
 *
 * Kaynak modulleri de kendi taraflarinda suzuyor; burasi son kapi.
 */
export function guvenliAdres(url) {
  if (!url) return null;
  try {
    // TABAN ADRES BILEREK VERILMIYOR: bu adresler disaridan geliyor ve
    // goreli olmalari icin bir sebep yok. Taban verilirse "/bir/sey"
    // kendi sayfamiza cozuluyor ve gecerli sayiliyor. Mutlak http(s)
    // istiyoruz, baskasi degil.
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const $ = (id) => document.getElementById(id);

const el = {
  sleep: $("sleep-screen"),
  sleepSub: $("sleep-sub"),
  sleepMeter: $("sleep-meter"),
  sleepLevel: $("sleep-level"),
  boot: $("boot"),
  bootLog: $("boot-log"),
  hud: $("hud"),
  statePill: $("state-pill"),
  privacyPill: $("privacy-pill"),
  clockTime: $("clock-time"),
  clockDate: $("clock-date"),
  coreLabel: $("core-state-label"),
  caption: $("core-caption"),
  log: $("log"),
  timers: $("timers"),
  gauges: $("gauges"),
  toast: $("toast"),
  consent: $("consent"),
  consentTitle: $("consent-title"),
  consentDetail: $("consent-detail"),
  consentYes: $("consent-yes"),
  consentNo: $("consent-no"),
};

const GAUGE = {};
for (const li of el.gauges.querySelectorAll("li")) {
  GAUGE[li.dataset.gauge] = { li, bar: li.querySelector(".gauge i"), value: li.querySelector("b") };
}

/* ------------------------------------------------------------------- saat */

const DAYS = ["Pazar", "Pazartesi", "Sali", "Carsamba", "Persembe", "Cuma", "Cumartesi"];
const MONTHS = [
  "Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran",
  "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik",
];

export function formatDate(d = new Date()) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${DAYS[d.getDay()]}`;
}

export function formatTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tickClock() {
  const now = new Date();
  el.clockTime.textContent = formatTime(now);
  el.clockDate.textContent = formatDate(now);
}

setInterval(tickClock, 1000);
tickClock();

/* ------------------------------------------------------------- ekran gecisleri */

export function showSleep() {
  el.hud.hidden = true;
  el.boot.hidden = true;
  el.sleep.hidden = false;
}

export function showHud() {
  el.sleep.hidden = true;
  el.boot.hidden = true;
  el.hud.hidden = false;
}

/** Uyku ekranindaki alt yazi. tone: ok | warn | error | null */
export function sleepStatus(text, tone = null) {
  el.sleepSub.textContent = text;
  if (tone) el.sleepSub.dataset.tone = tone;
  else delete el.sleepSub.dataset.tone;
}

/** Uyku ekranindaki mikrofon seviye cubugu. */
export function sleepMeter(visible, level = 0) {
  el.sleepMeter.hidden = !visible;
  el.sleepLevel.style.width = `${Math.round(level * 100)}%`;
}

/* ------------------------------------------------------------- acilis dizisi */

const BOOT_LINES = [
  "DRA CEKIRDEK v2.0  ................  YUKLENIYOR",
  "ses tanima modulu  ................  HAZIR",
  "konusma sentezi    ................  HAZIR",
  "komut motoru       ................  HAZIR",
  "alarm servisi      ................  HAZIR",
  "arayuz katmani     ................  HAZIR",
  "dis baglanti       ................  YOK",
  "",
  "TUM SISTEMLER YEREL.",
];

/**
 * Acilis dizisini oynatir; bittiginde coz.
 *
 * Ilerleme KARE SAYISINA degil, GECEN SUREYE bagli. Karakter basina
 * setTimeout kullanmak tarayicinin ic ice zamanlayici kenetlemesi yuzunden
 * olcumde 4 saniyeyi buluyordu; kare sayma ise dusuk FPS'te uzuyordu.
 * Sureye bagli ilerleme her makinede ayni suruyor.
 */
const BOOT_DURATION_MS = 1100;

export function playBoot() {
  return new Promise((resolve) => {
    el.sleep.hidden = true;
    el.hud.hidden = true;
    el.boot.hidden = false;
    el.bootLog.textContent = "";

    const script = BOOT_LINES.join("\n");
    const started = performance.now();

    const frame = (now) => {
      const progress = Math.min(1, (now - started) / BOOT_DURATION_MS);
      el.bootLog.textContent = script.slice(0, Math.ceil(script.length * progress));

      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }
      setTimeout(() => {
        el.boot.hidden = true;
        resolve();
      }, 220);
    };

    requestAnimationFrame(frame);
  });
}

/* ------------------------------------------------------------------- durum */

export function setCaption(text, kind = null) {
  el.caption.textContent = text || "";
  if (kind) el.caption.dataset.kind = kind;
  else delete el.caption.dataset.kind;
}

const PILL_TONE = {
  [S.IDLE]: "ok",
  [S.LISTENING]: "ok",
  [S.THINKING]: "busy",
  [S.SPEAKING]: "ok",
  [S.ERROR]: "error",
  [S.SLEEPING]: null,
  [S.WAKING]: "busy",
};

on("state", ({ next }) => {
  el.coreLabel.textContent = STATE_LABEL[next] || next.toUpperCase();
  el.statePill.querySelector("b").textContent = (STATE_LABEL[next] || next).toLowerCase();
  const tone = PILL_TONE[next];
  if (tone) el.statePill.dataset.tone = tone;
  else delete el.statePill.dataset.tone;
});

/**
 * Ses tanimanin nerede calistigini gosterir.
 * Tarayici cihaz uzerinde tanima sunuyorsa ses disari cikmaz; sunmuyorsa
 * bunu gizlemek yerine acikca yaziyoruz.
 */
export function setPrivacyPill(mode) {
  const pill = el.privacyPill;
  const label = pill.querySelector("b");
  if (mode === "local") {
    label.textContent = "cihazda";
    pill.dataset.tone = "ok";
    pill.title = "Ses tanima cihazinizda calisiyor, ses disari cikmiyor.";
  } else if (mode === "cloud") {
    label.textContent = "tarayici servisi";
    pill.dataset.tone = "warn";
    pill.title =
      "Tarayicinin ses tanima servisi kullaniliyor; ses tarayici saticisina gidiyor. " +
      "Yalnizca yazarak kullanmak icin mikrofonu kapatin.";
  } else {
    label.textContent = "yazi modu";
    delete pill.dataset.tone;
    pill.classList.add("statuspill--muted");
    pill.title = "Mikrofon kapali. Hicbir ses kaydedilmiyor.";
    return;
  }
  pill.classList.remove("statuspill--muted");
}

/* ------------------------------------------------------------------ olcerler */

export function setGauge(name, percent, label, tone = null) {
  const g = GAUGE[name];
  if (!g) return;
  g.bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (label !== undefined) g.value.textContent = label;
  if (tone) g.li.dataset.tone = tone;
  else delete g.li.dataset.tone;
}

/* ------------------------------------------------------------------ sohbet */

const WHO_LABEL = {
  user: "siz",
  dra: "dra",
  system: "sistem",
  error: "hata",
};

/**
 * Sohbete bir mesaj ekler ve metin dugumunu dondurur.
 * Dondurulen dugum sonradan guncellenebilir (or. yazilirken buyuyen yanit).
 *
 * who: user | dra | system | error
 */
export function log(who, text) {
  const li = document.createElement("li");
  li.dataset.who = who;

  // Sistem satirlarinda kim/saat basligi gereksiz gurultu yapar.
  if (who !== "system") {
    const head = document.createElement("div");
    head.className = "chat__who";
    const name = document.createElement("span");
    name.textContent = WHO_LABEL[who] || who;
    const time = document.createElement("time");
    time.textContent = formatTime();
    head.append(name, time);
    li.append(head);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat__bubble";
  bubble.textContent = text;
  li.append(bubble);

  el.log.append(li);
  while (el.log.children.length > 80) el.log.firstElementChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
  return bubble;
}

export function clearLog() {
  el.log.replaceChildren();
}

/* --------------------------------------------------------------- sayaclar */
/* Notlar ve alarmlar panel.js tarafindan yonetilir; burada yalnizca
   geri sayim zamanlayicilari cizilir. */

export function renderTimers(timers) {
  el.timers.replaceChildren();
  if (!timers.length) {
    const li = document.createElement("li");
    li.className = "list__empty";
    li.textContent = "Aktif zamanlayici yok";
    el.timers.append(li);
    return;
  }
  for (const t of timers) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "alarms__body";
    name.textContent = t.label;
    const left = document.createElement("b");
    const secs = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    left.textContent = `${mm}:${ss}`;
    li.append(name, left);
    el.timers.append(li);
  }
}

/* ------------------------------------------------------------------ bildirim */

let toastTimer = null;

export function toast(text, ms = 2600) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, ms);
}

/* ------------------------------------------------------- canli seviye baglama */

on("level", (level) => {
  state.level = level;
  const pct = Math.round(level * 100);
  setGauge("mic", pct, `${pct}%`);
  if (!el.sleep.hidden) sleepMeter(state.micEnabled, level);
});

/* ------------------------------------------------------------- izin sorusu */

/**
 * Bekleyen izin sorusunu cozen fonksiyon. Ayni anda yalnizca bir soru
 * olabilir; ikinci bir istek gelirse birincisi beklemeye devam eder ve
 * cagiran taraf sirayla sorar.
 */
let consentResolve = null;

export const consentPending = () => Boolean(consentResolve);

/**
 * Kullaniciya "su yetkiyi veriyor musun" diye sorar.
 * Karari dondurur; iptal (Esc / Hayir) false demektir.
 */
export function askPermission({ title, detail }) {
  // Onceki soru hala aciksa onu reddedip yenisini soruyoruz; aksi halde
  // eski soru sonsuza kadar askida kalirdi.
  if (consentResolve) settleConsent(false);

  el.consentTitle.textContent = title || "Erisim izni";
  el.consentDetail.textContent = detail || "";
  el.consent.hidden = false;
  // Varsayilan odak "Hayir"da: kazara Enter'a basmak izin vermesin.
  el.consentNo.focus();

  return new Promise((resolve) => {
    consentResolve = resolve;
  });
}

/** Sesle ya da dugmeyle gelen cevabi uygular. */
export function settleConsent(approved) {
  if (!consentResolve) return false;
  const resolve = consentResolve;
  consentResolve = null;
  el.consent.hidden = true;
  resolve(Boolean(approved));
  return true;
}

el.consentYes.addEventListener("click", () => settleConsent(true));
el.consentNo.addEventListener("click", () => settleConsent(false));
el.consent.addEventListener("keydown", (event) => {
  if (event.key === "Escape") settleConsent(false);
});

/* ------------------------------------------------------------ rapor karti */

/** Bir olcum satiri: etiket, deger ve (varsa) doluluk cubugu. */
function cardRow(label, value, percent) {
  const row = document.createElement("li");
  row.className = "card__row";

  const name = document.createElement("span");
  name.textContent = label;

  const val = document.createElement("b");
  val.textContent = value;

  row.append(name, val);

  if (Number.isFinite(percent)) {
    const bar = document.createElement("div");
    bar.className = "card__bar";
    const fill = document.createElement("i");
    // Cubuk anime olarak dolsun: rapor "sunum" gibi gorunsun.
    fill.style.setProperty("--hedef", `${Math.min(100, Math.max(0, percent))}%`);
    if (percent >= 90) fill.dataset.level = "kritik";
    else if (percent >= 75) fill.dataset.level = "yuksek";
    bar.append(fill);
    row.append(bar);
  }

  return row;
}

/**
 * Sohbete gorsel bir rapor karti basar.
 *
 * Kullanici "gif gibi gorsel sunum" istedi. Hareketli goruntu yerine
 * canli cizilen bir kart kullaniyoruz: ayni sunum etkisini veriyor ama
 * veriler gercek, metin secilebilir ve ekran okuyucu okuyabiliyor.
 *
 * @param {{title: string, subtitle?: string, sections: Array}} data
 */
export function logCard(data) {
  const li = document.createElement("li");
  li.dataset.who = "dra";

  const head = document.createElement("div");
  head.className = "chat__who";
  const name = document.createElement("span");
  name.textContent = WHO_LABEL.dra || "DRA";
  const time = document.createElement("time");
  time.textContent = formatTime();
  head.append(name, time);
  li.append(head);

  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("h4");
  title.className = "card__title";
  title.textContent = data.title || "Rapor";
  card.append(title);

  if (data.subtitle) {
    const sub = document.createElement("p");
    sub.className = "card__sub";
    sub.textContent = data.subtitle;
    card.append(sub);
  }

  for (const section of data.sections || []) {
    if (section.heading) {
      const h = document.createElement("p");
      h.className = "card__heading";
      h.textContent = section.heading;
      card.append(h);
    }

    if (section.note) {
      const n = document.createElement("p");
      n.className = "card__note";
      if (section.level) n.dataset.level = section.level;
      n.textContent = section.note;
      card.append(n);
    }

    if (section.rows?.length) {
      const ul = document.createElement("ul");
      ul.className = "card__rows";
      for (const [label, value, percent] of section.rows) {
        ul.append(cardRow(label, value, percent));
      }
      card.append(ul);
    }

    // Gorseller: arastirma kartinda kaynak sayfalarin onizlemeleri.
    if (section.images?.length) {
      const serit = document.createElement("div");
      serit.className = "card__shots";
      for (const g of section.images) {
        const gorselAdres = guvenliAdres(g.src);
        // Adresi guvenli degilse gorseli hic koymuyoruz.
        if (!gorselAdres) continue;

        const bag = guvenliAdres(g.url);
        const kutu = document.createElement(bag ? "a" : "div");
        kutu.className = "card__shot";
        if (bag) {
          kutu.href = bag;
          kutu.target = "_blank";
          kutu.rel = "noopener noreferrer";
        }
        const img = document.createElement("img");
        img.src = gorselAdres;
        img.alt = g.site || "";
        img.loading = "lazy";
        // Gorsel yuklenemezse bos bir kutu kalmasin.
        img.addEventListener("error", () => kutu.remove());
        kutu.append(img);
        if (g.site) {
          const etiket = document.createElement("span");
          etiket.textContent = g.site;
          kutu.append(etiket);
        }
        serit.append(kutu);
      }
      card.append(serit);
    }

    // Kaynak baglari: bilginin nereden geldigi tiklanabilir olmali.
    if (section.links?.length) {
      const ul = document.createElement("ul");
      ul.className = "card__links";
      for (const l of section.links) {
        const li = document.createElement("li");
        const adres = guvenliAdres(l.url);

        // Adres guvenli degilse tiklanabilir YAPMIYORUZ; basligi yine de
        // gosteriyoruz ki sonuc sessizce yok olmasin.
        const a = document.createElement(adres ? "a" : "span");
        if (adres) {
          a.href = adres;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.textContent = l.title || l.url || "";
        li.append(a);
        if (l.site) {
          const site = document.createElement("span");
          site.className = "card__site";
          site.textContent = l.site;
          li.append(site);
        }
        if (l.snippet) {
          const p = document.createElement("p");
          p.textContent = l.snippet;
          li.append(p);
        }
        ul.append(li);
      }
      card.append(ul);
    }

    if (section.items?.length) {
      const ul = document.createElement("ul");
      ul.className = "card__items";
      for (const item of section.items) {
        const li2 = document.createElement("li");
        li2.textContent = item;
        ul.append(li2);
      }
      card.append(ul);
    }
  }

  li.append(card);
  el.log.append(li);
  while (el.log.children.length > 80) el.log.firstElementChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
  return card;
}
