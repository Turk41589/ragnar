/**
 * Piper — cihazda calisan ucretsiz seslendirme.
 *
 * Gercek piper indirilemedigi icin (gelistirme ortaminda ag kapali)
 * onu TAKLIT EDEN bir ikili yazip ona karsi sinaniyor. Boylece
 * "dogru argumanlarla mi cagiriyor", "metni standart girdiden mi
 * veriyor", "WAV'i okuyabiliyor mu", "eksik ayar dosyasini yakaliyor
 * mu" sorularinin hepsi gercek bir surec calistirilarak cevaplaniyor.
 */

import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "Piper seslendirme";
export const standalone = true;

/** Gecerli bir WAV uretir (44 baytlik baslik + sessizlik). */
function wavBytes(samples = 400) {
  const veri = Buffer.alloc(samples * 2);
  const bas = Buffer.alloc(44);
  bas.write("RIFF", 0);
  bas.writeUInt32LE(36 + veri.length, 4);
  bas.write("WAVE", 8);
  bas.write("fmt ", 12);
  bas.writeUInt32LE(16, 16);
  bas.writeUInt16LE(1, 20);
  bas.writeUInt16LE(1, 22);
  bas.writeUInt32LE(22050, 24);
  bas.writeUInt32LE(44100, 28);
  bas.writeUInt16LE(2, 32);
  bas.writeUInt16LE(16, 34);
  bas.write("data", 36);
  bas.writeUInt32LE(veri.length, 40);
  return Buffer.concat([bas, veri]);
}

