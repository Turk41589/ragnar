/**
 * Esnek metin eslestirme.
 *
 * Amac: kullanicinin komutu tam olarak "dogru" yazmasini beklememek.
 * Ayni komut sesle de yaziyla da, farkli imlalarla da tutmali:
 *
 *   "bugun ne"  ·  "bu gün ne"  ·  "bue gün ne"  ·  "BUGÜN NE?"
 *
 * Uc katman var:
 *   1. Normalize  — buyuk/kucuk, Turkce harf, noktalama farklarini siler
 *   2. Bosluk toleransi — "bu gun" ile "bugun" ayni sayilir
 *   3. Yazim toleransi  — kelime uzunluguna gore sinirli harf hatasi affedilir
 */

/** Buyuk/kucuk, Turkce harf ve noktalama farklarini temizler. */
export function normalize(text) {
  return (text || "")
    .toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s.,+\-*/%^()]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize edilmis metni kelimelere ayirir. */
export function tokenize(n) {
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * Levenshtein mesafesi, `max`i asinca erken cikar.
 * Erken cikis onemli: her komut icin dolasilacagi zaman fark ediyor.
 */
export function distance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr.slice();
  }
  return prev[b.length];
}

/**
 * Kelime uzunluguna gore affedilecek harf hatasi.
 * Kisa kelimelerde tolerans yok — "ara" ile "ara" disinda hicbir sey
 * karismasin diye.
 */
export function tolerance(word) {
  if (word.length <= 3) return 0;
  if (word.length <= 9) return 1;
  return 2;
}

/**
 * Turkce yapim/cekim ekleri, uzundan kisaya.
 *
 * Ham onek eslesmesi ("hedefle basliyorsa kabul et") burada ise yaramaz:
 * "gunes" de "gun" ile baslar ama alakasizdir. Bunun yerine bilinen ekleri
 * teker teker sokup geriye kalan govdeyi karsilastiriyoruz — boylece
 * "gunlerden" govdesi "gun" olur ama "gunes" oldugu gibi kalir.
 *
 * Liste normalize edilmis metne gore yazildi (u/o/i sadelesmis halleriyle).
 */
const SUFFIXES = [
  "larimiz", "lerimiz", "lariniz", "leriniz",
  "larindan", "lerinden", "larini", "lerini", "larimi", "lerimi",
  "lardan", "lerden", "larda", "lerde", "larin", "lerin",
  "lari", "leri", "larim", "lerim",
  "imiz", "umuz", "iniz", "unuz",
  "deki", "daki", "teki", "taki",
  "den", "dan", "ten", "tan", "nin", "nun", "sin", "sun",
  "lar", "ler", "dir", "dur", "tir", "tur", "siz", "suz",
  "de", "da", "te", "ta", "in", "un", "im", "um", "ni", "nu",
  "ye", "ya", "yi", "yu", "si", "su", "ki", "ku", "li", "lu",
  "i", "e", "a", "u", "n", "m", "y",
];

/** Govdeyi korumak icin: bundan kisasi kalmasin. */
const MIN_STEM = 3;
/** En fazla bu kadar ek sokulur (Turkce'de zincir uzayabiliyor). */
const MAX_STRIPS = 3;

/**
 * Kelimeden ek sokerek ulasilabilecek tum govdeleri dondurur.
 * Kelimenin kendisi de listeye dahildir.
 *
 * Not: bu govdeler yalnizca BIREBIR karsilastirmada kullanilir.
 * Uzerlerine bir de yazim toleransi eklemek cok gevsek oluyordu:
 * "alarmlarim" govdelerinden biri "alar", o da tek harf farkla
 * "ayar" ile eslesip alakasiz kurallari tetikliyordu.
 */
