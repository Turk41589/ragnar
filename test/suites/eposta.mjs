/**
 * E-posta raporu (IMAP).
 *
 * Gercek bir Gmail hesabi olmadan da protokolun tamami sinanabilir:
 * asagida KONUSAN bir sahte IMAP sunucusu var. Boylece "dogru komutu mu
 * gonderiyor", "literal bloklari dogru okuyor mu", "Turkce konu
 * basliklarini cozuyor mu", "reklami bultenden ayiriyor mu" sorularinin
 * hepsi gercek bir alisverisle cevaplaniyor.
 */

import net from "node:net";

export const name = "E-posta raporu";
export const standalone = true;

/** Baslik blogu uretir (gercek Gmail basliklarina benzer). */
function header({ from, subject, unsub = false, precedence = null, date }) {
  const satirlar = [
    `Date: ${date || "Fri, 11 Sep 2026 10:00:00 +0300"}`,
    `From: ${from}`,
    `Subject: ${subject}`,
  ];
  if (unsub) satirlar.push("List-Unsubscribe: <https://ornek.com/cik>");
  if (precedence) satirlar.push(`Precedence: ${precedence}`);
  return satirlar.join("\r\n") + "\r\n\r\n";
}

/** Base64 ile kodlanmis Turkce konu — gercekte boyle geliyor. */
function b64Subject(text) {
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

const MESAJLAR = [
  // 1 — sponsor teklifi (onemli)
  header({ from: "Marka Ekibi <isbirligi@marka.com>", subject: b64Subject("Sponsorluk işbirliği teklifi") }),
  // 2 — is gorusmesi (onemli)
  header({ from: '"Ayşe Demir" <ik@sirket.com.tr>', subject: b64Subject("Mülakat daveti — yazılım pozisyonu") }),
  // 3 — reklam (toplu + indirim)
  header({ from: "Magaza <kampanya@magaza.com>", subject: b64Subject("%50 indirim fırsatı bugün son!"), unsub: true }),
  // 4 — bulten (toplu, reklam degil)
  header({ from: "Teknoloji Bulteni <bulten@haber.com>", subject: b64Subject("Haftalık özet: bu hafta olanlar"), unsub: true }),
  // 5 — kisisel (toplu degil, insan adresi)
  header({ from: "Mehmet Kaya <mehmet@gmail.com>", subject: b64Subject("Yarın buluşalım mı?") }),
  // 6 — otomatik bildirim
  header({ from: "no-reply@banka.com", subject: "Hesap hareketi bildirimi" }),
  // 7 — Precedence: bulk ile toplu (List-Unsubscribe yok)
  header({ from: "Duyuru <duyuru@platform.com>", subject: "Yeni surum yayinda", precedence: "bulk" }),
  // 8 — HAM UTF-8 baslik. Kodlanmis sozcuk kullanmayan gondericiler var ve
  // Turkce harfler iki bayt tutuyor. Literal blok BAYT sayisiyla verildigi
  // icin okuyucu karakter sayarsa tam burada kayiyordu.
  header({
    from: "Şükrü Çağlayan <sukru@ornek.com.tr>",
    subject: "Görüşme için müsait misiniz — ölçüm çizelgesi ğüşıöç",
  }),
];

/**
 * Sahte IMAP sunucusu. Gercek protokolu konusuyor: karsilama, LOGIN,
 * SELECT, UID SEARCH, UID FETCH — ve FETCH yanitini literal bloklarla
 * doner ki okuyucunun en zor kismi gercekten sinansin.
 */
function startFakeImap({ sifre = "dogrusifre" } = {}) {
  const kayit = [];

  const server = net.createServer((socket) => {
    socket.write("* OK sahte IMAP hazir\r\n");
    let tampon = "";

    socket.on("data", (chunk) => {
      tampon += chunk.toString("utf8");
      let satirSonu;
      while ((satirSonu = tampon.indexOf("\r\n")) !== -1) {
        const satir = tampon.slice(0, satirSonu);
        tampon = tampon.slice(satirSonu + 2);
        if (!satir) continue;

        const [tag, komut, ...arg] = satir.split(" ");
        const buyuk = (komut || "").toUpperCase();
        kayit.push(satir);

        if (buyuk === "LOGIN") {
          // Sifreyi tirnaklardan arindirip karsilastiriyoruz.
          const verilen = arg[1]?.replace(/^"|"$/g, "");
          if (verilen === sifre) socket.write(`${tag} OK giris tamam\r\n`);
          else socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (buyuk === "SELECT") {
          socket.write(`* ${MESAJLAR.length} EXISTS\r\n* 0 RECENT\r\n`);
          socket.write(`${tag} OK [READ-WRITE] SELECT tamam\r\n`);
        } else if (buyuk === "UID" && arg[0]?.toUpperCase() === "SEARCH") {
          const uids = MESAJLAR.map((_m, i) => i + 1).join(" ");
          socket.write(`* SEARCH ${uids}\r\n${tag} OK SEARCH tamam\r\n`);
        } else if (buyuk === "UID" && arg[0]?.toUpperCase() === "FETCH") {
          const istenen = (arg[1] || "").split(",").map(Number).filter(Boolean);
          for (const uid of istenen) {
            const govde = MESAJLAR[uid - 1];
            if (!govde) continue;
            const bayt = Buffer.byteLength(govde, "utf8");
            socket.write(
              `* ${uid} FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE ` +
                `LIST-UNSUBSCRIBE PRECEDENCE AUTO-SUBMITTED)] {${bayt}}\r\n`,
            );
            socket.write(govde);
            socket.write(")\r\n");
          }
          socket.write(`${tag} OK FETCH tamam\r\n`);
        } else if (buyuk === "LOGOUT") {
          socket.write(`* BYE\r\n${tag} OK cikis\r\n`);
          socket.end();
        } else {
          socket.write(`${tag} BAD bilinmeyen komut\r\n`);
        }
      }
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, server, kayit });
    });
  });
}