export async function run(_page, _base, t) {
  const piper = await import("../../server/piper.mjs");
  const kok = await mkdtemp(join(tmpdir(), "dra-piper-test-"));

  const modelYol = join(kok, "tr_TR-deneme-medium.onnx");
  const ayarYol = `${modelYol}.json`;
  const cagriKaydi = join(kok, "cagri.txt");
  const wavYol = join(kok, "ornek.wav");

  await writeFile(modelYol, "sahte model");
  await writeFile(wavYol, wavBytes());

  /**
   * Piper taklidi: aldigi argumanlari ve standart girdiyi kaydeder,
   * sonra --output_file ile verilen yere gecerli bir WAV yazar.
   */
  const binYol = join(kok, "sahte-piper.sh");
  await writeFile(binYol, `#!/bin/sh
girdi=$(cat)
printf '%s\\n' "ARGS: $*" > "${cagriKaydi}"
printf '%s\\n' "STDIN: $girdi" >> "${cagriKaydi}"
cikti=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--output_file" ]; then cikti="$2"; fi
  shift
done
if [ -n "$cikti" ]; then cp "${wavYol}" "$cikti"; fi
exit 0
`);
  await chmod(binYol, 0o755);

  /* ------------------------------------------- yapilandirmasiz ------ */
  piper.configure({});
  t.eq(piper.status().ready, false, "yapilandirmasiz hazir degil");

  let hata = null;
  try {
    await piper.speak("merhaba");
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NO_PIPER", "yapilandirmasiz seslendirme yapilmiyor");

  /* ------------------------------------------- eksik ayar dosyasi --- */
  // Kullanicilar cogu zaman yalnizca .onnx dosyasini indiriyor; piper
  // .onnx.json olmadan calismiyor. Bunu SIMDI soylemek gerek.
  piper.configure({ bin: binYol, voice: modelYol });
  hata = null;
  try {
    await piper.test();
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "ayar dosyasi eksik", "eksik .onnx.json yakalaniyor");
  t.has(hata?.message || "", "iki dosyadan", "ne yapilacagi anlatiliyor");

  /* ------------------------------------------- calisan kurulum ------ */
  await writeFile(ayarYol, JSON.stringify({ audio: { sample_rate: 22050 } }));

  const durum = piper.configure({ bin: binYol, voice: modelYol });
  t.eq(durum.ready, true, "ikili ve modelle hazir");

  const sinama = await piper.test();
  t.eq(sinama.ok, true, "baglanti sinamasi geciyor");
  t.ok(sinama.bytes > 44, "sinama gercek ses uretiyor");
  t.has(sinama.voice, "deneme", "hangi sesin kullanildigi bildiriliyor");

  /* ------------------------------------------- cagri bicimi --------- */
  const sonuc = await piper.speak("  Merhaba   efendim, ben DRA.  ");
  t.eq(sonuc.type, "audio/wav", "WAV donuyor");
  t.ok(sonuc.audio.length > 44, "ses baytlari geliyor");
  t.eq(sonuc.audio.subarray(0, 4).toString("latin1"), "RIFF", "gecerli WAV basligi");
  t.eq(sonuc.truncated, false, "kisa metin kesilmiyor");

  const kayit = await readFile(cagriKaydi, "utf8");
  t.has(kayit, "--model", "model argumani veriliyor");
  t.has(kayit, modelYol, "dogru model yolu gonderiliyor");
  t.has(kayit, "--output_file", "cikti dosyasi belirtiliyor");
  // Metin komut satirina degil STANDART GIRDIYE yaziliyor: uzun ve
  // ozel karakterli metinler komut satirinda sorun cikarir.
  t.has(kayit, "STDIN: Merhaba efendim, ben DRA.", "metin standart girdiden veriliyor");
  t.ok(
    !kayit.split("\n")[0].includes("Merhaba"),
    "metin komut satirina yazilmiyor",
  );

  /* ------------------------------------------- uzun metin ----------- */
  const uzun = "a".repeat(piper.LIMITS.MAX_CHARS + 300);
  const kesik = await piper.speak(uzun);
  t.eq(kesik.truncated, true, "cok uzun metin kesildigi bildiriliyor");
  t.eq(kesik.chars, piper.LIMITS.MAX_CHARS, "metin sinirda tutuluyor");

  /* ------------------------------------------- bos metin ------------ */
  hata = null;
  try {
    await piper.speak("   ");
  } catch (err) {
    hata = err;
  }
  t.ok(hata, "bos metin reddediliyor");

  /* ------------------------------------------- olmayan ikili -------- */
  piper.configure({ bin: join(kok, "yok-boyle-bir-program"), voice: modelYol });
  hata = null;
  try {
    await piper.speak("merhaba");
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "calistirilamadi", "olmayan program anlasilir hata veriyor");
  t.has(hata?.message || "", "yok-boyle-bir-program", "hangi yolun denendigi yaziliyor");

  /* ------------------------------------------- patlayan ikili ------- */
  const kotuBin = join(kok, "patlayan.sh");
  await writeFile(kotuBin, "#!/bin/sh\ncat > /dev/null\necho 'model yuklenemedi' >&2\nexit 1\n");
  await chmod(kotuBin, 0o755);
  piper.configure({ bin: kotuBin, voice: modelYol });
  hata = null;
  try {
    await piper.speak("merhaba");
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "Piper hata verdi", "ikili hata verirse bildiriliyor");
  t.has(hata?.message || "", "model yuklenemedi", "programin kendi mesaji korunuyor");

  /* ------------------------------------------- WAV olmayan cikti ---- */
  const sahteBin = join(kok, "wav-degil.sh");
  await writeFile(sahteBin, `#!/bin/sh
cat > /dev/null
cikti=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--output_file" ]; then cikti="$2"; fi
  shift
done
printf 'bu bir ses degil' > "$cikti"
exit 0
`);
  await chmod(sahteBin, 0o755);
  piper.configure({ bin: sahteBin, voice: modelYol });
  hata = null;
  try {
    await piper.speak("merhaba");
  } catch (err) {
    hata = err;
  }
  t.has(hata?.message || "", "WAV degil", "ses olmayan cikti yakalaniyor");
}