export function stems(word) {
  const found = new Set([word]);
  const queue = [[word, 0]];

  while (queue.length) {
    const [current, depth] = queue.shift();
    if (depth >= MAX_STRIPS) continue;
    for (const suffix of SUFFIXES) {
      if (!current.endsWith(suffix)) continue;
      const stem = current.slice(0, -suffix.length);
      if (stem.length < MIN_STEM || found.has(stem)) continue;
      found.add(stem);
      queue.push([stem, depth + 1]);
    }
  }
  return found;
}

/**
 * Aday kelime, hedef kelimeyi karsiliyor mu?
 * - birebir             : "bugun" = "bugun"
 * - Turkce eki          : "bugunku", "saatte", "alarmlarim"
 * - sinirli yazim hatasi: "buegun", "alrm", "saaat"
 */
/** Ust uste tekrar eden harfleri teke indirir: "nott" -> "not". */
const squeeze = (word) => word.replace(/(.)\1+/g, "$1");

export function wordMatches(candidate, target) {
  if (candidate === target) return true;

  // Tekrar eden harf hatasi ("saaat", "nott", "alarmm").
  // Bu en yaygin ve en zararsiz yazim hatasi; kisa kelimelerde bile
  // guvenle affedilebilir, cunku farkli kelimeleri birbirine karistirmaz.
  if (squeeze(candidate) === squeeze(target)) return true;

  // Ek sokulmus halleriyle dene
  if (candidate.length > target.length && stems(candidate).has(target)) return true;

  const tol = tolerance(target);
  if (tol === 0) return false;

  // Yazim hatasi affederken ilk harfin tutmasini sart kosuyoruz.
  // Aksi halde bitisik yazilmis kelimeler yanlis eslesiyor:
  // "zar at" -> "zarat", bu da "arat" ile bir harf farkli cikiyor.
  // Ilk harf sarti bunu keser, "bue gun" -> "buegun" ~ "bugun" ise gecer.
  if (candidate[0] !== target[0]) return false;

  return distance(candidate, target, tol) <= tol;
}

/**
 * Hedef ifade metinde geciyor mu?
 *
 * Boslugu esnek ele alir: ifadenin kelimeleri metinde bitisik de yazilmis
 * olabilir, ayri da. Bu yuzden metin uzerinde kayan pencere gezdirip
 * pencereyi bosluksuz birlestirerek karsilastiriyoruz.
 */
export function findPhrase(tokens, phraseWords) {
  const target = phraseWords.join("");
  // Ifade kac kelimeyse, bir fazlasina kadar pencere dene ("bu gun" -> 2)
  const maxSpan = Math.min(phraseWords.length + 1, 4);

  for (let i = 0; i < tokens.length; i += 1) {
    for (let span = 1; span <= maxSpan && i + span <= tokens.length; span += 1) {
      if (wordMatches(tokens.slice(i, i + span).join(""), target)) return true;
    }
  }
  return false;
}

/** Uzun kelimeler daha ayirt edici — puanlamada agirligi fazla. */
const weight = (word) => Math.max(1, word.length - 2);

/**
 * Ifadenin metinle ortusme orani (0..1).
 * Ifadenin her kelimesi metinde aranir; bulunanların agirligi toplanir.
 */
export function scorePhrase(tokens, phrase) {
  const words = tokenize(phrase);
  if (!words.length) return 0;

  let total = 0;
  let found = 0;
  for (const word of words) {
    const w = weight(word);
    total += w;
    if (findPhrase(tokens, [word])) found += w;
  }

  let score = found / total;

  // Ifadenin tamami bitisik/ayri fark etmeksizin tek parca geciyorsa
  // bu cok daha guclu bir isarettir.
  if (words.length > 1 && findPhrase(tokens, words)) score = 1;

  return score;
}

/** Verilen ifadeler icinden en yuksek puani dondurur. */
export function bestScore(tokens, phrases) {
  let best = 0;
  for (const phrase of phrases) {
    const score = scorePhrase(tokens, phrase);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

/** Metinde bu ifadelerden herhangi biri geciyor mu? (esnek) */
export function mentions(tokens, phrases) {
  return phrases.some((phrase) => findPhrase(tokens, tokenize(phrase)));
}
