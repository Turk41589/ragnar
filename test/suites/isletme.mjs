/**
 * Isletme modu: siniflama, otomatik yanit, raporlar.
 *
 * En kritik sinama otomatik yanitta: bu modul GERCEK MUSTERIYE mesaj
 * gonderiyor ve geri alinamiyor. Bu yuzden "kapaliyken gercekten
 * gondermiyor mu", "deneme kipinde gercekten gondermiyor mu",
 * "sikayete sablon cevap yapistirmiyor mu" ayri ayri kanitlaniyor.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const name = "Isletme modu";
export const standalone = true;

export async function run(_page, _base, t) {
  process.env.DRA_DATA_DIR = await mkdtemp(join(tmpdir(), "dra-isletme-"));

  const sentiment = await import("../../server/sentiment.mjs");
  const messages = await import("../../server/messages.mjs");
  const autoreply = await import("../../server/autoreply.mjs");
  const business = await import("../../server/business.mjs");
  const sources = await import("../../server/sources.mjs");

  // Paketler ayni surecte calisiyor ve depo modulu bellekte paylasiliyor:
  // onceki paketin mesajlari bu paketin sayimlarini bozmasin.
  messages._resetForTests();
  autoreply._resetForTests();

  /* ============================= 1. SINIFLAMA ====================== */

  const { classify } = sentiment;

  t.eq(classify("Cok tesekkurler, harika olmus").kind, "memnun", "tesekkur memnun sayiliyor");
  t.eq(classify("Berbat bir deneyimdi").kind, "sikayet", "acik sikayet yakalaniyor");
  t.eq(classify("Bugun acik misiniz?").kind, "soru", "soru ayirt ediliyor");
  t.eq(classify("tamam").kind, "notr", "duygusuz mesaj notr");

  // TURKCE OLUMSUZLUK — kelime saymak burada yaniltir.
  t.eq(
    classify("Memnun degilim").kind,
    "sikayet",
    "olumlu kelime olumsuzlanirsa sikayet sayiliyor",
  );
  t.eq(
    classify("Hic sorun yok, tesekkurler").kind,
    "memnun",
    "olumsuz kelime olumsuzlanirsa sikayet sayilmiyor",
  );
  t.eq(
    classify("Begenmedim").kind,
    "sikayet",
    "fiil olumsuzlugu yakalaniyor",
  );

  // Ikisi bir arada: ilgilenilmesi gereken taraf sikayet.
  t.eq(
    classify("Yemek lezzetliydi ama servis cok yavasti").kind,
    "sikayet",
    "karisik mesajda sikayet one aliniyor",
  );

  // Kelime ortasinda eslesme olmamali.
  t.eq(
    classify("Gecerli bir kod verir misiniz").kind,
    "soru",
    "'gec' kelimesi 'gecerli' icinde sikayet saymiyor",
  );

  /* ============================= 2. DEPO ETIKETI =================== */

  const gelen = [
    { externalId: "1", from: "Ayse", text: "Cok tesekkurler, harikaydi!" },
    { externalId: "2", from: "Mehmet", text: "Siparisim gelmedi, rezalet" },
    { externalId: "3", from: "Zeynep", text: "Bugun kacta aciksiniz?" },
    { externalId: "4", from: "Ali", text: "Memnun degilim, iade istiyorum" },
    { externalId: "5", from: "Veli", text: "Fiyat listeniz var mi" },
    { externalId: "6", from: "Ece", text: "Eline saglik, cok begendim" },
  ];
  await messages.ingest("instagram", gelen);

  const liste = await messages.list();
  t.eq(liste.length, 6, "mesajlar depoya girdi");
  t.ok(
    liste.every((m) => m.kind),
    "her mesaj girerken siniflandi",
  );

  /* ============================= 3. OTOMATIK YANIT ================= */

  autoreply._resetForTests();

  // Gonderim yapan kaynagi taklit ediyoruz: gercekten gidip gitmedigini
  // saymanin tek yolu bu.
  const gonderilenler = [];
  const gercekReply = sources.reply;
  sources.SOURCES.instagram.send = async (hedef, metin) => {
    gonderilenler.push({ hedef, metin });
    return { sent: true };
  };

  try {
    await autoreply.add({
      name: "Calisma saatleri",
      keywords: ["kacta", "acik misiniz", "saat"],
      reply: "Merhaba! Her gun 09:00-22:00 arasi aciktir.",
    });
    await autoreply.add({
      name: "Fiyat",
      keywords: ["fiyat", "ucret"],
      reply: "Fiyat listemiz profilimizdeki baglantida.",
    });

    t.eq((await autoreply.list()).length, 2, "kurallar kaydedildi");
    t.eq((await autoreply.status()).enabled, false, "otomatik yanit VARSAYILAN KAPALI");

    /* --- kapaliyken hicbir sey gitmemeli --- */
    const kapali = await autoreply.run();
    t.eq(kapali.skipped, "kapali", "kapaliyken calismiyor");
    t.eq(gonderilenler.length, 0, "kapaliyken TEK BIR MESAJ BILE gitmiyor");

    /* --- deneme kipi: gostersin, gondermesin --- */
    const deneme = await autoreply.run({ dryRun: true });
    t.eq(deneme.dryRun, true, "deneme kipi isaretli");
    t.eq(gonderilenler.length, 0, "deneme kipinde HICBIR SEY gonderilmiyor");
    t.eq(deneme.planned.length, 2, "iki mesaj icin plan cikti");
    t.eq(deneme.sent.length, 0, "deneme kipinde gonderilen yok");

    const planSaatler = deneme.planned.find((p) => p.from === "Zeynep");
    t.ok(planSaatler, "saat sorusu icin plan var");
    t.has(planSaatler.reply, "09:00", "dogru yanit secildi");
    t.eq(planSaatler.ruleName, "Calisma saatleri", "eslesen kural bildiriliyor");

    // SIKAYETE OTOMATIK YANIT YOK: kizgin musteriye sablon cevap
    // durumu buyutur; kural acikca istemedikce elde kaliyor.
    t.ok(
      !deneme.planned.some((p) => p.from === "Mehmet" || p.from === "Ali"),
      "sikayetlere kendiliginden sablon yanit verilmiyor",
    );

    /* --- acik: gercekten gondersin --- */
    await autoreply.setEnabled(true);
    const sonuc = await autoreply.run();

    t.eq(sonuc.sent.length, 2, "iki mesaj yanitlandi");
    t.eq(gonderilenler.length, 2, "yanitlar gercekten gonderildi");
    t.has(gonderilenler[0].metin, "09:00", "gonderilen metin dogru");

    const zeynep = (await messages.list()).find((m) => m.from === "Zeynep");
    t.eq(zeynep.status, "yanitlandi", "yanitlanan mesaj isaretlendi");
    t.ok(zeynep.reply, "verilen yanit kaydedildi");

    /* --- ayni mesaja iki kez yanit yok --- */
    gonderilenler.length = 0;
    const ikinci = await autoreply.run();
    t.eq(ikinci.sent.length, 0, "ayni mesaja ikinci kez yanit verilmiyor");
    t.eq(gonderilenler.length, 0, "tekrar gonderim yok");

    /* --- sikayete yanit acikca istenirse --- */
    await autoreply.add({
      name: "Sikayet karsilama",
      keywords: ["iade", "gelmedi"],
      reply: "Uzgunuz, hemen ilgileniyoruz.",
      answerComplaints: true,
    });
    gonderilenler.length = 0;
    const sikayetTuru = await autoreply.run();
    t.eq(sikayetTuru.sent.length, 2, "acikca istenince sikayetlere de yanit veriliyor");

    /* --- gonderim patlarsa mesaj yanitlandi sayilmamali --- */
    await messages.ingest("instagram", [
      { externalId: "7", from: "Can", text: "Fiyat nedir acaba" },
    ]);
    sources.SOURCES.instagram.send = async () => {
      throw new Error("ag koptu");
    };
    const hatali = await autoreply.run();
    t.eq(hatali.errors.length, 1, "gonderim hatasi bildiriliyor");
    t.eq(hatali.sent.length, 0, "hatali gonderim basarili sayilmiyor");
    const can = (await messages.list()).find((m) => m.from === "Can");
    t.ok(can.status !== "yanitlandi", "gonderilemeyen mesaj elde kaliyor");

    /* --- kural yonetimi --- */
    const kurallar = await autoreply.list();
    await autoreply.toggle(kurallar[0].id);
    t.eq((await autoreply.list())[0].enabled, false, "kural kapatilabiliyor");
    await autoreply.remove(kurallar[0].id);
    t.eq((await autoreply.list()).length, 2, "kural silinebiliyor");

    let hata = null;
    try {
      await autoreply.add({ keywords: [], reply: "x" });
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "anahtar kelime", "kelimesiz kural reddediliyor");

    hata = null;
    try {
      await autoreply.add({ keywords: ["x"], reply: "   " });
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "bos olamaz", "yanitsiz kural reddediliyor");
  } finally {
    sources.SOURCES.instagram.send = undefined;
  }

  /* ============================= 4. RAPORLAR ======================= */

  const memnuniyet = await business.satisfaction({ days: 30 });
  t.eq(memnuniyet.memnun, 2, "memnun mesajlar sayiliyor");
  t.eq(memnuniyet.sikayet, 2, "sikayetler sayiliyor");
  // Oran yalnizca duygu tasiyan mesajlar uzerinden: 2 memnun / 4 duygulu.
  t.eq(memnuniyet.rate, 50, "memnuniyet orani duygu tasiyanlar uzerinden");
  t.eq(memnuniyet.basis, 4, "oranin hangi sayiya dayandigi bildiriliyor");
  t.ok(memnuniyet.samples.length > 0, "ornek memnun mesajlar veriliyor");

  const sikayetler = await business.complaints({ days: 30 });
  t.eq(sikayetler.total, 2, "sikayet raporu dogru sayiyor");
  t.ok(sikayetler.topics.length > 0, "sikayet konulari cikariliyor");
  t.ok(
    sikayetler.items.every((m) => m.text),
    "sikayet metinleri listeleniyor",
  );

  const yanit = await business.responsiveness({ days: 30 });
  t.ok(yanit.answered > 0, "yanitlananlar sayiliyor");
  t.ok(yanit.rate !== null, "yanit orani hesaplaniyor");
  t.ok(Number.isFinite(yanit.medianMinutes), "ortanca yanit suresi hesaplaniyor");

  const tam = await business.report({ days: 30 });
  t.ok(tam.satisfaction && tam.complaints && tam.responsiveness, "birlesik rapor uc bolum veriyor");

  // Duygu tasiyan mesaj yoksa oran SIFIR degil YOK olmali.
  messages._resetForTests();
  await messages.ingest("manuel", [{ externalId: "n1", from: "X", text: "tamam" }]);
  const bos = await business.satisfaction({ days: 30 });
  t.eq(bos.rate, null, "duygu tasiyan mesaj yoksa oran uydurulmuyor");

  delete process.env.DRA_DATA_DIR;
}
