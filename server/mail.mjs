/**
 * E-posta raporu — IMAP uzerinden, OAuth'suz.
 *
 * NEDEN IMAP: Gmail'e erismenin iki yolu var. Biri Google Cloud'da bir
 * OAuth istemcisi acmak (proje, onay ekrani, istemci kimligi...), digeri
 * hesapta bir "uygulama sifresi" uretip IMAP ile baglanmak. Ikincisi
 * kullanicidan tek bir sey istiyor ve tamamen bu bilgisayarda kaliyor.
 * Bu yuzden IMAP secildi.
 *
 * Bagimlilik yok: IMAP satir tabanli bir protokol, node:tls yetiyor.
 * Yalnizca ihtiyacimiz olan kisim var — giris, kutu secme, arama,
 * BASLIK cekme. Mesaj GOVDESI hic indirilmiyor: rapor icin gerekmiyor
 * ve indirmemek en iyi gizlilik karari.
 *
 * DURUM NOTU: Gelistirme ortaminda Gmail hesabi ve disari cikis yok.
 * Protokol sahte bir IMAP sunucusuna karsi sinandi, canli dogrulanmadi.
 */

import tls from "node:tls";

const DEFAULT_HOST = "imap.gmail.com";
const DEFAULT_PORT = 993;

/** Tek seferde en fazla bu kadar mesaj baslik bilgisi cekilir. */
const MAX_MESSAGES = 120;

let config = { user: null, pass: null, host: DEFAULT_HOST, port: DEFAULT_PORT };

/** Testler gercek bir TLS baglantisi kuramaz; tasiyici disaridan verilebilir. */
let connectFn = null;

export function _setTransportForTests(fn) {
  connectFn = fn;
}

export function configure({ user, pass, host } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = {
    user: temiz(user),
    // Uygulama sifresi Google'da bosluklu gosteriliyor; bosluklar anlamsiz.
    pass: typeof pass === "string" && pass.trim() ? pass.replace(/\s+/g, "") : null,
    host: temiz(host) || DEFAULT_HOST,
    port: DEFAULT_PORT,
  };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.user && config.pass),
    user: config.user,
    host: config.host,
    // Sifre asla disari verilmez; yalnizca var olup olmadigi.
    passSet: Boolean(config.pass),
  };
}

/* ------------------------------------------------------------ protokol */

/** IMAP dizesi: tirnak icine alinir, tirnak ve ters bolu kacisli yazilir. */
function quote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * IMAP baglantisi. Tek seferlik: baglanir, isini yapar, kapanir.
 *
 * Zorluk su: yanitlar satir tabanli AMA icinde "{123}" ile baslayan
 * degismez bloklar (literal) olabiliyor; o blogun icindeki satir sonlari
 * protokol satiri DEGIL. Okuyucu bunu ayirt etmek zorunda.
 */
class Imap {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.tag = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(new Error(`Sunucuya baglanilamadi: ${err.message}`));

      this.socket = connectFn
        ? connectFn({ host: config.host, port: config.port })
        : tls.connect({ host: config.host, port: config.port, servername: config.host });

