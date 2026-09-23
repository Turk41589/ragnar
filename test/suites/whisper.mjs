/**
 * Whisper — bu bilgisayarda calisan ses tanima (whisper.cpp).
 *
 * Gercek whisper-server.exe yalnizca Windows'ta calisiyor ve modeli
 * ~580 MB. Onun yerine AYNI protokolu konusan sahte bir program
 * yaziliyor (Node betigi) ve gercek bir zip arsivine konuyor. Boylece
 * sinanan her sey gercek: indirme, arsivi acma, programi bulma, dogru
 * argumanlarla baslatma, /health beklemesi, ekran karti surumu
 * baslamazsa islemci surumune donme, sesin cok parcali formla gitmesi,
 * programin beklenmedik kapanmasi.
 */

import http from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "Whisper (bu bilgisayarda)";
export const standalone = true;

/** whisper-server'i taklit eden program. Aldigi argumanlari ve istekleri kaydeder. */
const SAHTE_SUNUCU = `#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const a = process.argv.slice(2);
const al = (k) => { const i = a.indexOf(k); return i === -1 ? null : a[i + 1]; };
const kayit = process.env.WHISPER_KAYIT;
fs.writeFileSync(kayit + ".args", JSON.stringify(a));
const model = al("-m");
if (!model || fs.readFileSync(model).subarray(0, 4).toString("latin1") !== "lmgg") {
  console.error("error: failed to load model"); process.exit(3);
}
let hazir = false;
setTimeout(() => { hazir = true; }, 600); // model yukleniyormus gibi
http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(hazir ? 200 : 503, { "content-type": "application/json" });
    return res.end(hazir ? '{"status":"ok"}' : '{"status":"loading model"}');
  }
  if (req.method === "POST" && req.url === "/inference") {
    const p = []; req.on("data", (c) => p.push(c)); req.on("end", async () => {
      const govde = Buffer.concat(p);
      const f = await new Request("http://x/", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: govde }).formData();
      const alanlar = {}; for (const [k, v] of f) alanlar[k] = typeof v === "string" ? v : "dosya:" + v.size;
      fs.appendFileSync(kayit + ".istek", JSON.stringify(alanlar) + "\\n");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: " Dra, saat kaç?\\n" }));
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(Number(al("--port")), al("--host"));
`;

/** Ekran karti surumu: CUDA yokmus gibi hemen olur. */
const BOZUK_SUNUCU = `#!/usr/bin/env node
console.error("ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected");
process.exit(1);
`;

function zipYap(dizin, zipAdi, icerik) {
  const kaynak = join(dizin, `${zipAdi}-kaynak`);
  mkdirSync(join(kaynak, "Release"), { recursive: true });
  const exe = join(kaynak, "Release", "whisper-server.exe");
  writeFileSync(exe, icerik);
  chmodSync(exe, 0o755);
  writeFileSync(join(kaynak, "Release", "whisper.dll"), "dll");
  execFileSync("zip", ["-q", "-r", join(dizin, zipAdi), "Release"], { cwd: kaynak });
}

