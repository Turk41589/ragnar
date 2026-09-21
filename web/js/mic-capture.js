/**
 * Mikrofondan ham ses alir ve gomulu tanima motoruna aktarir.
 *
 * AudioWorklet yerine ScriptProcessorNode kullaniliyor. Worklet daha
 * modern ama ayri bir modul dosyasi yuklemesi gerekiyor; uygulama
 * file:// uzerinden calistigi icin bu yukleme engelleniyor.
 *
 * TEK AKIS KURALI — onemli:
 * Bir donem seviye gostergesi ve yakalama AYRI AYRI getUserMedia
 * cagiriyordu. Windows'ta ses surucusu ikinci akisi cogu zaman SESSIZ
 * veriyor: gosterge oynuyor ama motora sifirlar gidiyor, yani "ses
 * geliyor ama DRA duymuyor". Artik tek bir akis acilip paylasiliyor.
 */

const SAMPLE_RATE = 16000;
/** Yaklasik 0.25 saniyelik parcalar — IPC trafigini makul tutar. */
const CHUNK = 4096;

let ctx = null;
let node = null;
let source = null;
let onChunk = null;

/* ------------------------------------------------------- paylasilan akis */

let sharedStream = null;
let streamUsers = 0;

/**
 * getUserMedia hatasini KULLANILABILIR bir cumleye cevirir.
 *
 * Her hatayi yutup `false` donmek, mikrofon acilmadiginda kullanicinin
 * elinde hicbir sey birakmiyordu. Hangi hata oldugunu bilmek ne
 * yapilacagini da belirliyor.
 */
export function micError(err) {
  const ad = err?.name || "";

  if (ad === "NotAllowedError" || ad === "SecurityError") {
    return "Mikrofon izni verilmedi. Windows'ta Ayarlar → Gizlilik ve " +
      "guvenlik → Mikrofon bolumunden masaustu uygulamalarina izin verin, " +
      "sonra DRA'yi yeniden baslatin.";
  }
  if (ad === "NotFoundError" || ad === "DevicesNotFoundError") {
    return "Mikrofon bulunamadi. Cihaz takili mi ve Windows ses ayarlarinda " +
      "goruyor musunuz? Bluetooth kulaklik ise once baglanmasini bekleyin.";
  }
  if (ad === "NotReadableError" || ad === "TrackStartError") {
    return "Mikrofona erisilemedi — baska bir uygulama kullaniyor olabilir " +
      "(Zoom, Discord, OBS). Onu kapatip tekrar deneyin.";
  }
  if (ad === "OverconstrainedError") {
    return "Mikrofon istenen ses ayarlarini desteklemiyor. Windows ses " +
      "ayarlarindan baska bir giris cihazi secmeyi deneyin.";
  }
  return err?.message
    ? `Mikrofon acilamadi: ${err.message}`
    : "Mikrofon acilamadi (bilinmeyen sebep).";
}

/**
 * Mikrofon akisini acar. Zaten aciksa AYNISINI dondurur.
 * Kullanan her taraf bitince `releaseStream` cagirmali.
 */
export async function acquireStream() {
  if (sharedStream && sharedStream.getAudioTracks().some((t) => t.readyState === "live")) {
    streamUsers += 1;
    return sharedStream;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("Bu ortamda mikrofon erisimi yok."), { code: "MIC" });
  }

  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw Object.assign(new Error(micError(err)), { code: "MIC", cause: err });
  }

  // Sayaci SIFIRLAMIYORUZ: akis olduyse (kablo cikti) yeniden aciyoruz
  // ama diger kullanicilarin haklari duruyor. Sifirlamak, sonraki
  // birakmada hala kullanilan akisi kapatiyordu.
  streamUsers += 1;
  return sharedStream;
}

