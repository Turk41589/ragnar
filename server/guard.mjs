/**
 * Yerel istek korumasi.
 *
 * Sunucu artik program calistirabiliyor. Bu, yeni bir riski beraberinde
 * getiriyor: tarayicinizda actiginiz herhangi bir kotu niyetli site,
 * arka planda http://localhost:4173 adresine istek atmayi deneyebilir.
 *
 * Uc katman:
 *  1. Sunucu yalnizca 127.0.0.1'e baglanir — disaridan hic erisilemez.
 *  2. Islem yapan uclar, acilista uretilen gizli bir jeton ister.
 *     Jeton yalnizca kendi sayfamizin okuyabilecegi bir uctan verilir;
 *     baska bir kokenden gelen JavaScript yaniti okuyamaz (CORS).
 *  3. Ayrica Origin ve Sec-Fetch-Site basliklari denetlenir.
 */

import { randomUUID } from "node:crypto";

/** Her acilista yenilenen oturum jetonu. */
export const SESSION_TOKEN = randomUUID();

/** Islem yapan uclarin kabul ettigi tek icerik turu. */
const REQUIRED_CONTENT_TYPE = "application/json";

/**
 * Istek bu makinedeki kendi sayfamizdan mi geliyor?
 * Sorun varsa insan okunur bir sebep dondurur, yoksa null.
 */
export function rejectReason(req, host) {
  // --- Origin: varsa kendi adresimiz olmali -------------------------
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      const url = new URL(origin);
      ok = ["127.0.0.1", "localhost"].includes(url.hostname);
    } catch {
      ok = false;
    }
    if (!ok) return "Farkli bir kokenden gelen istek reddedildi.";
  }

  // --- Tarayici bize baska bir siteden geldigini soyluyorsa ----------
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    return "Baska bir siteden gelen istek reddedildi.";
  }

  // --- Icerik turu: basit form istekleri onlensin --------------------
  const type = (req.headers["content-type"] || "").split(";")[0].trim();
  if (type !== REQUIRED_CONTENT_TYPE) {
    return "Gecersiz icerik turu.";
  }

  // --- Oturum jetonu -------------------------------------------------
  if (req.headers["x-dra-token"] !== SESSION_TOKEN) {
    return "Oturum jetonu gecersiz. Sayfayi yenileyin.";
  }

  return null;
}
