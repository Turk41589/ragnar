/**
 * Kick moderasyon koprusu (varsayilan olarak KAPALI).
 *
 * "Yayinci destegi" ayari acildiginda ve bir erisim jetonu girildiginde
 * devreye girer. Jeton yalnizca sunucuda durur, tarayiciya gonderilmez.
 *
 * DURUM NOTU: Bu modul Kick'in belgelenmis API'sine gore yazildi ama
 * CANLI DOGRULANMADI — gelistirme ortaminda Kick hesabi ve jeton yok.
 * Ilk kullanimda "baglantiyi sina" ile dogrulayin; uc adresleri
 * degistiyse KICK_API tablosundan duzeltmek yeterli.
 */

const KICK_API = "https://api.kick.com/public/v1";

let config = { token: null, channel: null, broadcasterId: null };

/** Ayarlardan gelen yapilandirmayi saklar (jeton diske yazilmaz). */
export function configure({ token, channel }) {
  config = {
    token: typeof token === "string" && token.trim() ? token.trim() : null,
    channel: typeof channel === "string" && channel.trim() ? channel.trim() : null,
    broadcasterId: null,
  };
  return status();
}

export function status() {
  return {
    ready: Boolean(config.token),
    channel: config.channel,
    // Jetonun kendisi asla disari verilmez; yalnizca var olup olmadigi.
    tokenSet: Boolean(config.token),
  };
}

async function call(path, { method = "GET", body } = {}) {
  if (!config.token) {
    throw Object.assign(new Error("Kick jetonu tanimli degil."), { code: "NO_TOKEN" });
  }

  const res = await fetch(`${KICK_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }

  if (!res.ok) {
    const err = new Error(
      res.status === 401
        ? "Kick jetonu gecersiz ya da suresi dolmus."
        : res.status === 403
          ? "Bu islem icin yetkiniz yok (moderator olmalisiniz)."
          : `Kick ${res.status} dondu.`,
    );
    err.code = `HTTP_${res.status}`;
    err.detail = data;
    throw err;
  }
  return data;
}

/** Kanal kimligini bir kez cozup saklar. */
async function broadcasterId() {
  if (config.broadcasterId) return config.broadcasterId;
  const slug = config.channel;
  const data = await call(`/channels${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`);
  const id = data?.data?.[0]?.broadcaster_user_id ?? data?.data?.[0]?.id;
  if (!id) throw new Error("Kanal kimligi bulunamadi. Kanal adini kontrol edin.");
  config.broadcasterId = id;
  return id;
}

/** Baglantiyi dogrular ve kanal adini dondurur. */
export async function verify() {
  const data = await call("/users");
  const user = data?.data?.[0];
  return {
    ok: true,
    user: user?.name || user?.username || "bilinmiyor",
    channel: config.channel,
  };
}

/* ------------------------------------------------------- islemler */

/** Kullaniciyi kalici olarak yasaklar. */
export async function ban(username, reason = "") {
  const id = await broadcasterId();
  await call("/moderation/bans", {
    method: "POST",
    body: { broadcaster_user_id: id, user_id: username, reason: reason || undefined },
  });
  return `${username} yasaklandi.`;
}

/** Kullaniciyi belirli sure susturur (saniye). */
export async function timeout(username, seconds = 300, reason = "") {
  const id = await broadcasterId();
  await call("/moderation/bans", {
    method: "POST",
    body: {
      broadcaster_user_id: id,
      user_id: username,
      duration: Math.max(1, Math.round(seconds / 60)),
      reason: reason || undefined,
    },
  });
  const dk = Math.round(seconds / 60);
  return `${username} ${dk} dakika susturuldu.`;
}

/** Yasagi kaldirir. */
export async function unban(username) {
  const id = await broadcasterId();
  await call(`/moderation/bans?broadcaster_user_id=${id}&user_id=${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
  return `${username} uzerindeki yasak kaldirildi.`;
}

/** Sohbetten bir mesaji siler. */
export async function deleteMessage(messageId) {
  const id = await broadcasterId();
  await call(`/chat/messages/${encodeURIComponent(messageId)}?broadcaster_user_id=${id}`, {
    method: "DELETE",
  });
  return "Mesaj silindi.";
}

/** Sohbete mesaj gonderir. */
export async function sendMessage(text) {
  const id = await broadcasterId();
  await call("/chat", {
    method: "POST",
    body: { broadcaster_user_id: id, content: text, type: "user" },
  });
  return "Mesaj gonderildi.";
}

/** Tum eylemler tek yerden yonlendirilir. */
export const ACTIONS = { ban, timeout, unban, deleteMessage, sendMessage, verify };
