# Kariyer.net İlan Önizleme (Chrome Extension)

Kariyer.net iş ilanı listesinde (`https://www.kariyer.net/is-ilanlari...`) bir ilan kartının üzerine
fareyle gelince ilanı arka planda açar ve ilanın **İş İlanı Hakkında** bölümünü olduğu gibi
(resimler hariç) kartın yanında gösterir.

## Kurulum

1. Chrome'da `chrome://extensions` adresini açın.
2. Sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** → bu klasörü (`KariyerChromeExtension`) seçin.
4. Kariyer.net ilan listesini yenileyin ve bir ilan kartının üzerine gelin.

Kodu değiştirdikten sonra `chrome://extensions` sayfasında eklentinin yenile (↻) düğmesine basıp
Kariyer.net sekmesini yenileyin.

## Nasıl çalışır

- `src/content.js` ilan listesindeki `/is-ilani/<slug>-<id>` linklerini dinler. Kartın üzerinde
  ~350 ms beklenince ilan yüklenir. Fare panele geçerse panel açık kalır; böylece uzun ilanlar
  kaydırılabilir. `Esc` paneli kapatır.
- Önce ilan sayfası `fetch` ile istenir. Kariyer.net bot koruması (PerimeterX) bu isteği reddederse
  ya da ilan metni sunucu HTML'inde yoksa, oturumun geri kalanında ilan **görünmez, aynı kökenli,
  sandbox'lı bir iframe** içinde normal bir sayfa gibi açılır. Metin oradan okunur, iframe hemen
  kaldırılır. Aynı anda yalnızca bir iframe açılır; yeni bir hover eskisini iptal eder.
- `src/extract.js` "İş İlanı Hakkında" kutusunu (`.job-detail-content`: ilan metni
  `[data-test="qualifications-and-job-description"]` + "Aday Kriterleri") kopyalar. Anahtar
  kelime araması yoktur; bölüm sayfadaki sırası ve biçimiyle (paragraf, kalın yazı, liste,
  başlık) gelir. "Daha Fazla Göster" ile açılan kısım sayfada zaten bulunduğu için tıklamaya
  gerek yoktur.
- Kopyalanan HTML bir izin listesiyle yeniden oluşturulur:
  - Resim ve medya (`img`, `figure`, `picture`, `svg`, `video`, `iframe` …) kaldırılır.
  - `script`, `style` ve form öğeleri kaldırılır.
  - Tüm özellikler (`style`, `onclick`, `class` …) silinir. Yalnızca `http(s)` linkleri ve
    "Aday Kriterleri" düzeni için birkaç sınıf kalır.
  - Boş paragraflar atılır.
- Sonuçlar sekme oturumu boyunca (`sessionStorage`) önbellekte tutulur; aynı ilan tekrar istenmez.
  Önbellekten gelen HTML de panele konmadan önce tekrar temizlenir.

## İncelendi / açıldı renkleri

- **Sarı**: İlanın metni panelde en az 1,5 sn göründü. Listenin üzerinden fareyle hızlıca geçmek
  ilanı işaretlemez.
- **Yeşil**: İlan açıldı. Şunlar sayılır:
  - karta tıklama (Ctrl/orta tuş ile yeni sekme dahil)
  - paneldeki "İlanı aç ↗" linki
  - ilan sayfasının herhangi bir yolla bir sekmede açılması (sağ tık → yeni sekme, başka bir
    sayfadan gelen link)
- Arka plandaki gizli iframe "açıldı" sayılmaz.
- Durum sadece yükselir (sarı → yeşil).
- `src/history.js` kayıtları `chrome.storage.local` içinde ilan başına bir anahtar olarak tutar:
  `h:<ilanId>` → `{ s: 1|2, t }`. Tarayıcı kapanınca da kalırlar ve tüm Kariyer.net sekmeleri
  arasında paylaşılırlar. Bir sekmede açılan ilan, diğer sekmedeki listede anında yeşile döner.
  60 günden eski kayıtlar silinir.
- `src/highlight.js` kartlara `data-kn-state="seen|clicked"` özelliği verir ve rengi bir `::after`
  katmanıyla çizer: incelenen kartlarda sarı, açılan kartlarda yeşil bir çerçeve (zemin rengi
  değişmez). Vue listeyi yeniden çizdiğinde (filtre, sayfalama) `MutationObserver` yeni
  kartları yeniden boyar.
- Henüz bir "geçmişi temizle" düğmesi yok. Şimdilik geçmişi silmenin yolu, eklentiyi
  `chrome://extensions` sayfasından kaldırıp yeniden yüklemek.

## Filtre (eklenti simgesine tıklayınca)

Chrome araç çubuğundaki eklenti simgesine tıklayınca açılan kutuda iki anahtar var:

- **Başvurulanları gizle**: Kariyer.net'in "Başvuruldu" işaretlediği ilanlar (kartta `applied`
  sınıfı / `data-type="applied"` rozeti).
- **İncelenenleri gizle**: Kariyer.net'in "İncelendi" işaretlediği ilanlar (kartta
  `inspacted-badge` sınıfı / `data-type="inspected"` rozeti).

Her anahtarın yanında o işaretten bu sayfada kaç ilan olduğu, altta da kaç ilanın gizli olduğu
yazar.

- Ayar `chrome.storage.local` içinde (`kn:settings`) tutulur. Açık tüm Kariyer.net sekmelerine
  anında uygulanır ve tarayıcı kapanınca da kalır.
- Kartın dış kutusu gizlenir, listede boşluk kalmaz.
- "Bu İlanla Birlikte Görüntülenenler" gibi yatay kaydırmalı listelerdeki kartlar, kaydırma
  düzeni bozulmasın diye gizlenmez.
- Önizleme paneli ilanı arka planda açtığı için, Kariyer.net önizlediğiniz ilanları da büyük
  ihtimalle "İncelendi" olarak işaretler. "İncelenenleri gizle" açıksa, bu ilanlar liste
  yenilendiğinde gizlenir.

## Notlar

- Kariyer.net doğrulama (captcha) isterse eklenti bunu aşmaya çalışmaz. Panelde ilanı bir kez yeni
  sekmede açıp doğrulamayı tamamlamanız söylenir.
- Arka planda açılan ilanlar Kariyer.net tarafında "görüntülendi" olarak sayılabilir.
- Kariyer.net sayfa yapısını değiştirirse `src/extract.js` içindeki `findSection` seçicilerini
  güncellemek yeterlidir.

## Dosyalar

```
manifest.json      MV3 manifest (yalnızca www.kariyer.net üzerinde çalışır, izin: storage)
src/extract.js     "İş İlanı Hakkında" bölümünü bulma ve güvenli HTML'e çevirme
src/history.js     incelendi/açıldı kayıtları (chrome.storage.local)
src/settings.js    filtre ayarları (popup ve sekmeler arasında ortak)
src/highlight.js   kartlara sarı/yeşil çerçeve, filtreye göre gizleme, sayfa sayıları
popup/             eklenti simgesine tıklayınca açılan filtre kutusu
src/content.js     hover algılama, yükleme (fetch → iframe), önbellek, panel (Shadow DOM),
                   incelendi/açıldı olaylarını kaydetme
icons/             eklenti ikonları
```
