/**
 * Konusma kesici: surekli gelen mikrofon sesini cumlelere boler.
 *
 * Bulutta tanima tek tek cumle ister; sesi surekli akitmak hem kotayi
 * yer hem de odadaki her seyi disari tasir. Kesici, sesin enerjisine
 * bakarak konusmanin nerede basladigini ve bittigini bulur:
 *
 *   - Ortam gurultusu surekli olculur (esik ona gore kendini ayarlar;
 *     klimali bir odada da sessiz bir odada da calissin diye). Surekli
 *     bir ugultu birkac saniye icinde "sessizlik" sayilmaya baslar.
 *   - Konusma baslamadan onceki kisa bir bolum de tutulur. "DRA"nin
 *     "d"si alcak sesli bir sessiz harf; esigi asmadan once gelir ve
 *     tutulmazsa model "ra" duyar.
 *   - Belli bir sure sessizlik olunca cumle biter.
 *   - Cok uzun konusma zorla kesilir; cok kisa ses (tik, oksuruk) atilir.
 *
 * Saf modul: DOM, IPC, zaman yok. Zaman yerine gelen ornek sayisi
 * sayiliyor; boylece testte gercek sure beklemeden sinanabiliyor.
 */

export const VARSAYILAN = Object.freeze({
  ornekHizi: 16000,
  /** Enerjinin olculdugu pencere. */
  cerceveMs: 20,
  /** Konusma basindan once tutulan ses. */
  onceMs: 600,
  /** Bu kadar sessizlik cumleyi bitirir. */
  sessizlikMs: 800,
  /** Bundan uzun cumle zorla kesilir. */
  azamiMs: 15000,
  /** Toplam sesli bolum bundan kisaysa parca atilir. */
  asgariKonusmaMs: 250,
  /** Konusma baslamasi icin ust uste sesli cerceve sayisi. */
  baslamaCercevesi: 3,
  /** Esik = gurultu tabani x bu carpan. */
  esikCarpani: 3,
  /**
   * Esik bundan asagi inmez (tam sessiz odada her hisirti konusma
   * sayilmasin). 0.008 idi; kisik kazancli dizustu mikrofonlarinda
   * normal ses tonu bunun altinda kalabiliyordu.
   */
  asgariEsik: 0.005,
  /**
   * Gurultu tabani son bu kadar suredeki EN DUSUK enerjidir. Konusmada
   * heceler arasinda hep bir dusus olur; vantilator ya da klima gibi
   * surekli bir ugultuda olmaz. Taban boylece konusmayi degil ugultuyu
   * olcer.
   */
  tabanPencereMs: 3000,
  /** Mikrofon acilinca once odayi dinle; bu surede cumle baslatma. */
  isinmaMs: 400,
});

/** Int16 cercevenin ortalama karekok enerjisi, 0..1 araliginda. */
export function enerji(pcm, bas = 0, son = pcm.length) {
  const n = son - bas;
  if (n <= 0) return 0;
  let toplam = 0;
  for (let i = bas; i < son; i += 1) {
    const v = pcm[i] / 32768;
    toplam += v * v;
  }
  return Math.sqrt(toplam / n);
}

