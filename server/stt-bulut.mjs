/**
 * Konusmayi yaziya ceviren saglayicilar (DRA uyandiktan sonra).
 *
 * Neden var: cihazdaki kucuk Vosk modeli (45 MB) Turkcede "dra"yi
 * "bira", "uyan"i "ayi" diye duyuyor. WhatsApp'in ya da telefonlarin
 * sesle yazma ozelligi cok buyuk modellerle calisiyor; o dogrulugu
 * 45 MB'lik bir modelden beklemek bosuna.
 *
 * Uc saglayici, tek sozlesme (16 kHz mono PCM → metin):
 *
 *   elevenlabs  ElevenLabs Scribe — seslendirmedeki anahtarla ayni.
 *   openai      OpenAI gpt-4o-transcribe — Turkcede en guclu bulut
 *               secenegi; "DRA" gibi ozel sozcukler icin ipucu alir.
 *   whisper     Whisper, BU BILGISAYARDA (whisper.cpp). Internet yok,
 *               ucret yok, ses hic disari cikmaz. Sunucuyu ana surec
 *               baslatir (electron/whisper-yerel.mjs); burada yalnizca
 *               onun yerel adresine konusuluyor.
 *
 * Gizlilik siniri her saglayicida ayni: Vosk cihazda "DRA"yi bekliyor.
 * Ses ANCAK DRA uyandiginda (ya da uyandiran cumlenin kendisi) gidiyor.
 *
 * Anahtarlar diske yazilmaz; arayuz her acilista yeniden bildirir.
 * Durum sorgusu anahtarin kendisini degil, yalnizca var olup olmadigini
 * doner.
 */

const ORNEK_HIZI = 16000;

/** Tek parcada gonderilecek en uzun ses (saniye). Kesici zaten 15 sn'de keser. */
const AZAMI_SANIYE = 30;
/** Bundan kisa ses gondermeye degmez: ya tik sesi ya nefes. */
const ASGARI_SANIYE = 0.25;

/**
 * Modele verilen ipucu. "DRA" Turkce bir sozcuk degil; ipucu olmadan
 * model onu "dıra", "tra" diye yazabiliyor. Kisa tutuluyor: uzun ipucu
 * sessizlikte modelin ipucunu tekrar etmesine yol aciyor.
 */
const IPUCU = "DRA, saat kaç? DRA, alarm kur.";

/** Her saglayicinin nasil cagrildigi. Yeni saglayici = yeni kayit. */
const SAGLAYICILAR = {
  elevenlabs: {
    ad: "ElevenLabs",
    adres: "https://api.elevenlabs.io/v1/speech-to-text",
    model: "scribe_v1",
    anahtarGerekli: true,
    zamanAsimi: 15000,
    istek(form, a) {
      form.append("model_id", a.model);
      form.append("language_code", "tr");
      form.append("tag_audio_events", "false");
      form.append("diarize", "false");
      form.append("timestamps_granularity", "none");
      return { "xi-api-key": a.key };
    },
  },
  openai: {
    ad: "OpenAI",
    adres: "https://api.openai.com/v1/audio/transcriptions",
    model: "gpt-4o-transcribe",
    anahtarGerekli: true,
    zamanAsimi: 15000,
    istek(form, a, ipucu) {
      form.append("model", a.model);
      form.append("language", "tr");
      if (ipucu) form.append("prompt", IPUCU);
      form.append("response_format", "json");
      return { authorization: `Bearer ${a.key}` };
    },
  },
  whisper: {
    ad: "Whisper (bu bilgisayarda)",
    adres: null, // ana surec sunucuyu baslatinca bildirir
    model: "large-v3-turbo",
    anahtarGerekli: false,
    // Islemcide calisirken uzun bir cumle birkac saniye surebilir.
    zamanAsimi: 45000,
    istek(form, _a, ipucu) {
      form.append("language", "tr");
      form.append("response_format", "json");
      form.append("temperature", "0");
      form.append("no_timestamps", "true");
      if (ipucu) form.append("prompt", IPUCU);
      return {};
    },
  },
};

