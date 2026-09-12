/**
 * Erisim izinleri.
 *
 * DRA'nin bilgisayara ve hesaplara erisimi genisledikce "her seye
 * erisebilir" demek yeterli degil: her yetki AYRI AYRI ve ACIKCA
 * verilmeli, geri alinabilmeli ve ne zaman verildigi gorulebilmeli.
 *
 * TASARIM KARARI — izni ARAYUZ vermez, BURASI verir.
 * Arayuz yalnizca kullaniciya sorar ve cevabi buraya iletir. Yetki
 * denetimi islemin yapildigi tarafta (bu surecte) yapilir; boylece
 * arayuzde bir acik olsa bile izinsiz is yapilamaz. Arayuzun "izin
 * verildi" demesi yetmez, kullanicinin onayi buraya yazilmis olmali.
 *
 * Izinler diske yazilir (data/permissions.json) ki her acilista
 * yeniden sorulmasin; ama her biri tek tikla geri alinabilir.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Testler gercek izin dosyasini kirletmesin diye klasor disaridan verilebilir.
const DATA_DIR = process.env.DRA_DATA_DIR || join(HERE, "..", "data");
const FILE = join(DATA_DIR, "permissions.json");

/**
 * Yetki listesi. Her biri kullaniciya GORUNEN bir cumleyle tanimli —
 * "izin veriyor musun" diye sorarken tam olarak bu metin gosterilir.
 * Belirsiz bir yetki, verilmis sayilmaz.
 */
export const SCOPES = {
  sistem: {
    title: "Bilgisayar durumu",
    detail:
      "Isletim sistemi surumu, disk doluluk orani, batarya, calisma suresi " +
      "ve Windows guncellemelerinin durumunu okur.",
    // Yalnizca okur; hicbir sey degistirmez.
    writes: false,
  },
  dosyalar: {
    title: "Dosyalari okuma",
    detail:
      "Izin verdiginiz klasorlerdeki dosya adlarini ve icerigini okur. " +
      "Dosya silmez, degistirmez.",
    writes: false,
  },
  eposta: {
    title: "E-posta okuma",
    detail:
      "Gelen kutunuzu okur; reklam ve bultenleri ayiklayip ise yarar " +
      "mesajlari ozetler. Mesaj gondermez, silmez.",
    writes: false,
  },
  montaj: {
    title: "Video montaji",
    detail:
      "Gosterdiginiz klasordeki videolari okur, montaj projenizi okuyup " +
      "uslubunuzu cikarir ve yeni bir video dosyasi uretir. Kaynak " +
      "dosyalariniza dokunmaz.",
    writes: true,
  },
  youtube: {
    title: "YouTube kanali",
    detail:
      "Kanal istatistiklerinizi okur, hazirladiginiz videolari belirlenen " +
      "saatte yukler. Yukleme oncesi ayrica onay ister.",
    writes: true,
  },
  isletme: {
    title: "Isletme verileri",
    detail:
      "Isletmenizle ilgili anlattiklarinizi (ciro, musteri mesajlari, " +
      "faturalar) bu bilgisayarda saklar ve raporlar.",
    writes: true,
  },
};

/** Verilen izinler: { [scope]: { grantedAt } } */
let grants = {};
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const data = JSON.parse(await readFile(FILE, "utf8"));
    if (data && typeof data.grants === "object") {
      // Diskten geleni oldugu gibi kabul etmiyoruz: tanimadigimiz bir
      // yetki adi dosyaya elle yazilmis olabilir.
      for (const [scope, info] of Object.entries(data.grants)) {
        if (SCOPES[scope] && info && Number.isFinite(info.grantedAt)) {
          grants[scope] = { grantedAt: info.grantedAt };
        }
      }
    }
  } catch {
    /* dosya yok ya da bozuk — izin verilmemis kabul ediyoruz */
  }
}

async function save() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify({ grants }, null, 2));
}

/** Tum yetkiler ve durumlari — ayar ekranindaki liste icin. */
export async function list() {
  await load();
  return Object.entries(SCOPES).map(([id, meta]) => ({
    id,
    title: meta.title,
    detail: meta.detail,
    writes: meta.writes,
    granted: Boolean(grants[id]),
    grantedAt: grants[id]?.grantedAt ?? null,
  }));
}

export async function granted(scope) {
  await load();
  return Boolean(grants[scope]);
}

/**
 * Izin verir. Yalnizca taninan bir yetki adi kabul edilir — boylece
 * "hepsine izin ver" gibi gizli bir toptan yetki olusturulamaz.
 */
export async function grant(scope) {
  if (!SCOPES[scope]) throw new Error(`Bilinmeyen yetki: ${scope}`);
  await load();
  grants[scope] = { grantedAt: Date.now() };
  await save();
  return { scope, granted: true };
}

export async function revoke(scope) {
  if (!SCOPES[scope]) throw new Error(`Bilinmeyen yetki: ${scope}`);
  await load();
  delete grants[scope];
  await save();
  return { scope, granted: false };
}

/** Hepsini geri alir — "DRA'nin elinden her seyi al" dugmesi. */
export async function revokeAll() {
  await load();
  grants = {};
  await save();
  return { granted: [] };
}

/**
 * Yetki yoksa ATAR. Izin gerektiren her islem ilk satirinda bunu cagirir.
 *
 * Hata, arayuzun kullaniciya ne soracagini bilmesi icin yetkinin
 * kendisini ve aciklamasini tasir; arayuz onay alirsa grant() cagirip
 * islemi yeniden dener.
 */
export async function require(scope) {
  await load();
  if (grants[scope]) return true;

  const meta = SCOPES[scope];
  throw Object.assign(
    new Error(`Bu is icin izin gerekiyor: ${meta?.title || scope}`),
    {
      code: "NEED_PERMISSION",
      scope,
      title: meta?.title || scope,
      detail: meta?.detail || "",
    },
  );
}

/** Testler icin: bellekteki durumu diske dokunmadan sifirlar. */
export function _resetForTests() {
  grants = {};
  loaded = true;
}
