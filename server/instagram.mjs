/**
 * Instagram DM — Meta Graph API.
 *
 * NEDEN RESMI API: Instagram'i "giris yapip sayfayi kazi" yontemiyle
 * okumak hesabin kapatilmasina yol aciyor ve her arayuz degisikliginde
 * kiriliyor. Resmi yol daha zahmetli kuruluyor ama hesabi riske atmiyor.
 *
 * Kullanicidan istenen: bir Sayfa Erisim Jetonu (Page Access Token) ve
 * Instagram hesap kimligi. Ikisi de Meta'nin kendi panelinden aliniyor.
 *
 * DURUM NOTU: Gelistirme ortaminda Meta hesabi ve disari cikis yok.
 * Modul, Graph API'yi taklit eden yerel bir sunucuya karsi sinandi;
 * canli dogrulanmadi.
 */

let BASE = "https://graph.facebook.com/v21.0";

export function _setBaseForTests(url) {
  BASE = url || "https://graph.facebook.com/v21.0";
}

let config = { token: null, accountId: null };

export function configure({ token, accountId } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = { token: temiz(token), accountId: temiz(accountId) };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.token && config.accountId),
    accountId: config.accountId,
    tokenSet: Boolean(config.token),
  };
}

function readError(kod, metin) {
  let detay = "";
  try {
    const d = JSON.parse(metin);
    detay = d?.error?.message || "";
    // Meta kod 190: jeton gecersiz ya da suresi dolmus.
    if (d?.error?.code === 190) {
      return "Instagram jetonu gecersiz ya da suresi dolmus. Meta panelinden " +
        "yeni bir Sayfa Erisim Jetonu alin.";
    }
  } catch {
    detay = String(metin).slice(0, 200);
  }
  if (kod === 403) {
    return `Instagram bu istegi reddetti${detay ? `: ${detay}` : "."} ` +
      "(Hesabin Isletme/Icerik Ureticisi olmasi ve bir Facebook Sayfasina " +
      "bagli olmasi gerekiyor.)";
  }
  return `Instagram ${kod} dondu${detay ? `: ${detay}` : "."}`;
}

async function call(path, params = {}) {
  if (!config.token || !config.accountId) {
    throw Object.assign(new Error("Instagram hesabi tanimli degil."), { code: "NO_IG" });
  }

  const url = `${BASE}${path}?` + new URLSearchParams({
    ...params,
    access_token: config.token,
  });

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`Instagram'a ulasilamadi: ${err.message}`);
  }

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));

  try {
    return JSON.parse(metin);
  } catch {
    throw new Error("Instagram beklenmedik bir yanit dondu.");
  }
}

/** Baglantiyi sinar; hesap adini dondurur. Mesaj cekmez. */
export async function test() {
  const data = await call(`/${config.accountId}`, { fields: "username,name" });
  return { username: data.username || null, name: data.name || null };
}

/**
 * Gelen DM'leri ceker.
 *
 * Graph API konusmalari ve icindeki mesajlari ayri ayri veriyor;
 * tek istekte ic ice alan isteyerek tur sayisini dusuk tutuyoruz.
 * Kendi gonderdigimiz mesajlar disariya verilmez — musteri mesaji
 * istiyoruz, kendi yanitlarimizi degil.
 */
export async function fetchMessages({ limit = 25 } = {}) {
  const data = await call(`/${config.accountId}/conversations`, {
    platform: "instagram",
    fields: `messages.limit(${limit}){id,created_time,from,message}`,
    limit: String(limit),
  });

  const cikan = [];
  for (const konusma of data.data || []) {
    for (const m of konusma.messages?.data || []) {
      const metin = String(m.message || "").trim();
      if (!metin) continue;
      // Kendi hesabimizdan cikan mesajlar musteri mesaji degil.
      if (m.from?.id && String(m.from.id) === String(config.accountId)) continue;

      cikan.push({
        externalId: m.id,
        from: m.from?.username || m.from?.name || "Instagram kullanicisi",
        handle: m.from?.username ? `@${m.from.username}` : null,
        text: metin,
        at: m.created_time ? Date.parse(m.created_time) || Date.now() : Date.now(),
      });
    }
  }
  return cikan;
}

/** Musteriye yanit gonderir. */
export async function send(recipientId, text) {
  if (!config.token || !config.accountId) {
    throw Object.assign(new Error("Instagram hesabi tanimli degil."), { code: "NO_IG" });
  }

  const res = await fetch(`${BASE}/${config.accountId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: String(text).slice(0, 1000) },
      access_token: config.token,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));
  return { sent: true };
}