      this.socket.setTimeout(25_000);
      this.socket.on("timeout", () => {
        this.socket.destroy();
        reject(new Error("Sunucu zamaninda cevap vermedi."));
      });
      this.socket.once("error", onError);
      this.socket.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
      });

      const hazir = () => {
        this.socket.off("error", onError);
        this.socket.on("error", () => {});
        // Karsilama satirini bekliyoruz: "* OK ..."
        this.waitFor(/^\* (OK|PREAUTH)/m, 15_000).then(resolve, reject);
      };

      if (connectFn) this.socket.once("connect", hazir);
      else this.socket.once("secureConnect", hazir);
    });
  }

  /** Tamponda bir kalip belirene kadar bekler. */
  waitFor(pattern, timeout) {
    return new Promise((resolve, reject) => {
      const bitis = Date.now() + timeout;
      const bak = () => {
        const metin = this.buffer.toString("utf8");
        if (pattern.test(metin)) return resolve(metin);
        if (Date.now() > bitis) return reject(new Error("Sunucu zamaninda cevap vermedi."));
        setTimeout(bak, 15);
      };
      bak();
    });
  }

  /** Tamponun tamamini okunmus sayar. */

  /**
   * Komut gonderir, etiketli tamamlanma satirina kadar okur.
   * Literal bloklarin icindeki satirlar tamamlanma sanilmaz.
   */
  async send(command, { gizli = false } = {}) {
    this.tag += 1;
    const tag = `d${this.tag}`;
    this.buffer = Buffer.alloc(0);
    this.socket.write(`${tag} ${command}\r\n`);

    const yanit = await this.readUntilTagged(tag);
    const son = yanit.tagline;

    if (/^\S+\s+OK\b/i.test(son)) return yanit;

    // Sifreyi hicbir hata mesajina ya da kayda sizdirmiyoruz.
    const sebep = son.replace(/^\S+\s+(NO|BAD)\s*/i, "").trim();
    const komutAdi = gizli ? command.split(" ")[0] : command;
    throw Object.assign(new Error(sebep || `IMAP ${komutAdi} reddedildi.`), {
      imap: /^\S+\s+NO\b/i.test(son) ? "NO" : "BAD",
    });
  }

  /** Etiketli tamamlanma satirina kadar okur; literal bloklari atlar. */
  readUntilTagged(tag) {
    return new Promise((resolve, reject) => {
      const bitis = Date.now() + 30_000;

      const bak = () => {
        // Tampon METNE CEVRILMEDEN taraniyor — sebebi scan()'in basinda.
        const cozum = this.scan(this.buffer, tag);
        if (cozum) return resolve(cozum);
        if (Date.now() > bitis) {
          return reject(new Error("Sunucu yaniti tamamlanmadi."));
        }
        setTimeout(bak, 15);
      };
      bak();
    });
  }

  /**
   * Yaniti satir satir gezer. Bir satir "{n}" ile bitiyorsa sonraki n
   * BAYT veridir, satir degildir.
   *
   * DIKKAT — burada TAMPON uzerinde calisiyoruz, metin uzerinde degil:
   * IMAP'teki {n} bir BAYT sayisi. Tamponu once UTF-8 metne cevirip
   * karakter sayarsak, Turkce bir baslikta (her "ş" iki bayt) sayac
   * kayiyor; okuyucu blogun ortasindan devam edip yaniti hic
   * tamamlayamiyor ve istek zaman asimina dusuyordu.
   */
  scan(buf, tag) {
    const satirlar = [];
    const CRLF = Buffer.from("\r\n");
    let i = 0;

    while (i < buf.length) {
      const sonu = buf.indexOf(CRLF, i);
      if (sonu === -1) return null; // yarim satir, bekle
      const satir = buf.toString("utf8", i, sonu);
      i = sonu + 2;

      const literal = /\{(\d+)\}$/.exec(satir);
      if (literal) {
        const uzunluk = Number(literal[1]); // BAYT
        if (buf.length < i + uzunluk) return null; // blok tamamlanmadi
        satirlar.push({ line: satir, literal: buf.toString("utf8", i, i + uzunluk) });
        i += uzunluk;
        continue;
      }

      satirlar.push({ line: satir, literal: null });

      if (satir.startsWith(`${tag} `)) {
        return { lines: satirlar, tagline: satir };
      }
    }
    return null;
  }

  close() {
    try {
      this.socket?.write("dX LOGOUT\r\n");
      this.socket?.end();
    } catch {
      /* zaten kapali */
    }
  }
}

/* -------------------------------------------------------------- baslik */

/**
 * ISO-8859-9 (Turkce latin) ile latin1 yalnizca ALTI karakterde ayrilir.
 * Node bu kod sayfasini tanimadigi icin latin1'e dusurulurse "İş" → "Ýþ"
 * oluyordu; bu yalnizca goruntuyu bozmakla kalmiyor, konu satirindaki
 * "görüşme" kelimesini de tanimaz hale getirip mesajin yanlis siniflanmasina
 * yol aciyordu. Farkli olan alti bayti elle esliyoruz.
 */
const ISO_8859_9 = {
  0xd0: "\u011e", // Ğ
  0xf0: "\u011f", // ğ
  0xdd: "\u0130", // İ
  0xfd: "\u0131", // ı
  0xde: "\u015e", // Ş
  0xfe: "\u015f", // ş
};

