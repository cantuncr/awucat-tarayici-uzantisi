# Mağaza listeleme metinleri ve gönderim notları

Paket: `pnpm zip` → `dist/awucat-extension.zip` (Chrome Web Store, Edge Add-ons, Opera, Yandex) ve
`dist/awucat-extension-firefox.zip` (Firefox AMO). Sürüm `manifest.json` içindeki `version`
alanından gelir; her gönderimde artırın.

Safari (Mac App Store) ayrı gönderilir: Xcode projesi ve adım adım yayın talimatı
`../safari-extension/README.md` ("Yayınlama" bölümü). Safari metninde `.zip → .udf` düzeltmesinin
yalnızca WhatsApp Web'de çalıştığı belirtilmelidir (bkz. `../safari-extension/COMPAT.md`).

## Chrome Web Store

- **Geliştirici hesabı:** tek seferlik 5 USD kayıt ücreti (Google hesabı, ödeme profili). Ticari
  bir tüzel kişi adına yayınlanacaksa "Trader" (AB DSA) bilgisi ve doğrulanmış e-posta gerekir.
- **İnceleme:** basit MV3 uzantıları genelde 1–3 iş günü; `scripting` + isteğe bağlı geniş host
  izinleri (`http(s)://*/*`) daha uzun ("in-depth") incelemeye düşebilir. Aşağıdaki gerekçeleri
  eksiksiz doldurun.
- **Gerekli görseller:** 128×128 simge (`icons/icon-128.png`), en az 1 ekran görüntüsü 1280×800
  (veya 640×400), isteğe bağlı küçük tanıtım karosu 440×280 ve 1400×560 marquee.
- **Gizlilik alanı:** "Gizlilik politikası URL'si" zorunlu → `PRIVACY.md` içeriğini
  `https://awucat.app/uzanti/gizlilik` gibi herkese açık bir adreste yayınlayın (veya GitHub'daki
  ham dosya). "Veri kullanımı" formunda **hiçbir veri toplanmaz** işaretlenir; üç sertifikasyon
  kutusu işaretlenir. "Uzaktan kod kullanıyor mu?" → Hayır.
- **Tek amaç (single purpose) açıklaması:** "UYAP UDF belgelerini tarayıcıda açmayı ve
  WhatsApp/e-posta ile bozulan .udf indirmelerini düzeltmeyi sağlar."
- **Dağıtım:** Türkiye + tüm bölgeler; dil Türkçe (İngilizce açıklama isteğe bağlı).
- Yandex Browser ve Opera kullanıcıları uzantıyı doğrudan Chrome Web Store'dan kurar; ayrı paket
  gerekmez.

### Ad (≤ 45 karakter)

```
AwuCat — UDF aç, .zip düzelt
```

### Kısa açıklama (≤ 132 karakter)

```
WhatsApp'ın .zip yaptığı UDF indirmelerini düzeltir; bağlantıdaki UDF, PDF ve Word dosyalarını AwuCat'te açar. Veri toplamaz.
```

### Ayrıntılı açıklama

```
UYAP UDF dosyalarıyla çalışan avukatlar, kâtipler ve vatandaşlar için küçük, izinleri dar bir yardımcı.

▪ WhatsApp ".zip" sorunu bitti
WhatsApp (özellikle iPhone) UDF dosyalarını "dilekce.udf.zip" ya da "dilekce.zip" olarak gönderir.
Uzantı, WhatsApp Web'den indirdiğiniz dosyanın adını kaydedilirken düzeltir ve kısa bir bildirim
gösterir. Dosyanın içine bakar: yalnızca gerçekten UDF olan arşivler ".udf" yapılır, sıradan zip
dosyaları olduğu gibi kalır. E-posta eklerinde de dosya adı ".udf.zip" ise düzeltilir.

▪ Sağ tık → "AwuCat'te aç"
UYAP portalı, e-posta veya herhangi bir sitedeki .udf, .zip, .pdf, .docx, .odt, .rtf, .tif
bağlantısına sağ tıklayın; belge AwuCat görüntüleyicisinde açılır. Seçili bir metinden yeni
UDF belgesi de oluşturabilirsiniz.

▪ Araç çubuğu penceresi
Editör, Görüntüleyici ve Dönüştürücü'ye tek tık; bilgisayarınızdan dosya seçin veya pencereye
sürükleyin, AwuCat'te açılsın.

▪ Gizlilik
Hiçbir veri toplanmaz. Dosyalar tarayıcınızın dışına çıkmaz: uzantı dosyayı tarayıcı içinde indirir
ve aynı tarayıcıdaki AwuCat sekmesine aktarır. Başka bir siteye giden bağlantılar için site
erişimi yalnızca o an, o site için sorulur ve ayarlardan kaldırılabilir. Kod açık kaynaktır.

AwuCat: tarayıcıda çalışan, %100 istemci taraflı UDF editörü, görüntüleyicisi ve dönüştürücüsü
(UDF ⇄ PDF/Word, e-imza kontrolü, şablonlar). https://awucat.app

Not: İndirme adı düzeltmesi Chrome, Edge, Brave, Opera ve Yandex'te çalışır (Firefox bu API'yi
sunmaz). Ağ üzerinden "application/zip" olarak etiketlenen indirmelerde tarayıcı ".zip" uzantısını
zorlar; bu durumda dosyayı AwuCat görüntüleyicisine bırakmanız yeterlidir, .zip uzantılı UDF'leri
doğrudan açar.
```

