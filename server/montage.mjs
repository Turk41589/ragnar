/**
 * Montaj — ffmpeg ile, deterministik.
 *
 * Bir USLUP (kesim uzunlugu, cozunurluk, fps) ve bir KAYNAK KLASORU
 * aliyor; klipleri uslubun soyledigi uzunlukta kesip birlestiriyor,
 * istenirse basliga bir giris karti ve fon muzigi ekliyor.
 *
 * Burada yapay zeka YOK ve gerekmiyor: uslup sayilardan olusuyor,
 * yapilan is o sayilari uygulamak. "Hangi ani secsin" gibi bir karar
 * verilmiyor — siralama dosya adina gore, kesim uslubun dedigi yerden.
 *
 * ffmpeg bu projenin bagimliligi DEGIL: kurulu degilse montaj modu
 * kapali kalir ve DRA bunu soyler. Kendi basina bir sey indirmez.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, mkdir, writeFile, stat, rm } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DRA_DATA_DIR || join(HERE, "..", "data");

/** Kaynak olarak kabul edilen video uzantilari. */
const VIDEO = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);

/** Hazir sablonlar — kullanici kendi projesini vermek istemezse. */
export const TEMPLATES = {
  hizli: {
    label: "Hizli kesim",
    detail: "Kisa kesimler, tempolu akis. Kisa videolar ve tanitimlar icin.",
    cutSeconds: 2.2,
    titleSeconds: 2.5,
    width: 1920,
    height: 1080,
    fps: 30,
  },
  anlatim: {
    label: "Sakin anlatim",
    detail: "Uzun kesimler, sakin akis. Anlatim ve inceleme videolari icin.",
    cutSeconds: 6,
    titleSeconds: 3,
    width: 1920,
    height: 1080,
    fps: 30,
  },
  dikey: {
    label: "Dikey (Shorts)",
    detail: "9:16 dikey, cok kisa kesimler. Shorts ve Reels icin.",
    cutSeconds: 1.6,
    titleSeconds: 1.8,
    width: 1080,
    height: 1920,
    fps: 30,
  },
};

/** ffmpeg yolu: ortam degiskeni varsa o, yoksa PATH. */
function ffmpegPath() {
  return process.env.DRA_FFMPEG || "ffmpeg";
}

/**
 * Suzgec bu ffmpeg derlemesinde var mi?
 *
 * ONEMLI: "drawtext" her ffmpeg'de bulunmuyor — libfreetype olmadan
 * derlenmis surumlerde yok ve cagirmak "Filter not found" ile dusuyor.
 * Bunu pesin denetliyoruz; yoksa yazi basmadan devam ediyoruz.
 */
let filterCache = null;

export async function filterAvailable(name) {
  // `""` de gecerli bir sonuc (probe basarisiz oldu). Falsy denetimi
  // yapilirsa her cagrida ffmpeg yeniden calisiyor ve 15 saniye bekleniyordu.
  if (filterCache === null) {
    try {
      const { stdout } = await execFileAsync(ffmpegPath(), ["-hide_banner", "-filters"], {
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      filterCache = stdout;
    } catch {
      filterCache = "";
    }
  }
  return new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(filterCache);
}

/** Testlerin onbellegi sifirlamasi icin. */
export function _resetFilterCache() {
  filterCache = null;
}

/** ffmpeg kurulu mu? Surumunu de dondurur. */
export async function ffmpegStatus() {
  try {
    const { stdout } = await execFileAsync(ffmpegPath(), ["-version"], { timeout: 10_000 });
    const surum = /ffmpeg version (\S+)/.exec(stdout)?.[1] || "bilinmiyor";
    return { ready: true, version: surum, path: ffmpegPath() };
  } catch {
    return {
      ready: false,
      version: null,
      path: ffmpegPath(),
      advice:
        "Montaj icin ffmpeg gerekiyor. Windows'ta: winget install Gyan.FFmpeg " +
        "(ya da ffmpeg.org'dan indirip PATH'e ekleyin). DRA kendi basina " +
        "bir sey indirmez.",
    };
  }
}

/** Uslubu montaj planina cevirir. */
export function planFromStyle(style, { template = "hizli" } = {}) {
  const sablon = TEMPLATES[template] || TEMPLATES.hizli;
  if (!style) return { ...sablon, source: `sablon: ${sablon.label}` };

  // Ortanca, ortalamadan daha saglam: tek bir cok uzun klip usluba
  // hakim olmasin. Cok kisa/uzun degerleri makul araliga sikistiriyoruz.
  const kesim = style.cut?.median || style.cut?.avg || sablon.cutSeconds;
  return {
    label: `Projenizden ogrenildi (${style.source?.label || "?"})`,
    cutSeconds: Math.min(20, Math.max(0.8, Number(kesim.toFixed(2)))),
    titleSeconds: style.titles?.everySeconds
      ? Math.min(5, Math.max(1.2, style.titles.everySeconds / 10))
      : sablon.titleSeconds,
    width: style.width || sablon.width,
    height: style.height || sablon.height,
    fps: style.fps || sablon.fps,
    source: `proje: ${style.source?.file || "?"}`,
  };
}

/** Kaynak klasorundeki videolari dosya adina gore siralar. */
export async function listClips(dir) {
  let girdiler;
  try {
    girdiler = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(`Kaynak klasoru okunamadi: ${dir}`);
  }

  const klipler = girdiler
    .filter((e) => e.isFile() && VIDEO.has(extname(e.name).toLowerCase()))
    // Kendi urettigimiz montajlar kaynak sayilmamali; yoksa ikinci
    // calistirmada onceki cikti da klip olarak iceri giriyor.
    .filter((e) => !/^dra-montaj/i.test(e.name))
    // Siralama dosya adina gore: "01-giris.mp4", "02-orta.mp4"...
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "tr", { numeric: true }));

  if (!klipler.length) {
    throw new Error(
      `${dir} icinde video bulamadim. Kabul ettigim uzantilar: ` +
        [...VIDEO].join(", "),
    );
  }
  return klipler.map((ad) => join(dir, ad));
}

