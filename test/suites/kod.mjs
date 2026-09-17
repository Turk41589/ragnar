/**
 * Kod taramasi.
 *
 * Calistirmadan once yakalanabilecek hatalar icin. Su an tek bir sey
 * ariyor ama en pahaliya patlayan sey oydu: hicbir yerde tanimlanmamis
 * bir degiskenin kullanilmasi.
 *
 * Gercek olay: `electron/speech-engine.mjs` icinde `HERE` tanimsizdi.
 * Kod yolu yalnizca "model kurulu" durumunda calisiyordu, testlerde model
 * hic kurulmuyordu, hata da bir async yurutucunun icinde kayboluyordu.
 * Sonuc: mikrofon hic acilmadi ve hicbir yerde hata gorunmedi.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../helpers.mjs";
import { parserHazir, scanFile } from "../tanimsiz.mjs";

export const name = "Kod taramasi";
export const standalone = true;

/** Taranacak klasorler ve uzantilari. */
const HEDEFLER = [
  ["server", ".mjs"],
  ["electron", ".mjs"],
  ["electron", ".cjs"],
  [join("web", "js"), ".js"],
  ["test", ".mjs"],
  [join("test", "suites"), ".mjs"],
];

async function dosyalar() {
  const liste = [];
  for (const [rel, uzanti] of HEDEFLER) {
    const dir = join(ROOT, rel);
    let girenler;
    try {
      girenler = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of girenler) {
      if (e.isFile() && e.name.endsWith(uzanti)) liste.push(join(dir, e.name));
    }
  }
  return liste;
}

export async function run(_page, _base, t) {
  if (!(await parserHazir())) {
    // Ayristirici yoksa tarama yapilamaz; bunu sessizce gecmiyoruz ama
    // paketin tamamini da dusurmuyoruz.
    t.ok(false, "acorn kurulu degil — kod taramasi yapilamadi (npm install)");
    return;
  }

  const liste = await dosyalar();
  t.ok(liste.length > 20, `taranacak dosya bulundu (${liste.length})`);

  const bulgular = [];
  for (const dosya of liste) {
    for (const b of scanFile(dosya)) {
      bulgular.push(`${b.path.replace(ROOT + "/", "")}:${b.line} → ${b.name} (${b.message})`);
    }
  }

  t.eq(
    bulgular,
    [],
    bulgular.length
      ? `tanimsiz degisken yok — bulunanlar: ${bulgular.join(" | ")}`
      : "tanimsiz degisken yok",
  );
}