function decodeBytes(buf, charset) {
  if (charset === "utf-8" || charset === "utf8") return buf.toString("utf8");
  if (charset === "iso-8859-9" || charset === "latin5" || charset === "windows-1254") {
    let out = "";
    for (const b of buf) out += ISO_8859_9[b] ?? String.fromCharCode(b);
    return out;
  }
  return buf.toString("latin1");
}

/** "=?UTF-8?B?...?=" bicimli basliklari cozer (Turkce konular boyle gelir). */
function decodeWords(value) {
  return String(value || "").replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (hepsi, sarj, tip, veri) => {
      try {
        const kod = sarj.toLowerCase();
        const bayt = tip.toUpperCase() === "B"
          ? Buffer.from(veri, "base64")
          : Buffer.from(
              // Q kodlamasi: alt cizgi bosluk, =XX onaltilik
              veri.replace(/_/g, " ")
                .replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))),
              "binary",
            );
        return decodeBytes(bayt, kod);
      } catch {
        return hepsi;
      }
    },
  );
}

/** RFC822 baslik blogunu nesneye cevirir (katlanmis satirlar birlestirilir). */
function parseHeaders(raw) {
  const out = {};
  const satirlar = String(raw || "").split(/\r?\n/);
  let ad = null;
  let deger = "";

  const yaz = () => {
    if (!ad) return;
    const anahtar = ad.toLowerCase();
    // Ayni baslik birden fazla gelebilir; ilkini tutuyoruz.
    if (!(anahtar in out)) out[anahtar] = decodeWords(deger.trim());
  };

  for (const satir of satirlar) {
    if (/^\s/.test(satir) && ad) {
      deger += " " + satir.trim();
      continue;
    }
    const ayrac = satir.indexOf(":");
    if (ayrac === -1) continue;
    yaz();
    ad = satir.slice(0, ayrac);
    deger = satir.slice(ayrac + 1);
  }
  yaz();
  return out;
}

