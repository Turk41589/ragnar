/**
 * Bulutta ses tanima: ElevenLabs "Scribe".
 *
 * Neden var: cihazdaki kucuk Vosk modeli (45 MB) Turkcede "dra"yi
 * "bira", "uyan"i "ayi" diye duyuyor. WhatsApp'in ya da telefonlarin
 * sesle yazma ozelligi cok buyuk modellerle calisiyor; o dogrulugu
 * 45 MB'lik bir modelden beklemek bosuna. Kullanicinin zaten bir
 * ElevenLabs anahtari var; ayni hesabin konusmayi metne ceviren modeli
 * bu isi ayni kalitede yapiyor.
 *
 * Gizlilik siniri: Vosk cihazda kalmaya devam ediyor ve yalnizca
 * "DRA"yi bekliyor. Ses buluta ANCAK DRA uyandiginda (ya da uyandiran
 * cumlenin kendisi) gidiyor; uyurken odadaki konusmalar gonderilmiyor.
 *
 * Anahtar diske yazilmaz; arayuz her acilista yeniden bildirir.
 * Durum sorgusu anahtarin kendisini degil, yalnizca var olup olmadigini
 * doner.
 */

const VARSAYILAN_ADRES = "https://api.elevenlabs.io/v1/speech-to-text";
const VARSAYILAN_MODEL = "scribe_v1";
const ORNEK_HIZI = 16000;

/** Tek parcada gonderilecek en uzun ses (saniye). Kesici zaten 15 sn'de keser. */
const AZAMI_SANIYE = 30;
/** Bundan kisa ses gondermeye degmez: ya tik sesi ya nefes. */
const ASGARI_SANIYE = 0.25;

let adres = VARSAYILAN_ADRES;
let ayar = { key: null, model: VARSAYILAN_MODEL };

export function configure({ key, model } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  ayar = { key: temiz(key), model: temiz(model) || VARSAYILAN_MODEL };
  return status();
}

export function status() {
  return {
    ready: Boolean(ayar.key),
    keySet: Boolean(ayar.key),
    provider: "elevenlabs",
    model: ayar.model,
  };
}

/** Yalnizca testler icin: istekleri yerel sahte sunucuya yonlendirir. */
export function _setEndpointForTests(url) {
  adres = url || VARSAYILAN_ADRES;
}

/**
 * 16 bit mono PCM'i WAV dosyasina sarar (44 baytlik RIFF basligi).
 * Sunucuya ham PCM gonderseydik ornekleme hizini tahmin etmesi gerekirdi.
 */
export function pcmToWav(pcm, hiz = ORNEK_HIZI) {
  const veri = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const baslik = Buffer.alloc(44);
  baslik.write("RIFF", 0, "ascii");
  baslik.writeUInt32LE(36 + veri.length, 4);
  baslik.write("WAVE", 8, "ascii");
  baslik.write("fmt ", 12, "ascii");
  baslik.writeUInt32LE(16, 16); // fmt parcasinin boyu
  baslik.writeUInt16LE(1, 20); // PCM
  baslik.writeUInt16LE(1, 22); // mono
  baslik.writeUInt32LE(hiz, 24);
  baslik.writeUInt32LE(hiz * 2, 28); // bayt/sn
  baslik.writeUInt16LE(2, 32); // blok boyu
  baslik.writeUInt16LE(16, 34); // bit derinligi
  baslik.write("data", 36, "ascii");
  baslik.writeUInt32LE(veri.length, 40);
  return Buffer.concat([baslik, veri]);
}

/**
 * Gelen sesi Int16Array'e cevirir. IPC'den Uint8Array/Buffer, HTTP'den
 * base64 gelir; hepsi ayni yere varsin.
 */
