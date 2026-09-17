/**
 * Komut yonlendirme: ayni komutun farkli yazilislari dogru kurala gitmeli.
 *
 * Bu paket "bir sey eslesti mi" degil, "DOGRU kural mi secildi" diye bakar.
 * Fark onemli: eslesme testi yesil gorunurken "notlari sil" komutu notlari
 * okuyor olabiliyordu.
 */

import { openApp } from "../helpers.mjs";

export const name = "Komut yonlendirme";

/** [girdi, beklenen kural adi] — null: hicbir kurala gitmemeli */
const CASES = [
  ["bugün ne","tarih"],["bu gün ne","tarih"],["bue gün ne","tarih"],
  ["bugün günlerden ne","tarih"],["bu günkü tarih","tarih"],["ayın kaçı","tarih"],
  ["hangi gündeyiz","tarih"],
  ["saat kaç","saat"],["saaat kaç","saat"],["saat kac acaba","saat"],
  ["saatin kaç olduğunu söyler misin","saat"],["vakit ne","saat"],
  ["merhaba","selam"],["mrhaba","selam"],["selam dra","selam"],["naber","selam"],
  ["nasılsın","selam"],["günaydın","selam"],
  ["not al süt al","not-al"],["nott al ekmek","not-al"],["not et yarın toplantı","not-al"],
  ["notlarım","notlari-oku"],["notlarımı göster","notlari-oku"],["ne not almıştım","notlari-oku"],
  ["notları sil","notlari-sil"],["tüm notları temizle","notlari-sil"],
  ["alarm kur","alarm-kur"],["alrm kur","alarm-kur"],
  ["sabah yedi buçukta alarm kur","alarm-kur"],["beni sabah 7 de uyandır","alarm-kur"],
  ["alarmlarım","alarmlari-oku"],["alarmları göster","alarmlari-oku"],["alarm var mı","alarmlari-oku"],
  ["alarmları sil","alarmlari-sil"],["tüm alarmları iptal et","alarmlari-sil"],
  ["5 dakika zamanlayıcı kur","zamanlayici"],["10 saniye sonra hatırlat","zamanlayici"],
  ["zamanlayci kur 3 dakika","zamanlayici"],["geri sayım başlat","zamanlayici"],
  ["12 kere 8 kaç eder","hesap"],["45 artı 17","hesap"],["hesapla 100 bölü 4","hesap"],
  ["youtube aç","site-ac"],["github açar mısın","site-ac"],["spotify aç","site-ac"],
  ["googleda kedi ara","arama"],["youtube'da müzik arat","arama"],
  ["şaka yap","saka"],["espri yap","saka"],["güldür beni","saka"],["bir fıkra anlat","saka"],
  ["yazı tura at","yazi-tura"],["zar at","zar"],["sayı tut","rastgele-sayi"],
  ["renk yeşil","renk"],["temayı değiştir","renk"],
  ["sistem durumu","durum"],["her şey yolunda mı","durum"],["durumun ne","durum"],
  // "rapor" artik BILGISAYAR raporu: donanim, disk, guncellemeler.
  // Bu ikisi bir donem ayni ctx metodunu paylasiyordu ve rapor komutu
  // sessizce DRA'nin kendi durumunu donduruyordu.
  ["rapor ver","rapor"],["rapor","rapor"],["bana rapor ver","rapor"],
  ["bilgisayar raporu","rapor"],["güncelleme var mı","rapor"],
  ["güncellemeleri kontrol et","rapor"],["disk ne kadar dolu","rapor"],
  ["bilgisayar güncel mi","rapor"],
  ["montajı başlat","montaj"],["montaj yap","montaj"],["klipleri birleştir","montaj"],
  ["mail var mı","eposta"],["maillerim","eposta"],["gelen kutusu","eposta"],
  ["kanal raporu","youtube"],["kaç abonem var","youtube"],["yayın sırası","youtube"],
  ["mesajları topla","musteri-topla"],["müşteri mesajlarını topla","musteri-topla"],
  ["müşteri mesajları","musteri-mesajlari"],["yanıt bekleyen var mı","musteri-mesajlari"],
  ["işletme raporu","isletme-rapor"],["memnuniyet raporu","isletme-rapor"],
  ["şikayet raporu","isletme-rapor"],
  ["otomatik yanıtla","otomatik-yanit"],["mesajları yanıtla","otomatik-yanit"],
  // Bilgisayar kontrolu — "sesini kapat" (DRA'nin kendi sesi) ile
  // "sesi kis" (bilgisayarin sesi) karismamali.
  ["sesi aç","ses-ac"],["sesi yükselt","ses-ac"],["kulaklığın sesini aç","ses-ac"],
  ["sesi kıs","ses-kis"],["sesi azalt","ses-kis"],
  ["sesini kapat","sesi-kapat"],["sus","sesi-kapat"],["sesini aç","sesi-ac"],
  ["duraklat","medya"],["sonraki şarkı","medya"],
  ["ileri sar","ileri-sar"],["10 saniye geri sar","ileri-sar"],
  ["youtubede kara murat aç","youtube-ac"],
  ["spotifyden jazz aç","muzik-ac"],["müzik aç","muzik-ac"],
  ["ekranı kilitle","ekrani-kilitle"],
  // GERCEK SORULAR komut onerisine dusmemeli; arastirmaya gitmeli.
  ["eyfel kulesi kaç metre",null],["bugün dolar kaç lira",null],
  ["fotosentez nedir",null],["türkiye'nin nüfusu ne kadar",null],
  ["ayarları aç","panel-ac"],["ayarlar","panel-ac"],
  ["sesini kapat","sesi-kapat"],["sus","sesi-kapat"],["sessiz ol","sesi-kapat"],
  ["sesini aç","sesi-ac"],
  ["tam ekran","tam-ekran"],["ekranı temizle","temizle"],["sohbeti temizle","temizle"],
  ["uyu","uyu"],["görüşürüz","uyu"],["iyi geceler","uyu"],["uyku moduna geç","uyu"],
  ["kimsin","kimsin"],["adın ne","kimsin"],["sen nesin","kimsin"],
  ["neler yapabilirsin","yardim"],["yardım","yardim"],
  ["teşekkürler","tesekkur"],["sağol","tesekkur"],
  ["hava durumu","hava"],["hava nasıl","hava"],
  ["blorp zonk gribble",null],["roma neden düştü",null],["asdfgh",null],
];

