/**
 * Yayin zamanlayicisi.
 *
 * Dakikada bir depoya bakar; yayin saati gelmis videolari yukler.
 * Yukleme uzun surebilir, bu yuzden ayni anda yalnizca BIR yukleme
 * calisir — degilse saati ayni olan uc video es zamanli yuklenmeye
 * kalkar ve hepsi yavaslar.
 *
 * Zamanlayici yalnizca "youtube" yetkisi verilmisse is yapar. Yetki
 * yoksa sessizce bekler: arka planda izinsiz bir sey olmaz.
 */

import * as videos from "./videos.mjs";
import * as youtube from "./youtube.mjs";
import * as permissions from "./permissions.mjs";

const ARALIK_MS = 60_000;

let timer = null;
let calisiyor = false;
let dinleyici = null;

/** Olaylari disariya bildirir (arayuze yazmak icin). */
export function onEvent(fn) {
  dinleyici = fn;
  return () => { dinleyici = null; };
}

function bildir(olay) {
  try {
    dinleyici?.(olay);
  } catch {
    /* dinleyici hata verirse zamanlayici durmasin */
  }
}

/** Bir turu calistirir. Test edilebilir olsun diye disa aciliyor. */
export async function tick(now = Date.now()) {
  if (calisiyor) return { skipped: "zaten calisiyor" };

  // Yetki yoksa hicbir sey yapma — ve her dakika soru sorma.
  if (!(await permissions.granted("youtube"))) return { skipped: "izin yok" };
  if (!youtube.status().ready) return { skipped: "kanal bagli degil" };

  const sirada = await videos.due(now);
  if (!sirada.length) return { uploaded: 0 };

  calisiyor = true;
  let basarili = 0;

  try {
    for (const video of sirada) {
      await videos.update(video.id, { status: videos.DURUM.YUKLENIYOR, error: null });
      bildir({ type: "basladi", video: { id: video.id, title: video.title } });

      try {
        const sonuc = await youtube.upload({
          file: video.file,
          title: video.title,
          description: video.description,
          tags: video.tags,
          privacy: video.privacy,
          thumbnail: video.thumbnail,
          onProgress: (p) =>
            bildir({ type: "ilerleme", id: video.id, ...p }),
        });

        await videos.update(video.id, {
          status: videos.DURUM.YUKLENDI,
          videoId: sonuc.videoId,
          uploadedAt: Date.now(),
          error: null,
        });
        basarili += 1;
        bildir({ type: "bitti", video: { id: video.id, title: video.title }, sonuc });
      } catch (err) {
        // Basarisiz yukleme kaydi silmez: kullanici gorsun, elle tekrarlasin.
        await videos.update(video.id, {
          status: videos.DURUM.HATA,
          error: err.message,
        });
        bildir({ type: "hata", video: { id: video.id, title: video.title }, error: err.message });
      }
    }
  } finally {
    calisiyor = false;
  }

  return { uploaded: basarili, tried: sirada.length };
}

export function start() {
  if (timer) return;
  // unref: zamanlayici surecin kapanmasini engellemesin.
  timer = setInterval(() => {
    tick().catch((err) => console.error("[dra] zamanlayici:", err?.message || err));
  }, ARALIK_MS);
  timer.unref?.();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export const running = () => Boolean(timer);
