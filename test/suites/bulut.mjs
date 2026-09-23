/**
 * Bulutta ses tanima (ElevenLabs Scribe) + konusma kesici.
 *
 * Gercek ElevenLabs'e baglanmiyoruz; onun yerine ayni protokolu konusan
 * yerel bir HTTP sunucusu var. Istek GERCEKTEN cok parcali form olarak
 * gidiyor ve karsida ayristiriliyor: anahtar hangi baslikta, model ve dil
 * dogru mu, dosya gecerli bir WAV mi — hepsi sahte fetch yerine gercek
 * aga bakarak sinaniyor.
 *
 * Kesici ise saf bir modul; sentetik sesle (sessizlik, ton, gurultu)
 * besleniyor.
 */

import http from "node:http";

export const name = "Bulutta ses tanima";
export const standalone = true;

const HIZ = 16000;

/** Belli genlikte sinus sesi (Int16). */
function ton(saniye, genlik = 0.2, frekans = 220) {
  const n = Math.round(saniye * HIZ);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.round(Math.sin((2 * Math.PI * frekans * i) / HIZ) * genlik * 32767);
  }
  return out;
}

/** Beyaz gurultu (tekrarlanabilir). */
function gurultu(saniye, genlik = 0.01, tohum = 7) {
  const n = Math.round(saniye * HIZ);
  const out = new Int16Array(n);
  let x = tohum;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = Math.round(((x / 0x7fffffff) * 2 - 1) * genlik * 1.7 * 32767);
  }
  return out;
}

const sessizlik = (saniye) => new Int16Array(Math.round(saniye * HIZ));

/**
 * Konusmaya benzeyen ses: heceler (200 ms ton) ve aralarinda kisa
 * dususler (60 ms). Duz bir ton konusma degil ugultudur; kesici onu
 * birkac saniyede gurultu sayar — dogru olan da bu.
 */
function konusma(saniye, genlik = 0.2) {
  const parcalar = [];
  let kalan = saniye;
  while (kalan > 0) {
    const hece = Math.min(0.2, kalan);
    parcalar.push(ton(hece, genlik));
    kalan -= hece;
    if (kalan <= 0) break;
    const ara = Math.min(0.06, kalan);
    parcalar.push(ton(ara, genlik * 0.05));
    kalan -= ara;
  }
  return birlestir(...parcalar);
}

