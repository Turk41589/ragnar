# DRA

JARVIS tarzı, **sesle uyanan** Türkçe yapay zekâ asistanı.

Mikrofon açıkken **"DRA"** dediğinizde uyanır, açılış dizisini oynatır ve
holografik arayüzünü açar. Sonrasında sesle ya da yazarak konuşabilirsiniz.
İşi bitince `uyu` deyin, tekrar uykuya döner ve yalnızca adını dinlemeye başlar.

---

## Kurulum

Gereken tek şey Node.js 18 veya üstü.

```bash
npm install
npm start
```

Ardından tarayıcıda **http://localhost:4173** adresini açın.

> **Neden bir sunucu var?**
> Tarayıcılar `file://` üzerinden mikrofona izin vermez. `localhost` güvenli
> bağlam sayıldığı için küçük bir Node sunucusu arayüzü servis eder — ve aynı
> sunucu API anahtarınızı tarayıcıdan uzak tutar.

**Tarayıcı:** Ses tanıma için **Chrome** veya **Edge** gerekir (Web Speech API).
Firefox'ta arayüz ve yazılı komutlar çalışır, sesle uyandırma çalışmaz.

---

## Yapay zekâ beyni (opsiyonel)

DRA anahtarsız da çalışır: aşağıdaki komutların tamamı yereldir, internet
istemez. Bilmediği bir şey sorulduğunda ise isteği Claude'a devretmek için
bir API anahtarı gerekir.

```bash
cp .env.example .env
# .env dosyasını açıp ANTHROPIC_API_KEY satırını doldurun
npm start
```

Anahtar **yalnızca sunucu sürecinde** durur; tarayıcıya hiçbir zaman
gönderilmez. Üst bardaki `beyin` rozeti bağlantının durumunu gösterir:
`beyin: yerel` (anahtar yok) ya da `beyin: claude-opus-5`.

Modeli değiştirmek için `.env` içine `DRA_MODEL=...` ekleyin.

---

## Sesli komutlar

Uyandıktan sonra doğrudan konuşun. Komutu tek nefeste de söyleyebilirsiniz:
*"DRA, saat kaç?"*

| Ne dersiniz | Ne yapar |
|---|---|
| `saat kaç` · `bugün günlerden ne` | Saat ve tarih |
| `12 kere 8 kaç eder` · `hesapla 45 artı 17` | Matematik (`eval` yok, kendi çözücüsü var) |
| `youtube aç` · `github aç` · `spotify aç` | Bilinen siteleri açar |
| `google'da kedi videosu ara` | Google / YouTube / Wikipedia'da arar |
| `5 dakika zamanlayıcı kur` · `10 saniye sonra hatırlat` | Geri sayım başlatır, dolunca seslenir |
| `not al yarın süt al` · `notlarım` · `notları sil` | Not tutar (tarayıcıda kalıcı) |
| `hava durumu` | Konum izniyle güncel hava (Open-Meteo) |
| `sistem durumu` | Mikrofon, ağ, beyin, sayaç ve not özeti |
| `renk yeşil` · `renk turuncu` | Arayüz temasını değiştirir |
| `sesini kapat` · `sesini aç` | Sesli yanıtı açar/kapatır |
| `tam ekran` · `ekranı temizle` | Arayüz kontrolleri |
| `şaka yap` · `yazı tura at` · `zar at` | Ufak eğlence |
| `uyu` · `görüşürüz` · `iyi geceler` | Uyku moduna döner |

Listede olmayan her şey — *"Roma neden düştü?"*, *"şu maili özetle"* —
yapay zekâ beynine gider.

## Klavye kısayolları

| Tuş | İşlev |
|---|---|
| `Boşluk` | Uyku ekranında elle uyandır |
| `Esc` | Konuşmayı kes ve uyut |
| `M` | Mikrofonu aç/kapat |
| `S` | Sesli yanıtı aç/kapat |
| `F` | Tam ekran |
| `/` | Yazı alanına odaklan |

---

## Nasıl çalışıyor

```
web/js/main.js       akışı yöneten orkestrasyon + uyandırma kelimesi
web/js/speech.js     ses tanıma (kulak) ve konuşma sentezi (ses)
web/js/commands.js   Türkçe yerel komut motoru
web/js/reactor.js    merkezdeki canvas reaktörü ve dalga formu
web/js/audio.js      görselleri besleyen mikrofon analizörü
web/js/hud.js        ekrandaki tüm metin/gösterge güncellemeleri
web/js/state.js      durum makinesi ve olay yolu
server/index.mjs     statik servis + /api/chat köprüsü
server/brain.mjs     Anthropic SDK sarmalayıcısı (anahtar burada kalır)
```

**Durum akışı:** `uykuda → (adını duyar) → açılış → hazır → dinliyor →
düşünüyor → konuşuyor → hazır`. 2.5 dakika sessizlikten sonra kendini uyutur.

**Tasarım notu:** Ses tanıma motoru tek bir örnek olarak sürekli çalışır;
duruma göre başlatılıp durdurulmaz. Web Speech API'de başlat/durdur yarışları
en yaygın hata kaynağı olduğu için gelen metin duruma göre yönlendirilir.
DRA konuşurken mikrofon kısa süreliğine sağırlaştırılır ki kendi sesini
komut sanmasın.

---

## Uyandırma kelimesi tutmuyorsa

Ses tanıma "DRA"yı bazen farklı yazar. Uyku ekranındaki alt yazı **o an ne
duyduğunu** gösterir. Sizde sürekli başka bir karşılık çıkıyorsa
`web/js/main.js` içindeki `WAKE_WORDS` listesine ekleyin.

## Bilinenler

* Ses tanıma Chrome'da Google sunucularını kullanır — internet gerektirir ve
  konuşulan ses Google'a gider. Bu, tarayıcının Web Speech API davranışıdır.
* `hava durumu` komutu konum izni ister ve Open-Meteo'ya istek atar.
* Sesli yanıt işletim sisteminin Türkçe sesine bağlıdır. Türkçe ses yüklü
  değilse sistem varsayılanı kullanılır.
