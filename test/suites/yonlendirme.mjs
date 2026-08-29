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
  ["sistem durumu","durum"],["rapor ver","durum"],["her şey yolunda mı","durum"],
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
}
