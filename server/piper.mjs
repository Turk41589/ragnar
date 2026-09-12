/**
 * Piper — ucretsiz, tamamen CIHAZDA calisan seslendirme.
 *
 * ElevenLabs'in ucretsiz ve internetsiz alternatifi. Piper acik kaynak,
 * kucuk bir ikili dosya ve ses basina bir model dosyasiyla calisiyor;
 * ses hicbir yere gitmiyor, kota yok, anahtar yok.
 *
 * Bu, projenin en basindaki "hicbir sirkete baglanmasin" kuralina da
 * geri donus: kaliteli ses icin disari cikmak SART DEGIL.
 *
 * Kurulum kullanicinin elinde ve DRA kendi basina bir sey indirmiyor:
 * ikili dosyanin ve ses modelinin yolu ayarlardan veriliyor.
 *
 * DURUM NOTU: Gelistirme ortamindan piper indirilemedi (ag kapali).
 * Cagri bicimi, argumanlar ve WAV okuma, piper'i taklit eden sahte bir
 * ikiliye karsi sinandi; gercek piper ile canli dogrulanmadi.
 */

import { execFile } from "node:child_process";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Tek seferde seslendirilecek en uzun metin. */
const MAX_CHARS = 2000;

let config = { bin: null, voice: null };

export function configure({ bin, voice } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = { bin: temiz(bin), voice: temiz(voice) };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.bin && config.voice),
    bin: config.bin,
    voice: config.voice,
  };
}

/**
 * Kurulumu dogrular: ikili calisiyor mu, ses modeli ve YANINDAKI
 * ayar dosyasi yerinde mi?
 *
 * Ayar dosyasi (.onnx.json) ayrica denetleniyor cunku piper onsuz
 * calismiyor ve kullanicilar cogu zaman yalnizca .onnx dosyasini
 * indiriyor — hatayi simdi soylemek, ilk konusma denemesinde
 * anlasilmaz bir cokme gormekten iyi.
 */
export async function test() {
  if (!config.bin) throw Object.assign(new Error("Piper programi secilmedi."), { code: "NO_PIPER" });
  if (!config.voice) throw Object.assign(new Error("Ses modeli secilmedi."), { code: "NO_VOICE" });

  const modelBilgi = await stat(config.voice).catch(() => null);
  if (!modelBilgi?.isFile()) {
    throw new Error(`Ses modeli bulunamadi: ${config.voice}`);
  }

  const ayar = `${config.voice}.json`;
  const ayarBilgi = await stat(ayar).catch(() => null);
  if (!ayarBilgi?.isFile()) {
    throw new Error(
      `Ses modelinin ayar dosyasi eksik: ${ayar}. Piper ses paketleri iki ` +
        "dosyadan olusur (.onnx ve .onnx.json); ikisini ayni klasore koyun.",
    );
  }

  // Ikilinin gercekten calistigini kucuk bir metinle dogruluyoruz.
  const deneme = await speak("Merhaba.");
  return {
    ok: true,
    bytes: deneme.audio.length,
    voice: config.voice.split(/[\\/]/).pop(),
  };
}

/**
 * Metni seslendirir; WAV baytlarini dondurur.
 *
 * Metin komut satirina DEGIL, standart girdiye yaziliyor: uzun ya da
 * ozel karakterli metinler komut satirinda sorun cikarir.
 */
export async function speak(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Bos metin.");
  if (!config.bin || !config.voice) {
    throw Object.assign(new Error("Piper yapilandirilmadi."), { code: "NO_PIPER" });
  }

  const kesildi = clean.length > MAX_CHARS;
  const govde = kesildi ? clean.slice(0, MAX_CHARS) : clean;

  const gecici = await mkdtemp(join(tmpdir(), "dra-piper-"));
  const cikti = join(gecici, "ses.wav");

  try {
    await new Promise((resolve, reject) => {
      const child = execFile(
        config.bin,
        ["--model", config.voice, "--output_file", cikti],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            const ayrinti = String(stderr || err.message || "")
              .split("\n").filter(Boolean).slice(-2).join(" ");
            // ENOENT: yol yanlis ya da dosya calistirilabilir degil.
            if (err.code === "ENOENT") {
              return reject(new Error(
                `Piper programi calistirilamadi: ${config.bin}. Yolu dogru mu, ` +
                  "dosya calistirilabilir mi?",
              ));
            }
            return reject(new Error(`Piper hata verdi: ${ayrinti || err.message}`));
          }
          resolve();
        },
      );

      child.stdin.on("error", () => { /* kapanmis boru; hata yukarida */ });
      child.stdin.end(govde, "utf8");
    });

    const audio = await readFile(cikti).catch(() => null);
    if (!audio?.length) throw new Error("Piper ses uretmedi.");

    // WAV basligi: dosyanin gercekten ses oldugunu dogruluyoruz.
    if (audio.subarray(0, 4).toString("latin1") !== "RIFF") {
      throw new Error("Piper beklenmedik bir dosya uretti (WAV degil).");
    }

    return { audio, type: "audio/wav", chars: govde.length, truncated: kesildi };
  } finally {
    await rm(gecici, { recursive: true, force: true });
  }
}

export const LIMITS = { MAX_CHARS };
