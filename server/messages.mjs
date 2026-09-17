/**
 * Musteri mesajlari — tek depo, cok kaynak.
 *
 * Gmail'den, Instagram'dan, WhatsApp'tan ya da elle girilen mesajlar
 * ayni bicimde burada toplanir. Raporlar ve otomatik yanit bu depoya
 * bakar; hangi kaynaktan geldigi yalnizca bir alan.
 *
 * Ayni mesajin iki kez girmemesi icin her kaynak kendi kimligini
 * (externalId) veriyor; tekrar cekimlerde o kimlik varsa atlanir.
 */

import { join, dirname } from "node:path";
import { oku, yaz } from "./kalici.mjs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { classify } from "./sentiment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DRA_DATA_DIR || join(HERE, "..", "data");
const FILE = join(DATA_DIR, "messages.json");

/** Depoda tutulan en fazla mesaj. Eskiler dusuyor. */
const MAX = 2000;

export const DURUM = {
  YENI: "yeni",
  OKUNDU: "okundu",
  YANITLANDI: "yanitlandi",
};

let kayitlar = null;

async function load() {
  if (kayitlar) return kayitlar;
  const data = await oku(FILE, null);
  kayitlar = Array.isArray(data?.messages) ? data.messages : [];
  return kayitlar;
}

async function save() {
  await yaz(FILE, { messages: kayitlar });
}

/**
 * Kaynak kendi kimligini vermediyse icerikten tureteriz.
 * Boylece ayni mesaj tekrar cekildiginde yine ayni kimlige sahip olur.
 */
function makeId(source, m) {
  if (m.externalId) return `${source}:${m.externalId}`;
  const ozet = createHash("sha1")
    .update(`${source}|${m.from || ""}|${m.text || ""}|${m.at || ""}`)
    .digest("hex")
    .slice(0, 16);
  return `${source}:${ozet}`;
}

/**
 * Kaynaktan gelen mesajlari depoya yazar; yalnizca YENI olanlari.
 * Kac tanesinin eklendigini dondurur.
 */
export async function ingest(source, gelenler) {
  await load();
  const varOlan = new Set(kayitlar.map((m) => m.id));
  const yeniler = [];

  for (const m of gelenler || []) {
    const metin = String(m.text || "").trim();
    if (!metin) continue;

    const id = makeId(source, m);
    if (varOlan.has(id)) continue;
    varOlan.add(id);

    yeniler.push({
      id,
      source,
      externalId: m.externalId || null,
      from: String(m.from || "bilinmiyor").slice(0, 120),
      handle: m.handle ? String(m.handle).slice(0, 160) : null,
      text: metin.slice(0, 4000),
      // Siniflama girerken bir kez yapiliyor; liste ve raporlar bunu okur.
      kind: classify(metin).kind,
      at: Number.isFinite(m.at) ? m.at : Date.now(),
      status: DURUM.YENI,
      reply: null,
      repliedAt: null,
    });
  }

  if (yeniler.length) {
    kayitlar.push(...yeniler);
    // En yeniler kalsin: depo sinirsiz buyumesin.
    kayitlar.sort((a, b) => a.at - b.at);
    if (kayitlar.length > MAX) kayitlar = kayitlar.slice(-MAX);
    await save();
  }

  return { added: yeniler.length, messages: yeniler };
}

/** Mesajlari dondurur; en yeniler basta. */
export async function list({ source = null, status = null, limit = 200 } = {}) {
  await load();
  return kayitlar
    .filter((m) => (!source || m.source === source) && (!status || m.status === status))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export async function get(id) {
  await load();
  return kayitlar.find((m) => m.id === id) || null;
}

export async function markRead(id) {
  await load();
  const m = kayitlar.find((x) => x.id === id);
  if (!m) throw new Error("Boyle bir mesaj yok.");
  if (m.status === DURUM.YENI) m.status = DURUM.OKUNDU;
  await save();
  return m;
}

export async function markReplied(id, reply) {
  await load();
  const m = kayitlar.find((x) => x.id === id);
  if (!m) throw new Error("Boyle bir mesaj yok.");
  m.status = DURUM.YANITLANDI;
  m.reply = String(reply || "").slice(0, 2000);
  m.repliedAt = Date.now();
  await save();
  return m;
}

export async function remove(id) {
  await load();
  const once = kayitlar.length;
  kayitlar = kayitlar.filter((m) => m.id !== id);
  if (kayitlar.length === once) throw new Error("Boyle bir mesaj yok.");
  await save();
  return { removed: id };
}

/** Kaynak ve durum kirilimli ozet. */
export async function summary({ days = 7 } = {}) {
  await load();
  const sinir = Date.now() - days * 86400000;
  const son = kayitlar.filter((m) => m.at >= sinir);

  const kaynak = {};
  const durum = {};
  for (const m of son) {
    kaynak[m.source] = (kaynak[m.source] || 0) + 1;
    durum[m.status] = (durum[m.status] || 0) + 1;
  }

  return {
    days,
    total: son.length,
    allTime: kayitlar.length,
    bySource: kaynak,
    byStatus: durum,
    unanswered: son.filter((m) => m.status !== DURUM.YANITLANDI).length,
  };
}

/** Testler icin. */
export function _resetForTests() {
  kayitlar = [];
}