export const SAGLAYICI_ADLARI = Object.freeze(Object.keys(SAGLAYICILAR));

let testAdresi = null;
let ayar = { provider: "elevenlabs", key: null, model: SAGLAYICILAR.elevenlabs.model, adres: null };

const saglayici = () => SAGLAYICILAR[ayar.provider];

export function configure({ provider = "elevenlabs", key, model, adres } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const s = SAGLAYICILAR[provider];
  if (!s) {
    throw Object.assign(new Error(`Bilinmeyen ses tanima saglayicisi: ${provider}`), { code: "BAD_PROVIDER" });
  }
  // Yerel Whisper'a yalnizca bu bilgisayardaki bir adres verilebilir;
  // aksi halde "yerel" diye secilen ses baska bir makineye gidebilirdi.
  const yerelAdres = temiz(adres);
  if (yerelAdres && !/^http:\/\/127\.0\.0\.1:\d+\//.test(yerelAdres)) {
    throw Object.assign(new Error("Whisper sunucusu yalnizca bu bilgisayarda olabilir."), { code: "BAD_ADDRESS" });
  }
  ayar = {
    provider,
    key: s.anahtarGerekli ? temiz(key) : null,
    model: temiz(model) || s.model,
    adres: s.anahtarGerekli ? null : yerelAdres,
  };
  return status();
}

export function status() {
  const s = saglayici();
  return {
    ready: s.anahtarGerekli ? Boolean(ayar.key) : Boolean(ayar.adres),
    keySet: Boolean(ayar.key),
    provider: ayar.provider,
    name: s.ad,
    model: ayar.model,
  };
}