export function pcmOku(girdi) {
  if (girdi instanceof Int16Array) return girdi;
  let bayt;
  if (typeof girdi === "string") bayt = Buffer.from(girdi, "base64");
  else if (girdi instanceof ArrayBuffer) bayt = Buffer.from(girdi);
  else if (ArrayBuffer.isView(girdi)) bayt = Buffer.from(girdi.buffer, girdi.byteOffset, girdi.byteLength);
  else throw Object.assign(new Error("Ses verisi okunamadi."), { code: "BAD_AUDIO" });

  // Tek sayida bayt gelirse son yarim ornegi at; Int16Array hizali ister.
  const uzunluk = bayt.length - (bayt.length % 2);
  const kopya = new Uint8Array(uzunluk);
  kopya.set(bayt.subarray(0, uzunluk));
  return new Int16Array(kopya.buffer);
}

/**
 * Modelin bazen sessizlige ya da gurultuye yazdigi seyleri ayiklar:
 * "(gulusmeler)", "[muzik]" gibi etiketler komut degildir.
 */
export function metniTemizle(metin) {
  return String(metin || "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hataMesaji(kod, govde) {
  let detay = "";
  let durum = "";
  try {
    const d = JSON.parse(govde);
    durum = String(d?.detail?.status || "");
    detay = d?.detail?.message || (typeof d?.detail === "string" ? d.detail : "") || d?.message || "";
  } catch {
    detay = String(govde || "").slice(0, 200);
  }

  // Yeni ElevenLabs anahtarlari izin kapsamiyla olusturuluyor; seslendirme
  // izni olan bir anahtarin konusmayi metne cevirme izni olmayabilir.
  if (/permission/i.test(durum) || /permission/i.test(detay)) {
    return "ElevenLabs anahtarinizin \"Speech to Text\" izni kapali. " +
      "elevenlabs.io → API Keys'ten anahtarin izinlerinde bunu acin.";
  }
  if (kod === 401) return "ElevenLabs anahtari gecersiz. Ayarlardan yeniden girin.";
  if (kod === 403) return `ElevenLabs istegi reddetti${detay ? `: ${detay}` : "."}`;
  if (kod === 429) return "ElevenLabs ses tanima kotasi doldu ya da cok sik istek gitti.";
  if (kod === 422 || kod === 400) return `ElevenLabs sesi kabul etmedi${detay ? `: ${detay}` : "."}`;
  return `ElevenLabs ses tanima ${kod} dondu${detay ? `: ${detay}` : "."}`;
}

/**
 * Sesi metne cevirir.
 * Doner: { text, language, seconds }
 */
export async function transcribe(girdi, { timeout = 15000 } = {}) {
  if (!ayar.key) {
    throw Object.assign(new Error("Ses tanima icin ElevenLabs anahtari tanimli degil."), {
      code: "NO_KEY",
    });
  }

  const pcm = pcmOku(girdi);
  const saniye = pcm.length / ORNEK_HIZI;
  if (saniye < ASGARI_SANIYE) return { text: "", language: null, seconds: saniye };
  if (saniye > AZAMI_SANIYE) {
    throw Object.assign(new Error("Ses parcasi cok uzun."), { code: "TOO_LONG" });
  }

  const form = new FormData();
  form.append("model_id", ayar.model);
  form.append("language_code", "tr");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("timestamps_granularity", "none");
  form.append("file", new Blob([pcmToWav(pcm)], { type: "audio/wav" }), "ses.wav");

  let res;
  try {
    res = await fetch(adres, {
      method: "POST",
      headers: { "xi-api-key": ayar.key, accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw Object.assign(new Error(`ElevenLabs'a ulasilamadi: ${err?.message || err}`), {
      code: "NETWORK",
    });
  }

  const govde = await res.text().catch(() => "");
  if (!res.ok) {
    throw Object.assign(new Error(hataMesaji(res.status, govde)), { code: `HTTP_${res.status}` });
  }

  let veri;
  try {
    veri = JSON.parse(govde);
  } catch {
    throw new Error("ElevenLabs ses tanima beklenmedik bir yanit dondu.");
  }

  return {
    text: metniTemizle(veri?.text),
    language: veri?.language_code || null,
    seconds: Math.round(saniye * 10) / 10,
  };
}

export const LIMITS = { ORNEK_HIZI, AZAMI_SANIYE, ASGARI_SANIYE, VARSAYILAN_MODEL };
