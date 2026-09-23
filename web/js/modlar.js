/**
 * Modlar ve sesli anahtarlari.
 *
 * Her mod bir anahtar gibi: kullanici kendi sectigi bir sozcugu
 * soyleyince mod acilir ya da kapanir. Otomasyon kurallarindan cok daha
 * hafif — bir sozcuk, bir bayrak.
 *
 * Bir mod calismak icin bilgi istiyorsa (jeton, hesap) o bilgilerin
 * listesi burada, modun kendi taniminda duruyor. Eksik bilgi oldugunda
 * DRA sohbette tek tek soruyor; hangi sorunun sorulacagi hicbir yerde
 * elle yazilmiyor, bu listeden okunuyor.
 *
 * Saf modul: DOM yok, ag yok. Karar verir, yan etkiyi cagiran yapar.
 */

import { normalize } from "./match.js";

/**
 * Gmail hesabi TEK bir giris. E-posta raporu da isletme modundaki Gmail
 * kaynagi da ayni hesabi kullaniyor; kullanici bir kez giriyor.
 */
export const GMAIL_ALANLARI = Object.freeze([
  {
    anahtar: "mailUser",
    etiket: "Gmail adresi",
    soru: "Gmail adresinizi yazin.",
    gizli: false,
    temizle: (v) => v.trim().toLowerCase(),
    dogrula: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Bu bir e-posta adresine benzemiyor.",
  },
  {
    anahtar: "mailPass",
    etiket: "Uygulama sifresi",
    soru:
      "Google'in verdigi 16 harfli UYGULAMA SIFRESINI yazin (normal Gmail sifreniz degil). " +
      "Google Hesabi → Guvenlik → Iki adimli dogrulama → Uygulama sifreleri.",
    gizli: true,
    // Google sifreyi dortlu gruplar halinde bosluklu gosteriyor.
    temizle: (v) => v.replace(/\s+/g, ""),
    dogrula: (v) =>
      /^[a-z]{16}$/i.test(v) ? null : "Uygulama sifresi 16 harf olmali (bosluklar onemli degil).",
  },
]);

export const MODLAR = Object.freeze([
  {
    id: "web",
    ad: "Web arastirmasi",
    bayrak: "webMode",
    adlar: ["web", "internet", "arastirma"],
    alanlar: [],
  },
  {
    id: "eposta",
    ad: "E-posta raporu",
    bayrak: "mailMode",
    adlar: ["eposta", "e-posta", "e posta", "mail", "posta"],
    hesap: "gmail",
    alanlar: GMAIL_ALANLARI,
  },
  {
    id: "yayinci",
    ad: "Yayinci destegi",
    bayrak: "streamerMode",
    adlar: ["yayinci", "yayin", "kick"],
    alanlar: [
      {
        anahtar: "kickChannel",
        etiket: "Kick kanal adi",
        soru: "Kick kanal adinizi yazin.",
        gizli: false,
        temizle: (v) => v.trim().replace(/^@/, ""),
        dogrula: (v) => (/^[\w.-]{2,80}$/.test(v) ? null : "Kanal adi yalnizca harf, rakam, _ . - icerebilir."),
      },
      {
        anahtar: "kickToken",
        etiket: "Kick erisim jetonu",
        soru: "Kick erisim jetonunu yazin.",
        gizli: true,
        temizle: (v) => v.trim().replace(/^bearer\s+/i, ""),
        dogrula: (v) => (v.length >= 8 ? null : "Jeton cok kisa gorunuyor."),
      },
    ],
  },
  {
    id: "montaj",
    ad: "Video montaji",
    bayrak: "montageMode",
    adlar: ["montaj"],
    alanlar: [],
  },
  {
    id: "youtube",
    ad: "YouTube",
    bayrak: "youtubeMode",
    adlar: ["youtube", "yutup"],
    alanlar: [
      {
        anahtar: "ytClientId",
        etiket: "Istemci Kimligi",
        soru: "Google Cloud'daki masaustu istemcinizin ISTEMCI KIMLIGINI yazin (…apps.googleusercontent.com).",
        gizli: false,
        temizle: (v) => v.trim(),
        dogrula: (v) =>
          /\.apps\.googleusercontent\.com$/.test(v) ? null : "Istemci kimligi …apps.googleusercontent.com ile biter.",
      },
      {
        anahtar: "ytClientSecret",
        etiket: "Gizli Anahtar",
        soru: "Ayni istemcinin GIZLI ANAHTARINI yazin.",
        gizli: true,
        temizle: (v) => v.trim(),
        dogrula: (v) => (v.length >= 8 ? null : "Gizli anahtar cok kisa gorunuyor."),
      },
    ],
  },
  {
    id: "isletme",
    ad: "Isletme modu",
    bayrak: "businessMode",
    adlar: ["isletme", "dukkan", "musteri"],
    alanlar: [
      {
        anahtar: "businessName",
        etiket: "Isletme adi",
        soru: "Isletmenizin adini yazin.",
        gizli: false,
        temizle: (v) => v.trim().slice(0, 120),
        dogrula: (v) => (v.length >= 2 ? null : "Isletme adi en az 2 harf olmali."),
      },
    ],
  },
]);

