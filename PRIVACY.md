# AwuCat tarayıcı uzantısı — Gizlilik Politikası

Yürürlük tarihi: 30 Eylül 2026 · Sürüm 0.1.0

Bu politika yalnızca **tarayıcı uzantısı** içindir. AwuCat web uygulamasının politikası
[awucat.app/gizlilik](https://awucat.app/gizlilik) adresindedir.

## Kısaca

- Uzantı **hiçbir veri toplamaz, saklamaz veya iletmez.** Analitik, telemetri, çerez, kimlik, hata
  raporu yoktur; uzantının kendi sunucusu yoktur.
- Dosyalar tarayıcınızın dışına çıkmaz. Bir bağlantıyı "AwuCat'te aç" ile açtığınızda dosya
  tarayıcı tarafından indirilir ve aynı tarayıcıdaki AwuCat sekmesine sekmeden sekmeye aktarılır.
- Tarama geçmişiniz, sayfa içerikleriniz veya mesajlarınız okunmaz.

## Ne işlenir, nerede

| Veri | Nerede | Ne için | Ne kadar |
| --- | --- | --- | --- |
| Ayarlar (uygulama adresi, anahtarlar) | `chrome.storage.sync` — tarayıcı profiliniz (tarayıcı hesabınızla eşitlenebilir) | Uzantının çalışması | Siz değiştirene veya uzantıyı kaldırana kadar |
| Bekleyen "bağlantı aç" isteği (URL) | `chrome.storage.session` — bellek, tarayıcı kapanınca silinir | Site erişimi izni verilince isteği tamamlamak | En fazla 15 dk |
| WhatsApp Web indirme kontrol sonucu (`blob:` URL → UDF mi/değil mi) | `chrome.storage.session` | İndirme adının doğru düzeltilmesi | 10 dk |
| İndirilen dosyanın adı ve MIME türü | Yalnızca bellek, `downloads.onDeterminingFilename` içinde | `.udf.zip` → `.udf` kararı | İşlem süresince |
| Açılan dosyanın içeriği | Yalnızca bellek; servis çalışanı → içerik betiği → AwuCat sekmesi | Dosyayı uygulamaya vermek | Aktarım süresince |

Hiçbir kalem üçüncü taraflara gönderilmez; uzantının ağ istekleri yalnızca **sizin açmak istediğiniz
bağlantıya** yapılır (tarayıcı indirme yapar gibi, sizin çerezlerinizle).

## WhatsApp Web'de ne yapılır

Uzantı `https://web.whatsapp.com` sayfalarında iki küçük betik çalıştırır:

- Sayfa bir dosya indirmesi hazırlarken (`URL.createObjectURL`) zip türündeki dosya nesnelerinin
  türünü `application/octet-stream` yapar. Bu, tarayıcının `.udf` adını `.zip`'e çevirmesini önlemek
  için gereklidir ve dosya içeriğini değiştirmez.
- Bu nesnelerin **ilk 4 KB ve son 64 KB**'ına bakıp UDF olup olmadığını (zip + `content.xml`)
  belirler. Sonuç (`true/false`) uzantının servis çalışanına iletilir. Mesaj metinleri, kişiler veya
  sohbetler okunmaz; sayfa içeriği hiçbir yere gönderilmez.

## Safari sürümü

Safari paketi aynı koddur, ancak daha az izin ister ve daha az şey tutar:

- `downloads` ve `notifications` izinleri yoktur (Safari bu API'leri sunmaz).
- WhatsApp Web'de dosya adı, indirme başlamadan hemen önce sayfanın içinde düzeltilir; koklama sonucu
  (`true/false`) sayfadan çıkmaz, uzantının arka planına gönderilmez ve saklanmaz.
- Sistem bildirimi yerine son durum mesajı (ör. "dosya açılamadı") `storage.session`'da en fazla 15 dk
  tutulur, popup açılınca silinir; WhatsApp Web'de düzeltme notu yalnızca sayfada gösterilir.
- Safari, site erişimini kurulumda vermez; `awucat.app` ve `web.whatsapp.com` için izni siz verirsiniz
  ve Safari > Ayarlar > Uzantılar'dan geri alabilirsiniz. `storage.sync` Safari'de eşitlenmez.

## İzinler

| İzin | Kullanım |
| --- | --- |
| `downloads` | İndirme adını kaydedilmeden önce düzeltmek; bildirime tıklanınca dosyayı klasörde göstermek |
| `contextMenus` | Sağ tık menüsü |
| `storage` | Yukarıdaki ayarlar ve geçici kayıtlar |
| `activeTab`, `scripting` | Sağ tık yaptığınız sekmede, aynı sitedeki bağlantıyı sayfa içinde indirmek; özel uygulama adresine içerik betiği kaydetmek |
| `notifications` | Kısa durum bildirimleri |
| Site erişimi `web.whatsapp.com` | Yukarıdaki WhatsApp Web düzeltmesi |
| İsteğe bağlı site erişimi | Yalnızca başka bir siteye giden bir bağlantıyı açmak istediğinizde, o site için, o anda sorulur. Verilen izinler uzantı ayarlarından kaldırılabilir |
| İçerik betiği `awucat.app`, `localhost:3000` | Dosyayı AwuCat sekmesine vermek |

Uzantı uzaktan kod yüklemez; tüm kod pakette bulunur ve açık kaynaktır (`apps/browser-extension`).

## Çocuklar, satış, profil oluşturma

Kişisel veri toplanmadığı için satış, paylaşım, reklam veya profil oluşturma söz konusu değildir.
Uzantı yaş sınırı gerektiren bir işlev içermez.

## Değişiklikler ve iletişim

Politika değişirse bu dosyanın tarihi ve uzantı sürümü güncellenir. Sorular için:
support@ct-ss.com — CTSS LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA.

---

### English summary (for store reviewers)

The AwuCat browser extension collects, stores and transmits **no user data**: no analytics,
no telemetry, no server of its own. It (1) renames `.udf.zip` downloads back to `.udf` using
`downloads.onDeterminingFilename`, (2) adds an "Open in AwuCat" context-menu item that fetches
the linked document inside the browser and hands the bytes to the AwuCat tab via
`window.postMessage`, and (3) provides a toolbar popup with shortcuts and a file picker. On
`web.whatsapp.com` it wraps `URL.createObjectURL` to re-type zip blobs to `application/octet-stream`
and inspects the first 4 KB / last 64 KB of such blobs to detect UDF files; chats or contacts
are never read. Settings live in `chrome.storage.sync`; short-lived state in `chrome.storage.session`.
Optional host permissions are requested per origin, only when the user opens a cross-origin link,
and can be revoked on the options page. No remote code is loaded. The Safari build requests neither `downloads`
nor `notifications`; on WhatsApp Web it corrects the `<a download>` filename inside the page and keeps
no verdicts; status messages are held in `storage.session` for at most 15 minutes and shown in the popup.
