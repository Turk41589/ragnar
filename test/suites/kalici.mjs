/**
 * Kalici depo — guvenli yazma.
 *
 * Musteri mesajlari, otomatik yanit kurallari, izinler ve video kuyrugu
 * hep ayni sekilde diske yaziliyor. Eski yol `writeFile` idi ve iki
 * sorunu vardi:
 *
 *   1) Yazma ortasinda uygulama kapanirsa geriye YARIM dosya kaliyordu.
 *      Okuma tarafi bozuk JSON'u yakalayip sessizce bos listeye donuyor,
 *      yani veriler hicbir uyari olmadan kayboluyordu.
 *   2) Es zamanli iki yazma birbirinin ustune biniyordu.
 *
 * Burada ikisi de dogrulaniyor.
 */

import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "Kalici depo";
export const standalone = true;

export async function run(_page, _base, t) {
  const kalici = await import("../../server/kalici.mjs");
  const kok = await mkdtemp(join(tmpdir(), "dra-kalici-"));

  try {
    /* ==================== 1. Yaz ve geri oku ==================== */

    const dosya = join(kok, "alt", "veri.json");
    await kalici.yaz(dosya, { a: 1, liste: ["x", "y"] });
    t.eq(JSON.parse(await readFile(dosya, "utf8")), { a: 1, liste: ["x", "y"] },
      "yazilan veri aynen geri okunuyor");
    t.ok(true, "olmayan klasor kendiliginden aciliyor");

    const geri = await kalici.oku(dosya, null);
    t.eq(geri.a, 1, "oku() yazilani veriyor");

    /* ==================== 2. Olmayan / bozuk dosya ============== */

    t.eq(await kalici.oku(join(kok, "yok.json"), { bos: true }), { bos: true },
      "olmayan dosyada varsayilan doner");

    const bozuk = join(kok, "bozuk.json");
    await writeFile(bozuk, '{"yarim": [1,2');
    t.eq(await kalici.oku(bozuk, { kurtarildi: true }), { kurtarildi: true },
      "bozuk dosyada varsayilan doner");
    // Bozuk dosya SILINMIYOR: kullanici isterse icine bakabilmeli.
    t.ok((await readFile(bozuk, "utf8")).includes("yarim"),
      "bozuk dosya silinmiyor, yerinde duruyor");

    /* ==================== 3. Es zamanli yazmalar ================ */

    const ortak = join(kok, "ortak.json");
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => kalici.yaz(ortak, { sira: i })),
    );
    const son = JSON.parse(await readFile(ortak, "utf8"));
    t.ok(Number.isInteger(son.sira), "es zamanli yazmalardan sonra dosya saglam");

    /* ==================== 4. ATOMIKLIK ==========================
     * Asil mesele bu. Buyuk bir govde yazilirken BASKA biri dosyayi
     * okursa, eski yolda yarim icerik goruyordu. Burada yazma surerken
     * surekli okuyoruz: her okuma ya "dosya yok" olmali ya da TAM ve
     * gecerli JSON. Arada bir hal gorunmemeli.                     */

    const buyuk = join(kok, "buyuk.json");
    const govde = { kayitlar: Array.from({ length: 4000 }, (_, i) => ({
      id: i, metin: "musteri mesaji ornegi ".repeat(6),
    })) };

    let okumaSayisi = 0;
    let bozukOkuma = 0;
    let dur = false;

    const okuyucu = (async () => {
      while (!dur) {
        try {
          // BILEREK senkron okuma: yazmayla arasinda bekleme olmasin.
          const ham = readFileSync(buyuk, "utf8");
          okumaSayisi += 1;
          try {
            const d = JSON.parse(ham);
            if (!Array.isArray(d?.kayitlar) || d.kayitlar.length !== 4000) bozukOkuma += 1;
          } catch {
            bozukOkuma += 1;
          }
        } catch {
          /* dosya henuz yok — sorun degil */
        }
        await new Promise((r) => setImmediate(r));
      }
    })();

    for (let i = 0; i < 12; i += 1) await kalici.yaz(buyuk, govde);
    dur = true;
    await okuyucu;

    t.ok(okumaSayisi > 0, `yazma sirasinda gercekten okundu (${okumaSayisi} kez)`);
    t.eq(bozukOkuma, 0, "yazma sirasinda hicbir okuma yarim icerik gormedi");

    /* ==================== 5. Gecici dosya artmiyor =============== */

    await kalici.bekle();
    const kalanlar = (await readdir(kok)).filter((a) => a.endsWith(".tmp"));
    t.eq(kalanlar, [], "gecici dosya geride birakilmiyor");
  } finally {
    await rm(kok, { recursive: true, force: true });
  }
}
