/**
 * Kalici JSON deposu — guvenli yazma.
 *
 * Neden ayri bir modul: dort ayri yerde ayni sey yaziliydi ve hepsinde
 * ayni iki sorun vardi.
 *
 * 1) `writeFile` ATOMIK DEGIL. Dosya once bosaltilir, sonra doldurulur.
 *    Tam o arada uygulama kapanirsa (elektrik kesintisi, cokme, gorev
 *    yoneticisinden kapatma) geriye yarim ya da bos bir dosya kalir.
 *    Okuma tarafi bozuk JSON'u yakalayip sessizce bos listeye donuyordu:
 *    yani musteri mesajlari, kurallar, izinler hiçbir uyari olmadan
 *    kaybolabiliyordu.
 *
 *    Cozum: once yanina gecici bir dosya yaziliyor, sonra `rename` ile
 *    yerine konuyor. `rename` dosya sisteminde tek adimdir — ya eski
 *    dosya ya yeni dosya gorunur, arada bir hal yoktur.
 *
 * 2) Es zamanli iki yazma birbirinin ustune biniyordu. Her dosya icin
 *    bir sira tutuluyor; yazmalar birbirini beklemek zorunda.
 */

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** Dosya yolu → suren yazma sozu. Ayni dosyaya yazmalar sirayla gider. */
const kuyruklar = new Map();

/**
 * JSON okur. Dosya yoksa ya da bozuksa `varsayilan` doner.
 * Bozuk dosyanin kendisi silinmez — kullanici isterse bakabilsin.
 */
export async function oku(dosya, varsayilan) {
  try {
    return JSON.parse(await readFile(dosya, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      // Dosya var ama okunamiyor: sessizce yutmak veri kaybini gizler.
      console.error(`[dra] ${dosya} okunamadi (${err.message}); varsayilana donuluyor.`);
    }
    return varsayilan;
  }
}

/** JSON yazar: once gecici dosyaya, sonra yerine tasiyarak. */
export async function yaz(dosya, veri) {
  const onceki = kuyruklar.get(dosya) || Promise.resolve();
  const simdiki = onceki
    .catch(() => {})          // onceki yazma patladiysa bu yazma yine de denensin
    .then(() => gercektenYaz(dosya, veri));

  kuyruklar.set(dosya, simdiki);
  try {
    await simdiki;
  } finally {
    // Sira bosaldiysa haritayi buyutmeye devam etme.
    if (kuyruklar.get(dosya) === simdiki) kuyruklar.delete(dosya);
  }
}

async function gercektenYaz(dosya, veri) {
  await mkdir(dirname(dosya), { recursive: true });
  // Gecici ad her yazmada farkli: iki surec ayni anda yazsa bile
  // birbirinin gecici dosyasini ezmesin.
  const gecici = `${dosya}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(gecici, JSON.stringify(veri, null, 2));
    await rename(gecici, dosya);
  } catch (err) {
    await unlink(gecici).catch(() => {});
    throw err;
  }
}

/** Testler icin: bekleyen tum yazmalarin bitmesini bekler. */
export async function bekle() {
  await Promise.allSettled([...kuyruklar.values()]);
}