/** Akisi birakir; son kullanan kapatir. */
export function releaseStream() {
  streamUsers = Math.max(0, streamUsers - 1);
  if (streamUsers === 0 && sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
}

export function capturing() {
  return Boolean(node || workletNode);
}

/* --------------------------------------------------------------- teshis */

/**
 * Yakalamanin saglik bilgisi.
 *
 * "Ses gidiyor ama cevap yok" sikayetini tahminle degil OLCUMLE
 * ayirt etmek icin: parca geliyor mu, icinde gercekten ses var mi,
 * ornekleme hizi dogru mu?
 */
const health = {
  chunks: 0,
  peak: 0,
  lastChunkAt: 0,
  contextRate: null,
  resampled: false,
  // "worklet" = ses ayri is parcaciginda (iyi olan)
  // "islemci" = eski ScriptProcessor yolu (ana is parcaciginda)
  engine: null,
};

export function captureHealth() {
  return { ...health, capturing: Boolean(node || workletNode) };
}

/* ---------------------------------------------------------- ornekleme */

/**
 * Basit dogrusal yeniden ornekleme.
 *
 * AudioContext'ten 16 kHz istiyoruz ama bazi suruculer bunu vermiyor
 * ve baglam 44.1/48 kHz aciliyor. O durumda motora yanlis hizda ses
 * gonderiliyor ve Vosk hicbir sey tanimiyor — ses "geliyor" ama
 * anlasilmiyor. Hizi olcup gerekiyorsa kendimiz indiriyoruz.
 */
function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const oran = fromRate / toRate;
  const uzunluk = Math.floor(input.length / oran);
  const cikti = new Float32Array(uzunluk);
  for (let i = 0; i < uzunluk; i += 1) {
    const bas = Math.floor(i * oran);
    const son = Math.min(input.length, Math.floor((i + 1) * oran));
    // Aradaki ornekleri ortalayarak takma frekanslari azaltiyoruz.
    let toplam = 0;
    for (let j = bas; j < son; j += 1) toplam += input[j];
    cikti[i] = son > bas ? toplam / (son - bas) : input[bas] || 0;
  }
  return cikti;
}

/** Float (-1..1) → 16-bit tamsayi. */
function toPcm16(input) {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const v = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm;
}

/**
 * Kurulumun artiklarini temizler.
 *
 * Iki ayri yol (worklet ve ScriptProcessor) ve birkac hata dali var;
 * temizligi tek yerde toplamak, "yarim kalan kurulum akisi iki kez
 * biraktiriyor" hatasinin tekrarini onluyor.
 */
function temizle() {
  onChunk = null;
  try {
    workletNode?.disconnect();
    node?.disconnect();
    source?.disconnect();
  } catch {
    /* onemsiz */
  }
  if (workletNode) workletNode.port.onmessage = null;
  ctx?.close().catch(() => {});
  if (blobAdresi) {
    URL.revokeObjectURL(blobAdresi);
    blobAdresi = null;
  }
  workletNode = null;
  node = null;
  source = null;
  ctx = null;
}

/* ------------------------------------------------- ses is parcacigi --
 *
 * NEDEN BU GEREKLI.
 *
 * ScriptProcessorNode'un geri cagrisi ANA IS PARCACIGINDA calisiyor —
 * reaktor animasyonu, dalga tuvali ve arayuzun geri kalaniyla ayni
 * yerde. Ana is parcacigi tikandiginda ses geri cagrisi gecikiyor ya da
 * atlaniyor. Sonucu iki ayri sikayet olarak goruluyordu:
 *
 *   - Tanima "her seferinde cok yanlis": Vosk'a kopuk kopuk ses
 *     gidiyor. Eksik parcalarla dogru tanima mumkun degil.
 *   - DRA konusurken ses uzuyordu ("orrrrrneeekkk"): ses grafigi ana is
 *     parcacigini bekliyor, yetisemeyince ornekler tekrarlaniyor.
 *
 * AudioWorklet ayri bir SES IS PARCACIGINDA calisiyor. Ornek alma,
 * hiz dusurme ve tamsayiya cevirme orada yapiliyor; ana is parcacigina
 * yalnizca hazir parca geliyor. Animasyon ne kadar agir olursa olsun
 * ses artik etkilenmiyor.
 *
 * Modul BLOB adresinden yukleniyor: uygulama file:// uzerinden
 * calistigi icin ayri bir dosyayi yuklemek engelleniyor, blob adresi
 * ise ayni kokene sayiliyor.
 */
