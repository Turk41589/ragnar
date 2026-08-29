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

Uygulama sürümünde ek olarak: sistem tepsisi simgesi, **Alt+Space** ile her
yerden çağırma, açılışta başlatma, ve tek pencere garantisi. Kapatma düğmesi
uygulamayı sonlandırmaz — tepside beklemeye devam eder.

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
* **Masaüstü uygulaması** — Electron gerçekten açılıyor mu, arayüz yükleniyor
  mu, IPC çalışıyor mu, Node arayüze sızmıyor mu, köprü yalnızca beklenen
  yüzeyi mi açıyor, beyaz liste uygulamada da geçerli mi
* **Alarm (yavaş)** — bir sonraki dakikaya alarm kurup gerçekten çalmasını,
  DRA'yı uykudan uyandırmasını ve kendini kapatmasını bekler

Tek bir paketi çalıştırmak için: `node test/run.mjs --sadece arayuz`

Kendi Chromium'unuzu kullanmak isterseniz `PLAYWRIGHT_CHROMIUM_PATH` ortam
değişkenini ayarlayın.

---

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

Konuşma sentezi (DRA'nın sesi) işletim sisteminizin Türkçe sesini kullanır.

**Masaüstü sürümünde ses:** Electron mikrofon iznini kendiliğinden vermez —
uygulama bunu açıkça açar (`electron/main.mjs` içindeki izin işleyicisi).
Electron 44, cihaz üstü ses tanıma API'sini (`SpeechRecognition.available` /
`install`) içeriyor. Ancak bu geliştirme ortamında hiç mikrofon olmadığı için
**tanımanın uygulamada gerçekten sonuç ürettiği doğrulanamadı.** İlk açılışta
Ayar → **"Ses tanımayı sına"** ile kontrol edin. Çalışmazsa tarayıcı sürümü
(`npm run web`) yedek olarak durmaya devam ediyor; kalıcı çözüm olarak
uygulamanın içine gömülü bir ses motoru (Vosk) eklenebilir.

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
| Sistem | mikrofon seviyesi, ağ, komut motoru, batarya; geri sayımlar; sıradaki alarm |
| Not | not ekle, tek tek sil, hepsini temizle |
| Alarm | saatli alarm kur, etiket ver, her gün tekrarla, aç/kapa, sil |
| Ayar | ses, mikrofon, sesi cihazda tut, açılış dizisi, konuşma hızı, otomatik uyku, tema rengi, ek uyandırma sözcükleri, sıfırlama |

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
electron/preload.cjs yalıtım köprüsü (arayüzün gördüğü tek yüzey)
server/index.mjs     statik dosya servisi + yerel uçlar (bağımlılıksız)
server/guard.mjs     yerel istek koruması (jeton, köken, içerik türü)
server/apps.mjs      uygulama/oyun tarama, başlatma, kapatma
server/search.mjs    web araması (kapalıyken hiç yüklenmez)
server/kick.mjs      Kick moderasyon köprüsü
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