export async function run(_page, _base, t) {
  const w = await import("../../electron/whisper-yerel.mjs");
  const stt = await import("../../server/stt-bulut.mjs");
  const { guvenliKok } = await import("../../electron/yol.mjs");

  const is = mkdtempSync(join(tmpdir(), "dra-whisper-"));
  const dosyalar = join(is, "sunucu");
  mkdirSync(dosyalar);
  zipYap(dosyalar, w.IKILILER.islemci.dosya, SAHTE_SUNUCU);
  zipYap(dosyalar, w.IKILILER.ekranKarti.dosya, BOZUK_SUNUCU);
  // Sahte model: dogru imza + yeterli boy.
  writeFileSync(join(dosyalar, "model.bin"), Buffer.concat([Buffer.from("lmgg"), Buffer.alloc(4096, 1)]));
  writeFileSync(join(dosyalar, "bozuk.bin"), Buffer.alloc(5000, 7));

  const indirilen = [];
  const dagitici = http.createServer((req, res) => {
    indirilen.push(req.url);
    const yol = join(dosyalar, decodeURIComponent(req.url.split("/").pop()));
    if (!existsSync(yol)) {
      res.writeHead(404);
      return res.end();
    }
    const veri = readFileSync(yol);
    res.writeHead(200, { "content-length": veri.length });
    res.end(veri);
  });
  await new Promise((r) => dagitici.listen(0, "127.0.0.1", r));
  const taban = `http://127.0.0.1:${dagitici.address().port}/`;

  const kayit = join(is, "kayit");
  process.env.WHISPER_KAYIT = kayit;
  const kok = join(is, "whisper");
  const olaylar = [];
  w.onOlay((o) => olaylar.push(o));

  try {
    /* ------------------------------------------------- klasor secimi */
    t.eq(
      guvenliKok({ userData: "C:\\Users\\msı\\AppData\\Roaming\\DRA", programData: "C:\\ProgramData", platform: "win32", alt: "whisper" }),
      join("C:\\ProgramData", "DRA", "whisper"),
      "Turkce harfli kullanici adinda Whisper ASCII klasore kuruluyor",
    );

    /* ------------------------------------------- Windows disinda --- */
    w.ayarla({ kok, platform: "linux" });
    t.eq((await w.durum()).destekleniyor, false, "Windows disinda desteklenmiyor diye bildiriliyor");
    let hata = null;
    try {
      await w.kur();
    } catch (err) {
      hata = err;
    }
    t.ok(/yalnizca Windows/.test(hata?.message || ""), "Windows disinda kurulum acik bir hatayla reddediliyor");

    /* ----------------------------------------------- kurulu degilken */
    w.ayarla({
      kok,
      platform: "win32",
      ikiliTaban: taban,
      modelAdresi: `${taban}model.bin`,
      asgariModelBayt: 1024,
      baslamaSiniri: 15000,
      nvidiaVarMi: async () => true,
    });
    hata = null;
    try {
      await w.baslat();
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NOT_INSTALLED", "kurulmadan baslatilamiyor, sebebi soyleniyor");

    /* ------------------------------------------------------ kurulum */
    const adimlar = new Set();
    const kurulum = await w.kur({ onProgress: ({ adim }) => adimlar.add(adim) });
    t.ok(kurulum.kurulu, "kurulum tamamlandi");
    t.ok(kurulum.islemci && kurulum.ekranKarti, "NVIDIA varken iki surum de kuruldu");
    t.eq([...adimlar].sort(), ["ekran karti", "model", "program"], "her adimin ilerlemesi bildirildi");
    t.ok(!existsSync(join(kok, "islemci.zip")), "indirilen arsivler silindi");
    t.ok(kurulum.model?.startsWith(kok), "model kendi klasorumuzde");

    // Ikinci kurulum hicbir sey indirmemeli.
    const onceki = indirilen.length;
    await w.kur();
    t.eq(indirilen.length, onceki, "kurulu olan tekrar indirilmiyor");

    /* ---------------------------------- baslatma: ekran karti → islemci */
    const adres = await w.baslat();
    t.ok(/^http:\/\/127\.0\.0\.1:\d+\/inference$/.test(adres), `yalnizca bu bilgisayarda dinliyor (${adres})`);
    const d = await w.durum();
    t.eq(d.hizlandirma, "islemci", "ekran karti surumu baslamayinca islemciye donuldu");
    t.ok(/CUDA/.test(d.sonHata || ""), "ekran kartinin neden calismadigi saklandi");
    const args = JSON.parse(readFileSync(`${kayit}.args`, "utf8"));
    const al = (k) => args[args.indexOf(k) + 1];
    t.eq(al("-l"), "tr", "dil Turkce verildi");
    t.eq(al("--host"), "127.0.0.1", "yalnizca 127.0.0.1'de dinliyor");
    t.ok(args.includes("-nt"), "zaman damgasi kapali (yaziya karismasin)");
    t.eq(al("-m"), kurulum.model, "kurulan model kullanildi");
    t.eq(await w.baslat(), adres, "ikinci baslat ayni sunucuyu donuyor");

    /* ------------------------------------ uctan uca: ses → yazi ---- */
    let hataConf = null;
    try {
      stt.configure({ provider: "whisper", adres: "http://192.168.1.5:8080/inference" });
    } catch (err) {
      hataConf = err;
    }
    t.eq(hataConf?.code, "BAD_ADDRESS", "Whisper'a baska makinenin adresi verilemiyor");

    const durumStt = stt.configure({ provider: "whisper", adres });
    t.ok(durumStt.ready, "adres verilince hazir");
    t.ok(!durumStt.keySet, "Whisper anahtar istemiyor");
    const ses = new Int16Array(16000);
    for (let i = 0; i < ses.length; i += 1) ses[i] = Math.round(Math.sin(i / 8) * 6000);
    const sonuc = await stt.transcribe(ses);
    t.eq(sonuc.text, "Dra, saat kaç?", "yazi temizlenip dondu");
    t.eq(sonuc.provider, "whisper", "hangi saglayici oldugu bildiriliyor");
    const istek = JSON.parse(readFileSync(`${kayit}.istek`, "utf8").trim().split("\n").pop());
    t.eq(istek.language, "tr", "istekte dil Turkce");
    t.eq(istek.response_format, "json", "yanit JSON istendi");
    t.ok(/DRA/.test(istek.prompt || ""), "'DRA' ipucu verildi");
    t.eq(istek.file, `dosya:${44 + ses.byteLength}`, "ses WAV olarak tam gitti");

    /* ------------------------------------- beklenmedik kapanma ---- */
    const calisan = await w.durum();
    t.ok(calisan.calisiyor && calisan.pid, "calisiyor gorunuyor");
    // Sureci disaridan oldur: kullanici Gorev Yoneticisi'nden kapatmis gibi.
    process.kill(calisan.pid);
    await new Promise((r) => setTimeout(r, 800));
    t.ok(olaylar.some((o) => o.type === "durdu"), "kapaninca 'durdu' olayi yayildi");
    t.eq((await w.durum()).calisiyor, false, "durum artik calismiyor");
    let agHata = null;
    try {
      await stt.transcribe(ses, { timeout: 3000 });
    } catch (err) {
      agHata = err;
    }
    t.eq(agHata?.code, "NETWORK", "kapali Whisper'a istek ag hatasi veriyor (arayuz Vosk'a doner)");

    const yeni = await w.baslat();
    t.ok(yeni && yeni !== null, "yeniden baslatilabiliyor");
    w.durdur();
    await new Promise((r) => setTimeout(r, 300));
    t.eq((await w.durum()).calisiyor, false, "durdur programi kapatiyor");
    t.eq(olaylar.filter((o) => o.type === "durdu").length, 1, "bilincli kapatma 'beklenmedik' sayilmiyor");

    /* ------------------------------------------ elle model secimi -- */
    let sorun = await w.modelSorunu(join(dosyalar, "bozuk.bin"));
    t.ok(/ggml/.test(sorun || ""), "imzasi yanlis dosya model sayilmiyor");
    hata = null;
    try {
      await w.modelSec(join(dosyalar, "bozuk.bin"));
    } catch (err) {
      hata = err;
    }
    t.ok(hata, "bozuk model secilemiyor");
    const secilen = await w.modelSec(join(dosyalar, "model.bin"));
    t.ok(secilen.model?.startsWith(kok), "secilen model kendi klasorumuze kopyalandi (Turkce harfli yol sorunu olmasin)");

    /* ---------------------------------------------------- kaldirma -- */
    const kaldirildi = await w.kaldir();
    t.ok(!kaldirildi.kurulu && !existsSync(kok), "kaldirinca dosyalar silindi");
  } finally {
    w.durdur();
    stt.configure({ provider: "elevenlabs", key: "" });
    await new Promise((r) => dagitici.close(r));
    rmSync(is, { recursive: true, force: true });
    delete process.env.WHISPER_KAYIT;
  }
}
