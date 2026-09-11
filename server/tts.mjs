/**
 * ElevenLabs seslendirmesi (varsayilan olarak KAPALI).
 *
 * DRA'nin sesi normalde isletim sisteminin kendi sentezinden gelir ve
 * hicbir yere istek gitmez. Bu modul o kuralin bilincli bir istisnasi:
 * yalnizca kullanici ayarlardan "ElevenLabs" sesini secip anahtarini
 * girerse devreye girer. O zaman DRA'nin SOYLEDIGI metin ElevenLabs
 * sunucularina gider — duydugu ses degil, yalnizca yaniti.
 *
 * Anahtar sunucuda/ana surecte durur; ses verisi arayuze cozulmus
 * olarak gelir, arayuz ElevenLabs ile hic konusmaz.
 *
 * DURUM NOTU: Gelistirme ortaminda ElevenLabs anahtari ve disari cikis
 * yok; bu modul mock'lanmis fetch ile sinandi, canli dogrulanmadi.
 * Ilk kullanimda "baglantiyi sina" ile dogrulayin.
 */

const API = "https://api.elevenlabs.io/v1";

/** Tek seferde seslendirilecek metin siniri — kotayi kazara yakmamak icin. */
const MAX_CHARS = 1200;

/** Varsayilanlar: Turkce destekli, dusuk gecikmeli model. */
const DEFAULT_MODEL = "eleven_flash_v2_5";

let config = { apiKey: null, voiceId: null, model: DEFAULT_MODEL };

/**
 * Ayarlardan gelen yapilandirmayi saklar.
 * Anahtar diske yazilmaz; surec kapaninca kaybolur.
 */
export function configure({ apiKey, voiceId, model } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = {
    apiKey: temiz(apiKey),
    voiceId: temiz(voiceId),
    model: temiz(model) || DEFAULT_MODEL,
  };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.apiKey && config.voiceId),
    // Anahtarin kendisi asla disari verilmez; yalnizca var olup olmadigi.
    keySet: Boolean(config.apiKey),
    voiceId: config.voiceId,
    model: config.model,
  };
}

/** Servisin hata govdesinden okunabilir bir mesaj cikarir. */
function readError(status, text) {
  let detay = "";
  try {
    const data = JSON.parse(text);
    detay =
      data?.detail?.message ||
      (typeof data?.detail === "string" ? data.detail : "") ||
      data?.message ||
      "";
  } catch {
    detay = text.slice(0, 200);
  }

  if (status === 401) {
    return "ElevenLabs anahtari gecersiz. Ayarlardan yeniden girin.";
  }
  if (status === 403) {
    return `ElevenLabs bu istegi reddetti${detay ? `: ${detay}` : "."}`;
  }
  if (status === 422) {
    return `ElevenLabs istegi kabul etmedi (ses ya da model hatali olabilir)${
      detay ? `: ${detay}` : "."
    }`;
  }
  if (status === 429) {
    return "ElevenLabs kotasi doldu ya da cok sik istek gitti.";
  }
  return `ElevenLabs ${status} dondu${detay ? `: ${detay}` : "."}`;
}

/** JSON dondugu varsayilan uclar icin ortak cagri. */
async function callJson(path, { timeout = 12000 } = {}) {
  if (!config.apiKey) {
    throw Object.assign(new Error("ElevenLabs anahtari tanimli degil."), {
      code: "NO_KEY",
    });
  }

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { "xi-api-key": config.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new Error(`ElevenLabs'a ulasilamadi: ${err.message}`);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(readError(res.status, text));

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("ElevenLabs beklenmedik bir yanit dondu.");
  }
}

/** Hesaptaki sesleri listeler (ayar ekranindaki secim kutusu icin). */
export async function voices() {
  const data = await callJson("/voices");
  const list = Array.isArray(data?.voices) ? data.voices : [];
  return list
    .map((v) => ({
      id: v.voice_id,
      name: v.name || v.voice_id,
      // Etiketler kullaniciya hangi sesin ne oldugunu anlatir (cinsiyet, tarz).
      labels: v.labels && typeof v.labels === "object" ? v.labels : {},
    }))
    .filter((v) => v.id);
}

/** Kullanilabilir modelleri listeler; Turkce destekleyenler one alinir. */
export async function models() {
  const data = await callJson("/models");
  const list = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
  return list
    .map((m) => {
      const diller = Array.isArray(m.languages) ? m.languages : [];
      return {
        id: m.model_id,
        name: m.name || m.model_id,
        // Turkce destegi olmayan modeller secilirse DRA anlasilmaz konusur.
        turkish: diller.some((d) => /^tr/i.test(d?.language_id || d?.name || "")),
      };
    })
    .filter((m) => m.id)
    .sort((a, b) => Number(b.turkish) - Number(a.turkish));
}

/** Kalan karakter hakkini dondurur (kota takibi icin). */
export async function quota() {
  const data = await callJson("/user/subscription");
  const used = Number(data?.character_count);
  const limit = Number(data?.character_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Baglantiyi sinar: anahtar gecerli mi, secili ses hesapta var mi?
 * Ses uretmez — kota harcamaz.
 */
export async function test() {
  const list = await voices();
  const secili = config.voiceId ? list.find((v) => v.id === config.voiceId) : null;

  if (config.voiceId && !secili) {
    throw new Error(
      "Anahtar calisiyor ama secili ses hesapta bulunamadi. Ayarlardan bir ses secin.",
    );
  }

  let kalan = null;
  try {
    kalan = await quota();
  } catch {
    /* kota okunamadiysa baglanti yine de saglam */
  }

  return {
    voiceCount: list.length,
    voice: secili ? secili.name : null,
    quota: kalan,
  };
}

/**
 * Metni seslendirir. Ham ses baytlarini dondurur (mp3).
 *
 * Uzun metin kotayi hizla yer; siniri asan metin kesilir ve kesildigi
 * cagirana bildirilir ki kullaniciya soylenebilsin.
 */
export async function speak(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Bos metin.");
  if (!config.apiKey) {
    throw Object.assign(new Error("ElevenLabs anahtari tanimli degil."), {
      code: "NO_KEY",
    });
  }
  if (!config.voiceId) {
    throw Object.assign(new Error("ElevenLabs sesi secilmedi."), { code: "NO_VOICE" });
  }

  const kesildi = clean.length > MAX_CHARS;
  const govde = kesildi ? clean.slice(0, MAX_CHARS) : clean;

  let res;
  try {
    res = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: govde, model_id: config.model }),
        // Uzun metinlerde sentez de uzun surer; yine de sonsuza kadar bekleme.
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch (err) {
    throw new Error(`ElevenLabs'a ulasilamadi: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(readError(res.status, text));
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) throw new Error("ElevenLabs bos ses dondu.");

  return { audio, type: "audio/mpeg", chars: govde.length, truncated: kesildi };
}

export const LIMITS = { MAX_CHARS, DEFAULT_MODEL };
