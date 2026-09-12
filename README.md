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

### Otomatik testler

```bash
npm install                    # Electron + Playwright
npx playwright install chromium
npm test                       # hızlı testler, ~40 sn
npm run test:tam               # alarmın gerçekten çalmasını da bekler, ~2 dk
```

`npm test` sunucuyu kendi başlatır, tarayıcıyı açar ve şunları doğrular:

* **Komut motoru** — Türkçe saat çözümleyici (11 vaka), matematik, komut
  eşleşmesi, komut önerisi, zamanlayıcı/alarm ayrımı ve yan etkili
  komutlardan sonra komut hattının açık kaldığı
* **Komut yönlendirme** — 84 farklı yazılışın doğru kurala gittiği
  (yazım hatası, boşluk, Türkçe ek ve eş anlamlı ifadeler dahil)
* **Arayüz** — uyandırma kelimesi (yanlış tetiklenme dahil), sohbet paneli,
  dört sekme, not/alarm ekleme-silme, ayarlar, kalıcılık, sıfırlama, dar
  ekran yerleşimi ve **localhost dışına hiçbir istek atılmadığı**
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
  mikrofon kapalıyken gelen artık sonuçlar yok sayılıyor mu
* **Alarm (yavaş)** — bir sonraki dakikaya alarm kurup gerçekten çalmasını,
  DRA'yı uykudan uyandırmasını ve kendini kapatmasını bekler

Tek bir paketi çalıştırmak için: `node test/run.mjs --sadece arayuz`

Kendi Chromium'unuzu kullanmak isterseniz `PLAYWRIGHT_CHROMIUM_PATH` ortam
değişkenini ayarlayın.

---

## Erişim izinleri

DRA'nın bilgisayara ve hesaplara erişimi genişledikçe "her şeye erişebilir"
demek yeterli değil. Her yetki **ayrı ayrı** verilir, **sorularak** verilir ve
**tek tıkla geri alınır.**

Nasıl çalışıyor:

1. DRA bir yetkiye ihtiyaç duyduğu **ilk anda** sorar — peşin peşin yetki
   dağıtmanız gerekmez. "Rapor ver" dediğinizde ekrana ne isteyeceğini ve ne
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
| Dosyaları okuma | İzin verdiğiniz klasörlerdeki dosyaları okur; silmez, değiştirmez |
| E-posta okuma | Gelen kutusunu okur, reklam/bülten ayıklar; mesaj göndermez |
| YouTube kanalı | Kanal istatistiği okur, video yükler (yükleme öncesi ayrıca onay ister) |
| İşletme verileri | İşletmenizle ilgili anlattıklarınızı bu bilgisayarda tutar |

### Bilgisayar raporu

**"DRA rapor ver"** deyin. İzin verdikten sonra sohbete görsel bir rapor kartı
düşer: işletim sistemi, bellek ve disk doluluk çubukları, ne kadar süre açık
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
| Modlar | çalışma modları (açılışta başlat, arka planda dinle, web araması, yayıncı desteği, **e-posta raporu**) ve **erişim izinleri** |
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
server/permissions.mjs  erisim izinleri — yetki denetiminin yapildigi yer
server/report.mjs    bilgisayar raporu (disk, bellek, Windows guncellemeleri)
server/mail.mjs      e-posta raporu (bagimliliksiz IMAP, yalnizca basliklar)
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
