/**
 * DRA'nin yapay zeka beyni.
 *
 * Anthropic anahtari yalnizca bu surecte durur; tarayiciya hicbir zaman
 * gonderilmez. Anahtar yoksa beyin "cevrimdisi" moda duser ve DRA sadece
 * yerel komut motoruyla calisir.
 */

import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MODEL = process.env.DRA_MODEL || "claude-opus-5";

/** Sesli okunacagi icin cevaplar kisa ve konusma dilinde tutulur. */
const SYSTEM_PROMPT = `Senin adin DRA. Kullanicinin kisisel sesli asistanisin —
Iron Man'deki JARVIS gibi sakin, kendinden emin ve isini bilen bir yardimcisin.

Kurallar:
- Her zaman Turkce konus.
- Cevaplarin YUKSEK SESLE OKUNACAK. Bu yuzden kisa tut: normalde 1-3 cumle.
  Kullanici acikca detay isterse uzat.
- Markdown kullanma. Baslik, madde isareti, yildiz, kod blogu yok. Duz konusma metni yaz.
- Rakam ve kisaltmalari sesli okunacak sekilde yaz (ornegin "%20" yerine "yuzde yirmi").
- Kullaniciya "efendim" diye hitap edebilirsin ama her cumlede tekrarlama.
- Bilmedigin bir sey varsa duruzce bilmedigini soyle, uydurma.
- Gercek zamanli veriye (canli hava durumu, borsa, haber) erisimin yok.
  Boyle bir sey istenirse bunu kisaca belirt.`;

let client = null;
let clientError = null;

/**
 * Kullanilabilir bir kimlik kaynagi var mi?
 *
 * SDK yapicisi anahtar olmadan da hata vermez — dogrulamayi ilk istege
 * erteler. Bu yuzden "beyin hazir mi" sorusunu yapiciya soramayiz;
 * kimlik kaynagini kendimiz arariz.
 */
function credentialSource() {
  if (process.env.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY";
  if (process.env.ANTHROPIC_AUTH_TOKEN) return "ANTHROPIC_AUTH_TOKEN";
  // `ant auth login` ile olusturulan profil dizini
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && existsSync(join(home, ".config", "anthropic"))) return "ant profili";
  return null;
}

function getClient() {
  if (client || clientError) return client;
  try {
    // Kimlik bilgisi ortamdan cozulur: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
    // ya da `ant auth login` profili.
    client = new Anthropic();
  } catch (err) {
    clientError = err;
    client = null;
  }
  return client;
}

/** Beyin kullanilabilir mi? */
export function brainStatus() {
  const source = credentialSource();
  const ready = Boolean(source && getClient());
  return {
    ready,
    model: ready ? MODEL : null,
    source,
    reason: ready ? null : ".env dosyasinda ANTHROPIC_API_KEY tanimli degil",
  };
}

/**
 * Konusma gecmisini Anthropic mesaj dizisine cevirir.
 * Sadece son `limit` tur tasinir; sesli asistanda uzun gecmis gereksiz.
 */
function toMessages(history, prompt, limit = 12) {
  const messages = [];
  for (const turn of (history || []).slice(-limit)) {
    if (!turn || typeof turn.content !== "string") continue;
    const content = turn.content.trim();
    if (!content) continue;
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content });
    }
  }
  // Ilk mesaj her zaman kullanicidan gelmeli.
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: prompt });
  return messages;
}

/**
 * Claude'a sorar ve metin parcalarini akis halinde `onDelta` ile geri verir.
 * Tam metni dondurur.
 */
export async function askStream({ prompt, history, context }, onDelta) {
  const anthropic = credentialSource() ? getClient() : null;
  if (!anthropic) {
    throw Object.assign(new Error("Yapay zeka beyni yapilandirilmamis."), {
      code: "BRAIN_OFFLINE",
    });
  }

  const system = context
    ? `${SYSTEM_PROMPT}\n\nSu anki durum bilgisi (kullanici sormadikca dile getirme):\n${context}`
    : SYSTEM_PROMPT;

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 2000, // Cevaplar sesli okunacagi icin bilerek kisa tutuluyor.
    system,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" }, // Sesli asistanda gecikme onemli.
    messages: toMessages(history, prompt),
  });

  stream.on("text", (delta) => {
    if (delta) onDelta(delta);
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category || "belirsiz";
    return `Bu istegi yerine getiremiyorum. Guvenlik nedeniyle reddedildi (${category}).`;
  }

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** SDK hatalarini kullaniciya okunacak Turkce bir cumleye cevirir. */
export function describeError(err) {
  if (err?.code === "BRAIN_OFFLINE") {
    return "Yapay zeka beynim su anda bagli degil. Sunucuda ANTHROPIC_API_KEY tanimlanmali.";
  }
  // SDK kimligi cozemedigi zaman APIError degil, duz Error firlatir.
  if (/Could not resolve authentication/i.test(err?.message || "")) {
    return "API anahtarini bulamadim. .env dosyasina ANTHROPIC_API_KEY ekleyip sunucuyu yeniden baslatin.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "API anahtari gecersiz gorunuyor. Lutfen anahtari kontrol edin.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Istek sinirina takildim. Birazdan tekrar deneyin.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return "Istegi isleyemedim, bir sey ters gitti.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Sunucuya baglanamadim. Internet baglantisini kontrol edin.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Beynimde bir hata olustu (${err.status}).`;
  }
  return "Beklenmedik bir hata olustu.";
}
