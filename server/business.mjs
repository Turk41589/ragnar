/**
 * Isletme raporlari.
 *
 * Musteri mesajlarindan uc rapor cikarir: memnuniyet, sikayet ve yanit
 * performansi. Hepsi depodaki mesajlara bakar; hangi kaynaktan geldigi
 * yalnizca bir kirilim.
 *
 * Sayilar uydurulmuyor: memnuniyet orani DUYGU TASIYAN mesajlar
 * uzerinden hesaplaniyor. Notr ve soru mesajlarini paya katmak orani
 * yapay olarak sisirirdi.
 */

import * as messages from "./messages.mjs";
import { classify, SINIF } from "./sentiment.mjs";

/** Mesajlari siniflandirip gruplar. */
async function collect(days) {
  const hepsi = await messages.list({ limit: 2000 });
  const sinir = Date.now() - days * 86400000;
  const son = hepsi.filter((m) => m.at >= sinir);

  const gruplar = { memnun: [], sikayet: [], soru: [], notr: [] };
  for (const m of son) {
    const s = classify(m.text);
    gruplar[s.kind].push({ ...m, hits: s.hits, score: s.score });
  }
  return { son, gruplar };
}

/** Memnuniyet raporu. */
export async function satisfaction({ days = 30 } = {}) {
  const { son, gruplar } = await collect(days);

  const memnun = gruplar[SINIF.MEMNUN].length;
  const sikayet = gruplar[SINIF.SIKAYET].length;
  // Oran yalnizca DUYGU TASIYAN mesajlar uzerinden; soru ve notr
  // mesajlari paya katmak orani yapay olarak yukseltirdi.
  const duygulu = memnun + sikayet;

  return {
    days,
    total: son.length,
    memnun,
    sikayet,
    soru: gruplar[SINIF.SORU].length,
    notr: gruplar[SINIF.NOTR].length,
    // Duygu tasiyan mesaj yoksa oran YOK; sifir demek yaniltici olurdu.
    rate: duygulu ? Math.round((memnun / duygulu) * 100) : null,
    basis: duygulu,
    samples: gruplar[SINIF.MEMNUN]
      .slice(0, 5)
      .map((m) => ({ from: m.from, source: m.source, text: m.text.slice(0, 120) })),
  };
}

/** Sikayet raporu — en yenilerden basa. */
export async function complaints({ days = 30, limit = 20 } = {}) {
  const { gruplar } = await collect(days);
  const liste = gruplar[SINIF.SIKAYET].sort((a, b) => b.at - a.at);

  // Hangi konudan kac sikayet var? (kural eslesmelerinden)
  const konular = {};
  for (const m of liste) {
    for (const h of m.hits) {
      const anahtar = h.replace(" (olumsuzlanmis)", "");
      konular[anahtar] = (konular[anahtar] || 0) + 1;
    }
  }

  return {
    days,
    total: liste.length,
    // Yanitlanmamis sikayet en acil is.
    unanswered: liste.filter((m) => m.status !== "yanitlandi").length,
    topics: Object.entries(konular)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ad, n]) => ({ topic: ad, count: n })),
    items: liste.slice(0, limit).map((m) => ({
      id: m.id,
      from: m.from,
      source: m.source,
      at: m.at,
      status: m.status,
      text: m.text.slice(0, 200),
    })),
  };
}

/** Yanit performansi: kacina yanit verilmis, ne kadar surede? */
export async function responsiveness({ days = 30 } = {}) {
  const { son } = await collect(days);
  const yanitlanan = son.filter((m) => m.status === "yanitlandi" && m.repliedAt);

  const sureler = yanitlanan
    .map((m) => m.repliedAt - m.at)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);

  const ortanca = sureler.length
    ? sureler.length % 2
      ? sureler[(sureler.length - 1) / 2]
      : (sureler[sureler.length / 2 - 1] + sureler[sureler.length / 2]) / 2
    : null;

  return {
    days,
    total: son.length,
    answered: yanitlanan.length,
    unanswered: son.length - yanitlanan.length,
    rate: son.length ? Math.round((yanitlanan.length / son.length) * 100) : null,
    medianMinutes: ortanca === null ? null : Math.round(ortanca / 60000),
  };
}

/** Ucunu birden — "isletme raporu" komutu icin. */
export async function report({ days = 30 } = {}) {
  const [m, s, y] = await Promise.all([
    satisfaction({ days }),
    complaints({ days }),
    responsiveness({ days }),
  ]);
  return { days, satisfaction: m, complaints: s, responsiveness: y, at: Date.now() };
}
