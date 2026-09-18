/**
 * Yerel komut motoru.
 *
 * DRA once buraya bakar. Buradaki kaliplardan biri tutarsa cevap aninda,
 * internetsiz ve bedava uretilir. Hicbiri tutmazsa istek yapay zeka
 * beynine (Claude) devredilir.
 */

import { formatDate, formatTime } from "./hud.js";

/* ------------------------------------------------------------ metin esleme */

// Normalize, ek cozumleme ve yazim toleransi match.js'te.
export { normalize } from "./match.js";
import { normalize, tokenize, bestScore, mentions } from "./match.js";

const has = (n, ...words) => words.some((w) => n.includes(w));

/**
 * Metinden komut kelimelerini temizler.
 *
 * `\b` ve ASCII kaliplar Turkce harflerde CALISMIYOR: "müzik aç"
 * icindeki "aç" `\bac\b` ile eslesmiyor, sonucta komutun kendisi
 * arama sorgusu olarak gonderiliyordu. Burada once Turkce'ye duyarli
 * kucultme yapiliyor, sonra kelime kelime eleniyor.
 */
function stripWords(raw, words) {
  const kume = new Set(words.map((w) => normalize(w)));
  return String(raw || "")
    .split(/\s+/)
    .filter((kelime) => {
      const temiz = normalize(kelime);
      return temiz && !kume.has(temiz);
    })
    .join(" ")
    .trim();
}

/* --------------------------------------------------------- sayi cozumlemesi */

const UNITS = {
  sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5,
  alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
};
const TENS = {
  on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50,
  altmis: 60, yetmis: 70, seksen: 80, doksan: 90,
};

/** "yirmi bes" -> 25, "iki yuz on" -> 210. */
function turkishNumber(words) {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in UNITS) { current += UNITS[w]; seen = true; }
    else if (w in TENS) { current += TENS[w]; seen = true; }
    else if (w === "yuz") { current = (current || 1) * 100; seen = true; }
    else if (w === "bin") { total += (current || 1) * 1000; current = 0; seen = true; }
    else if (seen) break;
  }
  return seen ? total + current : null;
}

/** Metinden ilk sayiyi cikarir (rakam ya da Turkce yazi). */
function extractNumber(n) {
  const digit = n.match(/-?\d+([.,]\d+)?/);
  if (digit) return Number(digit[0].replace(",", "."));
  const words = n.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const value = turkishNumber(words.slice(i));
    if (value !== null) return value;
  }
  return null;
}

/* ------------------------------------------------------- saat cozumlemesi */

/**
 * Ekli sayi sozcugunu cozer: "dokuzda" -> 9, "yediye" -> 7, "besté" -> 5.
 * Turkce'de saat neredeyse her zaman ek alir; ek atilmadan eslesmez.
 */
const NUM_SUFFIXES = ["da", "de", "ta", "te", "ya", "ye", "a", "e"];

function numberWord(token) {
  if (token in UNITS) return UNITS[token];
  if (token in TENS) return TENS[token];
  for (const suffix of NUM_SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const base = token.slice(0, -suffix.length);
    if (base in UNITS) return UNITS[base];
    if (base in TENS) return TENS[base];
  }
  return null;
}

/** Metinde mutlak bir saat ifadesi var mi? */
const hasClockShape = (n) =>
  /\b\d{1,2}[:.]\d{2}\b/.test(n) ||
  /bucuk|ceyrek/.test(n) ||
  /\b(sabah|aksam|oglen|ogleden|gece)\b/.test(n);

/** Metin mutlak saat degil de sure mi anlatiyor? ("5 dakika sonra") */
const hasDurationShape = (n) =>
  /\b(dakika|saniye)\b/.test(n) || (/\bsaat\b/.test(n) && /\bsonra\b/.test(n));

/**
 * "sabah yedi bucukta", "07:30", "aksam dokuzda" gibi ifadeleri "HH:MM" yapar.
 * Cozemezse null doner.
 */
export function parseClockTime(n) {
  let hour = null;
  let minute = 0;

  // 1) Dogrudan 07:30 / 07.30 bicimi
  const direct = n.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (direct) {
    hour = Number(direct[1]);
    minute = Number(direct[2]);
  } else {
    // 2) Rakamla yazilmis saat — "7 de", "8 30"
    const digits = n.match(/\b\d{1,2}\b/g);
    if (digits) {
      hour = Number(digits[0]);
      if (digits[1] !== undefined && Number(digits[1]) < 60) minute = Number(digits[1]);
    } else {
      // 3) Yaziyla yazilmis saat — "yedi", "on bir", "dokuzda"
      const words = n.split(" ");
      for (let i = 0; i < words.length; i += 1) {
        const value = numberWord(words[i]);
        if (value === null) continue;
        let hours = value;
        // "on bir", "yirmi uc" gibi bilesikler
        if (value === 10 || value === 20) {
          const next = numberWord(words[i + 1] || "");
          if (next !== null && next < 10) hours = value + next;
        }
        if (hours >= 0 && hours <= 24) {
          hour = hours;
          break;
        }
      }
    }
  }

  if (hour === null) return null;

  // "bucuk" / "ceyrek" dakikayi belirler. Ek aldiklari icin (bucukta,
  // ceyrege) kelime sinirina degil, govdeye bakiyoruz.
  const quarterTo = /ceyrek/.test(n) && /kala/.test(n);
  if (/bucuk/.test(n)) minute = 30;
  else if (quarterTo) minute = 45;
  else if (/ceyrek/.test(n)) minute = 15;

  // "yediye ceyrek kala" bir onceki saati kasteder
  if (quarterTo) hour = hour === 0 ? 23 : hour - 1;

  // Gunun bolumu 12 saatlik ifadeyi 24 saate tasir
  if (/\b(aksam|gece)\b/.test(n) && hour < 12) hour += 12;
  else if (/\bogleden\b/.test(n) && /\bsonra\b/.test(n) && hour < 12) hour += 12;
  else if (/\boglen\b/.test(n) && hour < 12) hour = 12;

  if (hour > 23 || minute > 59 || hour < 0) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Alarm cumlesinde etiket olmayan sozcukler. */
const ALARM_STOPWORDS = new Set([
  "alarm", "alarmi", "alarmini", "kur", "kurar", "misin", "ayarla", "ayarlar",
  "uyandir", "uyandirir", "beni", "saat", "saate", "saatte", "sabah", "sabaha",
  "aksam", "aksama", "gece", "geceye", "oglen", "ogleden", "sonra", "icin",
  "her", "gun", "gune", "tekrarla", "lutfen", "kala", "de", "da", "te", "ta",
  "ye", "ya", "bir", "olsun", "kurabilir", "kuralim",
]);

/**
 * Alarm cumlesinden etiketi cikarir.
 *
 * Sozcukleri tek tek normalize edip eleriz ama KORUNANLARI ozgun haliyle
 * birakiriz — boylece "ilac" degil "ilaç" yaziyor.
 */
function extractAlarmLabel(raw) {
  return raw
    .split(/\s+/)
    .filter((word) => {
      const t = normalize(word);
      if (!t) return false;
      if (/\d/.test(t)) return false;
      if (ALARM_STOPWORDS.has(t)) return false;
      if (numberWord(t) !== null) return false;
      if (/^(bucuk|ceyrek)/.test(t)) return false;
      return true;
    })
    .join(" ")
    .trim()
    .slice(0, 60);
}

/* ------------------------------------------------- guvenli matematik cozucu */

/** Turkce islem sozcuklerini sembollere cevirir. */
function mathify(n) {
  return n
    .replace(/\bkarekok(u|unu)?\b/g, "sqrt")
    .replace(/\bartir?\b|\barti\b|\btoplam\b|\bekle\b|\bile topla\b/g, "+")
    .replace(/\beksi\b|\bcikar\b|\bcikarti\b/g, "-")
    .replace(/\bkere\b|\bcarpi\b|\bcarp\b|\bcarpim\b|\bcarpimi\b|\bx\b/g, "*")
    .replace(/\bbolu\b|\bbol\b|\bbolum\b/g, "/")
    .replace(/\buzeri\b|\bussu\b|\bus\b/g, "^")
    .replace(/\byuzde\b/g, "%");
}

/**
 * Kucuk ozyinelemeli inis cozucusu.
 * eval() KULLANILMIYOR — sadece sayi ve islec kabul edilir.
 */
function evaluateExpression(src) {
  const tokens = src.match(/\d+(?:\.\d+)?|sqrt|[+\-*/^()%]/g);
  if (!tokens) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = next();
    if (t === undefined) throw new Error("eksik ifade");
    if (t === "(") {
      const v = parseSum();
      if (next() !== ")") throw new Error("parantez kapanmadi");
      return v;
    }
    if (t === "sqrt") return Math.sqrt(parsePrimary());
    if (t === "-") return -parsePrimary();
    if (t === "+") return parsePrimary();
    const num = Number(t);
    if (Number.isNaN(num)) throw new Error("sayi bekleniyordu");
    return num;
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek() === "^") { next(); return base ** parsePower(); }
    return base;
  }

  function parseProduct() {
    let v = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const rhs = parsePower();
      if (op === "*") v *= rhs;
      else if (op === "/") v /= rhs;
      else v %= rhs;
    }
    return v;
  }

  function parseSum() {
    let v = parseProduct();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseProduct();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = parseSum();
  if (pos !== tokens.length) throw new Error("artik jeton");
  if (!Number.isFinite(result)) throw new Error("sonuc gecersiz");
  return result;
}

