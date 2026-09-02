/**
 * Kick moderasyon koprusu.
 *
 * Gercek bir Kick hesabi ve jetonu olmadan API'ye baglanamayiz; ama
 * kopru mantigini tam olarak sinayabiliriz: dogru uca mi gidiyor, dogru
 * govdeyi mi gonderiyor, jetonu nereye koyuyor, hatalari nasil ceviriyor.
 *
 * Bunun icin `fetch` gecici olarak degistirilip her istek kaydediliyor.
 * Boylece "moderasyon calisiyor mu" sorusunun kod tarafi kanitlaniyor.
 */

export const name = "Kick moderasyonu";
export const standalone = true;

export async function run(_page, _base, t) {
  const kick = await import("../../server/kick.mjs");

  const gercekFetch = globalThis.fetch;
  const istekler = [];

  /** Kick API'sini taklit eder; her cagriyi kaydeder. */
  const sahteFetch = (yanit) => async (url, opts = {}) => {
    istekler.push({
      url: String(url),
      method: opts.method || "GET",
      auth: opts.headers?.authorization || null,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return {
      ok: yanit.status < 400,
      status: yanit.status,
      text: async () => JSON.stringify(yanit.body ?? {}),
    };
  };

  const sifirla = () => { istekler.length = 0; };

  try {
    /* ------------------------------------------------- jeton olmadan -- */
    kick.configure({ token: "", channel: "" });
    t.eq(kick.status().ready, false, "jetonsuzken hazir degil");

    let hata = null;
    try {
      globalThis.fetch = sahteFetch({ status: 200, body: {} });
      await kick.ban("biri");
    } catch (err) {
      hata = err;
    }
    t.eq(hata?.code, "NO_TOKEN", "jetonsuz istek ag'a hic cikmiyor");
    t.eq(istekler.length, 0, "jetonsuzken tek bir istek bile atilmiyor");

    /* ------------------------------------------------ jetonla kurulum - */
    const durum = kick.configure({ token: "gizli-jeton-123", channel: "kanalim" });
    t.eq(durum.ready, true, "jetonla hazir");
    t.eq(durum.channel, "kanalim", "kanal adi saklaniyor");
    t.ok(!("token" in durum), "jetonun kendisi disari verilmiyor");

    /* -------------------------------------------------------- yasakla - */
    sifirla();
    globalThis.fetch = sahteFetch({
      status: 200,
      body: { data: [{ broadcaster_user_id: 4242 }] },
    });
    const banMesaj = await kick.ban("ahmet", "spam");

    t.eq(istekler.length, 2, "once kanal kimligi, sonra islem: iki istek");
    t.has(istekler[0].url, "/channels", "kanal kimligi kanal ucundan aliniyor");
    t.has(istekler[0].url, "slug=kanalim", "kanal adi sorguya konuyor");
    t.eq(istekler[1].method, "POST", "yasaklama POST ile gidiyor");
    t.has(istekler[1].url, "/moderation/bans", "yasaklama dogru uca gidiyor");
    t.eq(istekler[1].auth, "Bearer gizli-jeton-123", "jeton Authorization basliginda");
    t.eq(istekler[1].body.broadcaster_user_id, 4242, "kanal kimligi govdeye geciyor");
    t.eq(istekler[1].body.user_id, "ahmet", "kullanici adi govdede");
    t.eq(istekler[1].body.reason, "spam", "sebep iletiliyor");
    t.has(banMesaj, "yasaklandi", "kullaniciya anlasilir yanit");

    /* -------------------------------------------------------- sustur -- */
    sifirla();
    const susMesaj = await kick.timeout("mehmet", 600);
    t.has(istekler[0].url, "/moderation/bans", "susturma da ayni uca gidiyor");
    t.eq(istekler[0].body.duration, 10, "600 saniye 10 dakikaya cevriliyor");
    t.has(susMesaj, "10 dakika", "sure kullaniciya soyleniyor");

    /* ---------------------------------------------------- yasak kaldir  */
    sifirla();
    const kaldirMesaj = await kick.unban("mehmet");
    t.eq(istekler[0].method, "DELETE", "yasak kaldirma DELETE ile");
    t.has(istekler[0].url, "user_id=mehmet", "kullanici sorguda");
    t.has(kaldirMesaj, "kaldirildi", "anlasilir yanit");

    /* ------------------------------------------------------ mesaj yaz - */
    sifirla();
    const yazMesaj = await kick.sendMessage("merhaba herkese");
    t.has(istekler[0].url, "/chat", "mesaj sohbet ucuna gidiyor");
    t.eq(istekler[0].body.content, "merhaba herkese", "mesaj icerigi dogru");
    t.has(yazMesaj, "gonderildi", "anlasilir yanit");

    /* --------------------------------------------------- hata cevirisi  */
    // Kanal kimligi onbellekte oldugu icin dogrudan islem cagrisi yapilir.
    globalThis.fetch = sahteFetch({ status: 401, body: { error: "unauthorized" } });
    let yetkiHatasi = null;
    try { await kick.ban("biri"); } catch (err) { yetkiHatasi = err; }
    t.has(yetkiHatasi?.message || "", "gecersiz", "401 anlasilir Turkce hataya cevriliyor");

    globalThis.fetch = sahteFetch({ status: 403, body: {} });
    let rolHatasi = null;
    try { await kick.ban("biri"); } catch (err) { rolHatasi = err; }
    t.has(rolHatasi?.message || "", "moderator", "403 yetki eksigini anlatiyor");

    /* -------------------------------------------- bilinmeyen islem yok  */
    t.ok(!("surecCalistir" in kick.ACTIONS), "kopru yalnizca moderasyon islemleri sunuyor");
    t.eq(
      Object.keys(kick.ACTIONS).sort(),
      ["ban", "deleteMessage", "sendMessage", "timeout", "unban", "verify"],
      "sunulan islemler beklendigi gibi",
    );
  } finally {
    globalThis.fetch = gercekFetch;
    kick.configure({ token: "", channel: "" });
  }
}