/** Bir videonun suresini saniye olarak okur. */
async function durationOf(file) {
  // ffprobe ayri bir ikili; ffmpeg ile de okunabiliyor, ek kurulum istemiyoruz.
  try {
    const { stderr } = await execFileAsync(ffmpegPath(), ["-i", file], { timeout: 20_000 })
      .catch((err) => err); // ffmpeg cikis kodu 1 verir, bilgi stderr'de
    const m = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(stderr || "");
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
  } catch {
    return null;
  }
}

/**
 * Montaji yapar.
 *
 * @param {object} o
 * @param {string} o.clipsDir   kaynak videolarin klasoru
 * @param {object} o.plan       planFromStyle cikisi
 * @param {string} [o.title]    giris kartinda yazacak metin
 * @param {string} [o.titleImage] giris karti gorseli (baslik gorseli)
 * @param {string} [o.music]    fon muzigi dosyasi
 * @param {string} o.out        cikti dosyasi
 * @param {function} [o.onProgress]
 */
export async function render({
  clipsDir, plan, title, titleImage, music, out, onProgress,
}) {
  const durum = await ffmpegStatus();
  if (!durum.ready) throw Object.assign(new Error(durum.advice), { code: "NO_FFMPEG" });

  const klipler = await listClips(clipsDir);
  const { width, height, fps, cutSeconds, titleSeconds } = plan;

  // Cikti kaynak klasorunun disinda bir alt klasore yaziliyor; o klasor
  // heniz yoksa ffmpeg dosyayi acamaz.
  await mkdir(dirname(out), { recursive: true });

  // Her montaj kendi gecici klasorunde calisir. Sabit bir klasor, ayni
  // anda baslatilan iki montajin (dugme + sesli komut) birbirinin
  // parcalarini silmesine yol aciyordu.
  const gecici = join(DATA_DIR, `montaj-gecici-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(gecici, { recursive: true });

  const parcalar = [];
  /** Kullaniciya soylenmesi gereken, isi durdurmayan durumlar. */
  const notlar = [];

  try {
    /* --- giris karti ------------------------------------------------- */
    // Baslik gorseli verildiyse ondan, verilmediyse duz zeminden bir kart.
    const kartGerekli = Boolean(titleImage) ||
      (Boolean(title) && (await filterAvailable("drawtext")));
    if (!kartGerekli && title) {
      notlar.push(
        "Giris karti atlandi: baslik gorseli verilmedi ve bu ffmpeg " +
          "surumunde yazi basma (drawtext) yok.",
      );
    }
    if (kartGerekli) {
      const kart = join(gecici, "00-kart.mp4");
      const yazi = (title || "").replace(/[:\\']/g, " ").slice(0, 120);

      const girdi = titleImage
        ? ["-loop", "1", "-t", String(titleSeconds), "-i", titleImage]
        : ["-f", "lavfi", "-t", String(titleSeconds),
           "-i", `color=c=black:s=${width}x${height}:r=${fps}`];

      // Gorsel ne olursa olsun hedef cozunurluge oturtulur: orani
      // bozmadan sigdir, kalani siyahla doldur.
      const olcek =
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

      // Yaziyi ancak drawtext varsa basabiliyoruz. Yoksa kart gorselle
      // devam eder — baslik gorselinde zaten yazi oluyor. Kart hic
      // atlanmaz, sessizce eksik de kalmaz: cagirana bildiriyoruz.
      const yaziBasilabilir = yazi ? await filterAvailable("drawtext") : false;
      if (yazi && !yaziBasilabilir) {
        notlar.push(
          "Bu ffmpeg surumunde yazi basma (drawtext) yok; giris karti " +
            "yalnizca gorselden olusturuldu. Yazi da istiyorsaniz " +
            "drawtext destekli bir ffmpeg kurun.",
        );
      }

      const suzgec = yaziBasilabilir
        ? `${olcek},drawtext=text='${yazi}':fontcolor=white:fontsize=${Math.round(height / 14)}` +
          `:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.45:boxborderw=20`
        : olcek;

      // ffmpeg'de GIRDI secenekleri girdiden once, CIKTI secenekleri tum
      // girdilerden sonra gelmek zorunda. Once iki girdi, sonra suzgecler.
      await run([
        ...girdi,
        // Sessiz ses izi: birlestirmede her parcanin ses izi olmali.
        "-f", "lavfi", "-t", String(titleSeconds), "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", suzgec,
        "-map", "0:v:0", "-map", "1:a:0",
        "-r", String(fps),
        "-t", String(titleSeconds),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-y", kart,
      ]);
      parcalar.push(kart);
      onProgress?.({ step: "kart", done: 1, total: klipler.length + 1 });
    }

    /* --- klipleri kes ------------------------------------------------ */
    for (const [i, klip] of klipler.entries()) {
      const sure = await durationOf(klip);
      // Klip uslubun istedigi kadar uzun degilse oldugu kadarini aliyoruz.
      const alinacak = sure ? Math.min(cutSeconds, sure) : cutSeconds;
      const hedef = join(gecici, `${String(i + 1).padStart(3, "0")}-kesim.mp4`);

      const kes = String(Number(alinacak.toFixed(3)));
      // Sesi olmayan klipler birlestirmeyi bozar; her parcaya ses izi
      // veriyoruz. Kaynagin kendi sesi varsa onu, yoksa sessizligi.
      const sesliMi = (await hasAudio(klip)) === true;

      await run([
        "-i", klip,
        ...(sesliMi ? [] : ["-f", "lavfi", "-t", kes, "-i", "anullsrc=r=44100:cl=stereo"]),
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`,
        "-map", "0:v:0",
        "-map", sesliMi ? "0:a:0" : "1:a:0",
        "-t", kes,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-y", hedef,
      ]);
      parcalar.push(hedef);
      onProgress?.({ step: "kesim", done: parcalar.length, total: klipler.length + 1 });
    }

    /* --- birlestir --------------------------------------------------- */
    const liste = join(gecici, "liste.txt");
    await writeFile(
      liste,
      parcalar.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );

    const birlesik = join(gecici, "birlesik.mp4");
    await run(["-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", "-y", birlesik]);

    /* --- fon muzigi -------------------------------------------------- */
    if (music) {
      await run([
        "-i", birlesik, "-i", music,
        // Muzik kisik, konusma duyulsun; video bitince muzik de biter.
        "-filter_complex",
        // normalize=0 sart: amix varsayilan olarak girdi sayisina boler,
        // yani muzik eklendiginde konusma da yariya iniyordu.
        "[1:a]volume=0.18,aloop=loop=-1:size=2e9[m];" +
          "[0:a][m]amix=inputs=2:duration=first:normalize=0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-y", out,
      ]);
    } else {
      await run(["-i", birlesik, "-c", "copy", "-y", out]);
    }

    const bilgi = await stat(out);
    const sure = await durationOf(out);

    return {
      out,
      file: basename(out),
      bytes: bilgi.size,
      seconds: sure ? Number(sure.toFixed(1)) : null,
      clips: klipler.length,
      plan,
      notes: notlar,
    };
  } finally {
    // Gecici parcalar duruyorsa disk sisirir; her durumda siliyoruz.
    await rm(gecici, { recursive: true, force: true });
  }
}

/** Kaynakta ses izi var mi? (yoksa sessiz iz ekliyoruz) */
async function hasAudio(file) {
  const bilgi = await execFileAsync(ffmpegPath(), ["-i", file], { timeout: 20_000 })
    .catch((err) => err);
  return /Stream #\d+:\d+.*: Audio:/.test(String(bilgi?.stderr || ""));
}

/** ffmpeg cagrisi; hata cikarsa son satirlarini gosterir. */
async function run(args) {
  try {
    await execFileAsync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", ...args], {
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    const ayrinti = String(err.stderr || err.message || "")
      .split("\n").filter(Boolean).slice(-3).join(" ");
    throw new Error(`Montaj adimi basarisiz: ${ayrinti || "bilinmeyen hata"}`);
  }
}
