/**
 * YouTube kanali — OAuth 2.0 + devam ettirilebilir yukleme.
 *
 * Gmail'de uygulama sifresi yeterliydi; YouTube'da boyle bir kisayol YOK,
 * Google yalnizca OAuth kabul ediyor. Bu yuzden tek seferlik bir kurulum
 * gerekiyor: Google Cloud'da bir "Masaustu uygulamasi" istemcisi acip
 * Istemci Kimligi ve Gizli Anahtari buraya girmek. Sonrasinda DRA
 * kendi yenileme jetonunu saklar, bir daha giris istemez.
 *
 * Yetkilendirme dongusu geri cagirmayi 127.0.0.1'de kendi actigi kisa
 * omurlu bir sunucuyla karsiliyor — kullanicinin tarayicidan kod kopyalayip
 * yapistirmasi gerekmiyor.
 *
 * Bagimlilik yok: hepsi fetch + node:http.
 *
 * DURUM NOTU: Gelistirme ortaminda Google hesabi ve disari cikis yok.
 * Modul, Google uclarini taklit eden yerel bir sunucuya karsi sinandi;
 * canli dogrulanmadi.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { basename } from "node:path";

/** Uc adresleri; testler yerel bir taklide yonlendirebilsin diye degisken. */
let ENDPOINTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  upload: "https://www.googleapis.com/upload/youtube/v3/videos",
  api: "https://www.googleapis.com/youtube/v3",
};

export function _setEndpointsForTests(next) {
  ENDPOINTS = next ? { ...ENDPOINTS, ...next } : {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    upload: "https://www.googleapis.com/upload/youtube/v3/videos",
    api: "https://www.googleapis.com/youtube/v3",
  };
}

/** Yukleme ve kanal okuma icin gereken en dar yetki kumesi. */
const SCOPE = "https://www.googleapis.com/auth/youtube.upload " +
  "https://www.googleapis.com/auth/youtube.readonly";

let config = { clientId: null, clientSecret: null, refreshToken: null };
/** Erisim jetonu kisa omurlu; bellekte tutulur, diske yazilmaz. */
let access = { token: null, expiresAt: 0 };

export function configure({ clientId, clientSecret, refreshToken } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = {
    clientId: temiz(clientId),
    clientSecret: temiz(clientSecret),
    refreshToken: temiz(refreshToken),
  };
  access = { token: null, expiresAt: 0 };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.clientId && config.clientSecret && config.refreshToken),
    configured: Boolean(config.clientId && config.clientSecret),
    // Jetonlarin kendisi disari verilmez.
    linked: Boolean(config.refreshToken),
  };
}

/**
 * Yaniti JSON'a cevirir.
 *
 * `res.ok` dogru olsa bile govde JSON olmayabilir: yakalama portali,
 * kurum vekil sunucusu ya da operator araya bir HTML sayfasi
 * koyabiliyor. Ciplak `JSON.parse` o durumda "Unexpected token <" gibi
 * kullaniciya hicbir sey anlatmayan bir hata veriyordu.
 */
function jsonCoz(metin) {
  try {
    return JSON.parse(metin);
  } catch {
    throw new Error(
      "YouTube beklenmedik bir yanit verdi (JSON degil). Internet baglantiniz " +
        "bir oturum acma sayfasina yonlendiriyor olabilir. Gelen: " +
        String(metin).replace(/\s+/g, " ").slice(0, 120),
    );
  }
}

/** Google'in hata govdesinden okunabilir bir cumle cikarir. */
function readError(status, text) {
  let detay = "";
  try {
    const data = JSON.parse(text);
    detay = data?.error?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      data?.error_description || "";
  } catch {
    detay = String(text).slice(0, 200);
  }

  if (status === 401) return "YouTube yetkisi gecersiz. Kanali yeniden baglayin.";
  if (status === 403) {
    return `YouTube bu istegi reddetti${detay ? `: ${detay}` : "."} ` +
      "(Kota dolmus ya da API etkin degil olabilir.)";
  }
  return `YouTube ${status} dondu${detay ? `: ${detay}` : "."}`;
}

