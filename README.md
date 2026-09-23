# DRA

JARVIS tarzı, sesle uyanan Türkçe asistan. **Tamamen sizin cihazınızda çalışır.**

Mikrofon açıkken **"DRA"** dediğinizde uyanır ve holografik arayüzünü açar.
Sonrasında konuşarak ya da sağdaki sohbet kutusuna yazarak kullanırsınız —
ikisi de aynı şekilde çalışır. İşiniz bitince `uyu` deyin.

---

## Bu bir yapay zekâ değil

DRA bir dil modeli değil, komutlarla çalışan bir programdır. Bunun pratik
sonuçları var — ikisi de bilinçli tercih:

* **Varsayılan halinde hiçbir şirkete bağlanmaz.** Ne yapay zekâ servisi, ne
  analitik, ne yazı tipi CDN'i. Uygulamanın tamamı `localhost`'tan gelir.
  Bu, tarayıcıda her ağ isteği yakalanarak test edilir. İki özellik bunun
  istisnası ve **ikisi de varsayılan olarak kapalı**: web araması ve Kick
  moderasyonu. Açmadıkça hiçbir dış bağlantı kurulmaz.
* **Bilmediği şeyi uydurmaz.** Anlamadığı bir komut duyduğunda cevap
  üretmeye çalışmaz; en yakın komutu önerir ya da ne yapabildiğini söyler.

Bağımlılığı da yoktur — `npm install` gerekmez, `node_modules` yoktur.

## Kurulum

DRA iki şekilde çalışır: **masaüstü uygulaması** (önerilen) veya
tarayıcıda yerel sayfa. İkisi de aynı arayüzü, aynı komutları kullanır.

### Masaüstü uygulaması

```bash
npm install        # Electron'u indirir
npm start          # uygulamayı açar
```

Kurulabilir bir `.exe` üretmek için:

```bash
npm run paket:win  # dist/ altında DRA-Kurulum-3.0.0.exe
```

Uygulama açılırken **Ragnar Stüdyo** açılış ekranı görünür; ana pencere hazır
olunca yerini ona bırakır. Ana pencere bir sebeple yüklenemezse açılış ekranı
kilitli kalmaz — hem yükleme hatasında hem de zaman aşımında kapanır.

Uygulama sürümünde ek olarak: sistem tepsisi simgesi, **Alt+Space** ile her
yerden çağırma, açılışta başlatma, ve tek pencere garantisi. Kapatma düğmesi
uygulamayı sonlandırmaz — tepside beklemeye devam eder.

### Arka planda çalışma

Sistem sekmesindeki **arka planda dinle** anahtarı açıkken DRA, bilgisayar
açıldığında görünmez başlar: ne pencere ne açılış ekranı çıkar. Arayüz arka
planda çalışır, mikrofonu kendisi açar ve adını bekler. «DRA» dediğinizde
pencere kendini gösterir; uyuduğunda yine tepsiye iner ve dinlemeye devam
eder. Anahtar açıldığında *açılışta başlat* da kendiliğinden açılır — biri
olmadan diğeri anlamsız.

Bu mod açılışa `--gizli` argümanıyla girer; uygulamayı elle açtığınızda
pencere her zaman normal biçimde görünür.

Pencere gizliyken Chromium sayfayı normalde kısar — zamanlayıcılar dakikada
bire düşer, `requestAnimationFrame` tamamen durur. Bu, arka planda dinlemeyi
de tepsideki alarmları da işlevsiz bırakırdı; bu yüzden ana pencerede
`backgroundThrottling` kapalı. Testler bunu hem ayar hem de ölçülen gecikme
üzerinden doğruluyor.

**Uygulamada makineye erişim HTTP yerine doğrudan IPC ile yapılır.** Yani
dinlenecek bir port ve korunacak bir oturum jetonu yoktur; saldırı yüzeyi
tarayıcı sürümünden daha küçüktür. Arayüz Node'a erişemez (`contextIsolation`
açık, `nodeIntegration` kapalı); yalnızca `electron/preload.cjs` içinde
açıkça listelenen dar yüzeyi görür. Bu, testlerle doğrulanır.

### Tarayıcı sürümü

```bash
npm run web        # bağımlılık gerektirmez
```

Ardından **http://localhost:4173** adresini açın (Chrome veya Edge).

> **Sunucu neden var?**
> Tarayıcılar `file://` üzerinden mikrofona izin vermez; `localhost` güvenli
> bağlam sayılır. Sunucunun tek işi `web/` klasörünü servis etmek ve
> makineye erişim gerektiren işleri üstlenmek.

---

## Test

### Elle deneme

`npm start` deyip `http://localhost:4173` adresini açın. Mikrofon olmadan da
baştan sona kullanabilirsiniz:

1. Uyku ekranındaki kutuya **`saat kaç`** yazıp Enter'a basın → açılış dizisi
   oynar, HUD açılır, DRA saati söyler.
2. Sağdaki sohbet kutusuna sırayla deneyin:
   `12 kere 8 kaç eder` · `sabah yedi buçukta alarm kur` · `not al süt al` ·
   `alarmlarım` · `renk yeşil` · `sistem durumu` · `neler yapabilirsin`
3. Sol paneldeki dört sekmeyi gezin; Alarm'dan saat seçip **Kur**'a basın,
   Ayar'dan tema ve konuşma hızını değiştirin.
4. Anlamayacağı bir şey yazın (`blorp zonk`) → cevap uydurmadığını görün.
5. `uyu` yazın → uyku ekranına döner.

**Sesli denemek için** "Mikrofonu başlat"a basın. İlk seferde Türkçe dil
paketi indirilebilir (bir kerelik). Hazır olunca **"DRA"** deyin. Üst bardaki
rozetin `cihazda` yazdığını doğrulayın.

**Dışarıya bağlanmadığını görmek için:** F12 → Network sekmesi → sayfayı
yenileyin. Tüm istekler `localhost:4173`'e olmalı, başka hiçbir alan adı
görünmemeli.

### WhatsApp gibi doğru yazı: ElevenLabs ile tanıma

Cihazdaki model küçük; ne kadar ayarlanırsa ayarlansın "dra"yı "bira",
"uyan"ı "ayı" diye duyabiliyor. WhatsApp'ın ya da telefonların sesle
yazması çok büyük modellerle çalışıyor. Aynı kaliteye ulaşmak için
masaüstü sürümü **iki motoru birlikte** kullanıyor:

| | Ne yapar | Ses nereye gider |
|---|---|---|
| Cihazdaki model (Vosk) | Yalnızca **"DRA"**yı bekler | Hiçbir yere — cihazda kalır |
| ElevenLabs (Scribe) | DRA uyandıktan sonraki cümleleri yazıya çevirir | ElevenLabs'e, **cümle cümle** |

* **Uyurken hiçbir ses dışarı gitmez.** Yalnızca içinde "DRA" duyulan
  cümle gönderilir; "DRA, saat kaç?" tek nefeste söylenirse komut da
  doğru yazıyla çalışır.
* Ses sürekli akıtılmaz: **konuşma kesici** sesin enerjisinden cümlenin
  başını ve sonunu bulur, yalnızca konuşulan kısım gider. Oda gürültüsü
  (vantilatör, klima) birkaç saniyede ölçülüp eşik ona göre ayarlanır.
* DRA konuşurken ya da bir işle meşgulken cümle gönderilmez (kota boşa
  gitmez).
* **İnternet koparsa ya da kota biterse DRA susmaz**: sebebini sohbete
  yazar ve bir süre cihazdaki modelle devam eder (ağ hatasında yarım
  dakika, anahtar/izin/kota sorununda 10 dakika).

**Ayar:** Ayar → *Yazıya çeviren* → **ElevenLabs** (varsayılan). Anahtar,
seslendirmede kullanılanla aynı. Yeni ElevenLabs anahtarları izin
kapsamıyla oluşturuluyor; anahtarın **"Speech to Text"** izni açık
olmalı (elevenlabs.io → API Keys). *ElevenLabs bağlantısını sına*
yarım saniyelik sessizlik gönderip anahtarı ve izni doğrular.

Anahtar yoksa ya da *Cihazdaki model* seçiliyse her şey eskisi gibi
cihazda kalır.

**Teşhis:** *Ne duyuyorsun? (30 sn)* artık iki motorun sonucunu yan yana
yazar (`duydum (cihaz) → …` / `duydum (ElevenLabs) → …`). *Ses tanımayı
sına* ise buluta giden cümle sayısını, son cevap süresini ve son hatayı
gösterir.

### Komut kipi — doğru tanımanın anahtarı

Gömülü model (`vosk-model-small-tr-0.3`) yaklaşık 45 MB. Serbest
konuşmada Türkçe başarımı sınırlı: **"dra" derken "bira" duyabiliyor.**
Sebep, modelin Türkçedeki *bütün* sözcükler arasından seçim yapması.

