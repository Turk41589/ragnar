/**
 * Montaj: proje dosyasindan uslup cikarma + ffmpeg ile birlestirme.
 *
 * Iki ayri sey sinaniyor:
 *  1. USLUP OKUMA — gercek bicimlerde yazilmis proje dosyalari veriliyor,
 *     cikan sayilar elle hesaplananla karsilastiriliyor. Burada tahmin
 *     yok: kesim uzunluklarini biz koyduk, ayni sayiyi bulmali.
 *  2. MONTAJ — ffmpeg varsa GERCEKTEN video uretiliyor ve cikti olculuyor
 *     (sure, cozunurluk, ses izi). ffmpeg yoksa bu bolum atlaniyor ama
 *     "kurulu degil" davranisi yine sinaniyor.
 */

import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const name = "Montaj";
export const standalone = true;

/* ------------------------------------------------------- ornek projeler */

/** Shotcut/Kdenlive projesi: kesimler 2.0, 4.0, 3.0 saniye. */
const MLT = `<?xml version="1.0"?>
<mlt version="7.0" profile="atsc_1080p_30">
  <profile width="1920" height="1080" frame_rate_num="30" frame_rate_den="1"/>
  <producer id="p0"><property name="resource">a.mp4</property></producer>
  <producer id="p1"><property name="mlt_service">kdenlivetitle</property></producer>
  <playlist id="playlist0">
    <entry producer="p0" in="00:00:00.000" out="00:00:02.000"/>
    <entry producer="p0" in="00:00:05.000" out="00:00:09.000"/>
    <entry producer="p0" in="00:00:00.000" out="00:00:03.000"/>
  </playlist>
  <transition id="t0"><property name="mlt_service">luma</property></transition>
</mlt>`;

/** Final Cut / DaVinci disa aktarimi: kesimler 3, 6, 3 saniye; 2 baslik. */
const FCPXML = `<?xml version="1.0"?>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="100/3000s" width="1080" height="1920"/>
  </resources>
  <project><sequence format="r1"><spine>
    <asset-clip ref="r2" offset="0s" duration="9000/3000s"/>
    <asset-clip ref="r3" offset="9000/3000s" duration="18000/3000s"/>
    <asset-clip ref="r4" offset="27000/3000s" duration="9000/3000s"/>
    <title ref="r5" offset="0s" duration="3000/3000s"/>
    <title ref="r6" offset="15000/3000s" duration="3000/3000s"/>
    <transition name="Cross Dissolve" duration="1500/3000s"/>
  </spine></sequence></project>
</fcpxml>`;

/** CapCut taslagi: mikrosaniye cinsinden 1.5 / 2.5 / 2.0 saniye. */
const CAPCUT = JSON.stringify({
  fps: 30,
  canvas_config: { width: 1080, height: 1920 },
  tracks: [
    {
      type: "video",
      segments: [
        { target_timerange: { start: 0, duration: 1_500_000 } },
        { target_timerange: { start: 1_500_000, duration: 2_500_000 } },
        { target_timerange: { start: 4_000_000, duration: 2_000_000 } },
      ],
    },
    { type: "text", segments: [{ target_timerange: { start: 0, duration: 900_000 } }] },
  ],
  materials: { transitions: [{ name: "Kaydir" }] },
});