const WORKLET_KAYNAK = `
class DraYakalayici extends AudioWorkletProcessor {
  constructor(secenekler) {
    super();
    const o = secenekler.processorOptions;
    this.hedefHiz = o.hedefHiz;
    this.parcaBoyu = o.parcaBoyu;
    this.biriken = [];
    this.birikenUzunluk = 0;
  }

  /** Basit ortalamali hiz dusurme (takma frekanslari azaltir). */
  indir(girdi) {
    const oran = sampleRate / this.hedefHiz;
    if (oran === 1) return girdi;
    const uzunluk = Math.floor(girdi.length / oran);
    const cikti = new Float32Array(uzunluk);
    for (let i = 0; i < uzunluk; i += 1) {
      const bas = Math.floor(i * oran);
      const son = Math.min(girdi.length, Math.floor((i + 1) * oran));
      let toplam = 0;
      for (let j = bas; j < son; j += 1) toplam += girdi[j];
      cikti[i] = son > bas ? toplam / (son - bas) : girdi[bas] || 0;
    }
    return cikti;
  }

  process(girisler) {
    const kanal = girisler[0] && girisler[0][0];
    if (!kanal) return true;

    // Giris tamponu her karede YENIDEN KULLANILIYOR; kopyalamak sart.
    this.biriken.push(new Float32Array(kanal));
    this.birikenUzunluk += kanal.length;
    if (this.birikenUzunluk < this.parcaBoyu) return true;

    const hepsi = new Float32Array(this.birikenUzunluk);
    let yer = 0;
    for (const p of this.biriken) { hepsi.set(p, yer); yer += p.length; }
    this.biriken = [];
    this.birikenUzunluk = 0;

    const indirilmis = this.indir(hepsi);

    let tepe = 0;
    const pcm = new Int16Array(indirilmis.length);
    for (let i = 0; i < indirilmis.length; i += 1) {
      const v = Math.max(-1, Math.min(1, indirilmis[i]));
      const m = v < 0 ? -v : v;
      if (m > tepe) tepe = m;
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }

    // Tamponu TASIYARAK gonderiyoruz: kopyalanmiyor.
    this.port.postMessage({ pcm, tepe, hiz: sampleRate }, [pcm.buffer]);
    return true;
  }
}
registerProcessor("dra-yakalayici", DraYakalayici);
`;

let workletNode = null;
let blobAdresi = null;

