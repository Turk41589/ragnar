/**
 * Montaj projesinden USLUP cikarma.
 *
 * Fikir su: kullanicinin kendi montaj projesini okuyup "bu kanal nasil
 * kesiyor" sorusunu SAYIYA cevirmek — ortalama kesim uzunlugu, basliklarin
 * sikligi, hangi gecisler, hangi cozunurluk. Sonra ayni sayilarla yeni
 * cekimleri kesmek. Yapay zeka yok: olculen sey projenin kendisi.
 *
 * NEDEN EKRANA BAKIP FARE OYNATMIYORUZ: bir montaj programini arayuzunden
 * surmek her guncellemede kirilir. Proje DOSYASI ise kararli bir bicim;
 * okumak hem saglam hem de programin acik olmasini gerektirmiyor.
 *
 * Desteklenen bicimler metin tabanli olanlar:
 *   .mlt / .kdenlive   Shotcut, Kdenlive
 *   .fcpxml            Final Cut, DaVinci Resolve, Premiere (disa aktarim)
 *   draft_content.json CapCut
 *   .prproj            Premiere (gzip'li XML) — cikarabildigi kadar
 *
 * Buradaki XML okuyucu genel amacli DEGIL: yalnizca ihtiyacimiz olan
 * etiketlerin niteliklerini tariyor. Bunu acikca soyluyorum ki kimse
 * tam bir XML cozumleyicisi sanmasin.
 */

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { basename, extname } from "node:path";

/* ---------------------------------------------------------- XML tarama */

/** Nitelik dizesini nesneye cevirir: `a="1" b='2'` → {a:"1", b:"2"} */
function attrs(text) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(text))) {
    out[m[1] ?? m[3]] = m[2] ?? m[4];
  }
  return out;
}