export function kesiciOlustur(secenek = {}) {
  const a = { ...VARSAYILAN, ...secenek };
  const cerceve = Math.max(1, Math.round((a.ornekHizi * a.cerceveMs) / 1000));
  const onceCerceve = Math.ceil(a.onceMs / a.cerceveMs);
  const sessizCerceve = Math.ceil(a.sessizlikMs / a.cerceveMs);
  const azamiCerceve = Math.ceil(a.azamiMs / a.cerceveMs);
  const asgariSesli = Math.ceil(a.asgariKonusmaMs / a.cerceveMs);

  /** Son cercevelerin enerjisi (halka tampon); taban bunlarin en kucugu. */
  const tabanBoyu = Math.max(1, Math.ceil(a.tabanPencereMs / a.cerceveMs));
  const isinma = Math.ceil(a.isinmaMs / a.cerceveMs);
  const gecmis = new Float32Array(tabanBoyu);
  let gecmisSayi = 0;
  let gecmisYer = 0;
  let taban = 0;

  function tabaniGuncelle(e) {
    gecmis[gecmisYer] = e;
    gecmisYer = (gecmisYer + 1) % tabanBoyu;
    if (gecmisSayi < tabanBoyu) gecmisSayi += 1;
    let enAz = Infinity;
    for (let i = 0; i < gecmisSayi; i += 1) if (gecmis[i] < enAz) enAz = gecmis[i];
    taban = enAz;
  }
  /** Konusma disinda tutulan son cerceveler (on tampon). */
  let once = [];
  /** Konusma sirasinda biriken cerceveler. */
  let parca = null;
  let sesli = 0;
  let sessizArka = 0;
  let ustUste = 0;
  /** Cerceveye tamamlanmayi bekleyen ornekler. */
  let artik = new Int16Array(0);

  /**
   * Teshis sayaclari. "Sesimi algilamiyor" denince tahmin yerine
   * olcum: mikrofonun en yuksek seviyesi esige hic ulasiyor mu, cumle
   * basliyor ama kisa diye mi atiliyor?
   */
  const sayac = { baslayan: 0, biten: 0, atilan: 0, enYuksek: 0 };

  const esik = () => Math.max(a.asgariEsik, taban * a.esikCarpani);

  function birlestir(cerceveler) {
    let toplam = 0;
    for (const c of cerceveler) toplam += c.length;
    const out = new Int16Array(toplam);
    let o = 0;
    for (const c of cerceveler) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  function bitir(olaylar, sebep) {
    const p = parca;
    const s = sesli;
    const arka = sessizArka;
    parca = null;
    sesli = 0;
    sessizArka = 0;
    ustUste = 0;
    once = [];
    if (s < asgariSesli) {
      sayac.atilan += 1;
      olaylar.push({ type: "atildi", sebep: "kisa" });
      return;
    }
    sayac.biten += 1;
    // Sondaki sessizligin cogunu gondermeye gerek yok; biraz payi kalsin.
    const kirp = Math.max(0, arka - 10);
    const cerceveler = sebep === "sessizlik" ? p.slice(0, p.length - kirp) : p;
    olaylar.push({
      type: "bitti",
      sebep,
      pcm: birlestir(cerceveler),
      konusmaMs: s * a.cerceveMs,
    });
  }

  function cerceveIsle(c, olaylar) {
    const e = enerji(c);
    if (e > sayac.enYuksek) sayac.enYuksek = e;
    tabaniGuncelle(e);
    const sinir = esik();
    const yuksek = e >= sinir;

    if (!parca) {
      once.push(c);
      if (once.length > onceCerceve) once.shift();

      // Oda henuz olculmediyse ilk ses konusma sayilmasin.
      if (gecmisSayi < isinma) return;

      if (yuksek) {
        ustUste += 1;
        if (ustUste >= a.baslamaCercevesi) {
          parca = once.slice();
          once = [];
          sesli = ustUste;
          sessizArka = 0;
          sayac.baslayan += 1;
          olaylar.push({ type: "basla" });
        }
      } else {
        ustUste = 0;
      }
      return;
    }

    parca.push(c);
    // Konusma icinde kucuk bir histerezis: kelime arasi alcak heceler
    // cumleyi erken bitirmesin.
    if (e >= sinir * 0.7) {
      sesli += 1;
      sessizArka = 0;
    } else {
      sessizArka += 1;
    }

    if (sessizArka >= sessizCerceve) bitir(olaylar, "sessizlik");
    else if (parca.length >= azamiCerceve) bitir(olaylar, "uzun");
  }

  return {
    /** Yeni ses ekler; olan olaylari dondurur ("basla" / "bitti" / "atildi"). */
    besle(pcm) {
      const olaylar = [];
      let veri = pcm;
      if (artik.length) {
        veri = new Int16Array(artik.length + pcm.length);
        veri.set(artik, 0);
        veri.set(pcm, artik.length);
      }
      let i = 0;
      for (; i + cerceve <= veri.length; i += cerceve) {
        // Kopya: gelen tampon baska yere aktarilabilir, parcada bozulmasin.
        cerceveIsle(veri.slice(i, i + cerceve), olaylar);
      }
      artik = veri.slice(i);
      return olaylar;
    },

    /** Yarim kalan parcayi atar (DRA konusurken, mikrofon kapaninca). */
    sifirla() {
      parca = null;
      once = [];
      sesli = 0;
      sessizArka = 0;
      ustUste = 0;
      artik = new Int16Array(0);
    },

    konusuyor: () => Boolean(parca),
    /** Teshis: sayaclar ve o anki esik/taban. */
    istatistik: () => ({ ...sayac, esik: esik(), taban }),
    esik,
    taban: () => taban,
  };
}