/**
 * KOSULLU kurallar.
 *
 * Dokuz kural bir `guard` ardinda duruyor: moderasyon komutlari Kick
 * acik degilse, uygulama komutlari o uygulama kurulu degilse, arastirma
 * arama kapaliysa hic degerlendirilmiyor. Yukaridaki liste `explain`i
 * baglamsiz cagirdigi icin bu kurallarin HICBIRI sinanmiyordu — yani
 * uygulamanin en cakismaya acik bolgesi test disindaydi.
 *
 * Ozellikle "sustur": hem bilgisayarin sesini kismak hem de bir
 * kullaniciya susturma vermek ayni kelime. Hangisinin kazandigi
 * `priority` ile belirleniyor ve bu, bir kural siralamasi
 * degistiginde sessizce bozulabilecek bir seydir.
 */
const KOSULLU = [
  // Ses susturma BILGISAYARIN sesi; moderasyon degil.
  ["bilgisayari sustur", "ses-sustur"],
  ["sesi sustur", "ses-sustur"],
  ["sessize al", "ses-sustur"],
  ["mute yap", "ses-sustur"],

  // Moderasyon: kime yapildigi belli olan komutlar.
  ["ahmeti banla", "mod-banla"],
  ["banla", "mod-banla"],
  ["ahmeti 10 dakika sustur", "mod-sustur"],
  ["ahmetin yasagini kaldir", "mod-ban-kaldir"],
  ["sohbete yaz merhaba", "mod-yaz"],

  // Parlaklik
  ["ekrani karart", "parlaklik"],
  ["parlakligi yuzde 50 yap", "parlaklik"],
  ["ekran parlakligi", "parlaklik"],

  // Kurulu uygulama: site acmaktan ONCE gelmeli.
  ["spotify ac", "uygulama-ac"],
  ["spotify kapat", "uygulama-kapat"],

  // Arastirma
  ["arastir istanbul nufusu", "web-arama"],
  ["fotosentez nedir", "web-arama"],
  ["einstein kimdir", "web-arama"],
];

export async function run(page, base, t) {
  await openApp(page, base);

  const results = await page.evaluate(async (cases) => {
    const { explain } = await import("/js/commands.js");
    return cases.map(([text]) => explain(text, 1)[0] ?? null);
  }, CASES);

  const THRESHOLD = 0.62;
  for (let i = 0; i < CASES.length; i += 1) {
    const [text, expected] = CASES[i];
    const top = results[i];
    const got = top && top.score >= THRESHOLD ? top.name : null;
    t.eq(got, expected, `"${text}"`);
  }

  /* ------------------------------------------------ kosullu kurallar */

  const kosullu = await page.evaluate(async (cases) => {
    const { explain } = await import("/js/commands.js");
    // Yayinci kipi acik, Spotify kurulu, arastirma acik.
    const ctx = {
      kickReady: () => true,
      searchEnabled: () => true,
      findApp: (s) => (/spotify/i.test(s) ? { id: "spotify", name: "Spotify" } : null),
    };
    return cases.map(([text]) => explain(text, 1, ctx)[0] ?? null);
  }, KOSULLU);

  for (let i = 0; i < KOSULLU.length; i += 1) {
    const [text, expected] = KOSULLU[i];
    const top = kosullu[i];
    const got = top && top.score >= THRESHOLD ? top.name : null;
    t.eq(got, expected, `(kosullu) "${text}"`);
  }

  // Kosul saglanmiyorsa bu kurallar HIC devreye girmemeli: Kick kapaliyken
  // "ahmeti banla" demek bir moderasyon komutu calistirmamali.
  const kapaliyken = await page.evaluate(async () => {
    const { explain } = await import("/js/commands.js");
    const ctx = { kickReady: () => false, searchEnabled: () => false, findApp: () => null };
    return ["ahmeti banla", "sohbete yaz merhaba", "spotify ac", "arastir istanbul"]
      .map((s) => (explain(s, 1, ctx)[0]?.name ?? null));
  });

  t.ok(!kapaliyken.includes("mod-banla"), "Kick kapaliyken moderasyon komutu calismiyor");
  t.ok(!kapaliyken.includes("mod-yaz"), "Kick kapaliyken sohbete yazilmiyor");
  t.ok(!kapaliyken.includes("uygulama-ac"), "kurulu olmayan uygulama acilmiyor");
  t.ok(!kapaliyken.includes("web-arama"), "arama kapaliyken arastirmaya gidilmiyor");
}
