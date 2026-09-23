/**
 * Model yolu secimi — saf mantik.
 *
 * Neden ayri bir dosya: asagidaki karar bu uygulamanin en pahaliya
 * patlayan hatalarindan birini onluyor ve test edilebilir olmasi sart.
 * `speech-engine.mjs` Electron'a bagli oldugu icin duz Node ile
 * calistirilamiyor; bu dosyanin hicbir bagimliligi yok.
 *
 * GERCEK OLAY: kullanicinin Windows adi "msı" (noktasiz ı) idi ve model
 * yolu "C:\Users\msı\AppData\Roaming\DRA\ses-modeli\..." oluyordu.
 * Dosyalar yerindeydi — 56 MB, hepsi tam — ama Vosk klasoru BULAMIYOR:
 *
 *     ERROR (VoskAPI:Model()) Folder '...' does not contain model files
 *
 * Sebep: Vosk'un C arayuzu model yolunu DAR (ANSI) metin olarak aliyor.
 * "ı" harfi UTF-8'de iki bayt; Windows onu Turkce kod sayfasiyla
 * okuyunca yol bozuluyor ve klasor bulunamiyor. Kullaniciya gorunen sey
 * once sessiz bir cokme (0xC0000005), sonra "klasorde model yok" oldu —
 * ikisi de sebebi anlatmiyordu.
 */

import { join } from "node:path";

/**
 * Metinde ASCII disi karakter var mi?
 * Vosk'un okuyamadigi her sey bu kapsama giriyor.
 */
// eslint-disable-next-line no-control-regex
export const asciiDisi = (x) => /[^\x00-\x7F]/.test(String(x || ""));

/**
 * Modelin duracagi klasoru secer.
 *
 * Normalde uygulamanin kendi veri klasoru — o yol kullanici adini
 * tasir. Kullanici adinda Turkce harf varsa, adi HIC GECMEYEN ve
 * tamamen ASCII olan bir klasore geciyoruz.
 *
 * Girdiler disaridan aliniyor ki test edilebilsin.
 */
export function guvenliKok({ userData, programData, platform, alt = "ses-modeli" }) {
  const varsayilan = join(userData, alt);
  if (!asciiDisi(varsayilan)) return varsayilan;

  // Windows disinda UTF-8 yollar sorunsuz; degistirmeye gerek yok.
  if (platform !== "win32") return varsayilan;

  // "C:\ProgramData" kullanici adi tasimaz.
  if (!programData || asciiDisi(programData)) return varsayilan;
  return join(programData, "DRA", alt);
}