**Komut kipi** açıkken motora "yalnızca şu sözcükleri duyabilirsin"
deniyor. Liste **komut tablosundan üretiliyor** — elle tutulan ikinci
bir liste olsaydı kurallar değiştikçe sessizce eskirdi. İçinde
uyandırma sözcükleri, bütün komut ifadeleri, sayılar ve günlük
bağlayıcılar var (~760 sözcük). "bira" listede olmadığı için model onu
artık üretemiyor.

Karşılığı: serbest soru sormak zorlaşır. Araştırma sorusu soracaksanız
Ayar sekmesinden kapatın — ya da yazarak sorun.

Varsayılan **açık**, çünkü asıl şikâyet yanlış anlama.

**Uzun uyandırma sözü.** "dra" tek heceye yakın ve tanıma için en zor
durum. **"hey dra"** ve **"dra uyan"** de — iki sözcüklü kalıp çok daha
sağlam tanınıyor. Gerçek asistanların "Hey Google", "Alexa" gibi uzun
uyandırma sözleri kullanmasının sebebi tam olarak bu. Kısa biçim de
çalışmaya devam ediyor.

### Ses ayrı bir iş parçacığında

Ses yakalama **AudioWorklet** ile ayrı bir ses iş parçacığında çalışır.
Örnek alma, hız düşürme ve tamsayıya çevirme orada yapılır; ana iş
parçacığına yalnızca hazır parça gelir.

Neden önemli: eski yol (`ScriptProcessorNode`) ana iş parçacığında
çalışıyordu — reaktör animasyonu ve dalga tuvaliyle aynı yerde. Ana iş
parçacığı tıkandığında ses parçaları gecikiyor ya da atlanıyordu ve bu
iki ayrı şikâyet olarak görünüyordu:

* Tanıma "her seferinde çok yanlış" — motora kopuk kopuk ses gidiyor
* DRA konuşurken sesi uzuyor — "örrrrrneeekkk"

Worklet modülü **blob adresinden** yüklenir: uygulama `file://`
üzerinden çalıştığı için ayrı bir dosya yüklemesi engellenir, blob
adresi ise aynı kökene sayılır. Worklet kurulamazsa eski yola düşülür ve
teşhis ekranı bunu açıkça yazar.

Ayar → **"Ses tanımasını sına"** satırında `Ses yolu: ayrı iş
parçacığında (iyi)` yazmalı.

### Türkçe harfli kullanıcı adı

Windows kullanıcı adınızda Türkçe harf varsa (`msı`, `Şükrü`, `Gökçe`…)
ses modeli **kullanıcı adı geçmeyen** bir klasöre kurulur:
`C:\ProgramData\DRA\ses-modeli`.

Sebebi: ses motorunun C arayüzü model yolunu dar (ANSI) metin olarak
alıyor. `ı` harfi UTF-8'de iki bayt ve Windows onu Türkçe kod sayfasıyla
okuyunca yol bozuluyor. Dosyalar yerinde duruyor ama motor klasörü
bulamıyor — ve hata mesajı bunu söylemiyor, "klasörde model yok" diyor.

Daha önce kurulmuş bir model eski konumdaysa **kendiliğinden taşınır**;
aynı diskte olduğu için anında biter ve 45 MB yeniden inmez. Taşıma
başarısız olursa hiçbir şey bozulmaz: model eski yerinde kalır ve
Windows'un ASCII kısa adı (`MSI~1`) denenir.

ASCII bir kullanıcı adınız varsa hiçbir şey değişmez.

### Otomatik testler

```bash
npm install                    # Electron + Playwright
npx playwright install chromium
npm test                       # hızlı testler, ~9 dk
npm run test:tam               # alarmın gerçekten çalmasını da bekler, +2.5 dk
```

`npm test` sunucuyu kendi başlatır, tarayıcıyı açar ve **1095 doğrulama**
çalıştırır:

* **Kod taraması** — kodu çalıştırmadan okur. Hiçbir yerde tanımlanmamış
  değişken, aynı nesnede tekrar eden anahtar, `new Promise(async …)` kalıbı
  ve IPC yüzeyinin iki yakası (ana süreç ↔ köprü) arasında kayma var mı?
  Bu paket, mikrofonun uzun süre açılmamasına sebep olan hatayı (tanımsız
  bir `HERE` değişkeni) yakaladığı için var
* **Kalıcı depo** — diske yazma yarıda kesilirse veri kaybı olur mu? Yazma
  sürerken sürekli okunuyor; her okuma ya "dosya yok" ya da tam ve geçerli
  JSON görmeli
* **Komut motoru** — Türkçe saat çözümleyici (11 vaka), matematik, komut
  eşleşmesi, komut önerisi, zamanlayıcı/alarm ayrımı ve yan etkili
  komutlardan sonra komut hattının açık kaldığı
* **Komut yönlendirme** — 152 farklı yazılışın doğru kurala gittiği
  (yazım hatası, boşluk, Türkçe ek ve eş anlamlı ifadeler dahil). Koşullu
  kurallar da ayrıca sınanıyor: yayıncı kipi açıkken "sesi sustur"
  bilgisayarın sesini kısmalı, "ahmeti 10 dakika sustur" moderasyon
  komutuna gitmeli; kapalıyken ikisi de devreye girmemeli
* **Arayüz** — uyandırma kelimesi (yanlış tetiklenme dahil), sohbet paneli,
  dört sekme, not/alarm ekleme-silme, ayarlar, kalıcılık, sıfırlama, dar
  ekran yerleşimi ve **localhost dışına hiçbir istek atılmadığı**. Ayrıca
  karttaki bağların adres süzgeci (`javascript:` ile başlayan bir arama
  sonucu tıklanabilir olmamalı) ve ayarlar kaydedilemediğinde sessiz
  kalınmadığı
* **Sunucu yetenekleri** — güvenlik koruması (jetonsuz, yabancı kökenli,
  çapraz site ve form istekleri reddediliyor mu), listede olmayan uygulamanın
  başlatılamadığı, kapalı özelliklerin gerçekten kapalı olduğu ve yeni
  komutların doğru yönlendirildiği
* **Kick moderasyonu** — ağ katmanı taklit edilerek köprünün tamamı: doğru uç,
  doğru gövde, jetonun `Authorization` başlığına konması, süre çevrimi,
  401/403 hatalarının anlaşılır Türkçeye çevrilmesi, jetonsuzken hiç istek
  atılmaması
* **Masaüstü uygulaması** — açılış ekranı görünüp kapanıyor mu, Electron
  açılıyor mu, IPC çalışıyor mu, Node arayüze sızmıyor mu, köprü yalnızca
  beklenen yüzeyi mi açıyor, beyaz liste geçerli mi, gömülü motor model
  olmadan düzgün hata veriyor mu, **motordan gelen metin komuta dönüşüyor mu**,
  mikrofon kapalıyken gelen artık sonuçlar yok sayılıyor mu, model
  yerindeyken `stt.start()` gerçekten sonuçlanıyor mu (asılı kalmıyor ve
  programlama hatası vermiyor), ve **pencere kendi adresinden ayrılamıyor mu**
* **Alarm (yavaş)** — bir sonraki dakikaya alarm kurup gerçekten çalmasını,
  DRA'yı uykudan uyandırmasını ve kendini kapatmasını bekler

Tek bir paketi çalıştırmak için: `node test/run.mjs --sadece arayuz`

Kendi Chromium'unuzu kullanmak isterseniz `PLAYWRIGHT_CHROMIUM_PATH` ortam
değişkenini ayarlayın.

---

## Fare ve klavye olmadan bilgisayar kontrolü

**"DRA sesi aç"**, **"ileri sar"**, **"youtube'de kara murat aç"**,
**"spotify'den jazz aç"**, **"ekranı kilitle"** — hepsi sesle.

| Ne dersiniz | Ne olur |
|---|---|
| sesi aç / kıs / sustur | Sistem sesi. "biraz" küçük adım, "çok" büyük adım |
| duraklat · oynat · sonraki şarkı | Hangi uygulama çalıyorsa ona gider |
| ileri sar / geri sar | 10 saniye (sayı söylerseniz o kadar) |
| youtube'de ... aç | Arar, **hangi videoyu açtığını söyler**, açar |
| müzik aç · spotify'den ... aç | YouTube Music, Spotify, SoundCloud, YouTube |
| ekranı kilitle | Windows kilit ekranı |
| parlaklığı yüzde 50 yap | Dizüstü ekranlarda çalışır |

**Ses ve medya için sanal tuşlar kullanılıyor.** Sebebi: Windows bu tuşları o an
sesi çalan uygulamaya yönlendiriyor — Spotify, tarayıcı, oyun, hangisiyse.
Uygulamaya özel kod yazmak gerekmiyor.

**İleri sarma** farklı: sanal medya tuşlarında ileri/geri sarma yok. Onun için
DRA tarayıcı penceresini öne getirip YouTube'un kendi kısayolunu gönderiyor
(`l` = +10sn, `j` = −10sn).

