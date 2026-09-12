/**
 * Stok video deposu.
 *
 * Kullanici videoyu, basligini ve baslik gorselini veriyor; DRA bunlari
 * sirada tutuyor ve belirlenen saatte yayina aliyor. Depo yalnizca
 * KAYIT tutar — yukleme isini youtube.mjs yapar.
 *
 * Dosyalarin kendisi kopyalanmaz: nerede duruyorsa oradan okunur.
 * Kayit data/videos.json icinde durur (depoya girmez).
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DRA_DATA_DIR || join(HERE, "..", "data");
const FILE = join(DATA_DIR, "videos.json");

/** Durumlar. */
export const DURUM = {
  BEKLIYOR: "bekliyor",
  YUKLENIYOR: "yukleniyor",
  YUKLENDI: "yuklendi",
  HATA: "hata",
};

let kayitlar = null;

async function load() {
  if (kayitlar) return kayitlar;
  try {
    const data = JSON.parse(await readFile(FILE, "utf8"));
    kayitlar = Array.isArray(data?.videos) ? data.videos : [];
  } catch {
    kayitlar = [];
  }
  return kayitlar;
}

async function save() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify({ videos: kayitlar }, null, 2));
}

/** "yarin 20:00" gibi degil; arayuz zaten tarih-saat veriyor. */
function parseWhen(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Siraya video ekler.
 * Dosyanin var oldugu burada dogrulanir: yayin saatinde degil, simdi
 * ogrenmek daha iyi.
 */
export async function add({ file, title, description, thumbnail, publishAt, tags, privacy }) {
  await load();

  if (!file) throw new Error("Video dosyasi belirtilmedi.");
  try {
    const bilgi = await stat(file);
    if (!bilgi.isFile()) throw new Error("dosya degil");
  } catch {
    throw new Error(`Video dosyasi bulunamadi: ${file}`);
  }

  const baslik = String(title || "").trim();
  if (!baslik) throw new Error("Video basligi bos olamaz.");
  // YouTube baslik siniri 100 karakter; sonradan reddedilmektense simdi soyle.
  if (baslik.length > 100) throw new Error("Baslik 100 karakteri gecemez.");

  if (thumbnail) {
    try {
      await stat(thumbnail);
    } catch {
      throw new Error(`Baslik gorseli bulunamadi: ${thumbnail}`);
    }
  }

  const ne_zaman = parseWhen(publishAt);
  if (publishAt && ne_zaman === null) {
    throw new Error("Yayin zamani anlasilmadi.");
  }

  const kayit = {
    id: randomUUID(),
    file,
    name: basename(file),
    title: baslik,
    description: String(description || "").slice(0, 4900),
    thumbnail: thumbnail || null,
    tags: Array.isArray(tags) ? tags.filter((x) => typeof x === "string").slice(0, 15) : [],
    privacy: ["public", "unlisted", "private"].includes(privacy) ? privacy : "private",
    publishAt: ne_zaman,
    status: DURUM.BEKLIYOR,
    error: null,
    videoId: null,
    addedAt: Date.now(),
    uploadedAt: null,
  };

  kayitlar.push(kayit);
  await save();
  return kayit;
}

export async function list() {
  await load();
  // Once yayin saati gelenler; saati olmayanlar sona.
  return [...kayitlar].sort((a, b) => {
    if (a.publishAt === b.publishAt) return a.addedAt - b.addedAt;
    if (a.publishAt === null) return 1;
    if (b.publishAt === null) return -1;
    return a.publishAt - b.publishAt;
  });
}

export async function get(id) {
  await load();
  return kayitlar.find((v) => v.id === id) || null;
}

export async function remove(id) {
  await load();
  const once = kayitlar.length;
  kayitlar = kayitlar.filter((v) => v.id !== id);
  if (kayitlar.length === once) throw new Error("Boyle bir video yok.");
  await save();
  return { removed: id };
}

/** Kaydi gunceller (durum, hata, videoId...). */
export async function update(id, patch) {
  await load();
  const kayit = kayitlar.find((v) => v.id === id);
  if (!kayit) throw new Error("Boyle bir video yok.");

  if ("title" in patch) {
    const baslik = String(patch.title || "").trim();
    if (!baslik) throw new Error("Baslik bos olamaz.");
    if (baslik.length > 100) throw new Error("Baslik 100 karakteri gecemez.");
    kayit.title = baslik;
  }
  if ("publishAt" in patch) kayit.publishAt = parseWhen(patch.publishAt);
  if ("description" in patch) kayit.description = String(patch.description || "").slice(0, 4900);
  if ("thumbnail" in patch) kayit.thumbnail = patch.thumbnail || null;
  if ("privacy" in patch && ["public", "unlisted", "private"].includes(patch.privacy)) {
    kayit.privacy = patch.privacy;
  }
  if ("status" in patch && Object.values(DURUM).includes(patch.status)) {
    kayit.status = patch.status;
  }
  if ("error" in patch) kayit.error = patch.error || null;
  if ("videoId" in patch) kayit.videoId = patch.videoId || null;
  if ("uploadedAt" in patch) kayit.uploadedAt = patch.uploadedAt || null;

  await save();
  return kayit;
}

/**
 * Yayin saati gelmis, hala bekleyen videolar.
 * Saati olmayanlar kendiliginden yayinlanmaz — elle baslatilir.
 */
export async function due(now = Date.now()) {
  await load();
  return kayitlar.filter(
    (v) => v.status === DURUM.BEKLIYOR && v.publishAt !== null && v.publishAt <= now,
  );
}

/** Siradaki yayin (arayuzde gostermek icin). */
export async function next(now = Date.now()) {
  await load();
  return (
    [...kayitlar]
      .filter((v) => v.status === DURUM.BEKLIYOR && v.publishAt !== null && v.publishAt > now)
      .sort((a, b) => a.publishAt - b.publishAt)[0] || null
  );
}

export async function summary() {
  await load();
  const say = (d) => kayitlar.filter((v) => v.status === d).length;
  return {
    total: kayitlar.length,
    bekliyor: say(DURUM.BEKLIYOR),
    yuklendi: say(DURUM.YUKLENDI),
    hata: say(DURUM.HATA),
    next: await next(),
  };
}

/** Testler icin: bellekteki kaydi sifirlar. */
export function _resetForTests() {
  kayitlar = [];
}
