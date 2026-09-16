/**
 * YouTube'da arayip oynatma ve muzik acma.
 *
 * ANAHTAR GEREKMIYOR: YouTube arama sayfasinin HTML'inden ilk videonun
 * kimligini cikariyoruz. Data API kullanmak bir anahtar ve kota
 * gerektirirdi; burada yalnizca herkese acik bir sayfa okunuyor.
 *
 * Arama sonucunu ACMADAN once hangi videoyu actigini soyluyoruz —
 * "en yakin video" her zaman istenen video olmayabilir.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36";

let BASE = "https://www.youtube.com";

export function _setBaseForTests(url) {
  BASE = url || "https://www.youtube.com";
}

/**
 * YouTube'da arar, ilk videoyu dondurur.
 * Sayfa yapisi degisebilir; iki ayri kalip deneniyor.
 */
export async function findVideo(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Bos arama.");

  /*
   * "sp" ZATEN yuzde-kodlu bir deger. URLSearchParams'a verilirse
   * yeniden kodluyor (%3D → %253D) ve YouTube suzgeci hic uygulamiyor.
   * Bu yuzden ayri ekleniyor.
   */
  const url = `${BASE}/results?${new URLSearchParams({ search_query: q })}` +
    "&sp=EgIQAQ%3D%3D";

  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "tr,en;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`YouTube'a ulasilamadi: ${err.message}`);
  }

  if (!res.ok) throw new Error(`YouTube ${res.status} dondu.`);
  const html = await res.text();

  // Sayfa icindeki JSON'dan ilk videoyu cikariyoruz.
  const kimlik = /"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(html)?.[1] ||
    /"videoId":"([\w-]{11})"/.exec(html)?.[1];
  if (!kimlik) {
    throw Object.assign(
      new Error(`"${q}" icin video bulunamadi.`),
      { code: "NO_RESULT" },
    );
  }

  // Basligi da cikarmaya calisiyoruz; bulunamazsa aramayi soyleriz.
  const baslikBlok = html.slice(html.indexOf(kimlik));
  const baslik =
    /"title":\{"runs":\[\{"text":"(.*?)"/.exec(baslikBlok)?.[1] ||
    /"title":\{"simpleText":"(.*?)"/.exec(baslikBlok)?.[1] ||
    null;

  const kanal = /"ownerText":\{"runs":\[\{"text":"(.*?)"/.exec(baslikBlok)?.[1] || null;

  /** JSON kacislarini cozer (& gibi). */
  const coz = (s) => {
    if (!s) return null;
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      return s;
    }
  };

  return {
    id: kimlik,
    title: coz(baslik),
    channel: coz(kanal),
    url: `https://www.youtube.com/watch?v=${kimlik}`,
    query: q,
  };
}

/** Muzik kaynaklari — isimli, serbest adres degil. */
export const MUZIK = {
  youtube: {
    label: "YouTube",
    url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  "youtube music": {
    label: "YouTube Music",
    url: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  },
  spotify: {
    label: "Spotify",
    // Spotify'in web oynaticisi; masaustu uygulamasi kuruluysa o aciliyor.
    url: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  },
  soundcloud: {
    label: "SoundCloud",
    url: (q) => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`,
  },
};

/** "spotifyden jazz ac" → { kaynak, sorgu } */
export function resolveMusicSource(name) {
  const n = String(name || "").toLocaleLowerCase("tr").trim();
  if (!n) return null;

  // EN UZUN eslesme kazanir: "youtube music" ayni zamanda "youtube"
  // iceriyor ve kisa olan once denenirse yanlis kaynak seciliyordu.
  const adaylar = Object.entries(MUZIK).sort((a, b) => b[0].length - a[0].length);
  for (const [id, kayit] of adaylar) {
    if (n.includes(id)) return { id, ...kayit };
  }
  return null;
}
