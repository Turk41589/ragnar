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
import { readFile } from "node:fs/promises";
import { parserHazir, scanFile, ayniAnahtarlar, asyncYurutucu } from "../tanimsiz.mjs";

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

  const topla = (fn) => {
    const cikti = [];
    for (const dosya of liste) {
      for (const b of fn(dosya)) {
        cikti.push(`${b.path.replace(ROOT + "/", "")}:${b.line} → ${b.name} (${b.message})`);
      }
    }
    return cikti;
  };

  const denetimler = [
    ["tanimsiz degisken yok", scanFile],
    ["ayni nesnede tekrar eden anahtar yok", ayniAnahtarlar],
    ["async yurutuculu Promise yok", asyncYurutucu],
  ];

  for (const [baslik, fn] of denetimler) {
    const bulgular = topla(fn);
    t.eq(bulgular, [], bulgular.length ? `${baslik} — bulunanlar: ${bulgular.join(" | ")}` : baslik);
  }

  await kopruYuzeyi(t);
}

/**
 * IPC yuzeyi iki yerde yaziliyor: `electron/main.mjs` kanallari
 * karsiliyor, `electron/preload.cjs` onlari arayuze aciyor. Ikisi
 * birbirinden kayarsa iki turlu sessiz hata olur:
 *
 *   - preload'da olup main'de olmayan kanal → cagrildiginda patlar,
 *     ama yalnizca o ozellik denendiginde ortaya cikar.
 *   - main'de olup preload'da olmayan kanal → olu uc; arayuz o isi
 *     hic yapamiyordur ve kimse fark etmez.
 */
async function kopruYuzeyi(t) {
  const ana = await readFile(join(ROOT, "electron", "main.mjs"), "utf8");
  const kopru = await readFile(join(ROOT, "electron", "preload.cjs"), "utf8");

  const cikar = (metin, kalip) =>
    [...metin.matchAll(kalip)].map((m) => m[1]).sort();

  // Ana surecte kanallar yerel bir `handle(...)` sarmalayicisiyla
  // kaydediliyor; `ipcMain.handle` yalnizca o sarmalayicinin icinde
  // bir kez geciyor. Nokta ile gelen hali disarida birakiliyor.
  const karsilanan = new Set(cikar(ana, /(?<![\w.])handle\("([^"]+)"/g));
  const acilan = new Set(cikar(kopru, /(?<![\w.])call\("([^"]+)"/g));

  // Tek yonlu kanallar (yanit beklemeyenler) ayri bir cift.
  const tekYonAna = new Set(cikar(ana, /ipcMain\.on\("([^"]+)"/g));
  const tekYonKopru = new Set(cikar(kopru, /ipcRenderer\.send\("([^"]+)"/g));

  t.ok(karsilanan.size > 40, `ana surec kanallari bulundu (${karsilanan.size})`);
  t.ok(acilan.size > 40, `kopru kanallari bulundu (${acilan.size})`);
  t.ok(tekYonAna.size > 0, `tek yonlu kanallar bulundu (${tekYonAna.size})`);

  const kiyas = (a, b) => [...a].filter((k) => !b.has(k));

  for (const [ad, sol, sag] of [
    ["kopruden cagrilan her kanal karsilaniyor", acilan, karsilanan],
    ["karsilanan her kanal arayuze aciliyor", karsilanan, acilan],
    ["kopruden yollanan her tek yonlu kanal dinleniyor", tekYonKopru, tekYonAna],
    ["dinlenen her tek yonlu kanal arayuze aciliyor", tekYonAna, tekYonKopru],
  ]) {
    const fark = kiyas(sol, sag);
    t.eq(fark, [], fark.length ? `${ad} — karsiligi yok: ${fark.join(", ")}` : ad);
  }
}