/* ------------------------------------------------------- yetkilendirme */

/**
 * Tarayiciyi acacak adresi ve geri cagirmayi bekleyen sunucuyu hazirlar.
 * `waitForCode` kullanici onay verince kodu dondurur.
 */
export function startAuth() {
  if (!config.clientId || !config.clientSecret) {
    throw Object.assign(new Error("Once Istemci Kimligi ve Gizli Anahtar girin."), {
      code: "NO_CLIENT",
    });
  }

  let cozumle;
  let reddet;
  const bekleyen = new Promise((res, rej) => {
    cozumle = res;
    reddet = rej;
  });

  const sunucu = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const kod = url.searchParams.get("code");
    const hata = url.searchParams.get("error");

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>DRA</title>` +
        `<body style="font:16px system-ui;background:#04070c;color:#cfefff;` +
        `display:grid;place-items:center;height:100vh;margin:0">` +
        `<p>${kod ? "Kanal baglandi. Bu sekmeyi kapatabilirsiniz." : "Baglanti iptal edildi."}</p>`,
    );

    if (kod) cozumle(kod);
    else reddet(new Error(hata || "Yetkilendirme iptal edildi."));
    setTimeout(() => sunucu.close(), 100);
  });

  return new Promise((resolve, reject) => {
    sunucu.on("error", reject);
    // Port 0: isletim sistemi bos bir port versin.
    sunucu.listen(0, "127.0.0.1", () => {
      const port = sunucu.address().port;
      const redirect = `http://127.0.0.1:${port}`;
      const url = `${ENDPOINTS.auth}?` + new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: SCOPE,
        // Yenileme jetonu yalnizca bu ikisiyle geliyor.
        access_type: "offline",
        prompt: "consent",
      });

      // Kullanici onaylamazsa sunucu sonsuza kadar acik kalmasin.
      const zamanAsimi = setTimeout(() => {
        sunucu.close();
        reject(new Error("Yetkilendirme zaman asimina ugradi."));
      }, 5 * 60_000);

      resolve({
        url,
        redirect,
        waitForCode: () => bekleyen.finally(() => clearTimeout(zamanAsimi)),
      });
    });
  });
}

/** Onay kodunu kalici yenileme jetonuna cevirir. */
export async function exchangeCode(code, redirect) {
  const res = await fetch(ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));

  const data = jsonCoz(metin);
  if (!data.refresh_token) {
    throw new Error(
      "Google yenileme jetonu vermedi. Google Hesabi → Guvenlik → " +
        "Ucuncu taraf erisimi bolumunden DRA'nin iznini kaldirip tekrar deneyin.",
    );
  }

  config.refreshToken = data.refresh_token;
  access = {
    token: data.access_token || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
  };
  return { refreshToken: data.refresh_token };
}

/** Gecerli bir erisim jetonu dondurur; gerekiyorsa yeniler. */
async function token() {
  if (!config.refreshToken) {
    throw Object.assign(new Error("YouTube kanali bagli degil."), { code: "NO_YOUTUBE" });
  }
  if (access.token && Date.now() < access.expiresAt) return access.token;

  const res = await fetch(ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));

  const data = jsonCoz(metin);
  if (!data.access_token) throw new Error("Google erisim jetonu vermedi.");

  access = {
    token: data.access_token,
    // Suresi dolmadan biraz once yenilemek icin 60 saniye pay birakiyoruz.
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
  };
  return access.token;
}

/* -------------------------------------------------------------- kanal */

