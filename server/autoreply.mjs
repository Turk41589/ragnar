/**
 * Otomatik yanit.
 *
 * DIKKAT — bu modul GERCEK MUSTERIYE mesaj gonderiyor. Geri alinamaz.
 * Bu yuzden bastan kisitli tasarlandi:
 *
 *  - Varsayilan KAPALI. Acik olmadan tek bir mesaj gitmez.
 *  - "Deneme kipi" var: neyi kime gonderecegini gosterir, GONDERMEZ.
 *    Kurallari once burada gormek lazim.
 *  - Ayni mesaja iki kez yanit verilmez.
 *  - Tek turda gonderilebilecek mesaj sayisi sinirli: bir kural yanlis
 *    yazildiysa yuzlerce musteriye gitmesin.
 *  - Sikayet mesajlarina varsayilan olarak otomatik yanit VERILMEZ.
 *    Kizgin musteriye sablon cevap durumu buyutur; kural acikca
 *    "sikayetlere de yanit ver" demedikce elde birakilir.
 *
 * Kurallar anahtar kelime esleme. Yapay zeka yok: hangi mesaja ne
 * gidecegi kullanicinin yazdigi kuralla belli.
 */

import { oku, yaz } from "./kalici.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import * as messages from "./messages.mjs";
import * as sources from "./sources.mjs";
import { classify, SINIF } from "./sentiment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DRA_DATA_DIR || join(HERE, "..", "data");
const FILE = join(DATA_DIR, "autoreply.json");

/** Tek turda en fazla bu kadar mesaj yanitlanir. */
const TUR_SINIRI = 20;

let durum = null;

async function load() {
  if (durum) return durum;
  const d = await oku(FILE, null);
  durum = {
    enabled: Boolean(d?.enabled),
    rules: Array.isArray(d?.rules) ? d.rules : [],
  };
  return durum;
}

async function save() {
  await yaz(FILE, durum);
}

function normalize(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

export async function status() {
  await load();
  return {
    enabled: durum.enabled,
    ruleCount: durum.rules.length,
    activeRules: durum.rules.filter((r) => r.enabled).length,
  };
}

export async function setEnabled(enabled) {
  await load();
  durum.enabled = Boolean(enabled);
  await save();
  return status();
}

export async function list() {
  await load();
  return durum.rules;
}

export async function add({ name, keywords, reply, sources: kaynaklar, answerComplaints }) {
  await load();

  const kelimeler = (Array.isArray(keywords) ? keywords : String(keywords || "").split(","))
    .map((k) => normalize(k))
    .filter(Boolean);
  if (!kelimeler.length) throw new Error("En az bir anahtar kelime gerekiyor.");

  const yanit = String(reply || "").trim();
  if (!yanit) throw new Error("Yanit metni bos olamaz.");
  if (yanit.length > 1000) throw new Error("Yanit 1000 karakteri gecemez.");

  const kural = {
    id: randomUUID(),
    name: String(name || kelimeler[0]).slice(0, 80),
    keywords: kelimeler.slice(0, 20),
    reply: yanit,
    // Bos birakilirsa tum kaynaklarda gecerli.
    sources: Array.isArray(kaynaklar) ? kaynaklar.slice(0, 10) : [],
    // Sikayetlere yanit vermek AYRICA istenmeli.
    answerComplaints: Boolean(answerComplaints),
    enabled: true,
    used: 0,
    createdAt: Date.now(),
  };

  durum.rules.push(kural);
  await save();
  return kural;
}

export async function remove(id) {
  await load();
  const once = durum.rules.length;
  durum.rules = durum.rules.filter((r) => r.id !== id);
  if (durum.rules.length === once) throw new Error("Boyle bir kural yok.");
  await save();
  return { removed: id };
}

export async function toggle(id) {
  await load();
  const kural = durum.rules.find((r) => r.id === id);
  if (!kural) throw new Error("Boyle bir kural yok.");
  kural.enabled = !kural.enabled;
  await save();
  return kural;
}

/**
 * Bir mesaja hangi kural uyuyor?
 * Kurallar yazilma sirasina gore denenir; ilk uyan kazanir.
 */
export function matchRule(rules, mesaj) {
  const n = normalize(mesaj.text);
  const sinif = classify(mesaj.text);

  for (const kural of rules) {
    if (!kural.enabled) continue;
    if (kural.sources.length && !kural.sources.includes(mesaj.source)) continue;
    // Kizgin musteriye sablon cevap durumu buyutur.
    if (sinif.kind === SINIF.SIKAYET && !kural.answerComplaints) continue;
    if (!kural.keywords.some((k) => n.includes(k))) continue;
    return { rule: kural, sinif };
  }
  return null;
}

/**
 * Yanitlanmamis mesajlari gezer.
 *
 * @param {object} o
 * @param {boolean} [o.dryRun] true ise HICBIR SEY GONDERMEZ, ne olacagini doner.
 */
export async function run({ dryRun = false } = {}) {
  await load();

  if (!durum.enabled && !dryRun) {
    return { skipped: "kapali", planned: [], sent: [], errors: [] };
  }

  const bekleyenler = await messages.list({ status: "yeni", limit: 200 });
  const plan = [];

  for (const m of bekleyenler) {
    const eslesme = matchRule(durum.rules, m);
    if (!eslesme) continue;
    plan.push({
      messageId: m.id,
      source: m.source,
      target: m.handle || m.from,
      from: m.from,
      text: m.text,
      reply: eslesme.rule.reply,
      ruleId: eslesme.rule.id,
      ruleName: eslesme.rule.name,
      kind: eslesme.sinif.kind,
    });
    if (plan.length >= TUR_SINIRI) break;
  }

  if (dryRun) {
    return { dryRun: true, planned: plan, sent: [], errors: [] };
  }

  const gonderildi = [];
  const hatalar = [];

  for (const p of plan) {
    try {
      await sources.reply(p.source, p.target, p.reply);
      await messages.markReplied(p.messageId, p.reply);
      const kural = durum.rules.find((r) => r.id === p.ruleId);
      if (kural) kural.used += 1;
      gonderildi.push(p);
    } catch (err) {
      // Gonderilemeyen mesaj YANITLANDI sayilmaz; elde kalsin.
      hatalar.push({ messageId: p.messageId, from: p.from, error: err.message });
    }
  }

  if (gonderildi.length) await save();
  return { planned: plan, sent: gonderildi, errors: hatalar };
}

/** Testler icin. */
export function _resetForTests() {
  durum = { enabled: false, rules: [] };
}

export const LIMITS = { TUR_SINIRI };