### Serbest komut çalıştırılmıyor

"Bilgisayardaki her şeye erişebilsin" demek, DRA'nın duyduğu her kelimeyi komut
satırına yazması demek **değil**. Yanlış duyulan tek bir kelime geri alınamaz
bir şey yapabilir.

Onun yerine **isimli işlemler** var: her biri `server/control.mjs` içinde
yazılı, ne yaptığı belli ve sınanabilir. Yeni bir yetenek eklemek oraya bir
kayıt eklemek demek. Adres açmada da yalnızca `http`/`https` kabul ediliyor —
`file:` ile dosya, `cmd.exe` ile program açılamıyor.

### Oyun oynarken öne çıkmaz

Oyundayken DRA'nın penceresi öne gelirse oyun küçülür ve bozulur. Bu yüzden
uyandırıldığında önce **ön plandaki pencereye bakıyor**: ekranın tamamını
kaplayan bir uygulama varsa görünmez kalıyor ve yalnızca **sesle** cevap
veriyor. Kenarlıksız tam ekran da tanınıyor (birkaç piksel tolerans var).

## Web araştırması — her zaman açık, çok kaynaklı

Tek kaynağa bağlı kalmak kırılgan: DuckDuckGo'nun HTML ucu tarayıcı olmayan
isteklere sık sık **403** veriyor ve araştırma tamamen çalışmaz hale geliyordu.
Artık kaynaklar sırayla deneniyor, ilk cevap veren kazanıyor:

0. **Google** — yalnızca kendi anahtarınızı girerseniz (aşağıda)
1. **Wikipedia** — olgusal sorular için; özet, görsel ve bağlantı verir
2. **DuckDuckGo anlık cevap** — kısa tanımlar, hesaplamalar
3. **DuckDuckGo sonuç sayfası** — en geniş kapsam (tarayıcı başlıklarıyla)
4. **DuckDuckGo lite** — aynı motorun sade sayfası; HTML ucu 403 verdiğinde
   genelde bu geçer

### Google araması (isteğe bağlı)

Google'ın arama **sayfası** otomatik isteklere kapalı — kazımaya çalışan her
istek er ya da geç CAPTCHA veya 403 alır. Resmî yol **Programmable Search
JSON API** ve kendi anahtarınızı ister.

Anahtar girmezseniz hiçbir şey değişmez: DRA Wikipedia ve DuckDuckGo ile
araştırmaya devam eder. Girerseniz iki şey belirgin biçimde iyileşir:

* **Türkçe sonuçlar ve güncel bilgi** — DuckDuckGo'nun Türkçe kapsamı zayıf
* **Gerçek görseller** — şu ana kadar sahnede kaynak sayfaların önizleme
  görselleri (`og:image`) kullanılıyordu; çoğu zaman sitenin logosu ya da
  alakasız bir kapak çıkıyor. Görsel araması konunun kendisini getiriyor