async function buildWorklet(stream, handler) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || typeof AudioWorkletNode !== "function") {
    throw new Error("AudioWorklet yok");
  }

  try {
    ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
  } catch {
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  if (!ctx.audioWorklet) throw new Error("audioWorklet yok");

  blobAdresi = URL.createObjectURL(new Blob([WORKLET_KAYNAK], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(blobAdresi);

  health.chunks = 0;
  health.peak = 0;
  health.lastChunkAt = 0;
  health.contextRate = ctx.sampleRate;
  health.resampled = ctx.sampleRate !== SAMPLE_RATE;
  health.engine = "worklet";

  onChunk = handler;
  source = ctx.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(ctx, "dra-yakalayici", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { hedefHiz: SAMPLE_RATE, parcaBoyu: CHUNK },
  });

  workletNode.port.onmessage = (olay) => {
    if (!onChunk) return;
    const { pcm, tepe } = olay.data;
    health.chunks += 1;
    health.lastChunkAt = Date.now();
    if (tepe > health.peak) health.peak = tepe;
    onChunk(pcm);
  };

  source.connect(workletNode);
  /*
   * Cikisa BAGLAMIYORUZ. ScriptProcessor'un calismasi icin bir cikisa
   * baglanmasi gerekiyordu; worklet'in gerekmiyor. Baglamamak sesin
   * hoparlorden donmesi riskini tamamen ortadan kaldiriyor.
   */
  return true;
}

/**
 * Yakalamayi baslatir. Her hazir parca icin `handler(Int16Array)` cagrilir.
 */
export async function startCapture(handler) {
  if (node || workletNode) return true;

  const stream = await acquireStream();

  // Bu noktadan sonraki her hata akisi BIRAKMALI; yoksa mikrofon
  // sonsuza kadar acik kalir (node null oldugu icin kimse kapatmaz).
  try {
    /*
     * ONCE WORKLET: ses isini ana is parcacigindan cikariyor.
     * Kurulamazsa (eski tarayici, blob engeli) eski yola duşuyoruz —
     * kotu tanima, hic tanimamaktan iyidir.
     */
    try {
      return await buildWorklet(stream, handler);
    } catch (workletHatasi) {
      console.warn("[dra] AudioWorklet kurulamadi, eski yola dusuluyor:", workletHatasi.message);
      temizle();
      return await buildGraph(stream, handler);
    }
  } catch (err) {
    /*
     * Yarida kalan kurulumun artiklarini da temizliyoruz.
     *
     * Kurulum once `ctx` atiyor, sonra dugumleri kuruyor. Arada bir
     * hata olursa `node` bos ama `ctx` dolu kaliyordu. stopCapture
     * "ctx varsa calis" diyor, yani sonradan cagrildiginda akisi BIR
     * KEZ DAHA birakiyor. Sayac erken sifira dusuyor ve seviye
     * gostergesinin hala kullandigi mikrofon kapaniyordu.
     */
    temizle();
    releaseStream();
    throw err;
  }
}

async function buildGraph(stream, handler) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  // 16 kHz istiyoruz; surucu vermezse asagida kendimiz indiriyoruz.
  try {
    ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
  } catch {
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  health.chunks = 0;
  health.peak = 0;
  health.lastChunkAt = 0;
  health.contextRate = ctx.sampleRate;
  health.resampled = ctx.sampleRate !== SAMPLE_RATE;
  health.engine = "islemci";

  onChunk = handler;
  source = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(CHUNK, 1, 1);

  node.onaudioprocess = (event) => {
    if (!onChunk) return;
    const input = event.inputBuffer.getChannelData(0);

    // Teshis: gercekten ses var mi?
    let tepe = 0;
    for (let i = 0; i < input.length; i += 1) {
      const m = Math.abs(input[i]);
      if (m > tepe) tepe = m;
    }
    health.chunks += 1;
    health.lastChunkAt = Date.now();
    if (tepe > health.peak) health.peak = tepe;

    const hizli = health.resampled
      ? downsample(input, ctx.sampleRate, SAMPLE_RATE)
      : input;
    onChunk(toPcm16(hizli));
  };

  source.connect(node);
  // ScriptProcessor'un calismasi icin bir cikisa baglanmasi gerekiyor.
  // Sessiz bir kazanc dugumu kullaniyoruz ki hoparlorden ses cikmasin.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(silent);
  silent.connect(ctx.destination);

  return true;
}

export function stopCapture() {
  /*
   * Yalnizca GERCEKTEN yakalama yapiyorsak birakiyoruz.
   *
   * Kosulsuz birakmak sayaci eksiye dusuruyordu: motor ust uste iki
   * hata verdiginde stopCapture iki kez cagriliyor, ikincisi seviye
   * gostergesinin hala kullandigi akisi kapatiyordu. Gosterge sifir
   * okumaya basliyor ve startMeter `if (analyser) return` ile erken
   * donduğu icin uygulama yeniden acilmadan duzelmiyordu.
   */
  if (!node && !ctx && !workletNode) return;

  temizle();
  releaseStream();
}