/** Kanal bilgisi ve istatistikleri. */
export async function channel() {
  const jeton = await token();
  const url = `${ENDPOINTS.api}/channels?` + new URLSearchParams({
    part: "snippet,statistics",
    mine: "true",
  });

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${jeton}` },
    signal: AbortSignal.timeout(20_000),
  });
  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));

  const data = jsonCoz(metin);
  const k = data.items?.[0];
  if (!k) throw new Error("Bu hesapta bir YouTube kanali bulunamadi.");

  return {
    id: k.id,
    title: k.snippet?.title || "—",
    subscribers: Number(k.statistics?.subscriberCount) || 0,
    views: Number(k.statistics?.viewCount) || 0,
    videos: Number(k.statistics?.videoCount) || 0,
  };
}

/* ------------------------------------------------------------ yukleme */

/**
 * Videoyu yukler (devam ettirilebilir yukleme: once oturum acilir,
 * sonra dosya gonderilir). Baslik gorseli verilmisse ayrica ayarlanir.
 */
export async function upload({
  file, title, description, tags, privacy = "private", publishAt, thumbnail, onProgress,
}) {
  const jeton = await token();

  const bilgi = await stat(file).catch(() => null);
  if (!bilgi?.isFile()) throw new Error(`Video dosyasi bulunamadi: ${file}`);

  const snippet = {
    title: String(title || basename(file)).slice(0, 100),
    description: String(description || "").slice(0, 4900),
    tags: Array.isArray(tags) ? tags.slice(0, 15) : undefined,
  };
  const govde = {
    snippet,
    status: {
      // Zamanlanmis yayinda video once "private" olmak ZORUNDA;
      // YouTube publishAt'i yalnizca oyle kabul ediyor.
      privacyStatus: publishAt ? "private" : privacy,
      ...(publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
      selfDeclaredMadeForKids: false,
    },
  };

  /* --- 1. oturum ac --- */
  const baslat = await fetch(
    `${ENDPOINTS.upload}?` + new URLSearchParams({
      uploadType: "resumable",
      part: "snippet,status",
    }),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jeton}`,
        "content-type": "application/json",
        "x-upload-content-length": String(bilgi.size),
        "x-upload-content-type": "video/*",
      },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!baslat.ok) throw new Error(readError(baslat.status, await baslat.text()));

  const oturum = baslat.headers.get("location");
  if (!oturum) throw new Error("YouTube yukleme oturumu acmadi.");

  /* --- 2. dosyayi gonder --- */
  let gonderilen = 0;
  const akis = createReadStream(file);
  akis.on("data", (parca) => {
    gonderilen += parca.length;
    onProgress?.({ sent: gonderilen, total: bilgi.size });
  });

  const yukle = await fetch(oturum, {
    method: "PUT",
    headers: {
      "content-type": "video/*",
      "content-length": String(bilgi.size),
    },
    body: akis,
    // Akis govdesi icin gerekli; Node fetch bunu istiyor.
    duplex: "half",
  });

  const yanit = await yukle.text();
  if (!yukle.ok) throw new Error(readError(yukle.status, yanit));

  const sonuc = jsonCoz(yanit);
  const videoId = sonuc.id;
  if (!videoId) throw new Error("YouTube video kimligi dondurmedi.");

  /* --- 3. baslik gorseli --- */
  let thumbUyari = null;
  if (thumbnail) {
    try {
      const gorsel = await readFile(thumbnail);
      const tRes = await fetch(
        `${ENDPOINTS.upload.replace("/videos", "/thumbnails/set")}?` +
          new URLSearchParams({ videoId }),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${jeton}`,
            "content-type": thumbnail.endsWith(".png") ? "image/png" : "image/jpeg",
          },
          body: gorsel,
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!tRes.ok) thumbUyari = readError(tRes.status, await tRes.text());
    } catch (err) {
      thumbUyari = err.message;
    }
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: snippet.title,
    privacy: govde.status.privacyStatus,
    publishAt: publishAt || null,
    bytes: bilgi.size,
    // Video yuklendi ama gorsel konamadiysa bu OLUMLU sonucu bozmamali;
    // yine de kullaniciya soylenmeli.
    thumbnailWarning: thumbUyari,
  };
}