export const modBul = (id) => MODLAR.find((m) => m.id === id) || null;

/** Modun eksik bilgileri, sorulacak sirayla. */
export function eksikAlanlar(mod, store) {
  if (!mod) return [];
  return mod.alanlar.filter((a) => !String(store?.[a.anahtar] ?? "").trim());
}

/** Kullanicinin yazdigi degeri alanin kurallarina gore temizler ve dogrular. */
export function alanDegeri(alan, ham) {
  const deger = alan.temizle ? alan.temizle(String(ham ?? "")) : String(ham ?? "").trim();
  if (!deger) return { hata: "Bos birakilamaz." };
  const hata = alan.dogrula ? alan.dogrula(deger) : null;
  return hata ? { hata } : { deger };
}

/* ------------------------------------------------------ sesli anahtar */

const AC = new Set(["ac", "acar", "acin", "acsana", "acalim", "baslat", "etkinlestir"]);
const KAPAT = new Set(["kapat", "kapa", "kapatir", "kapatin", "kapatsana", "kapatalim", "durdur"]);
/** Anahtarin etrafinda soylenebilecek, anlami degistirmeyen sozcukler. */
const DOLGU = new Set(["modu", "modunu", "mod", "modum", "modumu", "lutfen", "hey", "dra", "misin", "musun"]);
const MOD_SOZU = new Set(["modu", "modunu", "mod"]);

/** Karsilastirma icin sade bicim: "Web-Modu!" → "web-modu" */
const sade = (x) =>
  normalize(x).replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Soylenen/yazilan cumle bir mod anahtari mi?
 *
 * Cumlenin TAMAMI anahtar olmali (etrafinda yalnizca "ac/kapat/modu"
 * gibi sozcukler olabilir). "web sitesi ac" web modunu acmamali; yalnizca
 * "web", "web ac", "web modunu kapat" gibi cumleler anahtar sayilir.
 *
 * Doner: { id, istek: "ac" | "kapat" | "degistir" } ya da null
 */
export function anahtarBul(metin, anahtarlar = {}) {
  const n = sade(metin);
  if (!n) return null;
  const sozler = n.split(" ");

  let istek = "degistir";
  if (sozler.some((s) => KAPAT.has(s))) istek = "kapat";
  else if (sozler.some((s) => AC.has(s))) istek = "ac";

  const modDendi = sozler.some((s) => MOD_SOZU.has(s));
  const kalan = sozler.filter((s) => !AC.has(s) && !KAPAT.has(s) && !DOLGU.has(s)).join(" ");
  if (!kalan) return null;

  // 1) Kullanicinin kendi anahtari: tek basina da yeter.
  for (const mod of MODLAR) {
    const a = sade(anahtarlar?.[mod.id] || "");
    if (a && a === kalan) return { id: mod.id, istek };
  }

  // 2) Modun adi: yalnizca "... modunu ac/kapat" diye acikca soylenirse.
  //    Yoksa "youtube" demek YouTube'u acmak yerine modu degistirirdi.
  if (modDendi && istek !== "degistir") {
    for (const mod of MODLAR) {
      if (mod.adlar.some((ad) => sade(ad) === kalan)) return { id: mod.id, istek };
    }
  }
  return null;
}

/**
 * Yeni anahtar sozcugu kabul edilebilir mi?
 * Doner: null (uygun) ya da neden uygun olmadigi.
 */
export function anahtarSorunu(kelime, id, anahtarlar = {}) {
  const k = sade(kelime);
  if (!k) return null; // bos: anahtar kaldiriliyor
  if (k.length < 2) return "Anahtar en az 2 harf olmali.";
  if (k.split(" ").length > 3) return "Anahtar en fazla 3 sozcuk olabilir.";
  if (k.split(" ").every((s) => AC.has(s) || KAPAT.has(s) || DOLGU.has(s))) {
    return "Bu sozcuk tek basina anahtar olamaz; baska bir sozcuk secin.";
  }
  for (const mod of MODLAR) {
    if (mod.id === id) continue;
    if (sade(anahtarlar?.[mod.id] || "") === k) return `Bu anahtar zaten «${mod.ad}» icin kullaniliyor.`;
  }
  return null;
}

/** Anahtarlarin sozcukleri — cihazdaki ses motorunun sozlugune eklenir. */
export function anahtarSozcukleri(anahtarlar = {}) {
  const set = new Set();
  for (const mod of MODLAR) {
    for (const s of sade(anahtarlar?.[mod.id] || "").split(" ")) if (s) set.add(s);
    for (const ad of mod.adlar) for (const s of sade(ad).split(" ")) if (s) set.add(s);
  }
  for (const s of ["modu", "modunu", "ac", "kapat", "iptal", "vazgec"]) set.add(s);
  return [...set];
}

/** Toplama sirasinda "vazgectim" demenin yollari. */
export function iptalMi(metin) {
  const n = sade(metin);
  return /^(iptal|vazgec|vazgectim|bosver|dur|birak|iptal et|cik)$/.test(n);
}