export async function run(_page, _base, t) {
  const mail = await import("../../server/mail.mjs");

  /* ---------------------------------------------- once saf mantik ---- */
  const { parseFrom, decodeWords, classify, quote } = mail._internal;

  t.eq(decodeWords(b64Subject("Merhaba dünya")), "Merhaba dünya", "Turkce konu basligi cozuluyor");
  t.eq(
    decodeWords("=?UTF-8?Q?Yar=C4=B1n_g=C3=B6r=C3=BC=C5=9F=C3=BCr=C3=BCz?="),
    "Yarın görüşürüz",
    "Q kodlamasi da cozuluyor",
  );
  // ISO-8859-9 (Turkce latin) latin1 ile cozulemez: "ş" → "þ" oluyordu ve
  // bu yalnizca goruntuyu degil, siniflamayi da bozuyordu.
  const iso = Buffer.from([0x67, 0xf6, 0x72, 0xfc, 0xfe, 0x6d, 0x65]); // görüşme
  t.eq(
    decodeWords(`=?ISO-8859-9?B?${iso.toString("base64")}?=`),
    "görüşme",
    "ISO-8859-9 basliklar dogru cozuluyor",
  );

  t.eq(parseFrom("Ahmet Yilmaz <a@b.com>").name, "Ahmet Yilmaz", "gonderen adi okunuyor");
  t.eq(parseFrom("Ahmet Yilmaz <A@B.com>").email, "a@b.com", "adres kucuk harfe iniyor");
  t.eq(parseFrom("tek@adres.com").name, "tek", "ad yoksa adresten turetiliyor");

  // Sifrede tirnak olsa bile protokol bozulmamali.
  t.eq(quote('a"b\\c'), '"a\\"b\\\\c"', "ozel karakterler kacisli yaziliyor");

  /* -------------------------------------- yapilandirma ve gizlilik --- */
  mail.configure({ user: "", pass: "" });
  t.eq(mail.status().ready, false, "hesap yokken hazir degil");

  let hata = null;
  try {
    await mail.summary();
  } catch (err) {
    hata = err;
  }
  t.eq(hata?.code, "NO_MAIL", "hesap tanimsizken baglanti bile denenmiyor");

  // Uygulama sifresi Google'da bosluklu gosteriliyor; bosluklar atilmali.
  const durum = mail.configure({ user: "ben@gmail.com", pass: "abcd efgh ijkl mnop" });
  t.eq(durum.ready, true, "hesapla hazir");
  t.eq(durum.passSet, true, "sifre ayarli");
  t.ok(!("pass" in durum), "sifrenin kendisi disari verilmiyor");

  /* ------------------------------------------- sahte sunucuya baglan - */
  const sahte = await startFakeImap({ sifre: "abcdefghijklmnop" });
  mail._setTransportForTests(({ port }) => net.connect({ host: "127.0.0.1", port: sahte.port }));

  try {
    mail.configure({ user: "ben@gmail.com", pass: "abcd efgh ijkl mnop", host: "127.0.0.1" });

    /* --- baglanti sinamasi --- */
    const sinama = await mail.test();
    t.eq(sinama.total, MESAJLAR.length, "kutudaki mesaj sayisi okunuyor");
    t.eq(sinama.user, "ben@gmail.com", "hesap adi raporlaniyor");
    t.ok(
      sahte.kayit.some((k) => /LOGIN "ben@gmail\.com" "abcdefghijklmnop"/.test(k)),
      "sifre bosluksuz gonderiliyor",
    );

    /* --- ozet --- */
    sahte.kayit.length = 0;
    const ozet = await mail.summary({ days: 2 });

    t.eq(ozet.total, MESAJLAR.length, "tum mesajlarin basligi okundu");

    // BAYT/KARAKTER: cok baytli harfler iceren blok dogru okunmali.
    const turkce = [...(ozet.groups.is || []), ...(ozet.groups.kisisel || [])]
      .find((m) => /Görüşme/.test(m.subject));
    t.ok(turkce, "cok baytli (Turkce) basliklar bozulmadan okunuyor");
    t.has(turkce?.from || "", "Şükrü", "gonderen adindaki Turkce harfler dogru");
    t.has(turkce?.subject || "", "ölçüm", "konudaki Turkce harfler dogru");
    t.ok(
      sahte.kayit.some((k) => /UID SEARCH SINCE \d+-[A-Z][a-z]{2}-\d{4}/.test(k)),
      "arama IMAP tarih bicimiyle yapiliyor",
    );
    t.ok(
      sahte.kayit.some((k) => /BODY\.PEEK\[HEADER\.FIELDS/.test(k)),
      "yalnizca BASLIK isteniyor (govde indirilmiyor)",
    );
    t.ok(
      !sahte.kayit.some((k) => /BODY\[\]|BODY\.PEEK\[\]|RFC822/.test(k)),
      "mesaj govdesi hicbir yerde istenmiyor",
    );

    /* --- siniflama: istenen tam olarak buydu --- */
    t.eq(ozet.counts.sponsor, 1, "sponsor teklifi ayri sayiliyor");
    // Iki tane: kodlanmis "Mülakat daveti" ve ham UTF-8 "Görüşme için...".
    t.eq(ozet.counts.is, 2, "is gorusmeleri ayri sayiliyor");
    t.eq(ozet.counts.reklam, 1, "reklam sayiliyor");
    t.eq(ozet.counts.bulten, 2, "bulten sayiliyor (List-Unsubscribe ve Precedence: bulk)");
    t.eq(ozet.counts.kisisel, 1, "kisisel mesaj ayirt ediliyor");
    t.ok(
      ozet.groups.is.some((m) => /Görüşme/.test(m.subject)),
      "ham UTF-8 baslikli mesaj da siniflanabiliyor",
    );
    t.eq(ozet.counts.diger, 1, "otomatik bildirim ayirt ediliyor");

    t.has(
      ozet.groups.sponsor[0].subject,
      "Sponsorluk",
      "sponsor mesajinin konusu cozulmus halde",
    );
    t.has(ozet.groups.is[0].subject, "Mülakat", "is mesajinin Turkce konusu dogru");
    t.eq(ozet.groups.kisisel[0].from, "Mehmet Kaya", "kisisel mesajda gonderen adi var");
    t.ok(Number.isFinite(ozet.groups.is[0].date), "mesaj tarihi okunuyor");

    /* --- sinif kurallarinin kendisi --- */
    const kur = (from, subject, extra = {}) =>
      classify({ from: parseFrom(from), subject, headers: extra });

    t.eq(kur("x@y.com", "Sponsorluk teklifi", { "list-unsubscribe": "<u>" }), "sponsor",
      "sponsor teklifi toplu gonderilse bile onemli sayiliyor");
    t.eq(kur("ik@x.com", "İş görüşmesi daveti"), "is", "is gorusmesi yakalaniyor");
    t.eq(kur("x@y.com", "Kampanya: sepetinizde indirim", { "list-unsubscribe": "<u>" }), "reklam",
      "toplu + indirim = reklam");
    t.eq(kur("x@y.com", "Aylik bulten", { "list-unsubscribe": "<u>" }), "bulten",
      "toplu + reklam degil = bulten");
    t.eq(kur("ali@gmail.com", "Selam nasilsin"), "kisisel", "sradan mesaj kisisel");
    t.eq(kur("noreply@x.com", "Sifreniz degisti"), "diger", "no-reply otomatik sayiliyor");

    /* --- yanlis sifre --- */
    mail.configure({ user: "ben@gmail.com", pass: "yanlis", host: "127.0.0.1" });
    hata = null;
    try {
      await mail.summary();
    } catch (err) {
      hata = err;
    }
    t.has(hata?.message || "", "UYGULAMA SIFRESI", "yanlis sifrede ne yapmasi gerektigi soyleniyor");
    t.ok(
      !(hata?.message || "").includes("yanlis"),
      "hata mesaji sifreyi sizdirmiyor",
    );
  } finally {
    mail._setTransportForTests(null);
    sahte.server.close();
  }
}