/** Verilen etiketin tum orneklerinin niteliklerini dondurur. */
function tags(xml, name) {
  const re = new RegExp(`<${name}(\\s[^>]*?)?\\s*/?>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(attrs(m[1] || ""));
  return out;
}

/** `<name ...>icerik</name>` bloklarinin icerigini dondurur. */
function blocks(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/* ---------------------------------------------------------- zaman cevirme */

/** MLT zamani: "00:00:02.400" ya da kare sayisi. */
function mltTime(value, fps) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const tc = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s);
  if (tc) {
    return Number(tc[1]) * 3600 + Number(tc[2]) * 60 + Number(tc[3]) +
      Number(`0.${tc[4] || 0}`);
  }
  const kare = Number(s);
  if (Number.isFinite(kare) && fps > 0) return kare / fps;
  return null;
}

/** FCPXML zamani: "72000/3000s" ya da "5s". */
function fcpTime(value) {
  const s = String(value ?? "").trim().replace(/s$/, "");
  if (!s) return null;
  const kesir = /^(-?\d+)\/(\d+)$/.exec(s);
  if (kesir) {
    const b = Number(kesir[2]);
    return b ? Number(kesir[1]) / b : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------ istatistik */

function stats(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const orta = v.length % 2
    ? v[(v.length - 1) / 2]
    : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return {
    avg: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)),
    median: Number(orta.toFixed(2)),
    min: Number(v[0].toFixed(2)),
    max: Number(v[v.length - 1].toFixed(2)),
    count: v.length,
  };
}

/* ------------------------------------------------------------ okuyucular */

/** Shotcut / Kdenlive (.mlt, .kdenlive) */
function readMlt(xml) {
  const profil = tags(xml, "profile")[0] || {};
  const num = Number(profil.frame_rate_num);
  const den = Number(profil.frame_rate_den) || 1;
  const fps = Number.isFinite(num) && num > 0 ? num / den : 25;

  // Kesimler: oynatma listesindeki girdilerin in/out farki.
  const kesimler = [];
  for (const govde of blocks(xml, "playlist")) {
    for (const e of tags(govde, "entry")) {
      const bas = mltTime(e.in, fps);
      const son = mltTime(e.out, fps);
      if (bas !== null && son !== null && son > bas) kesimler.push(son - bas);
    }
  }

  // MLT'de gecis turu nitelik degil, ic ice bir ozellik:
  //   <transition><property name="mlt_service">luma</property></transition>
  const gecisler = [];
  for (const govde of blocks(xml, "transition")) {
    const tur = /<property\s+name=["']mlt_service["']\s*>\s*([^<]+)/i.exec(govde)?.[1]?.trim();
    // "mix" ve "cairoblend" gercek bir gecis degil, kanal karistirma.
    if (tur && tur !== "mix" && tur !== "frei0r.cairoblend") gecisler.push(tur);
  }

  // Baslik/yazi ogeleri Kdenlive'da ayri birer producer olarak duruyor.
  const yazi = (xml.match(/kdenlivetitle|dynamictext|qtext|\bpango\b/gi) || []).length;

  return {
    formatLabel: "Shotcut / Kdenlive",
    fps,
    width: Number(profil.width) || null,
    height: Number(profil.height) || null,
    cuts: kesimler,
    transitions: gecisler,
    titleCount: yazi,
  };
}

/** Final Cut / DaVinci / Premiere disa aktarimi (.fcpxml) */
function readFcpxml(xml) {
  const bicim = tags(xml, "format")[0] || {};
  const kareSuresi = fcpTime(bicim.frameDuration);
  const fps = kareSuresi ? Math.round(1 / kareSuresi) : 25;

  const kesimler = [
    ...tags(xml, "asset-clip"),
    ...tags(xml, "clip"),
    ...tags(xml, "video"),
  ]
    .map((c) => fcpTime(c.duration))
    .filter((x) => x !== null);

  const gecisler = tags(xml, "transition").map((t) => t.name || "gecis");
  const yazi = tags(xml, "title").length;

  return {
    formatLabel: "Final Cut / DaVinci XML",
    fps,
    width: Number(bicim.width) || null,
    height: Number(bicim.height) || null,
    cuts: kesimler,
    transitions: gecisler,
    titleCount: yazi,
  };
}

/** CapCut taslagi (draft_content.json) */
function readCapCut(text) {
  const data = JSON.parse(text);
  const tuval = data.canvas_config || {};
  const fps = Number(data.fps) || 30;

  const kesimler = [];
  let yazi = 0;
  const gecisler = [];

  for (const iz of data.tracks || []) {
    for (const parca of iz.segments || []) {
      // CapCut sureleri mikrosaniye.
      const sure = Number(parca?.target_timerange?.duration);
      if (iz.type === "video" && Number.isFinite(sure) && sure > 0) {
        kesimler.push(sure / 1_000_000);
      }
      if (iz.type === "text") yazi += 1;
      if (parca?.transition?.name) gecisler.push(String(parca.transition.name));
    }
  }

  // Gecisler ayri bir materyal listesinde de olabiliyor.
  for (const g of data.materials?.transitions || []) {
    if (g?.name) gecisler.push(String(g.name));
  }

  return {
    formatLabel: "CapCut",
    fps,
    width: Number(tuval.width) || null,
    height: Number(tuval.height) || null,
    cuts: kesimler,
    transitions: gecisler,
    titleCount: yazi,
  };
}

/**
 * Premiere projesi (.prproj) — gzip'li XML.
 *
 * Premiere'in ic yapisi cok ayrintili ve surumler arasinda degisiyor.
 * Elimizde gercek bir ornek olmadan kesim sinirlarini "tahmin etmek"
 * yanlis sayi uretmek olur; o yuzden deniyoruz ama cikaramazsak
 * ACIKCA soyluyoruz: Premiere'den Final Cut XML olarak disa aktarmak
 * tek tikla mumkun ve o bicim guvenilir okunuyor.
 */
function readPrproj(buffer) {
  let xml;
  try {
    xml = gunzipSync(buffer).toString("utf8");
  } catch {
    xml = buffer.toString("utf8"); // bazi projeler sikistirilmamis
  }

  const fps = 25;
  const kesimler = [];

  // Premiere sureleri "tick" ile tutuyor: saniyede 254016000000 tick.
  const TICK = 254_016_000_000;
  for (const govde of blocks(xml, "VideoClipTrackItem")) {
    const bas = Number(blocks(govde, "Start")[0]);
    const son = Number(blocks(govde, "End")[0]);
    if (Number.isFinite(bas) && Number.isFinite(son) && son > bas) {
      kesimler.push((son - bas) / TICK);
    }
  }

  return {
    formatLabel: "Premiere",
    fps,
    width: null,
    height: null,
    cuts: kesimler,
    transitions: [],
    titleCount: 0,
    // Cikarim eksikse cagiran taraf kullaniciyi yonlendirsin.
    incomplete: kesimler.length === 0,
    advice:
      "Bu Premiere projesinden kesim bilgisi cikaramadim. Premiere'de " +
      "Dosya → Disa Aktar → Final Cut Pro XML secip o dosyayi verin; " +
      "o bicimi guvenilir okuyorum.",
  };
}

/* ---------------------------------------------------------------- giris */

/** Dosyadan uslup cikarir. */
export async function read(path) {
  const ad = basename(path);
  const uzanti = extname(path).toLowerCase();

  let ham;
  try {
    ham = await readFile(path);
  } catch {
    throw new Error(`Dosya okunamadi: ${ad}`);
  }

  let sonuc;
  if (uzanti === ".mlt" || uzanti === ".kdenlive") {
    sonuc = readMlt(ham.toString("utf8"));
  } else if (uzanti === ".fcpxml" || uzanti === ".xml") {
    const metin = ham.toString("utf8");
    // .xml uzantisi hem FCPXML hem MLT olabilir; icerik karar verir.
    sonuc = /<fcpxml/i.test(metin) ? readFcpxml(metin) : readMlt(metin);
  } else if (uzanti === ".json") {
    sonuc = readCapCut(ham.toString("utf8"));
  } else if (uzanti === ".prproj") {
    sonuc = readPrproj(ham);
  } else {
    throw new Error(
      `"${uzanti || ad}" bicimini tanimiyorum. Destekledigim bicimler: ` +
        ".mlt (Shotcut/Kdenlive), .fcpxml (Final Cut/DaVinci), " +
        "draft_content.json (CapCut), .prproj (Premiere).",
    );
  }

  const kesim = stats(sonuc.cuts);
  const toplam = sonuc.cuts.reduce((a, b) => a + (b > 0 ? b : 0), 0);

  // Basliklarin sikligi: kac saniyede bir yazi giriyor?
  const basliklar = sonuc.titleCount || 0;
  const basliklarSaniye = basliklar > 0 && toplam > 0
    ? Number((toplam / basliklar).toFixed(1))
    : null;

  return {
    source: { file: ad, format: uzanti.replace(".", "") || "?", label: sonuc.formatLabel },
    fps: sonuc.fps,
    width: sonuc.width,
    height: sonuc.height,
    clipCount: kesim?.count ?? 0,
    totalSeconds: Number(toplam.toFixed(1)),
    cut: kesim,
    transitions: {
      count: sonuc.transitions.length,
      // Ayni gecis onlarca kez kullanilmis olabilir; benzersizleri yeter.
      kinds: [...new Set(sonuc.transitions)].slice(0, 6),
    },
    titles: { count: basliklar, everySeconds: basliklarSaniye },
    incomplete: Boolean(sonuc.incomplete),
    advice: sonuc.advice || null,
  };
}

export const _internal = { attrs, tags, blocks, mltTime, fcpTime, stats };
