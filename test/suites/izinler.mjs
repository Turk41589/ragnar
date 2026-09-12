/**
 * Erisim izinleri.
 *
 * "DRA her seye erisebilsin ama once izin istesin" isteginin kod
 * tarafi. Sinanmasi gereken asil sey su: izin YOKKEN is GERCEKTEN
 * yapilmiyor mu? Yoksa yalnizca arayuzde bir soru cikip is arkada
 * yine yapiliyor mu?
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "Erisim izinleri";
export const standalone = true;

export async function run(_page, _base, t) {
  // Gercek izin dosyasina dokunmuyoruz.
  process.env.DRA_DATA_DIR = await mkdtemp(join(tmpdir(), "dra-izin-"));
  const perms = await import("../../server/permissions.mjs");

  /* ------------------------------------------- baslangic: hicbir izin */
  let liste = await perms.list();
  t.ok(liste.length >= 5, "yetki listesi dolu");
  t.ok(
    liste.every((p) => !p.granted),
    "hicbir yetki kendiliginden verilmis degil",
  );
  t.ok(
    liste.every((p) => p.title && p.detail),
    "her yetkinin kullaniciya gosterilecek bir aciklamasi var",
  );

  /* -------------------------------------------------- izin olmadan -- */
  let hata = null;
  try {
    await perms.require("sistem");
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NEED_PERMISSION", "izin yoksa islem reddediliyor");
  t.eq(hata?.scope, "sistem", "hangi yetkinin gerektigi bildiriliyor");
  t.ok(hata?.title, "arayuzun soracagi baslik hatada tasiniyor");
  t.ok(hata?.detail, "aciklama da tasiniyor (kullanici neye izin verdigini bilsin)");

  /* ---------------------------------------------- rapor izinsiz mi? - */
  // EN ONEMLI TEST: rapor modulu izin denetiminin ARKASINDA olmali.
  // Sunucu ucu once require() cagirir; burada onun gercekten
  // reddettigini dogruluyoruz.
  const report = await import("../../server/report.mjs");
  let raporHatasi = null;
  try {
    await perms.require("sistem");
    await report.system();
  } catch (err) {
    raporHatasi = err;
  }
  t.eq(raporHatasi?.code, "NEED_PERMISSION", "izinsiz rapor uretilmiyor");

  /* -------------------------------------------------------- izin ver */
  const sonuc = await perms.grant("sistem");
  t.eq(sonuc.granted, true, "izin verilebiliyor");
  t.eq(await perms.granted("sistem"), true, "verilen izin hatirlaniyor");
  t.eq(await perms.require("sistem"), true, "izinden sonra islem geciyor");

  liste = await perms.list();
  const sistem = liste.find((p) => p.id === "sistem");
  t.eq(sistem.granted, true, "listede verildi olarak gorunuyor");
  t.ok(Number.isFinite(sistem.grantedAt), "ne zaman verildigi kayitli");

  // Bir yetki vermek digerlerini acmamali.
  t.eq(await perms.granted("eposta"), false, "bir izin digerlerini acmiyor");
  t.eq(
    liste.filter((p) => p.granted).length,
    1,
    "yalnizca istenen yetki verildi",
  );

  /* ------------------------------------------------- rapor artik var */
  const rapor = await report.system();
  t.ok(rapor.at > 0, "izinliyken rapor uretiliyor");
  t.ok(rapor.os.platform, "raporda isletim sistemi var");
  t.ok(rapor.memory.totalText, "raporda bellek var");
  t.ok(rapor.uptime.text, "raporda calisma suresi var");
  t.eq(
    rapor.updates,
    null,
    "Windows disinda guncelleme bilgisi null (uydurulmuyor)",
  );

  /* --------------------------------------------------- geri alma --- */
  await perms.revoke("sistem");
  t.eq(await perms.granted("sistem"), false, "izin geri alinabiliyor");

  hata = null;
  try {
    await perms.require("sistem");
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NEED_PERMISSION", "geri alindiktan sonra islem yine reddediliyor");

  /* ----------------------------------------------- taninmayan yetki */
  // Uydurma bir yetki adiyla toptan izin alinamamali.
  hata = null;
  try {
    await perms.grant("her-sey");
  } catch (err) {
    hata = err;
  }
  t.ok(hata, "taninmayan yetki verilemiyor");
  t.has(hata?.message || "", "Bilinmeyen", "sebebi soyleniyor");

  /* --------------------------------------------------- hepsini al -- */
  await perms.grant("sistem");
  await perms.grant("eposta");
  t.eq(
    (await perms.list()).filter((p) => p.granted).length,
    2,
    "iki yetki verildi",
  );
  await perms.revokeAll();
  t.ok(
    (await perms.list()).every((p) => !p.granted),
    "tum izinler tek seferde geri alinabiliyor",
  );

  /* ----------------------------------------------------- kalicilik - */
  // Izinler diske yaziliyor: uygulama her acilista yeniden sormasin.
  await perms.grant("youtube");
  const { readFile } = await import("node:fs/promises");
  const diskte = JSON.parse(
    await readFile(join(process.env.DRA_DATA_DIR, "permissions.json"), "utf8"),
  );
  t.ok(diskte.grants?.youtube, "verilen izin diske yazildi");
  t.ok(!diskte.grants?.sistem, "geri alinan izin diskte kalmadi");

  await perms.revokeAll();
  delete process.env.DRA_DATA_DIR;
}
