/**
 * Musteri mesaji kaynaklari — takilabilir yapi.
 *
 * Kullanici hangi kaynagi kullanacagini secer; DRA da TAM OLARAK o
 * kaynagin ihtiyac duydugu bilgiyi ister. Bilgi listesi burada, kaynagin
 * kendi tanimi icinde duruyor: arayuz de sesli akis da bu listeyi okuyor,
 * hicbir yerde elle yazilmis bir soru yok. Yeni bir kaynak eklemek
 * buraya bir kayit eklemek demek.
 *
 * Her kaynak ayni sozlesmeyi saglar:
 *   configure(bilgiler) → durum
 *   test()              → baglanti sinamasi (mesaj cekmez)
 *   fetch()             → [{externalId, from, handle, text, at}]
 *   send?(hedef, metin) → yanit gonderir (destekleyen kaynaklarda)
 */

import * as mail from "./mail.mjs";
import * as instagram from "./instagram.mjs";
import * as whatsapp from "./whatsapp.mjs";
import * as messages from "./messages.mjs";

/* --------------------------------------------------------------- gmail */

/**
 * Gmail: zaten IMAP ile okuyoruz. Musteri mesaji derken reklam ve
 * bultenleri degil, gercek insanlardan gelenleri kastediyoruz — mail.mjs
 * bu ayrimi zaten yapiyor, burada onu kullaniyoruz.
 */
const gmail = {
  id: "gmail",
  label: "Gmail",
  detail: "Gelen kutunuzdaki gercek kisi mesajlari. Reklam ve bultenler ayiklanir.",
  inbound: "poll",
  canSend: false,
  fields: [
    { key: "user", label: "Gmail adresi", type: "email", required: true,
      hint: "ornek@gmail.com" },
    { key: "pass", label: "Uygulama sifresi", type: "password", required: true,
      hint: "Google Hesabi → Guvenlik → Iki adimli dogrulama → Uygulama sifreleri. " +
        "Normal Gmail sifreniz DEGIL." },
  ],
  configure: (v) => mail.configure({ user: v.user, pass: v.pass }),
  status: () => mail.status(),
  test: async () => {
    const s = await mail.test();
    return { ok: true, detail: `${s.user} — kutuda ${s.total} mesaj` };
  },
  fetch: async () => {
    const ozet = await mail.summary({ days: 7 });
    // Yalnizca kisisel ve is mesajlari musteri sayilir; reklam/bulten degil.
    const secilen = [...(ozet.groups.kisisel || []), ...(ozet.groups.is || [])];
    return secilen.map((m) => ({
      externalId: `${m.email}|${m.date || 0}|${m.subject}`,
      from: m.from,
      handle: m.email,
      text: m.subject,
      at: m.date || Date.now(),
    }));
  },
};

/* ----------------------------------------------------------- instagram */

const ig = {
  id: "instagram",
  label: "Instagram DM",
  detail: "Instagram gelen kutunuzdaki mesajlar. Isletme/Icerik Ureticisi " +
    "hesabi ve bagli bir Facebook Sayfasi gerekiyor.",
  inbound: "poll",
  canSend: true,
  fields: [
    { key: "accountId", label: "Instagram hesap kimligi", type: "text", required: true,
      hint: "Meta Is Paneli → Instagram hesabiniz → kimlik numarasi" },
    { key: "token", label: "Sayfa erisim jetonu", type: "password", required: true,
      hint: "Meta for Developers → uygulamaniz → Graph API Gezgini → " +
        "instagram_manage_messages yetkisiyle uretilen jeton" },
  ],
  configure: (v) => instagram.configure({ token: v.token, accountId: v.accountId }),
  status: () => instagram.status(),
  test: async () => {
    const s = await instagram.test();
    return { ok: true, detail: s.username ? `@${s.username}` : s.name || "baglandi" };
  },
  fetch: () => instagram.fetchMessages(),
  send: (hedef, metin) => instagram.send(hedef, metin),
};

/* ------------------------------------------------------------ whatsapp */