export async function run(_page, _base, t) {
  const style = await import("../../server/editstyle.mjs");
  const montage = await import("../../server/montage.mjs");

  const kok = await mkdtemp(join(tmpdir(), "dra-montaj-"));

  /* ============================================== 1. USLUP OKUMA ==== */

  /* --- Shotcut / Kdenlive --- */
  const mltYol = join(kok, "proje.mlt");
  await writeFile(mltYol, MLT);
  const mlt = await style.read(mltYol);

  t.eq(mlt.source.label, "Shotcut / Kdenlive", "MLT bicimi taniniyor");
  t.eq(mlt.clipCount, 3, "MLT: kesim sayisi dogru");
  t.eq(mlt.cut.median, 3, "MLT: ortanca kesim 3 saniye");
  t.eq(mlt.cut.min, 2, "MLT: en kisa kesim 2 saniye");
  t.eq(mlt.cut.max, 4, "MLT: en uzun kesim 4 saniye");
  t.eq(mlt.totalSeconds, 9, "MLT: toplam sure 9 saniye");
  t.eq(mlt.fps, 30, "MLT: kare hizi okunuyor");
  t.eq(mlt.width, 1920, "MLT: cozunurluk okunuyor");
  t.ok(mlt.transitions.kinds.includes("luma"), "MLT: gecis turu okunuyor");
  t.ok(mlt.titles.count > 0, "MLT: baslik ogesi sayiliyor");

  /* --- Final Cut / DaVinci --- */
  const fcpYol = join(kok, "proje.fcpxml");
  await writeFile(fcpYol, FCPXML);
  const fcp = await style.read(fcpYol);

  t.eq(fcp.source.label, "Final Cut / DaVinci XML", "FCPXML bicimi taniniyor");
  t.eq(fcp.clipCount, 3, "FCPXML: kesim sayisi dogru");
  t.eq(fcp.cut.median, 3, "FCPXML: ortanca kesim 3 saniye");
  t.eq(fcp.cut.max, 6, "FCPXML: en uzun kesim 6 saniye");
  t.eq(fcp.fps, 30, "FCPXML: kare hizi kesirden hesaplaniyor");
  t.eq(fcp.height, 1920, "FCPXML: dikey cozunurluk okunuyor");
  t.eq(fcp.titles.count, 2, "FCPXML: baslik sayisi dogru");
  t.eq(fcp.transitions.count, 1, "FCPXML: gecis sayiliyor");
  t.eq(fcp.titles.everySeconds, 6, "FCPXML: kac saniyede bir baslik girdigi");

  /* --- CapCut --- */
  const ccYol = join(kok, "draft_content.json");
  await writeFile(ccYol, CAPCUT);
  const cc = await style.read(ccYol);

  t.eq(cc.source.label, "CapCut", "CapCut bicimi taniniyor");
  t.eq(cc.clipCount, 3, "CapCut: kesim sayisi dogru");
  t.eq(cc.cut.median, 2, "CapCut: ortanca kesim 2 saniye (mikrosaniye cevrildi)");
  t.eq(cc.totalSeconds, 6, "CapCut: toplam sure dogru");
  t.eq(cc.width, 1080, "CapCut: tuval genisligi okunuyor");
  t.eq(cc.titles.count, 1, "CapCut: yazi izi sayiliyor");

  /* --- taninmayan bicim --- */
  const kotuYol = join(kok, "proje.veg");
  await writeFile(kotuYol, "bu bir sey degil");
  let hata = null;
  try {
    await style.read(kotuYol);
  } catch (err) {
    hata = err;
  }
  t.ok(hata, "taninmayan bicim reddediliyor");
  t.has(hata?.message || "", "fcpxml", "hangi bicimleri destekledigi soyleniyor");

  /* --- olmayan dosya --- */
  hata = null;
  try {
    await style.read(join(kok, "yok.mlt"));
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "okunamadi", "olmayan dosya anlasilir hata veriyor");

  /* ============================================== 2. PLAN ============ */

  const planMlt = montage.planFromStyle(mlt);
  t.eq(planMlt.cutSeconds, 3, "plan kesim uzunlugunu ortancadan aliyor");
  t.eq(planMlt.width, 1920, "plan cozunurlugu projeden aliyor");
  t.has(planMlt.source, "proje.mlt", "planin nereden geldigi yaziyor");

  const planCc = montage.planFromStyle(cc);
  t.eq(planCc.height, 1920, "dikey proje dikey plan uretiyor");

  const planSablon = montage.planFromStyle(null, { template: "dikey" });
  t.eq(planSablon.height, 1920, "hazir sablon da kullanilabiliyor");
  t.eq(planSablon.cutSeconds, 1.6, "sablonun kesim uzunlugu geliyor");

  // Uc degerler makul araliga sikistirilmali: tek bir 90 saniyelik klip
  // uslubu ele gecirmesin.
  const uc = montage.planFromStyle({
    ...mlt,
    cut: { median: 90, avg: 90, min: 90, max: 90, count: 1 },
  });
  t.eq(uc.cutSeconds, 20, "asiri uzun kesim makul sinira cekiliyor");

  /* ============================================== 3. MONTAJ ========== */

  const durum = await montage.ffmpegStatus();

  if (!durum.ready) {
    // ffmpeg yoksa montaj calismamali AMA anlasilir konusmali.
    t.ok(durum.advice, "ffmpeg yoksa nasil kurulacagi soyleniyor");
    let mHata = null;
    try {
      await montage.render({ clipsDir: kok, plan: planSablon, out: join(kok, "x.mp4") });
    } catch (err) {
      mHata = err;
    }
    t.eq(mHata?.code, "NO_FFMPEG", "ffmpeg yokken montaj anlasilir sekilde duruyor");
    return;
  }

  t.ok(durum.version, "ffmpeg bulundu");

  // --- kaynak klipler uretiliyor ---
  const klipDir = join(kok, "klipler");
  await mkdir(klipDir, { recursive: true });
  const ff = durum.path;

  const uret = (args) => execFileAsync(ff, ["-hide_banner", "-loglevel", "error", ...args],
    { timeout: 120_000 });

  // Farkli cozunurluk, farkli fps, biri sesli biri sessiz — gercek hayatta
  // kaynaklar hic ayni olmuyor ve montaj bunlari ayni kaliba sokmali.
  await uret(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=25:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(klipDir, "01.mp4")]);
  await uret(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-shortest",
    "-y", join(klipDir, "02.mp4")]);
  // Uclusu plandan KISA: montaj bunu oldugu kadar almali, uzatmamali.
  await uret(["-f", "lavfi", "-i", "smptebars=size=1280x720:rate=25:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(klipDir, "03.mp4")]);

  const kapak = join(kok, "kapak.png");
  await uret(["-f", "lavfi", "-i", "color=c=navy:s=800x450", "-frames:v", "1", "-y", kapak]);

  // --- klip listesi ---
  const klipler = await montage.listClips(klipDir);
  t.eq(klipler.length, 3, "kaynak klipler bulunuyor");
  t.has(klipler[0], "01.mp4", "klipler dosya adina gore siralaniyor");

  let bosHata = null;
  try {
    await montage.listClips(kok);
  } catch (err) {
    bosHata = err;
  }
  t.has(bosHata?.message || "", "video bulamadim", "videosuz klasor anlasilir hata veriyor");

  // --- gercek montaj ---
  const plan = { ...montage.planFromStyle(null, { template: "hizli" }), cutSeconds: 2 };
  const cikti = join(kok, "montaj.mp4");
  const ilerleme = [];

  const sonuc = await montage.render({
    clipsDir: klipDir,
    plan,
    title: "Deneme",
    titleImage: kapak,
    out: cikti,
    onProgress: (p) => ilerleme.push(p),
  });

  t.ok(sonuc.bytes > 10_000, "video dosyasi uretildi");
  t.eq(sonuc.clips, 3, "uc klip kullanildi");
  t.ok(ilerleme.length >= 3, "ilerleme bildiriliyor");

  // Beklenen sure: kart 2.5 + 2 + 2 + (ucuncu klip yalnizca 1 saniye) = 7.5
  t.ok(
    Math.abs(sonuc.seconds - 7.5) < 0.6,
    `sure plana uyuyor (beklenen ~7.5, cikan ${sonuc.seconds})`,
  );

  // Cikti gercekten istenen kalipta mi?
  const bilgi = await execFileAsync(ff, ["-i", cikti], { timeout: 30_000 })
    .catch((e) => e);
  const stderr = String(bilgi.stderr || "");
  t.has(stderr, "1920x1080", "cikti hedef cozunurlukte (kaynaklar farkliydi)");
  t.has(stderr, "30 fps", "cikti hedef kare hizinda");
  t.has(stderr, "Audio:", "ciktida ses izi var (sessiz kaynaklara ragmen)");

  // drawtext olmayan derlemelerde yazi basilamaz — ama sessizce gecilmez.
  const yaziVar = await montage.filterAvailable("drawtext");
  if (!yaziVar) {
    t.ok(
      sonuc.notes.some((n) => /drawtext/.test(n)),
      "yazi basilamadiysa kullaniciya bildiriliyor",
    );
  } else {
    t.ok(true, "bu ffmpeg surumunde yazi basilabiliyor");
  }

  // Muzikli surum de calismali.
  const muzik = join(kok, "muzik.mp3");
  await uret(["-f", "lavfi", "-i", "sine=frequency=220:duration=20", "-y", muzik]);
  const muzikli = await montage.render({
    clipsDir: klipDir, plan, titleImage: kapak, music: muzik,
    out: join(kok, "muzikli.mp4"),
  });
  t.ok(muzikli.bytes > 10_000, "fon muzikli montaj da uretiliyor");
}
