/**
 * Musteri mesajini siniflar: memnun / sikayet / soru / notr.
 *
 * Yapay zeka YOK. Kurallar acik, denetlenebilir ve Turkce'ye gore
 * yazildi. Turkce'de esas zorluk OLUMSUZLUK: "memnun degilim" icinde
 * "memnun" gecer ama anlami tam tersidir. Kelime saymak bu yuzden
 * yetmez; her eslesmenin ardina bakiyoruz.
 *
 * Iki yonlu calisir:
 *   "memnun degilim"  → olumlu kelime, olumsuzlanmis → SIKAYET
 *   "sorun yok"       → olumsuz kelime, olumsuzlanmis → MEMNUN
 */

export const SINIF = {
  MEMNUN: "memnun",
  SIKAYET: "sikayet",
  SORU: "soru",
  NOTR: "notr",
};

/** Olumlu ifadeler. */
const OLUMLU = [
  "tesekkur", "tesekkurler", "sagol", "sag olun", "eline saglik",
  "harika", "mukemmel", "super", "muhtesem", "cok iyi", "cok guzel",
  "memnun", "memnunum", "begendim", "bayildim", "tavsiye", "basarili",
  "hizli", "ilgili", "nazik", "temiz", "lezzetli", "kaliteli",
  "tekrar gelecegim", "yine bekleriz", "helal", "bravo", "tebrikler",
];

/** Olumsuz ifadeler. Fiil olumsuzlari (gelmedi, begenmedim) dogrudan burada. */
const OLUMSUZ = [
  "kotu", "berbat", "rezalet", "rezil", "igrenc", "sikayet", "sikayetci",
  "iade", "geri odeme", "para iadesi", "iptal", "sorun", "problem",
  "hata", "yanlis", "eksik", "bozuk", "kirik", "calismiyor", "acilmiyor",
  "gec", "gecikti", "gelmedi", "ulasmadi", "cikmadi", "bekliyorum hala",
  "begenmedim", "sevmedim", "pisman", "hayal kirikligi", "bir daha asla",
  "kandirdiniz", "dolandirici", "kaba", "ilgisiz", "yavas", "soguk",
  "bayat", "pis", "kirli", "kayip", "ulasamiyorum", "cevap yok",
  "rezervasyonum yok", "yanmis", "eksik geldi",
];

/** Soru isaretleri. */
const SORU_IZI = [
  "ne zaman", "nasil", "nerede", "nereden", "kac", "kacta", "var mi",
  "musait", "acik misiniz", "acik mi", "fiyat", "ucret", "ne kadar",
  "mumkun mu", "olur mu", "yapabilir", "alabilir", "rezervasyon",
  "siparis", "teslimat", "kargo", "adres", "calisma saat",
];

/**
 * Olumsuzlayicilar. Bir duygu kelimesinden SONRA bu kelimelerden biri
 * gelirse o kelimenin isareti ters cevriliyor.
 */
const OLUMSUZLAYICI = [
  "degil", "degildi", "degilim", "degiliz", "yok", "yoktu", "hic",
];

/** Turkce metni karsilastirmaya hazirlar. */
function normalize(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a")
    .replace(/[^\w\s?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kalip metinde geciyorsa, hemen ardindaki iki kelimeye bakip
 * olumsuzlanip olumsuzlanmadigini sozler.
 */
function bulundu(n, kalip) {
  const yer = n.indexOf(kalip);
  if (yer === -1) return null;

  // Kelime ortasinda eslesme olmasin: "gec" kelimesi "gecerli" icinde gecmesin.
  const oncesi = yer === 0 ? " " : n[yer - 1];
  if (/[a-z0-9]/.test(oncesi)) return null;

  const sonrasi = n.slice(yer + kalip.length);
  const uzanti = /^([a-z]+)/.exec(sonrasi)?.[1] || "";

  // Turkce ek alabildigi icin kalibin ardina biraz uzanti birakiyoruz
  // ("memnun" → "memnunum", "sikayet" → "sikayetci"). Ama KISA kaliplar
  // baska kelimelerin basi olabiliyor: "gec" kalibi "gecerli" icinde
  // eslesiyordu ve gecerli bir soru sikayet sayiliyordu. Uc harfe kadar
  // olan kaliplarda tam kelime sart.
  if (kalip.length <= 3 && uzanti.length > 0) return null;
  if (uzanti.length > 3) return null;

  const ardindan = sonrasi.trim().split(" ").slice(0, 2);
  const olumsuz = ardindan.some((k) => OLUMSUZLAYICI.includes(k));
  return { kalip, olumsuz };
}

/**
 * Mesaji siniflar.
 * Sikayet, memnuniyetten once gelir: bir mesajda ikisi de varsa
 * ("hizli ama soguk geldi") ilgilenilmesi gereken taraf sikayettir.
 */
export function classify(text) {
  const n = normalize(text);
  if (!n) return { kind: SINIF.NOTR, score: 0, hits: [] };

  const isaretler = [];
  let olumluPuan = 0;
  let olumsuzPuan = 0;

  for (const kalip of OLUMLU) {
    const s = bulundu(n, kalip);
    if (!s) continue;
    // "memnun degilim": olumlu kelime olumsuzlanmis → sikayet.
    if (s.olumsuz) {
      olumsuzPuan += 1;
      isaretler.push(`${kalip} (olumsuzlanmis)`);
    } else {
      olumluPuan += 1;
      isaretler.push(kalip);
    }
  }

  for (const kalip of OLUMSUZ) {
    const s = bulundu(n, kalip);
    if (!s) continue;
    // "sorun yok": olumsuz kelime olumsuzlanmis → sikayet degil.
    if (s.olumsuz) {
      olumluPuan += 0.5;
      isaretler.push(`${kalip} (olumsuzlanmis)`);
    } else {
      olumsuzPuan += 1;
      isaretler.push(kalip);
    }
  }

  if (olumsuzPuan > 0 && olumsuzPuan >= olumluPuan) {
    return { kind: SINIF.SIKAYET, score: olumsuzPuan, hits: isaretler };
  }
  if (olumluPuan > 0) {
    return { kind: SINIF.MEMNUN, score: olumluPuan, hits: isaretler };
  }

  // Duygu yoksa soru mu diye bakiyoruz.
  const soru = n.includes("?") || SORU_IZI.some((k) => bulundu(n, k)) ||
    /\b(mi|mi|mu|mu|misin|miyim|miyiz|misiniz)\b/.test(n);
  if (soru) return { kind: SINIF.SORU, score: 1, hits: ["soru"] };

  return { kind: SINIF.NOTR, score: 0, hits: [] };
}

export const _internal = { normalize, bulundu, OLUMLU, OLUMSUZ };