/** Yalnizca testler icin: istekleri yerel sahte sunucuya yonlendirir. */
export function _setEndpointForTests(url) {
  testAdresi = url || null;
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
 * Whisper sessizlige ya da gurultuye bazen egitim verisinden kalma
 * cumleler yaziyor ("Altyazi M.K.", "Izlediginiz icin tesekkurler").
 * Bunlar komut degil; tamamen bunlardan olusan yazi bos sayiliyor.
 */
const HAYALET = [
  /^altyazi\b/,
  /^(izlediginiz|dinlediginiz) icin tesekkur(ler| ederim| ederiz)?$/,
  /^abone olmayi unutmayin$/,
  /^tesekkurler$/,
];

/** Karsilastirma icin sade bicim: kucuk harf, Turkce harfler ASCII, noktalama yok. */
const sadele = (x) =>
  x
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Modelin bazen sessizlige ya da gurultuye yazdigi seyleri ayiklar:
 * "(gulusmeler)", "[muzik]" gibi etiketler, bilinen hayalet cumleler ve
 * ipucunun TAMAMININ tekrari komut degildir. ("DRA, saat kac?" gibi
 * ipucunun bir parcasi elbette gercek bir komut olabilir.)
 */
export function metniTemizle(metin) {
  const t = String(metin || "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  const sade = sadele(t);
  if (!sade) return "";
  if (HAYALET.some((r) => r.test(sade))) return "";
  if (sade === sadele(IPUCU)) return "";
  return t;
}

function hataMesaji(s, kod, govde) {
  let detay = "";
  let durum = "";
  try {
    const d = JSON.parse(govde);
    durum = String(d?.detail?.status || d?.error?.code || d?.error?.type || "");
    detay =
      d?.detail?.message ||
      (typeof d?.detail === "string" ? d.detail : "") ||
      d?.error?.message ||
      (typeof d?.error === "string" ? d.error : "") ||
      d?.message ||
      "";
  } catch {
    detay = String(govde || "").slice(0, 200);
  }

  // Yeni ElevenLabs anahtarlari izin kapsamiyla olusturuluyor; seslendirme
  // izni olan bir anahtarin konusmayi metne cevirme izni olmayabilir.
  if (s.ad === "ElevenLabs" && (/permission/i.test(durum) || /permission/i.test(detay))) {
    return "ElevenLabs anahtarinizin \"Speech to Text\" izni kapali. " +
      "elevenlabs.io → API Keys'ten anahtarin izinlerinde bunu acin.";
  }
  if (/insufficient_quota/.test(durum)) {
    return `${s.ad} hesabinizda bakiye/kota kalmamis.`;
  }
  if (kod === 401) return `${s.ad} anahtari gecersiz. Ayarlardan yeniden girin.`;
  if (kod === 403) return `${s.ad} istegi reddetti${detay ? `: ${detay}` : "."}`;
  if (kod === 429) return `${s.ad} kotasi doldu ya da cok sik istek gitti.`;
  if (kod === 422 || kod === 400) return `${s.ad} sesi kabul etmedi${detay ? `: ${detay}` : "."}`;
  return `${s.ad} ${kod} dondu${detay ? `: ${detay}` : "."}`;
}

/**
 * Sesi metne cevirir.
 * Doner: { text, language, seconds, provider }
 */
/**
 * ipucu: false → "DRA" ipucu verilmez. Uyurken kullaniliyor: model
 * gurultude ipucunu tekrar yazabiliyor, bu da DRA'yi kendiliginden
 * uyandirirdi.
 */
export async function transcribe(girdi, { timeout, ipucu = true } = {}) {
  const s = saglayici();
  if (s.anahtarGerekli && !ayar.key) {
    throw Object.assign(new Error(`Ses tanima icin ${s.ad} anahtari tanimli degil.`), {
      code: "NO_KEY",
    });
  }
  if (!s.anahtarGerekli && !ayar.adres) {
    throw Object.assign(new Error("Whisper henuz baslamadi."), { code: "NOT_READY" });
  }

  const pcm = pcmOku(girdi);
  const saniye = pcm.length / ORNEK_HIZI;
  const sonuc = (text, language = null) => ({
    text,
    language,
    seconds: Math.round(saniye * 10) / 10,
    provider: ayar.provider,
  });
  if (saniye < ASGARI_SANIYE) return sonuc("");
  if (saniye > AZAMI_SANIYE) {
    throw Object.assign(new Error("Ses parcasi cok uzun."), { code: "TOO_LONG" });
  }

  const form = new FormData();
  const basliklar = s.istek(form, ayar, ipucu);
  form.append("file", new Blob([pcmToWav(pcm)], { type: "audio/wav" }), "ses.wav");

  let res;
  try {
    res = await fetch(testAdresi || ayar.adres || s.adres, {
      method: "POST",
      headers: { ...basliklar, accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(timeout || s.zamanAsimi),
    });
  } catch (err) {
    throw Object.assign(new Error(`${s.ad}'a ulasilamadi: ${err?.message || err}`), {
      code: "NETWORK",
    });
  }

  const govde = await res.text().catch(() => "");
  if (!res.ok) {
    throw Object.assign(new Error(hataMesaji(s, res.status, govde)), { code: `HTTP_${res.status}` });
  }

  let veri;
  try {
    veri = JSON.parse(govde);
  } catch {
    throw new Error(`${s.ad} beklenmedik bir yanit dondu.`);
  }
  // whisper.cpp hatayi 200 ile {"error": "..."} olarak da donebiliyor.
  if (veri?.error && veri?.text === undefined) {
    throw new Error(`${s.ad} hata verdi: ${String(veri.error).slice(0, 200)}`);
  }

  return sonuc(metniTemizle(veri?.text), veri?.language_code || veri?.language || null);
}

export const LIMITS = { ORNEK_HIZI, AZAMI_SANIYE, ASGARI_SANIYE, VARSAYILAN_MODEL: SAGLAYICILAR.elevenlabs.model, IPUCU };