/** Sonucu okunakli hale getirir. */
function prettyNumber(v) {
  const rounded = Math.round(v * 1e6) / 1e6;
  return rounded.toLocaleString("tr-TR", { maximumFractionDigits: 6 });
}

/* ------------------------------------------------------------- site kisayollari */

const SITES = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  github: "https://github.com",
  gmail: "https://mail.google.com",
  spotify: "https://open.spotify.com",
  whatsapp: "https://web.whatsapp.com",
  instagram: "https://www.instagram.com",
  twitter: "https://x.com",
  x: "https://x.com",
  netflix: "https://www.netflix.com",
  twitch: "https://www.twitch.tv",
  reddit: "https://www.reddit.com",
  wikipedia: "https://tr.wikipedia.org",
  translate: "https://translate.google.com",
  ceviri: "https://translate.google.com",
  harita: "https://maps.google.com",
  haritalar: "https://maps.google.com",
  maps: "https://maps.google.com",
  claude: "https://claude.ai",
  chatgpt: "https://chatgpt.com",
  discord: "https://discord.com/app",
  linkedin: "https://www.linkedin.com",
  hava: "https://www.mgm.gov.tr",
};

/* ----------------------------------------------------------------- sakalar */

const JOKES = [
  "Bir yazilimci markete gitmis. Esi demis ki: bir ekmek al, yumurta varsa on tane. Adam on ekmekle donmus.",
  "Neden hic hata yapmam biliyor musunuz? Cunku ben bir programim. Sakayi bir kenara birakalim, bol bol hata yapiyorum.",
  "Iki bit karsilasmis. Biri sormus: nasilsin? Digeri demis ki: bir sifir bir.",
  "Kullanici sormus: sifremi unuttum. Sistem demis ki: ben de. Ikimiz de zor durumdayiz.",
  "En sevdigim renk mavi. Cunku baska rengim yok efendim.",
  "Bir gun robotlar dunyayi ele gecirecek dediler. Ben hala saat kac sorusuna cevap veriyorum.",
];

