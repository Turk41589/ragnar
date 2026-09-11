/**
 * ElevenLabs seslendirmesi.
 *
 * Gercek bir ElevenLabs anahtari ve disari cikis olmadan servise
 * baglanamayiz; ama koprunun tamamini sinayabiliriz: dogru uca mi
 * gidiyor, anahtari nereye koyuyor, metni nasil gonderiyor, hatalari
 * nasil Turkceye ceviriyor, kapaliyken gercekten SESSIZ mi duruyor.
 *
 * Bunun icin `fetch` gecici olarak degistirilip her istek kaydediliyor.
 */

export const name = "Seslendirme (ElevenLabs)";
export const standalone = true;

export async function run(_page, _base, t) {
  const tts = await import("../../server/tts.mjs");

  const gercekFetch = globalThis.fetch;
  const istekler = [];

  /** ElevenLabs'i taklit eder; her cagriyi kaydeder. */
  const sahteFetch = (yanit) => async (url, opts = {}) => {
    istekler.push({
      url: String(url),
      method: opts.method || "GET",
      key: opts.headers?.["xi-api-key"] || null,
      accept: opts.headers?.accept || null,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return {
      ok: yanit.status < 400,
      status: yanit.status,
      text: async () =>
        typeof yanit.body === "string" ? yanit.body : JSON.stringify(yanit.body ?? {}),
      arrayBuffer: async () => yanit.audio ?? new ArrayBuffer(0),
    };
  };

  const sifirla = () => { istekler.length = 0; };
  /** Sahte mp3 baytlari. */
  const sesBaytlari = () => new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]).buffer;

  try {
    /* ------------------------------------------- anahtar olmadan ----- */
    tts.configure({ apiKey: "", voiceId: "" });
    t.eq(tts.status().ready, false, "anahtarsizken hazir degil");
    t.eq(tts.status().keySet, false, "anahtar yoklugu bildiriliyor");

    let hata = null;
    try {
      globalThis.fetch = sahteFetch({ status: 200, body: {} });
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_KEY", "anahtarsiz seslendirme ag'a hic cikmiyor");
    t.eq(istekler.length, 0, "anahtarsizken tek bir istek bile atilmiyor");

    // Ses secilmemisse de disari cikmamali.
    sifirla();
    tts.configure({ apiKey: "sk-gizli-123", voiceId: "" });
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_VOICE", "ses secilmeden seslendirme yapilmiyor");
    t.eq(istekler.length, 0, "ses secilmeden istek atilmiyor");

    /* ------------------------------------------------- yapilandirma -- */
    const durum = tts.configure({ apiKey: "sk-gizli-123", voiceId: "ses-42" });
    t.eq(durum.ready, true, "anahtar ve sesle hazir");
    t.eq(durum.voiceId, "ses-42", "secili ses saklaniyor");
    t.ok(!("apiKey" in durum), "anahtarin kendisi disari verilmiyor");
    t.eq(durum.model, tts.LIMITS.DEFAULT_MODEL, "model belirtilmezse varsayilan");

    /* ------------------------------------------------- seslendirme --- */
    sifirla();
    globalThis.fetch = sahteFetch({ status: 200, audio: sesBaytlari() });
    const sonuc = await tts.speak("  Saat   on iki.  ");

    t.eq(istekler.length, 1, "tek istek atiliyor");
    t.has(istekler[0].url, "/text-to-speech/ses-42", "dogru sesin ucuna gidiyor");
    t.eq(istekler[0].method, "POST", "POST ile gidiyor");
    t.eq(istekler[0].key, "sk-gizli-123", "anahtar xi-api-key basliginda");
    t.eq(istekler[0].accept, "audio/mpeg", "ses istendigi belli");
    t.eq(istekler[0].body.text, "Saat on iki.", "fazla bosluklar temizleniyor");
    t.eq(istekler[0].body.model_id, tts.LIMITS.DEFAULT_MODEL, "model gonderiliyor");
    t.ok(sonuc.audio.length > 0, "ses baytlari donuyor");
    t.eq(sonuc.type, "audio/mpeg", "icerik turu mp3");
    t.eq(sonuc.truncated, false, "kisa metin kesilmiyor");

    // Model degistirilebilmeli.
    sifirla();
    tts.configure({ apiKey: "sk-gizli-123", voiceId: "ses-42", model: "eleven_multilingual_v2" });
    await tts.speak("deneme");
    t.eq(istekler[0].body.model_id, "eleven_multilingual_v2", "secilen model gonderiliyor");

    /* -------------------------------------------- kota koruma -------- */
    // Cok uzun metin kotayi bir cirpida yer; kesiliyor ve bu bildiriliyor.
    sifirla();
    const uzun = "a".repeat(tts.LIMITS.MAX_CHARS + 500);
    const kesik = await tts.speak(uzun);
    t.eq(kesik.truncated, true, "cok uzun metin kesildigi bildiriliyor");
    t.eq(
      istekler[0].body.text.length,
      tts.LIMITS.MAX_CHARS,
      "gonderilen metin sinirda tutuluyor",
    );

    // Bos metin hic istek atmamali.
    sifirla();
    hata = null;
    try {
      await tts.speak("   ");
    } catch (err) {
      hata = err;
    }
    t.ok(hata, "bos metin reddediliyor");
    t.eq(istekler.length, 0, "bos metin icin istek atilmiyor");

    /* ------------------------------------------------------ hatalar -- */
    globalThis.fetch = sahteFetch({ status: 401, body: { detail: "invalid api key" } });
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "anahtari gecersiz", "401 anlasilir Turkce hataya cevriliyor");

    globalThis.fetch = sahteFetch({ status: 429, body: {} });
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "kota", "429 kota bitti diye anlatiliyor");

    globalThis.fetch = sahteFetch({
      status: 422,
      body: { detail: { message: "voice_not_found" } },
    });
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "voice_not_found", "422'de servisin kendi aciklamasi korunuyor");

    // Bos ses donerse bunu basari saymamaliyiz.
    globalThis.fetch = sahteFetch({ status: 200, audio: new ArrayBuffer(0) });
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "bos ses", "bos yanit hata sayiliyor");

    // Ag koparsa mesaj anlasilir olmali.
    globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "ulasilamadi", "ag hatasi anlasilir sekilde bildiriliyor");

    /* ------------------------------------------------------- sesler -- */
    sifirla();
    globalThis.fetch = sahteFetch({
      status: 200,
      body: {
        voices: [
          { voice_id: "v1", name: "Ayla", labels: { gender: "female", accent: "turkish" } },
          { voice_id: "v2", name: "Deniz", labels: {} },
          { name: "kimliksiz" },
        ],
      },
    });
    const sesler = await tts.voices();
    t.eq(sesler.length, 2, "kimliksiz kayitlar eleniyor");
    t.eq(sesler[0].name, "Ayla", "ses adi okunuyor");
    t.eq(sesler[0].labels.accent, "turkish", "etiketler korunuyor");
    t.eq(istekler[0].method, "GET", "ses listesi GET ile aliniyor");
    t.has(istekler[0].url, "/voices", "dogru uca gidiyor");

    /* ------------------------------------------------------ modeller - */
    globalThis.fetch = sahteFetch({
      status: 200,
      body: [
        { model_id: "m-ing", name: "Yalnizca Ingilizce", languages: [{ language_id: "en" }] },
        { model_id: "m-cok", name: "Cok dilli", languages: [{ language_id: "en" }, { language_id: "tr" }] },
      ],
    });
    const modeller = await tts.models();
    t.eq(modeller.length, 2, "modeller listeleniyor");
    t.eq(modeller[0].id, "m-cok", "Turkce destekleyen model basa aliniyor");
    t.eq(modeller[0].turkish, true, "Turkce destegi isaretleniyor");
    t.eq(modeller[1].turkish, false, "Turkce desteklemeyen model isaretlenmiyor");

    /* --------------------------------------------------------- sinama */
    // "Baglantiyi sina" ses uretmemeli — kota harcamamali.
    sifirla();
    tts.configure({ apiKey: "sk-gizli-123", voiceId: "v1" });
    globalThis.fetch = async (url) => {
      const u = String(url);
      istekler.push({ url: u });
      if (u.includes("/voices")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ voices: [{ voice_id: "v1", name: "Ayla" }] }),
        };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ character_count: 2000, character_limit: 10000 }),
      };
    };
    const sinama = await tts.test();
    t.eq(sinama.voice, "Ayla", "sinama secili sesi buluyor");
    t.eq(sinama.quota.remaining, 8000, "kalan kota hesaplaniyor");
    t.ok(
      !istekler.some((i) => i.url.includes("text-to-speech")),
      "sinama ses uretmiyor (kota harcamiyor)",
    );

    // Secili ses hesapta yoksa bunu acikca soylemeli.
    tts.configure({ apiKey: "sk-gizli-123", voiceId: "olmayan-ses" });
    hata = null;
    try {
      await tts.test();
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "bulunamadi", "olmayan ses sinamada yakalaniyor");

    /* ------------------------------------------------ kapatma -------- */
    // Ayar kapatilinca anahtar unutulmali ve hicbir istek cikmamali.
    sifirla();
    tts.configure({ apiKey: "", voiceId: "" });
    t.eq(tts.status().keySet, false, "kapatilinca anahtar unutuluyor");
    hata = null;
    try {
      await tts.speak("merhaba");
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_KEY", "kapatildiktan sonra seslendirme yapilmiyor");
    t.eq(istekler.length, 0, "kapatildiktan sonra ag'a cikilmiyor");
  } finally {
    globalThis.fetch = gercekFetch;
  }
}
