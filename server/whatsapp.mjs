/**
 * WhatsApp — Meta WhatsApp Business Cloud API.
 *
 * ONEMLI BIR KISIT: Cloud API'de gelen mesajlar SORULARAK alinamiyor.
 * "Son mesajlari getir" diye bir uc YOK; Meta mesajlari yalnizca
 * WEBHOOK ile, yani sizin verdiginiz bir adrese POST ederek iletiyor.
 *
 * Bunun anlami su: DRA gelen WhatsApp mesajlarini alabilmek icin
 * internetten ULASILABILIR olmali. DRA kendi tarafini hazir tutuyor
 * (asagidaki webhook alicisi), ama adresi disariya acmak kullanicinin
 * isi — sabit IP, port yonlendirme ya da bir tunel servisi.
 *
 * Bunu bastan ve acikca soyluyoruz; "calisiyor" deyip sessizce hicbir
 * mesaj getirmemek en kotusu olurdu.
 *
 * YANIT GONDERMEK icin boyle bir kisit yok: o duz bir HTTP istegi ve
 * her yerden calisiyor.
 */

let BASE = "https://graph.facebook.com/v21.0";

export function _setBaseForTests(url) {
  BASE = url || "https://graph.facebook.com/v21.0";
}

let config = { token: null, phoneNumberId: null, verifyToken: null };

/** Webhook'tan gelip henuz okunmamis mesajlar. */
let gelenKutusu = [];

export function configure({ token, phoneNumberId, verifyToken } = {}) {
  const temiz = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  config = {
    token: temiz(token),
    phoneNumberId: temiz(phoneNumberId),
    verifyToken: temiz(verifyToken),
  };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.token && config.phoneNumberId),
    phoneNumberId: config.phoneNumberId,
    tokenSet: Boolean(config.token),
    // Webhook kurulmadan gelen mesaj alinamaz; arayuz bunu gostersin.
    inbound: "webhook",
    pending: gelenKutusu.length,
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
      "WhatsApp beklenmedik bir yanit verdi (JSON degil). Internet baglantiniz " +
        "bir oturum acma sayfasina yonlendiriyor olabilir. Gelen: " +
        String(metin).replace(/\s+/g, " ").slice(0, 120),
    );
  }
}

function readError(kod, metin) {
  let detay = "";
  try {
    const d = JSON.parse(metin);
    detay = d?.error?.message || "";
    if (d?.error?.code === 190) {
      return "WhatsApp jetonu gecersiz ya da suresi dolmus. Meta panelinden " +
        "yeni bir kalici jeton alin.";
    }
  } catch {
    detay = String(metin).slice(0, 200);
  }
  return `WhatsApp ${kod} dondu${detay ? `: ${detay}` : "."}`;
}

/**
 * Meta'nin webhook dogrulama istegi (GET).
 * Meta, adresi kaydederken dogru jetonu bilip bilmedigimizi sinar.
 */
export function verifyWebhook(query) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && config.verifyToken && token === config.verifyToken) {
    return { ok: true, challenge: String(challenge ?? "") };
  }
  return { ok: false };
}

/**
 * Webhook govdesini isler ve icindeki musteri mesajlarini cikarir.
 * Meta'nin govdesi cok katmanli; yalnizca metin mesajlarini aliyoruz.
 */
export function handleWebhook(body) {
  const cikan = [];

  for (const giris of body?.entry || []) {
    for (const degisim of giris.changes || []) {
      const deger = degisim.value || {};
      // Gonderen adlarini numaraya eslemek icin.
      const adlar = new Map(
        (deger.contacts || []).map((c) => [c.wa_id, c.profile?.name]),
      );

      for (const m of deger.messages || []) {
        // Yalnizca metin; resim/ses mesajlarini simdilik atliyoruz.
        const metin = m.text?.body;
        if (!metin) continue;

        cikan.push({
          externalId: m.id,
          from: adlar.get(m.from) || m.from || "WhatsApp",
          handle: m.from ? `+${m.from}` : null,
          text: String(metin),
          // WhatsApp saniye cinsinden veriyor.
          at: m.timestamp ? Number(m.timestamp) * 1000 : Date.now(),
        });
      }
    }
  }

  gelenKutusu.push(...cikan);
  return cikan;
}

/**
 * Webhook'tan birikenleri verir ve kutuyu bosaltir.
 * "Cekme" burada ag'a cikmak degil, gelmis olani teslim almak.
 */
export async function fetchMessages() {
  const hepsi = gelenKutusu;
  gelenKutusu = [];
  return hepsi;
}

/** Baglantiyi sinar: numara kimligi gecerli mi? */
export async function test() {
  if (!config.token || !config.phoneNumberId) {
    throw Object.assign(new Error("WhatsApp hesabi tanimli degil."), { code: "NO_WA" });
  }

  const res = await fetch(
    `${BASE}/${config.phoneNumberId}?` +
      new URLSearchParams({ fields: "display_phone_number,verified_name" }),
    {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));
  const d = jsonCoz(metin);

  return {
    phone: d.display_phone_number || null,
    name: d.verified_name || null,
    // Gelen mesaj icin webhook sart; sinama gecse bile bunu hatirlat.
    inboundReady: Boolean(config.verifyToken),
  };
}

/** Musteriye yanit gonderir. */
export async function send(to, text) {
  if (!config.token || !config.phoneNumberId) {
    throw Object.assign(new Error("WhatsApp hesabi tanimli degil."), { code: "NO_WA" });
  }

  const res = await fetch(`${BASE}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to).replace(/[^\d]/g, ""),
      type: "text",
      text: { body: String(text).slice(0, 4000) },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const metin = await res.text();
  if (!res.ok) throw new Error(readError(res.status, metin));
  return { sent: true };
}

/** Testler icin. */
export function _resetForTests() {
  gelenKutusu = [];
}