/** "Ahmet Yilmaz <a@b.com>" → { name, email } */
function parseFrom(value) {
  const ham = String(value || "").trim();
  const acili = /<([^>]+)>/.exec(ham);
  const email = (acili ? acili[1] : ham).trim().toLowerCase();
  let name = acili ? ham.slice(0, acili.index).trim() : "";
  name = name.replace(/^["']|["']$/g, "").trim();
  return { name: name || email.split("@")[0], email };
}

/* ---------------------------------------------------------- siniflama */

/**
 * Mesaji siniflar. Yapay zeka YOK — kurallar acik ve denetlenebilir.
 *
 * En guvenilir isaret basliklarda: toplu gonderilen her posta
 * List-Unsubscribe ya da Precedence: bulk tasir. Bu, tahmin degil
 * gondericinin kendi beyani; bulten/reklam ayrimi buradan cikiyor.
 */
const REKLAM = /indirim|kampanya|firsat|fırsat|sepet|son sansi|son şans|bedava|hediye ceki|kupon|%\s?\d|sale|deal|offer|discount|black friday|sepetinizde/i;
const BULTEN = /bulten|bülten|newsletter|haftalik ozet|haftalık özet|digest|abonelik|weekly|roundup/i;
const IS_GORUSME = /gorusme|görüşme|mulakat|mülakat|interview|is basvuru|iş başvuru|basvurunuz|başvurunuz|pozisyon|ik ekibi|insan kaynaklari|insan kaynakları|ozgecmis|özgeçmiş|cv'niz|teklif mektubu|ise alim|işe alım/i;
const SPONSOR = /sponsor|isbirligi|işbirliği|is birligi|iş birliği|collaboration|collab|brand deal|barter|reklam anlasmasi|reklam anlaşması|partnership|ortaklik teklifi|ortaklık teklifi|tanitim teklifi|tanıtım teklifi/i;
const OTOMATIK = /^(no-?reply|noreply|donotreply|do-not-reply|bounce|mailer-daemon|postmaster|notifications?|info|destek|support|bilgi)@/i;

function classify(msg) {
  const konu = msg.subject || "";
  const toplu = Boolean(msg.headers["list-unsubscribe"]) ||
    /bulk|list|auto_reply/i.test(msg.headers["precedence"] || "") ||
    Boolean(msg.headers["auto-submitted"] && msg.headers["auto-submitted"] !== "no");

  // Onemli olanlar once: toplu gonderilse bile sponsor teklifi onemlidir.
  if (SPONSOR.test(konu)) return "sponsor";
  if (IS_GORUSME.test(konu)) return "is";

  if (toplu) return REKLAM.test(konu) ? "reklam" : "bulten";
  if (REKLAM.test(konu)) return "reklam";
  if (BULTEN.test(konu)) return "bulten";

  // Toplu degil, otomatik bir adresten de gelmiyorsa gercek bir insan.
  if (!OTOMATIK.test(msg.from.email)) return "kisisel";
  return "diger";
}

export const ETIKET = {
  sponsor: "Sponsor / isbirligi",
  is: "Is / gorusme",
  kisisel: "Kisisel",
  bulten: "Bulten",
  reklam: "Reklam",
  diger: "Otomatik bildirim",
};

/* ------------------------------------------------------------- islemler */

async function withConnection(work) {
  if (!config.user || !config.pass) {
    throw Object.assign(new Error("E-posta hesabi tanimli degil."), { code: "NO_MAIL" });
  }

  const imap = new Imap();
  try {
    await imap.connect();
    try {
      await imap.send(`LOGIN ${quote(config.user)} ${quote(config.pass)}`, { gizli: true });
    } catch (err) {
      // Gmail'in "giris basarisiz" mesaji kullaniciya bir sey anlatmiyor.
      throw new Error(
        err.imap === "NO"
          ? "Giris yapilamadi. Gmail'de iki adimli dogrulama acik olmali ve " +
            "buraya normal sifreniz degil UYGULAMA SIFRESI girilmeli."
          : err.message,
      );
    }
    return await work(imap);
  } finally {
    imap.close();
  }
}

/** Baglantiyi sinar: giris oluyor mu, kutuda kac mesaj var? */
export async function test() {
  return withConnection(async (imap) => {
    const yanit = await imap.send("SELECT INBOX");
    const metin = yanit.lines.map((l) => l.line).join("\n");
    const toplam = Number(/^\* (\d+) EXISTS/m.exec(metin)?.[1] ?? 0);
    return { user: config.user, total: toplam };
  });
}

/** IMAP tarih bicimi: 12-Sep-2026 */
function imapDate(d) {
  const ay = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()}-${ay[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Son `days` gundeki mesajlarin basliklarini ceker ve siniflar.
 * Govde indirilmez.
 */
export async function summary({ days = 2 } = {}) {
  return withConnection(async (imap) => {
    await imap.send("SELECT INBOX");

    const since = new Date(Date.now() - days * 86400000);
    const arama = await imap.send(`UID SEARCH SINCE ${imapDate(since)}`);
    const satir = arama.lines.map((l) => l.line).find((l) => /^\* SEARCH/i.test(l)) || "";
    const uids = satir.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter(Boolean);

    if (!uids.length) {
      return { days, total: 0, counts: {}, groups: {}, at: Date.now() };
    }

    // En yeniler sonda; sinirdan fazlasini cekmiyoruz.
    const secilen = uids.slice(-MAX_MESSAGES);
    const alanlar = "FROM SUBJECT DATE LIST-UNSUBSCRIBE PRECEDENCE AUTO-SUBMITTED";
    const getir = await imap.send(
      `UID FETCH ${secilen.join(",")} (BODY.PEEK[HEADER.FIELDS (${alanlar})])`,
    );

    const mesajlar = [];
    for (const { literal } of getir.lines) {
      if (!literal) continue;
      const headers = parseHeaders(literal);
      if (!headers.from && !headers.subject) continue;
      const msg = {
        from: parseFrom(headers.from),
        subject: (headers.subject || "(konu yok)").trim(),
        date: headers.date ? Date.parse(headers.date) || null : null,
        headers,
      };
      msg.kind = classify(msg);
      mesajlar.push(msg);
    }

    const counts = {};
    const groups = {};
    for (const m of mesajlar) {
      counts[m.kind] = (counts[m.kind] || 0) + 1;
      (groups[m.kind] ||= []).push({
        from: m.from.name,
        email: m.from.email,
        subject: m.subject,
        date: m.date,
      });
    }

    return { days, total: mesajlar.length, counts, groups, at: Date.now() };
  });
}

export const _internal = { parseHeaders, parseFrom, decodeWords, classify, quote, decodeBytes };