### Kategori, dil, anahtar kelimeler

Kategori: **Üretkenlik** (Productivity). Dil: Türkçe. Arama terimleri açıklama içinde geçmelidir:
udf, udf aç, udf zip, whatsapp udf, uyap, udf görüntüleyici, udf pdf.

### İzin gerekçeleri (Chrome Web Store formu; Türkçe + İngilizce)

| İzin | Gerekçe |
| --- | --- |
| `downloads` | İndirme adını kaydedilmeden önce ".udf.zip" → ".udf" olarak düzeltmek (`onDeterminingFilename`); bildirime tıklanınca dosyayı klasörde göstermek. / Rename ".udf.zip" downloads back to ".udf" before they are written; reveal the file when the notification is clicked. |
| `contextMenus` | Bağlantılar ve seçili metin için "AwuCat'te aç" menüsü. / "Open in AwuCat" items on links and selected text. |
| `storage` | Kullanıcı ayarları (`sync`) ve kısa ömürlü durum (`session`). / User settings and short-lived state. |
| `activeTab` | Sağ tıklanan sekmede aynı origin'deki bağlantıyı sayfanın çerezleriyle sayfa içinde indirmek. / Fetch a same-origin link inside the page the user right-clicked, with its cookies, without broad host access. |
| `scripting` | `activeTab` ile aynı amaçla `executeScript`; kullanıcı özel bir AwuCat adresi girerse içerik betiğini oraya kaydetmek. / `executeScript` with `activeTab`; registering the handover content script on a user-configured AwuCat origin. |
| `notifications` | Düzeltme, hata ve izin bildirimleri. / Short status notifications. |
| Host `https://web.whatsapp.com/*` | Chrome, uzantı önerdiği adı MIME türüne göre ".zip"e çevirdiği için WhatsApp Web'de `URL.createObjectURL` sarılarak zip blob'ları `octet-stream` yapılır ve UDF imzası kontrol edilir. / Chrome forces the MIME type's extension onto extension-suggested names; the shim re-types zip blobs and checks for the UDF signature so the rename can work. |
| İsteğe bağlı `http(s)://*/*` | Yalnızca kullanıcı başka bir sitedeki bağlantıyı "AwuCat'te aç" ile açtığında, o origin için, o anda istenir. / Requested per origin, only when the user opens a cross-origin link. |
| İçerik betiği `awucat.app`, `localhost:3000` | Dosyayı AwuCat sekmesine `postMessage` ile vermek. / Hands the file to the AwuCat tab. |

Tek amaç: "UYAP UDF belgelerini AwuCat'te açmak ve bozuk .udf indirme adlarını düzeltmek".

### Ekran görüntüleri (hazırlanacak, 1280×800)

1. WhatsApp Web'de indirme + "dosya .udf olarak düzeltildi" bildirimi.
2. Bir UYAP/e-posta sayfasında sağ tık menüsü "AwuCat'te aç".
3. Popup (Editör / Görüntüleyici / Dönüştürücü, dosya bırakma alanı).
4. Açılan belge AwuCat görüntüleyicisinde.
5. Ayarlar sayfası (uygulama adresi, izinler).

`scripts/verify.mjs` popup ve görüntüleyici için `.verify/popup.png` ve `.verify/handover.png`
üretir; mağaza için 1280×800'e uyarlanmaları gerekir.

## Microsoft Edge Add-ons

Kayıt ücretsiz (Partner Center). Aynı `awucat-extension.zip` yüklenir; Chrome'daki metinler
kullanılabilir. Gizlilik politikası URL'si ve "Bu uzantı veri toplamaz" beyanı istenir. İnceleme
genelde birkaç iş günü.

## Firefox Add-ons (AMO)

Kayıt ücretsiz. `awucat-extension-firefox.zip` yüklenir (`background.scripts` olay sayfası,
`browser_specific_settings.gecko.id = uzanti@awucat.app`, `data_collection_permissions: none`).
Firefox'ta `downloads.onDeterminingFilename` bulunmadığından indirme düzeltmesi ve WhatsApp betikleri
bu pakette yoktur; listeleme metninde yalnızca "AwuCat'te aç" ve popup anlatılmalıdır. Paket
Firefox'ta henüz denenmemiştir; göndermeden önce `about:debugging` ile elle test edin.

## Sürüm notu (0.1.0)

- İlk sürüm: WhatsApp Web .zip → .udf düzeltmesi (içerik kontrollü), bağlam menüsü, popup, ayarlar.