const wa = {
  id: "whatsapp",
  label: "WhatsApp",
  detail: "WhatsApp Business Cloud API. Yanit gondermek her yerden calisir; " +
    "GELEN mesaj icin DRA'nin internetten ulasilabilir olmasi gerekir.",
  inbound: "webhook",
  canSend: true,
  // Kullanici bunu bastan bilsin: kurulum yarida kalirsa sebebi bu.
  warning:
    "WhatsApp'ta gelen mesajlar sorularak alinamiyor; Meta yalnizca webhook " +
    "ile gonderiyor. Yanit gondermek sorunsuz calisir, ama gelen mesajlari " +
    "alabilmek icin DRA'nin adresini disariya acmaniz gerekir.",
  fields: [
    { key: "phoneNumberId", label: "Numara kimligi", type: "text", required: true,
      hint: "Meta panelinde WhatsApp → API Kurulumu → Phone number ID" },
    { key: "token", label: "Kalici erisim jetonu", type: "password", required: true,
      hint: "Meta panelinde Sistem Kullanicisi uzerinden uretilen kalici jeton" },
    { key: "verifyToken", label: "Webhook dogrulama jetonu", type: "text", required: false,
      hint: "Kendi belirlediginiz bir parola; Meta'ya webhook kaydederken " +
        "ayni degeri yazarsiniz. Gelen mesaj almayacaksaniz bos birakin." },
  ],
  configure: (v) => whatsapp.configure({
    token: v.token, phoneNumberId: v.phoneNumberId, verifyToken: v.verifyToken,
  }),
  status: () => whatsapp.status(),
  test: async () => {
    const s = await whatsapp.test();
    return {
      ok: true,
      detail: `${s.name || ""} ${s.phone || ""}`.trim() || "baglandi",
      warning: s.inboundReady ? null :
        "Dogrulama jetonu girilmedi; yanit gonderebilirsiniz ama gelen " +
        "mesajlar ulasmaz.",
    };
  },
  fetch: () => whatsapp.fetchMessages(),
  send: (hedef, metin) => whatsapp.send(hedef, metin),
};

/* -------------------------------------------------------------- elle */

/**
 * Elle giris: hicbir hesap baglamak istemeyen ya da henuz baglayamamis
 * kullanici da isletme modunu kullanabilsin. Kurulum gerektirmez.
 */
const manuel = {
  id: "manuel",
  label: "Elle giris",
  detail: "Mesajlari kendiniz yazarsiniz. Hicbir hesap baglamaniz gerekmez.",
  inbound: "manual",
  canSend: false,
  fields: [],
  configure: () => ({ ready: true }),
  status: () => ({ ready: true }),
  test: async () => ({ ok: true, detail: "Elle giris her zaman hazir" }),
  fetch: async () => [],
};

export const SOURCES = { gmail, instagram: ig, whatsapp: wa, manuel };

/* ------------------------------------------------------------- yuzey */

/** Arayuzun gosterecegi kaynak listesi (islev icermez, veridir). */
export function catalog() {
  return Object.values(SOURCES).map((k) => ({
    id: k.id,
    label: k.label,
    detail: k.detail,
    inbound: k.inbound,
    canSend: k.canSend,
    warning: k.warning || null,
    fields: k.fields,
    ready: Boolean(k.status().ready),
  }));
}

/** Bir kaynagin istedigi bilgiler — DRA sesli sorarken de bunu okur. */
export function fieldsOf(id) {
  const k = SOURCES[id];
  if (!k) throw new Error(`Bilinmeyen kaynak: ${id}`);
  return k.fields;
}

export function configure(id, values) {
  const k = SOURCES[id];
  if (!k) throw new Error(`Bilinmeyen kaynak: ${id}`);

  // Zorunlu alanlar eksikse kaynak hic yapilandirilmasin: yarim
  // yapilandirma "hazir" gorunup ilk kullanimda patliyor.
  const eksik = k.fields
    .filter((f) => f.required && !String(values?.[f.key] ?? "").trim())
    .map((f) => f.label);
  if (eksik.length) {
    throw Object.assign(
      new Error(`Su bilgiler eksik: ${eksik.join(", ")}`),
      { code: "MISSING_FIELDS", fields: eksik },
    );
  }

  return { id, status: k.configure(values || {}) };
}

export async function test(id) {
  const k = SOURCES[id];
  if (!k) throw new Error(`Bilinmeyen kaynak: ${id}`);
  return await k.test();
}

/**
 * Secili kaynaklardan mesaj ceker ve depoya yazar.
 * Bir kaynak patlarsa digerleri devam eder: tek bir bozuk hesap
 * butun raporu engellememeli.
 */
export async function collect(ids) {
  const sonuc = { added: 0, bySource: {}, errors: {} };

  for (const id of ids || []) {
    const k = SOURCES[id];
    if (!k) {
      sonuc.errors[id] = "Bilinmeyen kaynak";
      continue;
    }
    if (!k.status().ready) {
      sonuc.errors[id] = "Yapilandirilmamis";
      continue;
    }

    try {
      const gelen = await k.fetch();
      const { added } = await messages.ingest(id, gelen);
      sonuc.bySource[id] = added;
      sonuc.added += added;
    } catch (err) {
      sonuc.errors[id] = err.message;
    }
  }

  return sonuc;
}

/** Yanit gonderir (kaynak destekliyorsa). */
export async function reply(id, hedef, metin) {
  const k = SOURCES[id];
  if (!k) throw new Error(`Bilinmeyen kaynak: ${id}`);
  if (!k.send) {
    throw new Error(`${k.label} uzerinden yanit gonderilemiyor.`);
  }
  return await k.send(hedef, metin);
}