Nasıl alınır:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   → yeni bir **API anahtarı** oluşturun, "Custom Search API"yi etkinleştirin
2. [Programmable Search Engine](https://programmablesearchengine.google.com/)
   → yeni bir arama motoru oluşturun, **"tüm web'i ara"** seçin
3. Oradaki **Arama motoru kimliği (cx)** ile anahtarı Modlar sekmesine girin
4. **"Kaydet ve sına"** — gerçek bir sorgu atıp sonucu yazar

> **Günde 100 sorgu ücretsiz.** Aşılırsa Google para almadan **durur**;
> sessizce faturaya dönüşmez. Kota dolduğunda DRA susmaz, zincirdeki diğer
> kaynaklardan devam eder ve ne olduğunu söyler.
>
> Görsel araması **ayrı bir sorgu** sayılır, bu yüzden yalnızca gerçekten
> görsel gösterilecekse yapılıyor — boşuna kota harcanmıyor.
>
> Anahtar yalnızca bu bilgisayarda kalır ve arka tarafta **diske yazılmaz**;
> her açılışta arayüzden bildirilir. Sağlık bilgisinde anahtarın kendisi
> değil, yalnızca var olup olmadığı taşınır.

Hangi kaynağın cevapladığı kartta yazıyor. Hiçbirine ulaşılamazsa **hangisinin
neden başarısız olduğu** tek tek gösteriliyor — "araştırmıyor" demek yerine
sebebi görürsünüz.

Wikipedia her sorguyu kapmıyor: güncel bilgi isteyen sorular ("bugün hava
nasıl", "dolar kaç TL") ansiklopediye gitmez, ayrıca dönen başlığın sorguyla
gerçekten örtüşmesi aranır.



Artık açma/kapama yok. DRA bilmediği bir soruyu uydurmak yerine araştırıyor ve
sonucu **görsellerle ve kaynak bağlantılarıyla** gösteriyor: özet, kaynak
sayfaların önizleme görselleri, ve tıklanabilir bağlantılar. Bilginin nereden
geldiği görünür olmalı — kendi doğrulamanızı yapabilesiniz.

Kendiliğinden dolaşmaz: yalnızca siz bir şey sorduğunuzda arar.

### Her soru aynı cevabı hak etmiyor

DRA sorunun **ne tür bir cevap istediğini** ayırt ediyor:

| Soru | Ne yapıyor |
|---|---|
| "iphone 15 en ucuz hangi sitede" | Sorguya "fiyat" ekler, daha çok sonuç ister, snippet'lerden **TL tutarlarını okuyup ucuzdan pahalıya sıralar** |
| "mercimek çorbası tarifi" | Daha çok kaynak getirir; tek özet bu tür soruya yetmiyor |
| "minecraft redstone nasıl çalışır" | Aynı şekilde geniş kaynak |
| "eyfel kulesi kaç metre" | Klasik özet + kaynaklar |

Fiyat listesinde en ucuz olan işaretli ve **her satır kaynağına gidiyor** —
fiyat arama sonucundan okunduğu için siteye girince değişmiş olabilir,
kart bunu açıkça yazıyor.

Türkçe fiyat yazımı okunuyor: `1.299,00 TL`, `₺1.299`, `12.345,67 ₺`.
Bir sonuçta birden fazla tutar geçiyorsa (indirimli/eski fiyat) **en
düşüğü** alınıyor — sorulan şey "en uygun".

> **Neden daha fazlası değil:** DRA'nın içinde bir dil modeli yok. Tarifi
> ya da oyun adımlarını kendi cümleleriyle yazamaz; kaynakları bulur,
> özeti ve bağlantıları verir. Adımları sitenin kendisinden okursunuz.

### Anlatırken ortadaki ekran

Bir soru sorduğunuzda DRA cevabı **söylerken** ortadaki bölüm sahneye
dönüşüyor: konuyla ilgili görseller, kısa özet ve kaynak adları orada
beliriyor. Konuşma bitince sahne kapanıyor ve reaktör geri geliyor.

**Sohbet ve ayar panelleri hiç kaybolmuyor** — değişen yalnızca ortadaki
alan. Sağdaki sohbete düşen kart ise kalıcı: kaynak bağlantılarına
sonradan da tıklayabilirsiniz.

Görseller kaynak sayfaların kendi önizleme görselleri (`og:image`) ve
Wikipedia küçük resimleri. Adresler karttakiyle aynı süzgeçten geçiyor:
yalnızca mutlak `http`/`https` sahneye giriyor.

> Ses kapalıysa sahne, metnin okunacağı kadar süre ekranda kalıp
> kapanıyor — açılır açılmaz kaybolmasın diye.

## Modlar — sesli anahtarlar

Her mod bir anahtar gibi çalışır. **Modlar** sekmesinin en üstünde her
mod için bir kutu var; oraya kendi sözcüğünüzü yazın (ör. web için
«internet»). Sonra:

| Söylediğiniz / yazdığınız | Ne olur |
|---|---|
| `internet` | Web araştırması açıksa kapanır, kapalıysa açılır |
| `internet aç` / `internet kapat` | Açar / kapatır |
| `web modunu kapat`, `e-posta modunu aç` | Anahtar koymadan da çalışır |

* Anahtar **cümlenin tamamı** olmalı: «internette kedi ara» web modunu
  kapatmaz, «youtube aç» YouTube modunu değil YouTube'u açar.
* Bir komutla çakışan sözcük («saat kaç» gibi) ve başka bir modun
  anahtarı kabul edilmez; çakışsaydı o komut bir daha çalışmazdı.
* Anahtarlar cihazdaki ses motorunun sözlüğüne de eklenir.

### Eksik bilgiyi DRA sohbette ister

Bir mod açıldığında çalışmak için bilgi gerekiyorsa (Kick jetonu,
YouTube istemci bilgileri, işletme adı, Gmail) ve bu bilgi girilmemişse
DRA **sohbette tek tek sorar**:

* Yazdığınız değer **sohbete hiç yazılmaz**; yerine
  `🔒 Kick erişim jetonu kaydedildi — sohbetten silindi` satırı düşer.
  Değer bu bilgisayarda, diğer ayarların yanında saklanır.
* Şifre/jeton sorulurken yazı kutusu gizli moda geçer (yazarken de
  görünmez).
* Bilgi beklenirken **sesle** söylenen hiçbir şey kaydedilmez ve sohbete
  yazılmaz; DRA yazarak girmenizi ister. (Sesle söylenen şifre hem odada
  duyulur hem de yazıya çeviren servise gider.)
* Biçimi yanlış değer (16 harf olmayan uygulama şifresi, e-posta olmayan
  adres) ağa gitmeden reddedilir. «iptal» ya da «vazgeç» her an durdurur;
  DRA uyuyunca da yarım kalan soru iptal olur.

### Gmail: tek giriş

Gmail hesabı artık **tek bir giriş**: e-posta raporu da işletme
modundaki Gmail kaynağı da aynı hesabı kullanır. Modlar → **Gmail
hesabı** bölümünden giriş yapılır, **Çıkış yap / hesabı değiştir** ile
değiştirilir. Giriş sırasında DRA gerçekten bağlanıp sınar; uygulama
şifresi yanlışsa şifreyi saklamaz ve bir kez daha sorar. Önceden işletme
modunda ayrı girilmiş bir Gmail varsa ortak hesaba kendiliğinden taşınır.

## Erişim izinleri

DRA'nın bilgisayara ve hesaplara erişimi genişledikçe "her şeye erişebilir"
demek yeterli değil. Her yetki **ayrı ayrı** verilir, **sorularak** verilir ve
**tek tıkla geri alınır.**

Nasıl çalışıyor:

0. **İlk açılışta** bütün yetkiler tek ekranda gösterilir; istediklerinizi orada
   açarsınız. Hiçbiri önceden seçili değil — toplu bir "hepsine izin ver"
   düğmesi okumadan tıklamayı teşvik eder.
1. İlk ekranda vermediğiniz bir yetkiye ihtiyaç duyduğunda DRA **o anda** sorar
   — peşin peşin yetki dağıtmanız gerekmez. "Rapor ver" dediğinizde ekrana ne isteyeceğini ve ne
   yapacağını yazan bir soru gelir.
2. **Hayır** derseniz iş yapılmaz. **Evet** derseniz yetki kaydedilir ve iş
   kaldığı yerden tamamlanır.
3. Sesle de cevap verebilirsiniz: «evet» / «hayır». Soru ekrandayken
   yazdığınız "evet" komut sayılmaz, cevap sayılır.
4. **Modlar** sekmesinde verdiğiniz her yetki, ne zaman verildiğiyle birlikte
   listelenir. Tek tek ya da hep birden geri alınır.

**İzni arayüz vermez, arka taraf verir.** Yetki denetimi işin yapıldığı yerde
(uygulamada ana süreç, tarayıcıda yerel sunucu) yapılır. Arayüzün "izin
verildi" demesi yetmez — kullanıcının onayı oraya yazılmış olmalı. Yani
arayüzde bir açık olsa bile izinsiz iş yapılamaz. Bu, testlerle doğrulanıyor:
izin yokken rapor **üretilmiyor**, yalnızca soru çıkmıyor.

İzinler `data/permissions.json` dosyasında durur (depoya girmez). Her açılışta
yeniden sorulmaması için diske yazılır.

| Yetki | Ne yapar |
|---|---|
| Bilgisayar durumu | İşletim sistemi, disk, bellek, çalışma süresi, Windows güncellemeleri — yalnızca okur |
| Bilgisayarı kontrol etme | Ses, medya, ileri sarma, adres açma, ekran kilidi — yalnızca isimli işlemler |
| Dosyaları okuma | İzin verdiğiniz klasörlerdeki dosyaları okur; silmez, değiştirmez |
| E-posta okuma | Gelen kutusunu okur, reklam/bülten ayıklar; mesaj göndermez |
| YouTube kanalı | Kanal istatistiği okur; **sıraya koyduğunuz** videoları verdiğiniz saatte yükler |
| Video montajı | Gösterdiğiniz klasördeki videoları okur, projenizden üslup çıkarır, yeni video üretir |
| İşletme verileri | Seçtiğiniz kaynaklardan müşteri mesajlarını okur ve bu bilgisayarda tutar |

### "Rapor ver" — tek komut, üç rapor

**"DRA rapor ver"** dediğinizde sırayla şunlar gelir:

1. **Bilgisayarın durumu** — her zaman
2. **Gmail gelen kutusu** — e-posta modu açık ve hesap tanımlıysa
3. **WhatsApp / müşteri mesajları** — işletme modu açıksa

Bağlı olmayan bölüm **sessizce atlanır.** Gmail kurulu değilken her
"rapor ver"de "Gmail kurulu değil" duymak istenmez; kurulumu zaten
Modlar sekmesinde görüyorsunuz. Bir kaynak hata verirse yalnızca o
bölüm düşer, rapor geri kalanıyla devam eder.

Sözlü özet üçünü tek cümlede toplar.

#### Gelen kutusu görünümü

Gmail ve WhatsApp bölümleri basit bir **posta kutusu görseli** olarak
geliyor: üstte hesap adı ve toplam okunmamış sayısı, altında iki grup —
**yeni gelen okunmamışlar** (son 24 saat) ve **okunmamış diğerleri**.
Her satırda gönderen kalın, konusu ince, sağda saat.

Okunmamışlar ayrı bir `UID SEARCH UNSEEN` sorgusuyla geliyor: okunmamış
bir mesaj tarih penceresinden daha eski olabilir ve "okunmamış
diğerleri" tam olarak onlar. Okunmuş mesajlar kutuda görünmez — iş
bitmiş demektir.

### Bilgisayar raporu

İzin verdikten sonra sohbete görsel bir rapor kartı düşer: işletim sistemi, bellek ve disk doluluk çubukları, ne kadar süre açık
kaldığı, **son yüklenen Windows güncellemesi** ve **bekleyen güncelleme sayısı**
(varsa ilk sekizinin adı). DRA ayrıca sözlü bir özet verir.

Kart hareketli bir GIF değil, **canlı çizilen** bir kart: aynı sunum etkisini
verir ama veriler gerçek, metin seçilebilir ve ekran okuyucu okuyabilir. Doluluk
çubukları kart ekrana girerken dolar.

Güncelleme bilgisi Windows'a özel (PowerShell ile okunuyor, yönetici yetkisi
gerekmez). Başka bir işletim sisteminde o bölüm "yalnızca Windows'ta okunuyor"
der — uydurma bir değer göstermez. Bir parça okunamazsa rapor o alan eksik
gelir; hiç rapor gelmemesinden iyidir.

### E-posta raporu

**"DRA mail var mı"** deyin. DRA gelen kutunuzu okur, reklam ve bültenleri
ayıklar, işe yarar olanları öne çıkarır ve sohbete görsel bir kart basar:

* **Sponsor / işbirliği** ve **iş / görüşme** mesajları tek tek listelenir
* **Kişisel** mesajlar (gerçek bir insandan gelenler) ayrıca gösterilir
* Kaç reklam, kaç bülten, kaç otomatik bildirim ayıkladığını söyler

Sözlü özet yalnızca işe yarar kısmı okur: "Son 2 günde 34 mesaj geldi.
Dikkatinizi çekecekler: 1 sponsor teklifi, 2 iş mesajı. 28 tanesini ayıkladım."

**Nasıl ayırıyor — yapay zekâ yok.** Kurallar açık ve denetlenebilir. En
güvenilir işaret başlıklarda: toplu gönderilen her posta `List-Unsubscribe` ya
da `Precedence: bulk` taşır. Bu tahmin değil, **gönderenin kendi beyanı** —
bülten/reklam ayrımı buradan çıkıyor. Üstüne konu satırı kuralları biniyor
(indirim/kampanya → reklam, mülakat/görüşme → iş, sponsor/işbirliği → sponsor).
Sponsor teklifi toplu gönderilse bile önemli sayılır, çünkü öyledir.

**Kurulum — OAuth yok.** Google Cloud'da proje açmanız gerekmiyor. DRA IMAP
ile bağlanır ve sizden tek bir şey ister: bir **uygulama şifresi.**

1. Google Hesabı → Güvenlik → **İki adımlı doğrulama** açık olmalı
2. Aynı sayfada **Uygulama şifreleri** → yeni bir tane oluşturun
3. Modlar sekmesinde **E-posta raporu**'nu açın, adresinizi ve o 16 haneli
   şifreyi girin → **Bağlantıyı sına**

Gmail şifreniz hiçbir yere girilmez. Uygulama şifresi bu bilgisayarda kalır,
istek DRA'nın kendi sürecinden gider.

**Mesaj gövdesi hiç indirilmez.** DRA yalnızca başlıkları ister
(`BODY.PEEK[HEADER.FIELDS ...]`) — gönderen, konu, tarih ve sınıflama için
gereken üç başlık. Raporu üretmek için gövde gerekmiyor, indirmemek de en iyi
gizlilik kararı. Bu testle doğrulanıyor: istekler arasında `BODY[]` ya da
`RFC822` geçmiyor.

Bağımlılık eklenmedi: IMAP satır tabanlı bir protokol, `node:tls` yetiyor.
Sadece gereken kısmı var — giriş, kutu seçme, arama, başlık çekme.

> Not: Geliştirme ortamında Gmail hesabı ve dışarı çıkış yok. Protokol,
> gerçekten konuşan bir **sahte IMAP sunucusuna** karşı sınandı (36 test:
> literal blok okuma, Türkçe başlık çözme, sınıflama kuralları) — canlı
> doğrulanmadı. İlk kullanımda "Bağlantıyı sına" ile doğrulayın.

### Video montajı

**"DRA montajı başlat"** deyin ya da Modlar → **Video montajı**. DRA klasördeki
klipleri kesip birleştirir, başlık kartı ekler, isterseniz fon müziği bindirir
ve yeni bir dosya üretir. **Kaynak dosyalarınıza dokunmaz.**

**Üslubu kendi projenizden öğrenir.** Kesim uzunluğunu tahmin etmesine gerek
yok — eski montaj projenizi verirsiniz, DRA onu okur ve *ölçer*: ortalama ve
ortanca kesim uzunluğu, çözünürlük, kare hızı, kaç saniyede bir başlık
girdiğiniz, hangi geçişleri kullandığınız. Sonra yeni videoyu **aynı
ölçülerle** keser. Burada da yapay zekâ yok: üslup sayılardan ibaret, yapılan
iş o sayıları uygulamak.

Okuduğu proje biçimleri:

| Biçim | Program |
|---|---|
| `.mlt`, `.kdenlive` | Shotcut, Kdenlive |
| `.fcpxml` | Final Cut, DaVinci Resolve, Premiere (dışa aktarım) |
| `draft_content.json` | CapCut |
| `.prproj` | Premiere (çıkarabildiği kadar) |

**Neden ekrana bakıp fare oynatmıyor:** bir montaj programını arayüzünden
sürmek her güncellemede kırılır ve size çalışmayan bir şey vermiş olurum.
Proje **dosyası** ise kararlı bir biçim; okumak hem sağlam, hem de programın
açık olmasını gerektirmiyor.

Premiere'in `.prproj` yapısı sürümler arasında değiştiği için kesim bilgisini
her zaman çıkaramaz. Çıkaramazsa **tahmin etmez** — Premiere'de
Dosya → Dışa Aktar → Final Cut Pro XML deyip o dosyayı vermenizi söyler.

Proje vermek istemezseniz üç hazır şablon var: **hızlı kesim**, **sakin
anlatım**, **dikey (Shorts)**.

**ffmpeg gerekiyor** ve bu projenin bağımlılığı değil — DRA kendi başına bir
şey indirmez. Kurulu değilse montaj düğmesi kapalı kalır ve nasıl kurulacağını
söyler (`winget install Gyan.FFmpeg`). Bazı ffmpeg sürümleri yazı basmayı
(`drawtext`) desteklemez; DRA bunu önceden yoklar, desteklenmiyorsa giriş
kartını yalnızca görselden üretir ve **bunu size söyler** — sessizce eksik
bırakmaz.

Kaynak klipler farklı çözünürlük, farklı kare hızında ve kimi sessiz olabilir;
hepsi tek kalıba sokulur (oranı bozmadan sığdırılıp siyahla doldurulur, sessiz
olanlara sessiz ses izi eklenir) — yoksa birleştirme bozulur.

### YouTube

Modlar → **YouTube**. Videoyu, başlığını, başlık görselini ve **yayın saatini**
verirsiniz; DRA sıraya koyar ve saati gelince yükler. **"DRA kanal raporu"**
deyince abone/izlenme sayısını ve sırada bekleyenleri kart olarak gösterir.

**Sıraya kendiniz eklemediğiniz hiçbir video yüklenmez.** Sırayı Modlar
sekmesinden görür, istediğinizi çıkarırsınız. Yükleme başladığında,
bittiğinde ve hata aldığında sohbete yazar — arka planda sessizce olmaz.

Zamanlanmış videolar YouTube kuralı gereği önce **gizli** yüklenir, saati
gelince kendiliğinden yayına geçer. "Herkese açık" seçseniz bile zamanlanmış
yüklemede gizli gider; YouTube `publishAt` alanını başka türlü kabul etmiyor.

**Kurulum — burada OAuth kaçınılmaz.** Gmail'deki uygulama şifresi kısayolunun
YouTube'da karşılığı yok; Google yalnızca OAuth kabul ediyor. Tek seferlik:

1. [Google Cloud Console](https://console.cloud.google.com) → yeni proje
2. **YouTube Data API v3**'ü etkinleştirin
3. Kimlik Bilgileri → OAuth istemci kimliği → tür: **Masaüstü uygulaması**
4. Çıkan **İstemci Kimliği** ve **Gizli Anahtar**'ı Modlar sekmesine girin
5. **Kanalı bağla** → tarayıcı açılır, onay verirsiniz, biter

Onay kodunu kopyalayıp yapıştırmanız gerekmez: DRA geri çağırmayı
`127.0.0.1`'de kendi açtığı kısa ömürlü bir sunucuyla karşılar. Yenileme
jetonu bu bilgisayarda kalır, bir daha giriş istenmez.

Bağımlılık eklenmedi — OAuth, devam ettirilebilir yükleme ve başlık görseli
ayarlama `fetch` + `node:http` ile yazıldı.

> Not: Geliştirme ortamında Google hesabı ve dışarı çıkış yok. Akışın tamamı,
> Google'ın uçlarını taklit eden **gerçek bir yerel sunucuya** karşı sınandı
> (68 test: yetkilendirme döngüsü, jeton yenileme, iki adımlı yükleme,
> zamanlanmış yayında gizlilik kuralı, zamanlayıcı) — canlı doğrulanmadı.

### İşletme modu — müşteri mesajları

Modlar → **İşletme modu**. Müşteri mesajlarının **nereden geleceğini siz
seçersiniz**; DRA da yalnızca o kaynağın ihtiyaç duyduğu bilgileri ister.
Kaynak açtığınız anda ne isteyeceğini sohbete yazar, alanlar da ekranda
belirir — her alanın altında o bilgiyi nereden alacağınız yazılı.

| Kaynak | İstediği bilgi | Gelen mesaj |
|---|---|---|
| **Gmail** | adres + uygulama şifresi | sorarak alınır |
| **Instagram DM** | hesap kimliği + sayfa erişim jetonu | sorarak alınır |
| **WhatsApp** | numara kimliği + kalıcı jeton (+ doğrulama jetonu) | **yalnızca webhook** |
| **Elle giriş** | — | kendiniz yazarsınız |

Sonra **"DRA mesajları topla"** deyin; hepsi tek bir listede toplanır.
**"DRA müşteri mesajları"** hangi kaynaktan kaç mesaj geldiğini ve yanıt
bekleyenleri kart olarak gösterir. Bir kaynak çalışmazsa diğerleri devam
eder — tek bozuk hesap bütün raporu engellemez, hangisinin neden
çalışmadığı ayrıca yazılır.

Aynı mesaj iki kez kaydedilmez: her kaynak kendi kimliğini verir.

**Instagram'ı neden resmî API ile okuyoruz:** "giriş yapıp sayfayı kazı"
yöntemi hesabın kapatılmasına yol açıyor ve her arayüz değişikliğinde
kırılıyor. Resmî yol daha zahmetli kuruluyor ama hesabınızı riske atmıyor.
İşletme/İçerik Üreticisi hesabı ve bağlı bir Facebook Sayfası gerekiyor.

**WhatsApp'ta bir kısıt var, baştan söyleyelim:** Cloud API'de gelen
mesajlar *sorularak alınamıyor.* "Son mesajları getir" diye bir uç yok;
Meta mesajları yalnızca **webhook** ile, yani sizin verdiğiniz bir adrese
POST ederek iletiyor. Yani gelen WhatsApp mesajlarını alabilmek için
DRA'nın internetten ulaşılabilir olması gerekiyor — sabit IP, port
yönlendirme ya da bir tünel servisi. DRA kendi tarafını hazır tutuyor
(`/webhook/whatsapp` ucu doğrulamayı da karşılıyor), adresi dışarı açmak
sizin tarafınız.

**Yanıt göndermekte** böyle bir kısıt yok: o düz bir HTTP isteği,
her yerden çalışır. Gmail'den yanıt gönderilmez (IMAP okuma protokolü);
DRA bunu söyler, sessizce yutmaz.

> Not: Geliştirme ortamında Meta hesabı ve dışarı çıkış yok. Instagram ve
> WhatsApp, Graph API'yi taklit eden **gerçek bir yerel sunucuya** karşı
> sınandı (60 test) — canlı doğrulanmadı.

### Mesajları sınıflama — yapay zekâ yok

Her mesaj depoya girerken sınıflanır: **memnun · şikâyet · soru · nötr.**
Kurallar açık ve denetlenebilir.

Türkçe'de asıl zorluk **olumsuzluk**: "memnun değilim" içinde "memnun" geçer
ama anlamı tam tersidir. Kelime saymak bu yüzden yetmez — her eşleşmenin
ardındaki iki kelimeye bakılır ve gerekirse işaret ters çevrilir. İki yönlü
çalışır:

* "memnun değilim" → olumlu kelime olumsuzlanmış → **şikâyet**
* "sorun yok, teşekkürler" → olumsuz kelime olumsuzlanmış → **memnun**
* "beğenmedim" → fiil olumsuzluğu → **şikâyet**
* "yemek lezzetliydi ama servis yavaştı" → ikisi de var → **şikâyet**
  (ilgilenilmesi gereken taraf odur)

Kısa kalıplarda tam kelime aranır: "geç" kalıbı "geçerli" içinde eşleşip
geçerli bir soruyu şikâyet saymaz.

### Otomatik yanıt

Anahtar kelime kuralları yazarsınız: *"kaçta, açık mısınız, saat"* → *"Her gün
09:00-22:00 arası açıktır."* Uyan mesajlara DRA kendiliğinden yanıt verir.

Bu modül **gerçek müşteriye mesaj gönderiyor ve geri alınamıyor**, o yüzden
baştan kısıtlı:

* **Varsayılan kapalı.** Açık olmadan tek bir mesaj gitmez.
* **Deneme kipi**: neyi kime göndereceğini gösterir, **göndermez**. Sesli
  "otomatik yanıtla" komutu da önce denemeyi çalıştırır — ekranı görmeden
  müşteriye mesaj gitmesin.
* **Şikâyetlere otomatik yanıt verilmez.** Kızgın müşteriye şablon cevap
  durumu büyütür; kural açıkça "şikâyetlere de yanıt ver" demedikçe elde
  bırakılır.
* Aynı mesaja iki kez yanıt verilmez; bir turda en fazla 20 mesaj yanıtlanır
  (yanlış yazılmış bir kural yüzlerce müşteriye gitmesin).
* Gönderim başarısız olursa mesaj **yanıtlandı sayılmaz**, sırada kalır.

### İşletme raporu

**"DRA işletme raporu"** — memnuniyet oranı, şikâyetler ve yanıt performansı
tek kartta.

Memnuniyet oranı **yalnızca duygu taşıyan mesajlar** üzerinden hesaplanır.
Soru ve nötr mesajları paya katmak oranı yapay olarak şişirirdi. Duygu taşıyan
mesaj yoksa oran **sıfır değil, yok** olarak gösterilir — uydurulmaz.

Şikâyet raporu en sık geçen konuları da çıkarır ve kaç şikâyetin hâlâ yanıtsız
olduğunu söyler. Yanıt performansı: kaçına yanıt verilmiş ve **ortanca** yanıt
süresi (ortalama değil — tek bir çok geç yanıt tabloyu bozmasın).

## Ses ve gizlilik — okumaya değer

Tarayıcıların varsayılan ses tanıması sesi **satıcının sunucusuna gönderir**
(Chrome'da Google'a). DRA'nın amacı bunun tersi olduğu için:

* Ayarlarda **"Sesi cihazda tut"** varsayılan olarak **açıktır**.
* Mikrofonu açtığınızda DRA önce tarayıcının **cihaz üstü** ses tanımasını
  arar. Türkçe dil paketi indirilmemişse bir kerelik indirir; sonrasında ses
  cihazınızdan hiç çıkmaz.
* Tarayıcınız bunu desteklemiyorsa **mikrofon açılmaz.** Sessizce buluta
  düşmez — bunu söyler ve yazarak kullanmanızı önerir.
* Üst bardaki rozet o an hangi modda olduğunuzu gösterir:
  `cihazda` · `tarayıcı servisi` · `yazı modu`.

### Mikrofon açık ama DRA duymuyorsa

Bir dönem şu oluyordu: **seviye göstergesi konuşmaya göre oynuyor ama tanıma
sessiz.** Sebep, göstergenin ve tanımanın **ayrı ayrı** mikrofon açmasıydı;
Windows ses sürücüsü ikinci akışı çoğu zaman sessiz veriyor. Artık tek bir
akış açılıp paylaşılıyor.

Ayrıca örnekleme hızı doğrulanıyor: bağlamdan 16 kHz isteniyor ama sürücü
vermezse ses **kendimiz indirilerek** motora doğru hızda gidiyor — yanlış
hızda gönderilen ses Vosk tarafından hiç tanınmıyor.

**"DRA ses tanımayı sına"** deyin; artık tahmin değil ölçüm veriyor: motora
kaç parça gittiği, parçalardaki en yüksek ses seviyesi, örnekleme hızı. Parça
hiç gitmiyorsa ya da hep sessizse bunu ayrıca söyler.

### Mikrofon açılmıyorsa

DRA artık **neden** açılmadığını söyler — sohbete yazar, ekranda da gösterir:

* **İzin verilmedi** → Windows: Ayarlar → Gizlilik ve güvenlik → Mikrofon →
  masaüstü uygulamalarına izin verin, sonra DRA'yı yeniden başlatın
* **Mikrofon bulunamadı** → cihaz takılı mı, Windows ses ayarlarında görünüyor
  mu? Bluetooth kulaklıksa önce bağlanmasını bekleyin
* **Başka uygulama kullanıyor** → Zoom, Discord, OBS gibi bir program mikrofonu
  tutuyor olabilir

Bir dönem bunların hiçbiri görünmüyordu: `getUserMedia` hatası yutuluyor,
arayüz de mikrofon açılmamışken "Mikrofon açık" yazıyordu. Artık açılış
**gerçekten doğrulanmadan** öyle yazmıyor.

### Ses tanıma çalışmıyorsa

Ayar sekmesindeki **"Ses tanımayı sına"** düğmesine basın. Tarayıcının ne
desteklediğini, hangi modda olduğunuzu ve en son ne zaman sonuç geldiğini
sohbete yazar — tahmin yürütmek yerine oradan bakın.

Mikrofon ses alıyor ama tanıma sonuç üretmiyorsa DRA bunu kendisi fark eder
ve sohbette söyler. Bu genelde cihaz üstü Türkçe modelinin çalışmadığı
anlamına gelir; Ayar'dan **"Sesi cihazda tut"** anahtarını kapatarak
tarayıcının kendi servisini deneyebilirsiniz.

Bulut tanımayı bilerek kullanmak isterseniz Ayar'dan bu anahtarı kapatın.
Kapattığınızda rozet `tarayıcı servisi` olur — gizlenmez.

### DRA'nın sesi

Varsayılan olarak konuşma sentezi **işletim sisteminizin** Türkçe sesini
kullanır; dışarıya hiçbir şey gitmez.

### Ücretsiz ses: Piper (cihazda)

Ayar → **DRA'nın sesi** → **Piper**. Açık kaynak, ücretsiz, **tamamen bu
bilgisayarda** çalışır: internet yok, anahtar yok, kota yok. Projenin en
baştaki "hiçbir şirkete bağlanmasın" kuralına geri dönüş — kaliteli ses için
dışarı çıkmak şart değil.

Kurulum tek seferlik, DRA kendi başına bir şey indirmez:

1. [piper sürümleri](https://github.com/rhasspy/piper/releases) → Windows
   paketini indirip bir klasöre açın
2. [piper sesleri](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR)
   → bir Türkçe ses seçin (`dfki` ya da `fahrettin`, `medium` kalitesi iyi bir
   başlangıç)
3. Ayar sekmesinde **piper programını** ve **ses modelini** gösterin →
   **Sesi dinle**

> Ses paketi **iki dosyadır**: `.onnx` ve `.onnx.json`. Çoğu kişi yalnızca
> ilkini indiriyor ve piper sessizce çalışmıyor. DRA bunu önceden kontrol eder
> ve eksikse açıkça söyler.

**Diğer ücretsiz seçenekler:** Windows'un kendi Türkçe sesleri zaten
kullanılıyor (varsayılan "yerel" seçeneği). Windows 11'de
*Ayarlar → Saat ve dil → Konuşma → Ses ekle* ile daha doğal Türkçe sesler
yükleyebilirsiniz; kurduğunuz anda listeye düşerler, kod değişikliği gerekmez.
Google Cloud TTS, Azure ve Amazon Polly'nin de ücretsiz kotaları var ama
üçü de hesap, anahtar ve dışarı bağlantı istiyor — Piper bunların hiçbirini
istemiyor.

> Not: Geliştirme ortamından piper indirilemedi (ağ kapalı). Çağrı biçimi,
> argümanlar ve WAV okuma, piper'ı taklit eden sahte bir ikiliye karşı sınandı
> (25 test); gerçek piper ile canlı doğrulanmadı.

### ElevenLabs

Ayar sekmesindeki **"DRA'nın sesi"** listesinden **ElevenLabs** seçerseniz
DRA belirgin biçimde daha doğal konuşur. Ne anlama geldiği açık olsun:

* Açtığınızda DRA'nın **söylediği** metin ElevenLabs sunucularına gider.
  **Duyduğu ses gitmez** — mikrofonunuz hâlâ tamamen cihazınızda işlenir.
  Yani "DRA beni dinliyor mu" sorusunun cevabı değişmez; değişen yalnızca
  cevabın nasıl seslendirildiğidir.
* API anahtarı bu bilgisayarda kalır. İstekleri arayüz değil, DRA'nın kendi
  süreci (uygulamada ana süreç, tarayıcıda yerel sunucu) atar; anahtar
  sayfaya hiç verilmez.
* **ElevenLabs cevap vermezse DRA susmaz.** Kota bitti, ağ koptu, anahtar
  bozuldu — hangisi olursa olsun bilgisayarın kendi sesine döner ve bunu
  sohbette söyler.
* Aynı cümleler ("Sizi dinliyorum efendim", "Not alındı") yeniden
  seslendirilmez; önbellekte tutulur. Kotanız her tekrar için harcanmaz.
* Ayarı kapattığınızda anahtar süreçten silinir ve o uca bir daha istek
  gitmez.

Kurulum: anahtarı yapıştırın — sesler kendiliğinden gelir ve ilki seçilir.
Beğenene kadar **"Sesi dinle"** ile deneyin; her basışta DRA o sesle kısa bir
cümle söyler. İsterseniz **"Bağlantıyı sına"** anahtarın geçerli olduğunu,
seçtiğiniz sesin hesapta bulunduğunu ve kalan karakter hakkınızı söyler —
sınama ses üretmez, yani kotanızdan harcamaz. Model listesinde Türkçe
destekleyenler başa alınır; desteklemeyen bir model seçerseniz DRA anlaşılmaz
konuşur.

> Not: Geliştirme ortamında ElevenLabs anahtarı ve dışarı çıkış yok. Köprü
> mock'lanmış isteklerle sınandı (46 test), canlı doğrulanmadı. İlk kullanımda
> "Bağlantıyı sına" ile doğrulayın.

### Masaüstü sürümünde ses: gömülü motor

Uygulama sürümü tarayıcının ses tanımasını **kullanmaz.** Kendi motoru vardır
(Vosk) ve model diskte durur.

Bunun sebebi ölçülmüş bir sonuç: Chrome'un cihaz üstü Türkçe modelini Chrome
kendi bileşen güncelleyicisiyle yönetiyor, Electron'da o mekanizma yok. Uygulama
o modeli indiremiyor. Yani tarayıcı motoruna bel bağlamak uygulamada çalışmıyor.

**Motor ayrı bir süreçte çalışır.** Vosk yerel (native) kod çalıştırıyor;
oradaki bir çökme JavaScript hatası değildir ve `try/catch` ile yakalanamaz —
içinde bulunduğu sürecin tamamını öldürür. Motor uygulamanın içinde çalışsaydı
bozuk bir model DRA'nın tamamını kapatırdı (ve kapatıyordu). Artık çökerse
yalnızca motor ölür; uygulama ayakta kalır, durumu sohbete yazar ve yazılı
komutlar çalışmaya devam eder. Bu, testlerde kasten bozuk model verilerek
doğrulanıyor.

Gömülü motorun sonuçları:

* Ses **hiçbir yere gitmiyor** — ne Google'a, ne başka bir yere
* İnternet gerekmiyor (model kurulduktan sonra)
* Chrome'un keyfine bağlı değil

**İlk kurulum:** Ayar → **"Ses modelini kur"**. Türkçe model bir kerelik
indirilir (yaklaşık 45 MB). Bu, uygulamanın dışarıya çıkan tek isteğidir ve
bir daha tekrarlanmaz.

**İndirme çalışmazsa:** Modeli tarayıcıdan elle indirin
(`alphacephei.com/vosk/models` → `vosk-model-small-tr-0.3.zip`), bir klasöre
çıkarın, sonra Ayar → **"Model klasörünü seç"** ile gösterin. Model tanıma
`conf` klasörüne bakar, dosya düzeninin ayrıntısına takılmaz.

Ayar → **Ses tanıma motoru** ile tarayıcı motoruna geçebilirsiniz, ama uygulama
sürümünde bunun çalışması beklenmiyor.

> **Doğrulanamayan kısım:** Bu geliştirme ortamında ne mikrofon var ne de
> model indirilebiliyor. Motorun yüklendiği, model olmadan düzgün hata verdiği
> ve arayüze doğru bağlandığı test ediliyor; ama **gerçek sesle tanıma
> yaptığı doğrulanmadı.** İlk kullanımda Ayar → "Ses tanımayı sına" ile
> kontrol edin.

---

## Bilgisayar kontrolü

DRA kurulu uygulamaları ve Steam oyunlarını sesle başlatıp kapatabilir.

**Sistem** sekmesinde **"Bilgisayarı tara"** düğmesine basın. DRA Başlat
menüsünü, masaüstünü ve Steam kütüphanesini tarayıp bir liste çıkarır.
Sonrasında `spotify aç` · `valorant aç` · `chrome kapat` diyebilirsiniz.

**Neden tarama gerekiyor:** DRA rastgele komut çalıştırmaz. Yalnızca bu
listedeki bir kaydı başlatabilir. Böylece yanlış duyulan bir kelime
beklenmedik bir şey çalıştıramaz. Ayrıca isim eşleşmesi yüksek eşikle
yapılır — emin olamazsa çalıştırmaz, sorar.

**Güvenlik:** Sunucu artık program çalıştırabildiği için, tarayıcınızda
açtığınız kötü niyetli bir sitenin arka planda `localhost`'a istek atma
riski doğar. Buna karşı dört katman var: sunucu yalnızca `127.0.0.1`'e
bağlanır, her açılışta üretilen gizli bir oturum jetonu istenir, `Origin`
ve `Sec-Fetch-Site` başlıkları denetlenir, ve yalnızca taranmış listedeki
kayıtlar çalıştırılabilir. Dördü de test altında.

## Web araması (varsayılan kapalı)

**Ayar → Web araması** anahtarını açarsanız DRA, komutlarında bulamadığı
soruları DuckDuckGo üzerinden arar ve sonucu sohbete yazar. İstek tarayıcıdan
değil sunucudan gider; tarayıcı geçmişinize ve çerezlerinize dokunmaz.

Kapalıyken `araştır ...` komutu yine çalışır ama sadece tarayıcıda arama
sayfasını açar — dış bağlantıyı DRA kurmaz.

## Yayıncı desteği — Kick moderasyonu (varsayılan kapalı)

**Ayar → Yayıncı desteği** açıldığında kanal adı ve Kick erişim jetonu
alanları görünür. Jeton yalnızca sunucuda tutulur, sohbete yazılmaz.
**"Bağlantıyı sına"** ile doğrulayın.

Açıkken sesli moderasyon:

| Ne dersiniz | Ne yapar |
|---|---|
| `ahmeti banla` | Kullanıcıyı yasaklar |
| `ahmeti 10 dakika sustur` | Süreli susturma |
| `ahmetin yasağını kaldır` | Yasağı kaldırır |
| `sohbete yaz merhaba` | Kanala mesaj gönderir |

> **Dürüst not:** Bu köprü Kick'in belgelenmiş API'sine göre yazıldı ama
> **canlı doğrulanmadı** — geliştirme ortamında Kick hesabı ve jeton yoktu.
> İlk kullanımda "Bağlantıyı sına" ile kontrol edin. Uç adresleri değiştiyse
> `server/kick.mjs` içindeki `KICK_API` tablosundan düzeltmek yeterli.
> Mesaj silme, mesajın kimliğini gerektirdiği için henüz yok; sohbet akışına
> bağlanmadan "şu mesajı sil" demek mümkün değil.

---

## Ekran düzeni

**Sol** — kontrol paneli, dört sekme:

| Sekme | İçerik |
|---|---|
| Sistem | mikrofon seviyesi, ağ, komut motoru, batarya; geri sayımlar; sıradaki alarm; uygulama taraması |
| Not | not ekle, tek tek sil, hepsini temizle |
| Alarm | saatli alarm kur, etiket ver, her gün tekrarla, aç/kapa, sil |
| Modlar | çalışma modları (açılışta başlat, arka planda dinle, yayıncı desteği, **e-posta raporu**, **video montajı**, **YouTube**, **işletme modu**) ve **erişim izinleri** |
| Ayar | ses, mikrofon, ses tanıma motoru ve modeli, sesi cihazda tut, açılış dizisi, **DRA'nın sesi** (yerel / ElevenLabs), konuşma hızı, otomatik uyku, tema rengi, ek uyandırma sözcükleri, sıfırlama |

**Orta** — reaktör. Dönen halkalar, glif şeridi ve yörüngedeki parçalar;
mikrofon sesiyle ve duruma göre canlanır.

**Sağ** — sohbet. Yazdıklarınız ve DRA'nın yanıtları; en altta yazı kutusu.

Uyku ekranında da bir yazı kutusu var: mikrofonu hiç açmadan da kullanabilirsiniz.

---

## Komutlar

Konuşun ya da yazın — fark etmez.

### Komutu tam olarak doğru yazmanız gerekmiyor

DRA komutları birebir aramaz. Üç katmanlı bir eşleştirme kullanır:

| Ne değişebilir | Örnek |
|---|---|
| Büyük/küçük harf, Türkçe karakter, noktalama | `BUGÜN NE?` · `bugun ne` |
| Boşluk | `bugün ne` · `bu gün ne` |
| Yazım hatası | `bue gün ne` · `saaat kaç` · `alrm kur` · `mrhaba` |
| Türkçe ekler | `notlarımı göster` · `alarmlarım` · `saatte` |
| Farklı ifade | `vakit ne` · `hangi gündeyiz` · `her şey yolunda mı` |

Her komutun birden fazla söyleniş biçimi tanımlı; girdi hepsine karşı
puanlanır ve en yüksek puanı alan kural çalışır. Hiçbiri yeterince güçlü
değilse en yakın komut önerilir.

Bu davranış test altında: `test/suites/yonlendirme.mjs` 84 farklı yazılışın
doğru komuta gittiğini doğrular. Komutu tek nefeste de söyleyebilirsiniz:
*"DRA, saat kaç?"*

| Ne dersiniz | Ne yapar |
|---|---|
| `saat kaç` · `bugün günlerden ne` | Saat ve tarih |
| `12 kere 8 kaç eder` · `hesapla 45 artı 17` | Matematik (`eval` yok, kendi çözücüsü var) |
| `youtube aç` · `github aç` · `spotify aç` | Bilinen siteleri yeni sekmede açar |
| `google'da kedi videosu ara` | Google / YouTube / Wikipedia'da arar |
| `5 dakika zamanlayıcı kur` · `10 saniye sonra hatırlat` | Geri sayım başlatır |
| `sabah yedi buçukta alarm kur` · `akşam dokuzda alarm kur ilaç` | Saatli alarm |
| `07:30 alarm kur` · `yediye çeyrek kala alarm kur` | Rakamla ya da "çeyrek kala" |
| `her sabah altıda alarm kur` | Her gün tekrarlanan alarm |
| `alarmlarım` · `alarmları sil` | Alarmları okur / siler |
| `not al yarın süt al` · `notlarım` · `notları sil` | Not tutar (tarayıcıda kalıcı) |
| `sistem durumu` | Mikrofon, ağ, sayaç, alarm ve not özeti |
| `renk yeşil` · `ayarları aç` | Tema ve panel |
| `sesini kapat` · `tam ekran` · `ekranı temizle` | Arayüz kontrolleri |
| `şaka yap` · `yazı tura at` · `zar at` | Ufak eğlence |
| `uyu` · `görüşürüz` · `iyi geceler` | Uyku moduna döner |

Alarm çaldığında DRA uykudaysa **kendini uyandırır**, zil çalar ve söyler.
Sesli yanıt kapalı olsa bile zil çalar. Tek seferlik alarmlar kendini kapatır.

## Klavye kısayolları

| Tuş | İşlev |
|---|---|
| `Boşluk` | Uyku ekranında elle uyandır |
| `Esc` | Konuşmayı kes ve uyut |
| `M` / `S` / `F` | Mikrofon / sesli yanıt / tam ekran |
| `/` | Sohbet kutusuna odaklan |

---

## Nasıl çalışıyor

```
web/js/main.js       akışı yöneten orkestrasyon + uyandırma kelimesi
web/js/speech.js     ses tanıma (cihaz üstü tercihli) ve konuşma sentezi
web/js/match.js      esnek metin eşleştirme (ek çözümleme, yazım toleransı)
web/js/commands.js   Türkçe komut motoru, saat çözümleyici, komut önerici
web/js/reactor.js    merkezdeki canvas reaktörü ve dönen parçalar
web/js/panel.js      sol kontrol paneli (sekmeler, not, alarm, ayar)
web/js/alarms.js     alarm motoru ve zil sesi
web/js/store.js      kalıcı veri (localStorage)
web/js/audio.js      görselleri besleyen mikrofon analizörü
web/js/hud.js        sohbet, göstergeler, açılış dizisi
web/js/state.js      durum makinesi ve olay yolu
electron/main.mjs    masaüstü uygulaması: pencere, tepsi, kısayol, IPC, izinler
electron/speech-engine.mjs  gömülü ses tanıma (Vosk) + model kurulumu
web/js/mic-capture.js       mikrofondan ham ses alıp motora aktarma
electron/preload.cjs yalıtım köprüsü (arayüzün gördüğü tek yüzey)
server/index.mjs     statik dosya servisi + yerel uçlar (bağımlılıksız)
server/guard.mjs     yerel istek koruması (jeton, köken, içerik türü)
server/apps.mjs      uygulama/oyun tarama, başlatma, kapatma
server/search.mjs    web araması (kapalıyken hiç yüklenmez)
server/kick.mjs      Kick moderasyon köprüsü
server/tts.mjs       ElevenLabs seslendirmesi (anahtar girilmeden istek atmaz)
server/piper.mjs     Piper: cihazda calisan ucretsiz seslendirme
server/control.mjs   bilgisayar kontrolu (isimli islemler, serbest komut yok)
server/media.mjs     YouTube arama ve muzik kaynaklari (anahtarsiz)
server/permissions.mjs  erisim izinleri — yetki denetiminin yapildigi yer
server/report.mjs    bilgisayar raporu (disk, bellek, Windows guncellemeleri)
server/mail.mjs      e-posta raporu (bagimliliksiz IMAP, yalnizca basliklar)
server/editstyle.mjs montaj projesinden uslup cikarma (.mlt/.fcpxml/CapCut)
server/montage.mjs   ffmpeg ile montaj (ffmpeg yoksa mod kapali kalir)
server/videos.mjs    stok video deposu (baslik, kapak, yayin saati)
server/youtube.mjs   YouTube OAuth + devam ettirilebilir yukleme
server/scheduler.mjs yayin zamanlayicisi (yetki yoksa hicbir sey yapmaz)
server/sources.mjs   musteri mesaji kaynaklari (her kaynak ne istedigini bildirir)
server/messages.mjs  birlesik musteri mesaji deposu
server/instagram.mjs Instagram DM (Meta Graph API)
server/whatsapp.mjs  WhatsApp Cloud API (gonderim + webhook alicisi)
server/sentiment.mjs mesaj siniflama (Turkce olumsuzluk dahil)
server/autoreply.mjs otomatik yanit kurallari (varsayilan kapali, deneme kipi)
server/business.mjs  memnuniyet, sikayet ve yanit performansi raporlari
web/js/system.js     sunucu köprüsü (istemci tarafı)
```

**Durum akışı:** `uykuda → (adını duyar) → açılış → hazır → dinliyor →
düşünüyor → konuşuyor → hazır`. Ayarlardaki süre kadar sessizlikten sonra
kendini uyutur (kapatılabilir).

**Reaktör:** Sabit katmanlar bir kez çizilip önbelleğe alınır; her karede
yalnızca döndürülüp basılırlar. Aksi halde 120 tik çizgisi her karede
yeniden üretilirdi.

**Ses tanıma:** Motor tek bir örnek olarak sürekli çalışır; duruma göre
başlatılıp durdurulmaz. Web Speech API'de başlat/durdur yarışları en yaygın
hata kaynağı olduğu için gelen metin duruma göre yönlendirilir. DRA
konuşurken mikrofon kısa süreliğine sağırlaştırılır ki kendi sesini komut
sanmasın.

---

## Uyandırma kelimesi tutmuyorsa

Ses tanıma "DRA"yı bazen farklı yazar. Uyku ekranındaki alt yazı **o an ne
duyduğunu** gösterir. Sürekli başka bir karşılık çıkıyorsa onu
**Ayar → Ek uyandırma sözcükleri** alanına yazın (virgülle ayırarak).
Kod değiştirmeye gerek yok.

## Veriler nerede duruyor

Notlar, alarmlar ve ayarlar tarayıcınızın `localStorage`'ında, `dra.state.v2`
anahtarında durur. Sunucuya hiçbir şey gitmez, disk üzerinde bir dosya
oluşmaz. Ayar → **Sıfırla** hepsini siler.