const GREETINGS = [
  "Merhaba efendim. Emrinizdeyim.",
  "Buradayim. Ne yapmami istersiniz?",
  "Selam. Sistemler calisiyor, sizi dinliyorum.",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ------------------------------------------------------------ komut tablosu */

/**
 * Her kural: { name, test(n, raw), run(n, raw, ctx) -> string | Promise<string> }
 * `run` ayrica { text, then } dondurebilir; `then` cevap okunduktan sonra calisir.
 */
const RULES = [
  /* -- uyku -------------------------------------------------------------- */
  {
    name: "uyu",
    example: "uyu",
    phrases: [
      "uyu", "uyku moduna gec", "uykuya gec", "kendini kapat", "kapan",
      "gorusuruz", "hosca kal", "bay bay", "iyi geceler", "dinlen",
      "mola ver", "kapat kendini", "artik kapan", "isim bitti",
    ],
    exclude: ["ses", "sessiz", "mikrofon", "ekran"],
    // "kapat" sozcugu hem DRA'yi hem bir programi kapatmak icin kullanilir.
    // Kurulu bir uygulama adi geciyorsa bu komut ona aittir.
    guard: (n, raw, tokens, ctx) => !ctx?.findApp?.(stripVerbs(raw)),
    run: (n, raw, ctx) => ({
      text: "Uyku moduna geciyorum. Ihtiyaciniz olursa adimi soyleyin.",
      after: () => ctx.sleep(),
    }),
  },

  /* -- selamlama --------------------------------------------------------- */
  {
    name: "rapor",
    example: "rapor ver",
    phrases: [
      "rapor ver", "rapor", "raporu ver", "bana rapor ver", "rapor hazirla",
      "rapor sun", "bilgisayar raporu", "bilgisayar durumu",
      "guncelleme var mi", "guncelleme kontrol et", "guncellemeleri kontrol et",
      "bilgisayar guncel mi", "son guncelleme ne zaman",
      "disk ne kadar dolu", "disk durumu",
    ],
    // "alarm raporu" ya da "kanal raporu" gibi baska bir seyi
    // kastediyorsa bu kural devreye girmesin.
    exclude: ["alarm", "not", "sohbet", "kanal", "youtube", "abone", "mail", "eposta"],
    // Rapor istegi, DRA'nin kendi durumunu anlatan "durum" kuralindan
    // once gelmeli: kullanici "rapor" derken bilgisayari kastediyor.
    priority: 2,
    run: async (n, raw, ctx) => {
      /*
       * "Rapor ver" tek bir sey degil, bir ZINCIR: once bilgisayarin
       * durumu, sonra bagliysa Gmail gelen kutusu, sonra bagliysa
       * WhatsApp ve diger musteri kaynaklari. Bagli olmayan bolum
       * sessizce atlaniyor.
       */
      const ozet = await ctx.fullReport();
      // null: kullanici izin vermedi — uyari zaten ekranda, sessiz gec.
      if (!ozet) return { text: "" };
      return ozet;
    },
  },

  {
    name: "musteri-topla",
    example: "mesajlari topla",
    phrases: [
      "mesajlari topla", "musteri mesajlarini topla", "yeni mesaj var mi",
      "mesajlari cek", "musterileri kontrol et", "gelen mesajlari topla",
    ],
    priority: 3,
    run: async (n, raw, ctx) => {
      const sonuc = await ctx.collectMessages();
      if (!sonuc) return { text: "" };
      return sonuc;
    },
  },

  {
    name: "musteri-mesajlari",
    example: "musteri mesajlari",
    phrases: [
      "musteri mesajlari", "musteri mesajlarim", "musteri raporu",
      "kac musteri yazmis", "yanit bekleyen var mi", "musteriler ne diyor",
      "yanitsiz mesajlar",
    ],
    priority: 2,
    run: async (n, raw, ctx) => {
      const sonuc = await ctx.messageReport();
      if (!sonuc) return { text: "" };
      return sonuc;
    },
  },

  /* -- bilgisayar kontrolu: fare ve klavye olmadan -------------------- */
  {
    name: "ses-ac",
    example: "sesi ac",
    phrases: [
      "sesi ac", "sesi yukselt", "sesi artir", "ses ac", "sesi acar misin",
      "sesi biraz ac", "sesi cok ac", "kulakligin sesini ac",
      "bilgisayarin sesini ac", "sesi arttir",
    ],
    /**
     * "sesini ac" DRA'nin KENDI sesi, "sesi ac" cihazin sesi.
     * Ama "kulakligin sesini ac" da cihaz sesi — icinde "sesini"
     * gectigi icin duz bir exclude bunu da elerdi. O yuzden: bir cihaz
     * kelimesi geciyorsa her zaman bu kural gecerli.
     */
    guard: (n) => {
      const cihaz = /kulakl|bilgisayar|hoparlor|ses seviye/.test(n);
      if (cihaz) return true;
      // Cihazdan bahsedilmiyorsa "sesini" DRA'ya aittir.
      return !/sesini|kendi/.test(n);
    },
    priority: 3,
    run: async (n, raw, ctx) => {
      // "cok" derse daha buyuk adim; "biraz" derse kucuk.
      const adim = has(n, "cok") ? 10 : has(n, "biraz", "az") ? 2 : 5;
      const r = await ctx.control({ action: "volume", direction: "up", steps: adim });
      return r ? "Sesi actim." : null;
    },
  },

  {
    name: "ses-kis",
    example: "sesi kis",
    phrases: [
      "sesi kis", "sesi azalt", "sesi dusur", "ses kis", "sesi biraz kis",
      "sesi alcalt", "kulakligin sesini kis", "bilgisayarin sesini kis",
    ],
    exclude: ["kendi sesini"],
    priority: 3,
    run: async (n, raw, ctx) => {
      const adim = has(n, "cok") ? 10 : has(n, "biraz", "az") ? 2 : 5;
      const r = await ctx.control({ action: "volume", direction: "down", steps: adim });
      return r ? "Sesi kistim." : null;
    },
  },

  {
    name: "ses-sustur",
    example: "bilgisayari sustur",
    phrases: [
      "bilgisayari sustur", "sesi sustur", "sessize al", "sesi kapat tamamen",
      "mute yap", "sesi ac kapat",
    ],
    exclude: ["sesini kapat", "kendi sesini"],
    priority: 3,
    run: async (n, raw, ctx) => {
      const r = await ctx.control({ action: "mute" });
      return r ? "Sesi susturdum." : null;
    },
  },

  {
    name: "medya",
    example: "duraklat",
    phrases: [
      "duraklat", "durdur", "oynat", "devam ettir", "devam et", "pause",
      "sonraki sarki", "siradaki sarki", "sarkiyi gec", "onceki sarki",
      "bir onceki sarki", "basa al",
    ],
    exclude: ["alarm", "zamanlayici", "video hazirla"],
    priority: 3,
    run: async (n, raw, ctx) => {
      const what = has(n, "sonraki", "siradaki", "gec")
        ? "sonraki"
        : has(n, "onceki", "basa")
          ? "onceki"
          : "oynat";
      const r = await ctx.control({ action: "media", what });
      if (!r) return null;
      return what === "sonraki" ? "Sonraki parcaya gectim."
        : what === "onceki" ? "Onceki parcaya dondum."
        : "Tamam.";
    },
  },

  {
    name: "ileri-sar",
    example: "ileri sar",
    phrases: [
      "ileri sar", "on saniye ileri", "10 saniye ileri sar", "ileri al",
      "geri sar", "on saniye geri", "10 saniye geri sar", "geri al",
      "biraz ileri sar", "biraz geri sar",
    ],
    priority: 3,
    run: async (n, raw, ctx) => {
      const geri = has(n, "geri");
      // "30 saniye ileri sar" gibi bir sayi varsa onu kullan.
      const sayi = /(\d+)\s*saniye/.exec(n)?.[1];
      const saniye = Math.min(120, Math.max(10, Number(sayi) || 10));
      const r = await ctx.control({
        action: "seek",
        seconds: geri ? -saniye : saniye,
      });
      if (!r) return null;
      // GERCEKTEN uygulanan sureyi soyluyoruz; 10'ar saniye atlandigi
      // icin istenen sure her zaman birebir uygulanmiyor.
      const uygulanan = Number.isFinite(r.applied) ? r.applied : saniye;
      return `${uygulanan} saniye ${geri ? "geri" : "ileri"} sardim.`;
    },
  },

  {
    name: "youtube-ac",
    example: "youtubede sunu ac",
    phrases: [
      "youtubede ac", "youtube da ac", "youtubeda ac",
      "youtubede oynat", "youtubede izle", "youtubede bul",
      "youtubeden ac", "youtubede calistir",
    ],
    // "youtubede muzik arat" arama komutudur, video oynatma degil.
    exclude: ["arat", "arama yap"],
    /**
     * Aranacak bir sey SOYLENMIS olmali: "youtube ac" siteyi acmak
     * demek (site-ac kurali), "youtubede kara murat ac" video oynatmak.
     */
    guard: (n) => {
      const kalan = n
        .replace(/youtube\S*/g, " ")
        .replace(/\b(ac|acar|misin|oynat|izle|bul|calistir|video|videoyu|videosunu|da|de|den|dan)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return kalan.length >= 2;
    },
    priority: 4,
    run: async (n, raw, ctx) => {
      // "youtubede kara murat ac" → aranacak: "kara murat"
      const sorgu = stripWords(
        raw.replace(/youtube\S*/gi, " "),
        ["ac", "aç", "acar", "açar", "misin", "mısın", "arat", "oynat", "izle",
         "bul", "video", "videoyu", "videosunu", "calistir", "çalıştır"],
      );

      if (!sorgu) return "Neyi acayim? Kanal ya da video adini soyleyin.";

      const r = await ctx.control({ action: "youtube", query: sorgu });
      if (!r) return null;
      const v = r.video;
      // Hangi videoyu actigini SOYLUYORUZ: "en yakin" her zaman
      // istenen olmayabilir, kullanici yanlissa hemen anlasin.
      return v.title
        ? `${v.title}${v.channel ? ` — ${v.channel}` : ""} aciliyor.`
        : `"${sorgu}" icin bulduğum ilk videoyu aciyorum.`;
    },
  },

  {
    name: "muzik-ac",
    example: "spotifyden muzik ac",
    phrases: [
      "muzik ac", "sarki ac", "muzik calar misin",
      "spotifyden ac", "spotifyden calistir", "youtube musicten ac",
      "soundcloudtan ac", "muzik calistir", "sarki calistir",
      "muzik ac spotifyden",
    ],
    /**
     * "spotify ac" uygulamayi acmak demek (site-ac). Bu kural ancak
     * "muzik/sarki" denmisse ya da kaynaktan ekli soylenmisse gecerli:
     * "spotify'DEN jazz ac".
     */
    guard: (n) => /muzik|sarki/.test(n) || /(den|dan|ten|tan)\b/.test(n),
    priority: 4,
    run: async (n, raw, ctx) => {
      const kaynaklar = ["youtube music", "spotify", "soundcloud", "youtube"];
      const kaynak = kaynaklar.find((k) => n.includes(k.replace(" ", ""))) ||
        kaynaklar.find((k) => n.includes(k)) || "youtube music";

      // Kaynak adini ve komut kelimelerini cikarip kalani arama yapiyoruz.
      const sorgu = stripWords(
        raw.replace(/spotify\S*|youtube\s*music\S*|soundcloud\S*|youtube\S*/gi, " "),
        ["muzik", "müzik", "sarki", "şarkı", "ac", "aç", "acar", "açar",
         "misin", "mısın", "calistir", "çalıştır", "calar", "çalar"],
      );

      const r = await ctx.control({ action: "music", source: kaynak, query: sorgu });
      if (!r) return null;
      return sorgu
        ? `${r.source} uzerinde "${sorgu}" aciliyor.`
        : `${r.source} aciliyor.`;
    },
  },

  {
    name: "ekrani-kilitle",
    example: "ekrani kilitle",
    phrases: ["ekrani kilitle", "bilgisayari kilitle", "kilitle ekrani"],
    priority: 3,
    run: async (n, raw, ctx) => {
      const r = await ctx.control({ action: "power", what: "kilitle" });
      return r ? "Ekrani kilitliyorum." : null;
    },
  },

  {
    name: "parlaklik",
    example: "parlakligi yuzde 50 yap",
    phrases: [
      "parlakligi ayarla", "parlakligi yuzde", "ekran parlakligi",
      "parlakligi dusur", "parlakligi artir", "ekrani karart", "ekrani parlat",
    ],
    priority: 3,
    run: async (n, raw, ctx) => {
      const yuzde = /(\d{1,3})/.exec(n)?.[1];
      const deger = yuzde
        ? Math.min(100, Math.max(0, Number(yuzde)))
        : has(n, "dusur", "karart") ? 30 : 80;
      const r = await ctx.control({ action: "brightness", percent: deger });
      return r ? `Parlakligi yuzde ${deger} yaptim.` : null;
    },
  },

  {
    name: "isletme-rapor",
    example: "isletme raporu",
    phrases: [
      "isletme raporu", "memnuniyet raporu", "musteri memnuniyeti",
      "sikayet raporu", "sikayetler ne durumda", "memnuniyet ne durumda",
      "isletmem nasil", "dukkanim nasil",
    ],
    priority: 3,
    run: async (n, raw, ctx) => {
      const sonuc = await ctx.businessReport();
      if (!sonuc) return { text: "" };
      return sonuc;
    },
  },

  {
    name: "otomatik-yanit",
    example: "otomatik yanitla",
    phrases: [
      "otomatik yanitla", "mesajlari yanitla", "musterilere cevap ver",
      "otomatik yanit calistir", "bekleyenleri yanitla",
    ],
    priority: 3,
    run: async (n, raw, ctx) => {
      // Sesli komutta once DENEME yapiyoruz: kullanici ekrani gormeden
      // gercek musteriye mesaj gitmesin.
      const sonuc = await ctx.runAutoreply(true);
      if (!sonuc) return { text: "" };
      return sonuc;
    },
  },

  {
    name: "youtube",
    example: "kanal raporu",
    phrases: [
      "kanal raporu", "youtube raporu", "kanalim nasil", "kac abonem var",
      "abone sayim", "kanal durumu", "youtube durumu", "sirada ne var",
      "yayin sirasi", "kac video bekliyor",
    ],
    priority: 2,
    run: async (n, raw, ctx) => {
      const ozet = await ctx.youtubeReport();
      if (!ozet) return { text: "" };
      return ozet;
    },
  },

  {
    name: "montaj",
    example: "montaji baslat",
    phrases: [
      "montaji baslat", "montaj yap", "videoyu montajla", "video hazirla",
      "montaja basla", "videoyu birlestir", "klipleri birlestir",
      "montaj baslat", "videomu hazirla", "kurguyu yap",
    ],
    priority: 2,
    run: async (n, raw, ctx) => {
      const sonuc = await ctx.runMontage();
      if (!sonuc) return { text: "" };
      return sonuc;
    },
  },

  {
    name: "eposta",
    example: "mail var mi",
    phrases: [
      "mail var mi", "maillerim", "mail raporu", "eposta raporu",
      "e posta raporu", "postalarim", "gelen kutusu", "gelen kutum",
      "mail geldi mi", "yeni mail var mi", "mailleri kontrol et",
      "epostalarimi kontrol et", "mail ozeti", "kim mail atmis",
      "onemli mail var mi",
    ],
    priority: 2,
    run: async (n, raw, ctx) => {
      const ozet = await ctx.mailReport();
      if (!ozet) return { text: "" };
      return ozet;
    },
  },

  {
    name: "selam",
    example: "merhaba",
    phrases: [
      "merhaba", "selam", "selamlar", "selamun aleykum", "hey", "alo",
      "gunaydin", "iyi aksamlar", "iyi gunler", "naber", "nasilsin",
      "ne haber", "nasil gidiyor", "iyi misin", "orada misin",
    ],
    run: (n) => {
      if (has(n, "nasilsin", "naber", "nasil gidiyor")) {
        return "Tum sistemlerim calisiyor, tesekkur ederim. Siz nasilsiniz?";
      }
      if (has(n, "gunaydin")) return "Gunaydin efendim. Gununuz verimli gecsin.";
      if (has(n, "iyi aksamlar")) return "Iyi aksamlar efendim.";
      return pick(GREETINGS);
    },
  },
  {
    name: "tesekkur",
    example: "tesekkurler",
    phrases: [
      "tesekkurler", "tesekkur ederim", "sagol", "sag ol", "eyvallah",
      "helal", "minnettarim", "cok iyisin",
    ],
    run: () => "Rica ederim efendim. Baska bir sey lazim olursa buradayim.",
  },

  /* -- kimlik / yardim --------------------------------------------------- */
  {
    name: "kimsin",
    example: "kimsin",
    phrases: [
      "kimsin", "sen kimsin", "adin ne", "ismin ne", "kendini tanit",
      "sen nesin", "nesin sen", "seni kim yapti", "sen bir yapay zeka misin",
    ],
    run: () =>
      "Ben DRA. Kisisel asistaniniz. Bir yapay zeka degilim — komutlarla calisan " +
      "bir programim. Tamamen bu cihazda calisirim, hicbir sirkete baglanmam ve " +
      "konustuklariniz disari cikmaz.",
  },
  {
    name: "yardim",
    example: "neler yapabilirsin",
    phrases: [
      "ne yapabilirsin", "neler yapabilirsin", "yardim", "komutlar",
      "nasil kullanilir", "yeteneklerin", "ne is yaparsin", "hangi komutlar",
      "komut listesi", "bana yardim et",
    ],
    run: () =>
      "Saati ve tarihi soyleyebilirim, hesap yapabilirim, site acabilirim, arama " +
      "yapabilirim, alarm ve zamanlayici kurabilirim, not tutabilirim, tema rengimi " +
      "degistirebilirim ve sistem durumunu raporlayabilirim. Sol paneldeki ayarlardan " +
      "beni yapilandirabilirsiniz. Beni uyutmak icin uyu demeniz yeterli.",
  },

  /* -- saat / tarih ------------------------------------------------------ */
  {
    name: "saat",
    example: "saat kac",
    phrases: ["saat kac", "saat kacta", "saati soyle", "zaman ne", "vakit ne", "saat"],
    // Alarm ve sayac cumlelerinde de "saat" gecer; onlar bu kurala dusmemeli.
    exclude: ["alarm", "zamanlayici", "sayac", "hatirlat", "geri sayim", "uyandir"],
    run: () => `Saat ${formatTime()}.`,
  },
  {
    name: "tarih",
    example: "bugun gunlerden ne",
    phrases: [
      "bugun gunlerden ne", "bugun ayin kaci", "hangi gundeyiz", "tarih ne",
      "bugunun tarihi", "ayin kaci", "bugun ne", "hangi gun", "gunlerden ne",
      "bugun gun ne", "tarih", "hangi tarihteyiz", "ne zamandayiz",
    ],
    exclude: ["alarm", "zamanlayici", "sayac"],
    /*
     * "bugun" cok guclu bir kelime ve icinde gectigi her cumleyi buraya
     * cekiyordu: "bugun dolar kac lira" sorusuna DRA bugunun TARIHINI
     * soyluyordu. Disaridan bir olgu istenen cumleler bu kurala ait
     * degil — arastirmaya gitmeli.
     */
    guard: (n, raw) => !soruMu(raw),
    run: () => `Bugun ${formatDate()}.`,
  },

  /* -- hava -------------------------------------------------------------- */
  {
    name: "hava",
    example: "hava durumu",
    phrases: [
      "hava durumu", "hava nasil", "disarisi nasil", "yagmur yagacak mi",
      "hava kac derece", "sicaklik kac", "hava",
    ],
    /*
     * GERCEKTEN hava sorulmus olmali.
     *
     * "hava nasil" ifadesindeki "nasil" tek basina puan topluyordu ve
     * "kuru fasulye nasil yapilir" gibi cumleler bu kurala geliyordu.
     * Cumlede hava ile ilgili bir kelime yoksa bu kural bize ait degil.
     */
    guard: (n) => /\b(hava|sicaklik|yagmur|kar|ruzgar|disarisi|derece)\b/.test(n),
    /*
     * ESKIDEN "soyleyemem, disariya baglanmam" diyordu. O cumle artik
     * dogru degil: web arastirmasi HEP ACIK. Kendi yetenegini yanlis
     * anlatan bir cevap, olmayan bir sinir uyduruyor.
     */
    run: async (n, raw, ctx) => {
      if (!ctx.research) return "Hava durumunu arastiramiyorum.";
      const sonuc = await ctx.research(raw);
      const metin = typeof sonuc === "string" ? sonuc : sonuc?.text || "";

      /*
       * Sehir ipucunu YALNIZCA cevap bulunduysa ekliyoruz.
       *
       * Arastirma basarisiz oldugunda ("bulamadim", "ulasamadim") ustune
       * "sehir soylerseniz daha isabetli olur" demek yaniltici: sorun
       * sehir degil, cevabin hic gelmemis olmasi.
       */
      const basarisiz = /bulamadim|ulasamadim|anlayamadim|hata/i.test(metin);
      const sehirSoylenmis = raw.trim().split(/\s+/).length > 3;
      const not = basarisiz || sehirSoylenmis
        ? ""
        : " Sehir soylerseniz daha isabetli olur — «Ankara hava durumu» gibi.";

      if (typeof sonuc === "string") return metin + not;
      return { ...sonuc, text: metin + not };
    },
  },

  /* -- uygulama / oyun acma --------------------------------------------- */
  // Site acma kuralindan ONCE: "valorant ac" once kurulu oyunlarda aranir.
  {
    name: "uygulama-ac",
    priority: 1,
    example: "spotify ac",
    phrases: ["ac", "acar misin", "baslat", "calistir", "acsana", "girelim"],
    exclude: ["ayar", "panel", "tam ekran"],
    // Yalnizca kurulu bir uygulamaya benziyorsa gecerli.
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.findApp?.(stripVerbs(raw))),
    run: async (n, raw, ctx) => {
      const hit = ctx.findApp(stripVerbs(raw));
      if (!hit) return "Bu isimde kurulu bir uygulama bulamadim.";
      try {
        await ctx.launchApp(hit.app.id);
        return `${hit.app.name} baslatiliyor.`;
      } catch (err) {
        return `${hit.app.name} baslatilamadi: ${err.message}`;
      }
    },
  },
  {
    name: "uygulama-kapat",
    priority: 1,
    example: "spotify kapat",
    phrases: ["kapat", "kapatir misin", "sonlandir", "cik", "durdur"],
    exclude: ["ses", "mikrofon", "alarm", "ekran", "kendini"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.findApp?.(stripVerbs(raw))),
    run: async (n, raw, ctx) => {
      const hit = ctx.findApp(stripVerbs(raw));
      if (!hit) return "Bu isimde acik bir uygulama bulamadim.";
      try {
        await ctx.closeApp(hit.app.id);
        return `${hit.app.name} kapatildi.`;
      } catch (err) {
        return `${hit.app.name} kapatilamadi: ${err.message}`;
      }
    },
  },

  /* -- moderasyon (yayinci destegi acikken) ------------------------------ */
  {
    name: "mod-banla",
    priority: 2,
    example: "ahmeti banla",
    phrases: ["banla", "yasakla", "ban at", "uzaklastir", "at kanaldan"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.kickReady?.()),
    run: async (n, raw, ctx) => {
      const user = extractUsername(raw, ["banla", "yasakla", "ban", "at", "kanaldan", "uzaklastir"]);
      if (!user) return "Kimi yasaklayacagimi soyleyin.";
      try {
        return await ctx.kickAction("ban", [user]);
      } catch (err) {
        return `Yasaklayamadim: ${err.message}`;
      }
    },
  },
  {
    name: "mod-sustur",
    priority: 2,
    example: "ahmeti 10 dakika sustur",
    phrases: ["sustur", "timeout ver", "gecici yasak", "sessize al kullanici"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.kickReady?.()),
    run: async (n, raw, ctx) => {
      const user = extractUsername(raw, ["sustur", "timeout", "ver", "dakika", "saniye", "gecici", "yasak"]);
      if (!user) return "Kimi susturacagimi soyleyin.";
      const minutes = extractNumber(n) || 5;
      try {
        return await ctx.kickAction("timeout", [user, minutes * 60]);
      } catch (err) {
        return `Susturamadim: ${err.message}`;
      }
    },
  },
  {
    name: "mod-ban-kaldir",
    priority: 2,
    example: "ahmetin yasagini kaldir",
    phrases: ["yasagini kaldir", "bani kaldir", "affet", "yasagi kaldir", "unban"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.kickReady?.()),
    run: async (n, raw, ctx) => {
      const user = extractUsername(raw, ["yasagini", "yasagi", "bani", "kaldir", "affet", "unban"]);
      if (!user) return "Kimin yasagini kaldiracagimi soyleyin.";
      try {
        return await ctx.kickAction("unban", [user]);
      } catch (err) {
        return `Kaldiramadim: ${err.message}`;
      }
    },
  },
  {
    name: "mod-yaz",
    priority: 2,
    example: "sohbete yaz merhaba",
    phrases: ["sohbete yaz", "kanala yaz", "chate yaz", "mesaj gonder"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.kickReady?.()),
    run: async (n, raw, ctx) => {
      const text = raw
        .replace(/\b(sohbete|kanala|chate|yaz|mesaj|gonder)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return "Ne yazacagimi soyleyin.";
      try {
        return await ctx.kickAction("sendMessage", [text]);
      } catch (err) {
        return `Gonderemedim: ${err.message}`;
      }
    },
  },

  /* -- web aramasi (ayardan acikken) ------------------------------------- */
  {
    name: "web-arama",
    priority: 1,
    example: "arastir istanbul nufusu",
    phrases: ["arastir", "internetten bul", "webden bul", "nedir", "kimdir", "ne demek", "hakkinda bilgi"],
    guard: (n, raw, tokens, ctx) => Boolean(ctx?.searchEnabled?.()),
    run: async (n, raw, ctx) => {
      const query = raw
        .replace(/\b(arastir|internetten|webden|bul|hakkinda|bilgi|ver|lutfen)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!query) return "Neyi arastirmami istiyorsunuz?";
      /*
       * ZENGIN yolu kullaniyoruz, tek cumlelik olani degil.
       *
       * "arastir …" komutu bir donem yalnizca duz bir cumle donduruyordu:
       * ne kart, ne gorsel, ne kaynak bagi. Oysa komutla sorulan bir soru
       * ile dogrudan sorulan bir soru arasinda kullanici acisindan fark
       * yok — ikisi de ayni seyi hak ediyor.
       */
      return ctx.research(query);
    },
  },

  /* -- site acma --------------------------------------------------------- */
  {
    name: "site-ac",
    example: "youtube ac",
    phrases: ["ac", "acar misin", "baslat", "goster", "gir", "acsana"],
    // Yalnizca tanidigi bir siteden bahsediliyorsa gecerli.
    guard: (n, raw, tokens) => mentions(tokens, Object.keys(SITES)),
    run: (n, raw, ctx) => {
      const key = Object.keys(SITES).find((k) => n.includes(k));
      ctx.openUrl(SITES[key]);
      return `${key} aciliyor.`;
    },
  },

  /* -- arama ------------------------------------------------------------- */
  {
    name: "arama",
    example: "googleda kedi ara",
    phrases: ["ara", "arat", "arama yap", "bul", "aratir misin", "arastir"],
    exclude: ["alarm", "zamanlayici", "sayac"],
    // "ara" tek basina yeterli degil; aranacak bir sey olmali.
    guard: (n, raw, tokens) => tokens.length > 1,
    run: (n, raw, ctx) => {
      const target = has(n, "youtube") ? "youtube"
        : has(n, "wikipedia", "vikipedi") ? "wikipedia"
        : "google";

      let query = raw
        .replace(/\b(youtube|google|wikipedia|vikipedi)\s*(da|de|ta|te|'?da|'?de)?\b/gi, " ")
        .replace(/\b(ara|arat|arama yap|bul|bakar misin|lutfen)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!query) return "Neyi aramami istiyorsunuz?";

      const encoded = encodeURIComponent(query);
      const urls = {
        google: `https://www.google.com/search?q=${encoded}`,
        youtube: `https://www.youtube.com/results?search_query=${encoded}`,
        wikipedia: `https://tr.wikipedia.org/w/index.php?search=${encoded}`,
      };
      ctx.openUrl(urls[target]);
      return `${target} uzerinde "${query}" aratiliyor.`;
    },
  },

  /* -- matematik --------------------------------------------------------- */
  {
    name: "hesap",
    example: "12 kere 8 kac eder",
    phrases: ["hesapla", "kac eder", "kac yapar", "toplami", "carpimi", "hesap yap"],
    // Sade aritmetik ifadeler ("12 kere 8") kalip listesine girmez.
    test: (n) => {
      const m = mathify(n);
      return /^[\d\s+\-*/^%().]+$/.test(m) && /[+\-*/^]/.test(m) && /\d/.test(m);
    },
    run: (n) => {
      const expr = mathify(n)
        .replace(/\b(hesapla|kac eder|kacdir|kac yapar|toplami|nedir|kac)\b/g, " ")
        .trim();
      try {
        const value = evaluateExpression(expr);
        if (value === null) return "Bu ifadeyi cozemedim.";
        return `Sonuc ${prettyNumber(value)}.`;
      } catch {
        return "Bu hesabi cozemedim. Daha sade sorabilir misiniz?";
      }
    },
  },

  /* -- alarm ------------------------------------------------------------- */
  /* Sorgu ve silme kurallari kurma kuralindan ONCE gelmeli: "alarmlarim"
     da "alarm" sozcugunu icerdigi icin aksi halde yeni alarm kurmaya
     calisiyordu. */
  {
    name: "alarmlari-oku",
    example: "alarmlarim",
    phrases: [
      "alarmlarim", "alarmlari soyle", "alarmlari goster", "alarmlari listele",
      "kurulu alarmlar", "alarm var mi", "hangi alarmlar", "alarmlarimi goster",
    ],
    exclude: ["sil", "temizle", "kaldir", "iptal"],
    run: (n, raw, ctx) => {
      ctx.openPanel("alarm");
      const list = ctx.getAlarms().filter((a) => a.enabled);
      if (!list.length) return "Kurulu alarminiz yok.";
      const spoken = list
        .map((a) => `${a.time}${a.label ? ` ${a.label}` : ""}`)
        .join(", ");
      return `${list.length} alarminiz var: ${spoken}.`;
    },
  },
  {
    name: "alarmlari-sil",
    example: "alarmlari sil",
    phrases: [
      "alarmlari sil", "alarmlari iptal et", "alarmlari kapat", "tum alarmlari sil",
      "alarmi kaldir", "alarmlari temizle", "alarmi iptal et",
    ],
    run: (n, raw, ctx) => {
      if (!ctx.getAlarms().length) return "Zaten kurulu alarm yok.";
      ctx.clearAlarms();
      return "Tum alarmlar silindi.";
    },
  },
  {
    name: "alarm-kur",
    example: "sabah yedi bucukta alarm kur",
    phrases: [
      "alarm kur", "alarm ayarla", "alarm koy", "alarm istiyorum", "alarma kur",
      "beni uyandir", "uyandir beni", "alarm kurar misin", "alarm",
    ],
    // Sure anlatan ifadeler ("5 dakika sonra") zamanlayici kuralina kalir.
    guard: (n) => !(hasDurationShape(n) && !hasClockShape(n)),
    run: (n, raw, ctx) => {
      const time = parseClockTime(n);
      if (!time) {
        return "Saat kaca alarm kurmami istersiniz? Ornegin: sabah yedi bucukta alarm kur.";
      }

      const repeat = has(n, "her gun", "her sabah", "her aksam", "tekrarla");
      const label = extractAlarmLabel(raw);

      const alarm = ctx.addAlarm(time, label, repeat);
      if (!alarm) return "Bu saati anlayamadim.";

      return (
        `${alarm.time} icin alarm kuruldu${repeat ? ", her gun tekrarlanacak" : ""}. ` +
        `${ctx.describeAlarm(alarm)} calacak.`
      );
    },
  },

  /* -- zamanlayici ------------------------------------------------------- */
  {
    name: "zamanlayici",
    example: "5 dakika zamanlayici kur",
    phrases: [
      "zamanlayici kur", "sayac kur", "geri sayim baslat", "hatirlat",
      "sure tut", "kronometre", "zamanlayici", "sayac", "geri sayim",
      "dakika sonra hatirlat",
    ],
    // Mutlak saat verilmisse bu bir alarmdir, sayac degil.
    guard: (n) => !hasClockShape(n),
    run: (n, raw, ctx) => {
      const amount = extractNumber(n);
      if (!amount || amount <= 0) return "Kac dakika ya da saniye istediginizi soyleyin.";

      const unit = has(n, "saniye") ? "saniye" : has(n, "saat") ? "saat" : "dakika";
      const seconds = unit === "saniye" ? amount : unit === "saat" ? amount * 3600 : amount * 60;
      if (seconds > 12 * 3600) return "En fazla on iki saatlik bir sayac kurabilirim.";

      const label = has(n, "hatirlat") ? "Hatirlatma" : "Zamanlayici";
      ctx.addTimer(label, seconds);
      return `${amount} ${unit}lik ${label.toLowerCase()} kuruldu.`;
    },
  },

  /* -- notlar ------------------------------------------------------------ */
  {
    name: "not-al",
    example: "not al sut al",
    phrases: ["not al", "not et", "not tut", "kaydet", "yaz bunu", "aklinda tut", "sunu not al"],
    exclude: ["notlarim", "notlari sil", "notlari oku"],
    run: (n, raw, ctx) => {
      const body = raw.replace(/^\s*(not al|not et|sunu not al|kaydet)\s*/i, "").trim();
      if (!body) return "Ne not almami istiyorsunuz?";
      ctx.addNote(body);
      return "Not alindi.";
    },
  },
  {
    name: "notlari-oku",
    example: "notlarim",
    phrases: [
      "notlarim", "notlari oku", "notlari soyle", "ne not almistim",
      "notlarimi goster", "not var mi", "notlari goster", "notlari listele",
    ],
    // "notlari sil" da "notlari" iceriyor; silme kurallarini burada kesiyoruz.
    exclude: ["sil", "temizle", "kaldir", "iptal"],
    run: (n, raw, ctx) => {
      ctx.openPanel("notlar");
      const notes = ctx.getNotes();
      if (!notes.length) return "Kayitli notunuz yok.";
      return `${notes.length} notunuz var. ` + notes.map((x, i) => `${i + 1}. ${x}`).join(". ");
    },
  },
  {
    name: "notlari-sil",
    example: "notlari sil",
    phrases: ["notlari sil", "notlari temizle", "tum notlari sil", "notlari kaldir"],
    run: (n, raw, ctx) => {
      ctx.clearNotes();
      return "Tum notlar silindi.";
    },
  },

  /* -- sans oyunlari ----------------------------------------------------- */
  {
    name: "yazi-tura",
    example: "yazi tura at",
    phrases: ["yazi tura", "para at", "yazi mi tura mi", "yazi tura at"],
    run: () => `${Math.random() < 0.5 ? "Yazi" : "Tura"} geldi.`,
  },
  {
    name: "zar",
    example: "zar at",
    phrases: ["zar at", "zar atalim", "zar"],
    run: () => `Zar ${1 + Math.floor(Math.random() * 6)} geldi.`,
  },
  {
    name: "rastgele-sayi",
    example: "sayi tut",
    phrases: ["rastgele sayi", "sayi tut", "rasgele sayi", "sayi sec", "tut bir sayi"],
    run: (n) => {
      const nums = (n.match(/\d+/g) || []).map(Number);
      const min = nums.length > 1 ? Math.min(...nums) : 1;
      const max = nums.length > 1 ? Math.max(...nums) : nums[0] || 100;
      return `${min} ile ${max} arasinda ${min + Math.floor(Math.random() * (max - min + 1))} tuttum.`;
    },
  },

  /* -- saka -------------------------------------------------------------- */
  {
    name: "saka",
    example: "saka yap",
    phrases: [
      "saka yap", "espri yap", "fikra anlat", "guldur beni",
      "komik bir sey soyle", "saka", "espri",
    ],
    run: () => pick(JOKES),
  },

  /* -- arayuz kontrolleri ------------------------------------------------ */
  {
    name: "renk",
    example: "renk yesil",
    phrases: ["renk", "tema", "rengini degistir", "temayi degistir", "rengi degistir"],
    exclude: ["ayar"],
    run: (n, raw, ctx) => {
      const THEMES = {
        mavi: [53, 230, 255], turkuaz: [53, 230, 255], camgobegi: [53, 230, 255],
        yesil: [77, 255, 168], kirmizi: [255, 77, 94], turuncu: [255, 180, 84],
        sari: [255, 226, 84], mor: [186, 122, 255], pembe: [255, 122, 200],
        beyaz: [226, 240, 255], altin: [255, 200, 90],
      };
      const key = Object.keys(THEMES).find((k) => n.includes(k));
      if (!key) return "Mavi, yesil, kirmizi, turuncu, sari, mor, pembe veya altin secebilirsiniz.";
      ctx.setTheme(THEMES[key]);
      return `Arayuz rengi ${key} olarak ayarlandi.`;
    },
  },
  {
    name: "sesi-kapat",
    example: "sesini kapat",
    phrases: ["sesini kapat", "sessiz ol", "konusma", "sus", "sesi kis", "sessize al"],
    run: (n, raw, ctx) => ({
      text: "Sesimi kapatiyorum. Yazili yanit vermeye devam edecegim.",
      after: () => ctx.setVoice(false),
    }),
  },
  {
    name: "sesi-ac",
    example: "sesini ac",
    phrases: ["sesini ac", "konus benimle", "sesli yanit ver", "sesini geri ac"],
    // "kulakligin sesini ac" DRA'nin sesi degil, CIHAZIN sesi.
    // Kokleri kullaniyoruz: "kulakligin" icinde "kulaklik" GECMIYOR
    // (yumusak g). Ek almis haller de yakalansin.
    exclude: ["kulakl", "bilgisayar", "hoparlor", "yukselt", "artir", "kis", "azalt"],
    run: (n, raw, ctx) => {
      ctx.setVoice(true);
      return "Sesim tekrar acik.";
    },
  },
  {
    name: "tam-ekran",
    example: "tam ekran",
    phrases: ["tam ekran", "tam ekrana gec", "ekrani buyut", "buyut ekrani"],
    run: (n, raw, ctx) => {
      ctx.toggleFullscreen();
      return "Tam ekran moduna geciyorum.";
    },
  },
  {
    name: "temizle",
    example: "ekrani temizle",
    phrases: [
      "ekrani temizle", "kaydi temizle", "gecmisi temizle", "sohbeti temizle",
      "logu temizle", "sohbeti sil",
    ],
    run: (n, raw, ctx) => {
      ctx.clearLog();
      return "Kayit temizlendi.";
    },
  },

  /* -- panel gezinme ----------------------------------------------------- */
  {
    name: "panel-ac",
    example: "ayarlari ac",
    phrases: [
      "ayarlari ac", "ayarlar", "ayar sekmesi", "not sekmesi", "sistem sekmesi",
      "paneli ac", "ayarlara git", "secenekler",
    ],
    run: (n, raw, ctx) => {
      const target = has(n, "ayar") ? "ayar" : has(n, "not") ? "notlar" : "sistem";
      ctx.openPanel(target);
      return `${target} paneli acildi.`;
    },
  },

  /* -- sistem raporu ----------------------------------------------------- */
  {
    name: "durum",
    example: "sistem durumu",
    phrases: [
      "sistem durumu", "sistemler nasil", "durumun ne", "kendi durumun",
      "her sey yolunda mi", "durum", "nasil gidiyor sistemler",
    ],
    run: (n, raw, ctx) => ctx.systemReport(),
  },
];

/* --------------------------------------------------------- yardimcilar */

/** "spotify ac" -> "spotify": komut fiillerini cumleden temizler. */
const VERBS = /\b(ac|acar|acsana|misin|baslat|calistir|kapat|kapatir|sonlandir|cik|durdur|girelim|lutfen|bana|hemen|sunu|su|program|uygulama|oyun|oyunu)\b/gi;

function stripVerbs(raw) {
  return raw.replace(VERBS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Moderasyon cumlesinden kullanici adini cikarir.
 * Turkce ekleri de temizler: "ahmeti banla" -> "ahmet".
 */
function extractUsername(raw, stopWords) {
  const stop = new Set([...stopWords, "lutfen", "sunu", "su", "bu", "kullanici", "kullaniciyi"]);
  const words = raw.split(/\s+/).filter((w) => {
    const t = normalize(w);
    return t && !stop.has(t) && !/^\d+$/.test(t) && !/^(dakika|saniye|saat)$/.test(t);
  });
  if (!words.length) return null;
  // Ilk kalan sozcuk kullanici adi sayilir; belirtme eki atilir.
  return words[0].replace(/['’]?(yi|yı|yu|yü|i|ı|u|ü|nin|nın|nun|nün|in|ın|un|ün)$/i, "");
}

/* ---------------------------------------------------------------- esleme */

/** Bir kuralin calismasi icin gereken en dusuk puan. */
const THRESHOLD = 0.62;
/** Bu puanin ustundeki en yakin kural "sunu mu demek istediniz" olur. */
const SUGGEST_THRESHOLD = 0.34;

/**
 * Metni tum kurallara karsi puanlar ve en iyisini dondurur.
 *
 * Onceki surumde kurallar sirayla denenip ilk tutan calisiyordu; bu,
 * "alarmlarim" gibi bir cumlenin "alarm kur" kuralina dusmesine yol
 * aciyordu. Artik hepsi puanlanip en yuksek olan seciliyor.
 */
function scoreRules(raw, ctx) {
  const n = normalize(raw);
  const tokens = tokenize(n);
  const scored = [];

  for (const rule of RULES) {
    // Disarida birakma kaliplari
    if (rule.exclude && mentions(tokens, rule.exclude)) continue;
    // Ek kosul (mutlak saat var mi, kurulu uygulama mi, Kick acik mi)
    if (rule.guard && !rule.guard(n, raw, tokens, ctx)) continue;

    let score = 0;
    // Ozel mantik (aritmetik ifade gibi) tam puan sayilir.
    if (rule.test) {
      try {
        if (rule.test(n, raw, tokens)) score = 1;
      } catch {
        score = 0;
      }
    }
    if (score < 1 && rule.phrases) {
      score = Math.max(score, bestScore(tokens, rule.phrases));
    }
    if (score > 0) scored.push({ rule, score, n });
  }

  // Esit puanda `priority` belirler. Ozel kipler (moderasyon, uygulama)
  // genel kurallarin onune gecer: "sohbete yaz merhaba" bir selamlama
  // degil, moderasyon komutudur.
  scored.sort(
    (a, b) => b.score - a.score || (b.rule.priority || 0) - (a.rule.priority || 0),
  );
  return scored;
}

/**
 * Hangi kurallarin ne puan aldigini dondurur (test ve teshis icin).
 * Yanlis yonlendirmeleri ancak buradan gorebiliyoruz.
 */
export function explain(rawText, limit = 3, ctx = null) {
  return scoreRules(rawText, ctx)
    .slice(0, limit)
    .map(({ rule, score }) => ({ name: rule.name, score: Number(score.toFixed(3)) }));
}

/**
 * Metni komut tablosuyla esler.
 * Yeterince guclu bir eslesme yoksa null doner.
 *
 * Kurallar `{ text }` ya da `{ text, after }` dondurebilir; `after`,
 * yanit soylendikten SONRA calisacak yan etkidir (uyutmak, sesi kapatmak).
 * Bu alanin adi bilerek `then` DEGIL: `.then` metodu olan her nesne
 * JavaScript'te promise sayilir, `await` onu cozmeye calisir ve resolve
 * cagrilmadigi icin komut hatti sonsuza kadar asili kalir.
 */
export async function runCommand(rawText, ctx) {
  const raw = (rawText || "").trim();
  if (!raw) return null;

  const scored = scoreRules(raw, ctx);
  const best = scored[0];
  if (!best || best.score < THRESHOLD) return null;

  try {
    const result = await best.rule.run(best.n, raw, ctx);
    if (!result) return null;
    return typeof result === "string" ? { text: result } : result;
  } catch (err) {
    console.error(`[dra] "${best.rule.name}" komutu hata verdi:`, err);
    return { text: "Bu komutu calistirirken bir sorun cikti." };
  }
}

/**
 * Anlasilmayan girdi icin yardimci yanit.
 * Esik altinda kalan ama tamamen alakasiz da olmayan bir kural varsa
 * onun ornegini onerir.
 */
/**
 * Girilen metne YAKIN bir komut var mi?
 *
 * Arastirma hep acik oldugu icin anlasilmayan her sey internete
 * gidebilirdi. Oysa "alrm kur" gibi bir yazim hatasi aranacak bir soru
 * degil, yanlis yazilmis bir komut. Once buna bakiyoruz.
 */
/**
 * Disariya sorulacak bir BILGI SORUSU gibi mi duruyor?
 *
 * "nerede" ve "nasil" bilerek DISARIDA: "not defteri nerede" ya da
 * "alarm nasil kurulur" aslinda bir KOMUTU soruyor, internete
 * sorulacak bir sey degil. Buradakiler ise disaridan bir olgu isteyen
 * kaliplar: "kac metre", "nedir", "ne kadar", "kim".
 */
/*
 * SORU ISARETLERI — disaridan bir bilgi istendigini gosteren kaliplar.
 *
 * Eski liste cok darrdi ve sonucu su oluyordu:
 *   "minecraftta ... nasil yapilir"  → hava durumu kuralina
 *   "kuru fasulye nasil yapilir"     → hava durumu kuralina
 *   "iphone 15 en ucuz hangi sitede" → TARIH kuralina, DRA gunun
 *                                       tarihini soyluyordu
 *
 * Yani "nasil" iceren her soru havaya, "hangi" iceren her soru tarihe
 * gidiyordu. Liste artik gercekten sorulan seyleri kapsiyor.
 */
const SORU_ISARETI = new RegExp([
  "\\bkac\\b", "\\bkacta\\b", "\\bkac tane\\b", "\\bkac para\\b",
  "\\bkac lira\\b", "\\bkac tl\\b",
  "\\bnedir\\b", "\\bne kadar\\b", "\\bne demek\\b", "\\bne ise yarar\\b",
  "\\bkimdir\\b", "\\bkim\\b",
  "\\bneden\\b", "\\bnicin\\b",
  "\\bnasil\\b",
  "\\bnerede\\b", "\\bnerde\\b", "\\bnereden\\b", "\\bnereye\\b",
  "\\bhangi\\b",
  "\\bne zaman\\b",
  "\\btarif\\b", "\\btarifi\\b", "\\btarifleri\\b",
  "\\byapilir\\b", "\\byapilisi\\b", "\\byapimi\\b",
  "\\ben ucuz\\b", "\\ben uygun\\b", "\\ben iyi\\b",
  "\\bfiyat\\b", "\\bfiyati\\b", "\\bfiyatlari\\b",
].join("|"));

/*
 * ISTISNA — sorunun konusu DRA'NIN KENDI DURUMU.
 *
 * "hangi gundeyiz" bir soru ama cevabi internette degil, burada.
 * Listeyi genisletirken bunlari disarida birakmak sart; yoksa saat ve
 * tarih komutlari arastirmaya gonderilir.
 */
const KENDI_DURUMU = /\b(gun|gunlerden|gundeyiz|tarih|tarihteyiz|saat|saati|vakit|alarm|alarmlar|alarmlarim|zamanlayici|sayac|not|notlar|notlarim|pil|batarya)\b/;

/**
 * Bu metin DISARIDAN bilgi isteyen bir soru mu?
 *
 * Oyle ise yerel komutlara degil arastirmaya gitmeli.
 */
function soruMu(text) {
  const n = normalize(text);
  if (!SORU_ISARETI.test(n)) return false;
  // Konusu DRA'nin kendi durumuysa yerel komut kalsin.
  return !KENDI_DURUMU.test(n);
}

/**
 * Girilen metne YAKIN bir komut var mi?
 *
 * Esik SUGGEST_THRESHOLD'dan (0.34) yuksek tutuluyor: o esik "en yakin
 * ornegi goster" icin yeterliydi ama burada karar veriyoruz. Dusuk
 * esikle "eyfel kulesi kac metre" gibi GERCEK SORULAR bir komuta
 * benzetilip arastirmaya hic ulasmiyordu.
 *
 * Soru gibi duran metinler ise her durumda arastirmaya gider.
 */
const KOMUT_ONERI_ESIGI = 0.5;

export function nearestCommand(text) {
  if (soruMu(text)) return null;
  const near = scoreRules(text).find((s) => s.score >= KOMUT_ONERI_ESIGI);
  return near?.rule.example ? near.rule.example : null;
}

export function suggestCommand(text) {
  const ornek = nearestCommand(text);

  if (ornek) {
    return `Bunu tam anlayamadim. Sunu mu demek istediniz: "${ornek}"?`;
  }

  return (
    "Bunu anlayamadim. Ben bir sohbet yapay zekasi degilim, komutlarla calisan " +
    "bir asistanim. Saat ve tarih soyleyebilir, hesap yapabilir, alarm ve " +
    "zamanlayici kurabilir, not tutabilir, site acabilir ve arama yapabilirim. " +
    "Tum listeyi duymak icin \"neler yapabilirsin\" deyin."
  );
}