function birlestir(...parcalar) {
  const toplam = parcalar.reduce((a, p) => a + p.length, 0);
  const out = new Int16Array(toplam);
  let o = 0;
  for (const p of parcalar) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Sesi mikrofon gibi, belli boyda parcalar halinde verir. */
function parcalaBesle(kesici, ses, boy = 1365) {
  const olaylar = [];
  for (let i = 0; i < ses.length; i += boy) {
    olaylar.push(...kesici.besle(ses.slice(i, i + boy)));
  }
  return olaylar;
}

export async function run(_page, _base, t) {
  const stt = await import("../../server/stt-bulut.mjs");
  const { kesiciOlustur, enerji } = await import("../../web/js/kesici.js");

  /* ----------------------------------------------------- WAV basligi -- */
  {
    const pcm = new Int16Array([1, -1, 32767, -32768]);
    const wav = stt.pcmToWav(pcm, HIZ);
    t.eq(wav.length, 44 + 8, "WAV: 44 bayt baslik + veri");
    t.eq(wav.toString("ascii", 0, 4), "RIFF", "WAV: RIFF imzasi");
    t.eq(wav.toString("ascii", 8, 12), "WAVE", "WAV: WAVE bicimi");
    t.eq(wav.readUInt32LE(4), 36 + 8, "WAV: RIFF boyu dogru");
    t.eq(wav.readUInt16LE(20), 1, "WAV: PCM");
    t.eq(wav.readUInt16LE(22), 1, "WAV: tek kanal");
    t.eq(wav.readUInt32LE(24), HIZ, "WAV: 16 kHz");
    t.eq(wav.readUInt32LE(28), HIZ * 2, "WAV: bayt hizi");
    t.eq(wav.readUInt16LE(34), 16, "WAV: 16 bit");
    t.eq(wav.readUInt32LE(40), 8, "WAV: veri boyu");
    t.eq(wav.readInt16LE(48), 32767, "WAV: ornekler bozulmadan yaziliyor");
  }

  /* --------------------------------------------------- ses okuma ---- */
  {
    const kaynak = new Int16Array([10, -20, 30]);
    const bayt = new Uint8Array(kaynak.buffer);
    t.eq(Array.from(stt.pcmOku(bayt)), [10, -20, 30], "IPC'den gelen baytlar okunuyor");
    t.eq(
      Array.from(stt.pcmOku(Buffer.from(bayt).toString("base64"))),
      [10, -20, 30],
      "HTTP'den gelen base64 okunuyor",
    );
    // Tek sayida bayt: yarim ornek atilir, cokmez.
    t.eq(stt.pcmOku(new Uint8Array([1, 0, 2, 0, 9])).length, 2, "yarim ornek atiliyor");
    // Hizasiz bir gorunum (byteOffset tek sayi) de okunabilmeli.
    const kaydirilmis = new Uint8Array(7);
    kaydirilmis.set([0, 5, 0, 6, 0, 7, 0]);
    t.eq(Array.from(stt.pcmOku(kaydirilmis.subarray(1))), [5, 6, 7], "hizasiz tampon okunuyor");
    let hata = null;
    try {
      stt.pcmOku({ foo: 1 });
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "BAD_AUDIO", "anlamsiz girdi acik bir hatayla reddediliyor");
  }

  /* ------------------------------------------------ metin temizleme -- */
  t.eq(stt.metniTemizle("(gülüşmeler) Dra, saat kaç? [müzik]"), "Dra, saat kaç?", "ses etiketleri ayiklaniyor");
  t.eq(stt.metniTemizle("  "), "", "bos metin bos kaliyor");
  t.eq(stt.metniTemizle(undefined), "", "tanimsiz metin cokmuyor");

  /* ------------------------------------------- sahte ElevenLabs ------ */
  const istekler = [];
  let cevap = { status: 200, body: { language_code: "tur", text: "Dra, saat kaç?" } };

  const sunucu = http.createServer(async (req, res) => {
    const parcalar = [];
    for await (const c of req) parcalar.push(c);
    const govde = Buffer.concat(parcalar);
    // Cok parcali formu Node'un kendi ayristiricisiyla aciyoruz;
    // bicim bozuksa burada patlar.
    let form = null;
    try {
      form = await new Request("http://x/", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] || "" },
        body: govde,
      }).formData();
    } catch {
      form = null;
    }
    istekler.push({ url: req.url, headers: req.headers, form });
    res.writeHead(cevap.status, { "content-type": "application/json" });
    res.end(typeof cevap.body === "string" ? cevap.body : JSON.stringify(cevap.body));
  });
  await new Promise((r) => sunucu.listen(0, "127.0.0.1", r));
  const adres = `http://127.0.0.1:${sunucu.address().port}/v1/speech-to-text`;
  stt._setEndpointForTests(adres);

  try {
    /* ------------------------------------------ anahtar yokken ----- */
    stt.configure({ key: "" });
    t.eq(stt.status().ready, false, "anahtarsizken hazir degil");
    let hata = null;
    try {
      await stt.transcribe(ton(1));
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_KEY", "anahtarsiz tanima reddediliyor");
    t.eq(istekler.length, 0, "anahtarsizken tek bir istek bile gitmiyor");

    /* ------------------------------------------------ yapilandirma -- */
    const durum = stt.configure({ key: "  sk-gizli-999  " });
    t.eq(durum.ready, true, "anahtarla hazir");
    t.ok(!JSON.stringify(durum).includes("sk-gizli"), "durum anahtarin kendisini icermiyor");
    t.eq(durum.model, stt.LIMITS.VARSAYILAN_MODEL, "model verilmezse varsayilan");

    /* ------------------------------------------------ gercek istek -- */
    const ses = ton(1.5);
    const sonuc = await stt.transcribe(new Uint8Array(ses.buffer));
    t.eq(sonuc.text, "Dra, saat kaç?", "servisin yazisi donuyor");
    t.eq(sonuc.seconds, 1.5, "sure bildiriliyor");
    t.eq(istekler.length, 1, "tek istek gitti");
    const ist = istekler[0];
    t.eq(ist.headers["xi-api-key"], "sk-gizli-999", "anahtar xi-api-key basliginda (bosluklar kirpilmis)");
    t.ok(!ist.url.includes("sk-gizli"), "anahtar adreste yok");
    t.ok(ist.form, "govde gecerli bir cok parcali form");
    t.eq(ist.form?.get("model_id"), "scribe_v1", "model: scribe_v1");
    t.eq(ist.form?.get("language_code"), "tr", "dil: Turkce");
    t.eq(ist.form?.get("tag_audio_events"), "false", "ses etiketleri kapali");
    const dosya = ist.form?.get("file");
    const dosyaBayt = dosya ? Buffer.from(await dosya.arrayBuffer()) : Buffer.alloc(0);
    t.eq(dosyaBayt.toString("ascii", 0, 4), "RIFF", "dosya WAV olarak gidiyor");
    t.eq(dosyaBayt.length, 44 + ses.byteLength, "sesin tamami gidiyor");
    t.eq(dosya?.type, "audio/wav", "dosya turu audio/wav");

    /* ------------------------------------------------ cok kisa ses -- */
    istekler.length = 0;
    const kisa = await stt.transcribe(ton(0.1));
    t.eq(kisa.text, "", "cok kisa ses bos doner");
    t.eq(istekler.length, 0, "cok kisa ses icin istek gitmiyor (kota yanmasin)");

    hata = null;
    try {
      await stt.transcribe(sessizlik(31));
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "TOO_LONG", "30 sn'den uzun ses reddediliyor");

    /* ------------------------------------------------ hatalar ------- */
    const hataIcin = async (status, body) => {
      cevap = { status, body };
      try {
        await stt.transcribe(ton(0.5));
        return null;
      } catch (err) {
        return err;
      }
    };

    let e = await hataIcin(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
    t.eq(e?.code, "HTTP_401", "401 kodu tasiniyor");
    t.ok(/anahtari gecersiz/.test(e?.message || ""), "401 → anahtar gecersiz");

    e = await hataIcin(401, {
      detail: { status: "missing_permissions", message: "The API key you used is missing the permission speech_to_text" },
    });
    t.ok(/Speech to Text/.test(e?.message || ""), "izin eksikligi ayrica soyleniyor");
    t.ok(/API Keys/.test(e?.message || ""), "nereden acilacagi yaziyor");

    e = await hataIcin(429, { detail: { message: "quota" } });
    t.ok(/kotasi doldu/.test(e?.message || ""), "429 → kota");

    e = await hataIcin(200, "<html>bakim</html>");
    t.ok(/beklenmedik/.test(e?.message || ""), "JSON olmayan 200 acik hata veriyor");

    cevap = { status: 200, body: { text: "(müzik)" } };
    const etiketli = await stt.transcribe(ton(0.5));
    t.eq(etiketli.text, "", "yalnizca etiket donerse bos sayiliyor");

    // Ag hatasi
    stt._setEndpointForTests("http://127.0.0.1:1/yok");
    e = null;
    try {
      await stt.transcribe(ton(0.5), { timeout: 3000 });
    } catch (err) {
      e = err;
    }
    t.eq(e?.code, "NETWORK", "ulasilamayinca NETWORK kodu");

    /* ---------------------------------------------------- OpenAI ---- */
    stt._setEndpointForTests(adres);
    istekler.length = 0;
    const oa = stt.configure({ provider: "openai", key: "sk-openai-gizli" });
    t.eq(oa.provider, "openai", "OpenAI secilebiliyor");
    t.eq(oa.model, "gpt-4o-transcribe", "OpenAI varsayilan modeli gpt-4o-transcribe");
    t.ok(!JSON.stringify(oa).includes("sk-openai"), "OpenAI anahtari durumda yok");
    cevap = { status: 200, body: { text: "DRA, YouTube'u aç." } };
    const oaSonuc = await stt.transcribe(ton(1));
    t.eq(oaSonuc.text, "DRA, YouTube'u aç.", "OpenAI yazisi donuyor");
    const oaIstek = istekler[0];
    t.eq(oaIstek?.headers.authorization, "Bearer sk-openai-gizli", "OpenAI anahtari Bearer basliginda");
    t.eq(oaIstek?.headers["xi-api-key"], undefined, "OpenAI'a ElevenLabs basligi gitmiyor");
    t.eq(oaIstek?.form?.get("model"), "gpt-4o-transcribe", "OpenAI: model alani");
    t.eq(oaIstek?.form?.get("language"), "tr", "OpenAI: dil Turkce");
    t.ok(/DRA/.test(oaIstek?.form?.get("prompt") || ""), "OpenAI: 'DRA' ipucu veriliyor");
    t.eq((await oaIstek?.form?.get("file")?.arrayBuffer())?.byteLength, 44 + 32000, "OpenAI: ses WAV olarak tam gitti");

    e = await hataIcin(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
    t.ok(/OpenAI hesabinizda bakiye/.test(e?.message || ""), "OpenAI bakiye bitince acikca soyleniyor");
    e = await hataIcin(401, { error: { message: "Incorrect API key provided", code: "invalid_api_key" } });
    t.ok(/OpenAI anahtari gecersiz/.test(e?.message || ""), "OpenAI yanlis anahtar");

    stt.configure({ provider: "openai", key: "" });
    istekler.length = 0;
    e = null;
    try {
      await stt.transcribe(ton(1));
    } catch (err) {
      e = err;
    }
    t.eq(e?.code, "NO_KEY", "OpenAI anahtarsiz istek atmiyor");
    t.eq(istekler.length, 0, "OpenAI anahtarsizken istek gitmiyor");

    /* ------------------------------------------------ saglayici disi -- */
    e = null;
    try {
      stt.configure({ provider: "baska" });
    } catch (err) {
      e = err;
    }
    t.eq(e?.code, "BAD_PROVIDER", "bilinmeyen saglayici reddediliyor");
    e = null;
    try {
      stt.configure({ provider: "whisper" });
      await stt.transcribe(ton(1));
    } catch (err) {
      e = err;
    }
    t.eq(e?.code, "NOT_READY", "Whisper baslamadan istek atilmiyor");

    /* ---------------------------------------- Whisper hayaletleri ---- */
    t.eq(stt.metniTemizle("Altyazı M.K."), "", "Whisper hayaleti: 'Altyazi M.K.' atiliyor");
    t.eq(stt.metniTemizle("İzlediğiniz için teşekkürler."), "", "Whisper hayaleti: 'izlediginiz icin tesekkurler' atiliyor");
    t.eq(stt.metniTemizle(stt.LIMITS.IPUCU), "", "ipucunun tamaminin tekrari atiliyor");
    t.eq(stt.metniTemizle("DRA, saat kaç?"), "DRA, saat kaç?", "ipucuna benzeyen GERCEK komut atilmiyor");
    t.eq(stt.metniTemizle("Teşekkürler DRA, alarmı kapat"), "Teşekkürler DRA, alarmı kapat", "'tesekkurler' ile baslayan komut atilmiyor");
  } finally {
    stt._setEndpointForTests(null);
    stt.configure({ provider: "elevenlabs", key: "" });
    await new Promise((r) => sunucu.close(r));
  }

  /* ================================================ konusma kesici == */

  t.ok(Math.abs(enerji(ton(0.1, 0.5)) - 0.5 / Math.SQRT2) < 0.01, "enerji: sinusun RMS'i");
  t.eq(enerji(sessizlik(0.1)), 0, "enerji: sessizlik sifir");

  {
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, sessizlik(3));
    t.eq(olaylar.length, 0, "sessizlikte hicbir sey olmuyor");
  }

  {
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, birlestir(sessizlik(1), ton(1), sessizlik(1.2)));
    const turler = olaylar.map((o) => o.type);
    t.eq(turler.join(","), "basla,bitti", "bir cumle: basla → bitti");
    const bitti = olaylar.find((o) => o.type === "bitti");
    t.eq(bitti?.sebep, "sessizlik", "sessizlikle bitti");
    const sn = (bitti?.pcm.length || 0) / HIZ;
    // on tampon (0.6) + konusma (1) + kalan sessizlik payi (<= 0.2)
    t.ok(sn >= 1.5 && sn <= 1.9, `parca boyu makul (${sn.toFixed(2)} sn)`);
    t.ok(Math.abs((bitti?.konusmaMs || 0) - 1000) <= 80, `konusma suresi ~1 sn (${bitti?.konusmaMs} ms)`);
  }

  {
    // "D" gibi alcak bir baslangic esigin altinda kalir; on tampon onu korumali.
    const k = kesiciOlustur();
    const alcak = ton(0.15, 0.004, 400);
    const olaylar = parcalaBesle(k, birlestir(sessizlik(1), alcak, ton(0.8), sessizlik(1.2)));
    const bitti = olaylar.find((o) => o.type === "bitti");
    // Parcanin icinde alcak bolumun ornekleri olmali.
    let bulundu = false;
    if (bitti) {
      const hedef = alcak.slice(100, 110).join(",");
      const tum = Array.from(bitti.pcm);
      for (let i = 0; i + 10 <= tum.length && !bulundu; i += 1) {
        if (tum.slice(i, i + 10).join(",") === hedef) bulundu = true;
      }
    }
    t.ok(bulundu, "esigi asmayan baslangic ('d' sesi) parcaya dahil");
  }

  {
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, birlestir(sessizlik(1), ton(0.08), sessizlik(1.2)));
    t.ok(!olaylar.some((o) => o.type === "bitti"), "tik sesi cumle sayilmiyor");
  }

  {
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, birlestir(sessizlik(0.5), konusma(20)));
    const ilk = olaylar.find((o) => o.type === "bitti");
    t.eq(ilk?.sebep, "uzun", "bitmeyen konusma zorla kesiliyor");
    t.ok((ilk?.pcm.length || 0) / HIZ <= 15.1, "zorla kesilen parca 15 sn'yi asmiyor");
  }

  {
    // Kelime arasi kisa duraklama cumleyi bolmemeli.
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(
      k,
      birlestir(sessizlik(1), ton(0.6), sessizlik(0.4), ton(0.6), sessizlik(1.2)),
    );
    t.eq(olaylar.filter((o) => o.type === "bitti").length, 1, "0.4 sn duraklama tek cumle");
  }

  {
    // Parca boyu sonucu degistirmemeli (mikrofon farkli boyda verebilir).
    const ses = birlestir(sessizlik(1), ton(1), sessizlik(1.2));
    const a = parcalaBesle(kesiciOlustur(), ses, 1365).find((o) => o.type === "bitti");
    const b = parcalaBesle(kesiciOlustur(), ses, 4096).find((o) => o.type === "bitti");
    const c = parcalaBesle(kesiciOlustur(), ses, 317).find((o) => o.type === "bitti");
    t.ok(a && b && c && a.pcm.length === b.pcm.length && b.pcm.length === c.pcm.length,
      "parca boyundan bagimsiz ayni sonuc");
  }

  {
    // Gurultulu oda: surekli ugultu cumle sanilmamali, ustune gelen ses yakalanmali.
    const k = kesiciOlustur();
    const oda = gurultu(4, 0.02);
    const sessizOlay = parcalaBesle(k, oda);
    t.ok(!sessizOlay.some((o) => o.type === "bitti"), "ortam gurultusu cumle sayilmiyor");
    t.ok(k.esik() > 0.03, `esik gurultuye gore yukseldi (${k.esik().toFixed(3)})`);
    // Gercek odada konusma ugultunun USTUNE gelir; ikisi toplaniyor.
    const kon = konusma(1, 0.25);
    const ortam = gurultu(1, 0.02, 99);
    const karisik = kon.map((v, i) => Math.max(-32768, Math.min(32767, v + ortam[i])));
    const olaylar = parcalaBesle(k, birlestir(karisik, gurultu(1.5, 0.02, 99)));
    t.ok(olaylar.some((o) => o.type === "bitti"), "gurultulu odada konusma yakalaniyor");
  }

  {
    // Konusma sirasinda ugultu baslarsa (vantilator acildi) cumle sonsuza
    // kadar surmemeli: birkac saniyede ugultu taban olur ve cumle biter.
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, birlestir(sessizlik(1), konusma(1), gurultu(6, 0.03)));
    const bitti = olaylar.find((o) => o.type === "bitti");
    t.eq(bitti?.sebep, "sessizlik", "sonradan baslayan ugultu cumleyi 15 sn'ye uzatmiyor");
  }

  {
    // Mikrofon acilir acilmaz gelen ses (tik, ugultu) cumle baslatmamali.
    const k = kesiciOlustur();
    const olaylar = parcalaBesle(k, birlestir(gurultu(3, 0.03), sessizlik(0.1)));
    t.ok(!olaylar.some((o) => o.type === "bitti"), "acilistaki ugultu cumle sayilmiyor");
  }

  {
    const k = kesiciOlustur();
    parcalaBesle(k, birlestir(sessizlik(1), ton(0.5)));
    t.ok(k.konusuyor(), "konusma surerken durum 'konusuyor'");
    k.sifirla();
    t.ok(!k.konusuyor(), "sifirlaninca yarim parca atiliyor");
    const olaylar = parcalaBesle(k, sessizlik(1.5));
    t.ok(!olaylar.some((o) => o.type === "bitti"), "sifirlanan parca sonradan gonderilmiyor");
  }
}
