# AwuCat — Safari uzantısı (macOS)

Chrome/Edge uzantısının (`../browser-extension`) Safari Web Extension olarak paketlenmiş hâli.
Kaynak kod ortaktır; bu klasörde yalnızca Xcode projesi (kapsayıcı macOS uygulaması + uzantı
hedefi), eşitleme/derleme betikleri ve WebKit testleri bulunur. Safari'de neyin aynı, neyin farklı
çalıştığı: [COMPAT.md](COMPAT.md).

Durum: **geliştirme aşamasında**. Proje derleniyor ve uzantı macOS'un WebKit uzantı motorunda
test edildi; gerçek Safari'de elle deneme ve App Store gönderimi henüz yapılmadı.

Gereksinimler: macOS 13.5+ ve Safari 18+ (kullanıcı için); geliştirme için Xcode 16+ (bu proje Xcode
27 ile üretildi), Node 22.18+.

## Yapı

```
AwuCat Uzantı/                          Xcode projesi (safari-web-extension-converter çıktısı, sadeleştirilmiş)
  AwuCat Uzantı.xcodeproj
  AwuCat Uzantı/                        kapsayıcı uygulama: Türkçe kurulum talimatı, "Safari Ayarları'nı aç"
  AwuCat Uzantı Extension/Resources/    ../browser-extension/dist/safari'nin kopyası (elle düzenlemeyin)
scripts/sync-resources.mjs                  dist/safari → Resources; sürümü manifest.json'dan alır
scripts/build-app.sh                        xcodebuild (ad-hoc imzalı veya imzasız) → build/
scripts/make-app-icons.mjs                  public/icons/icon.svg → uygulama simgeleri (yalnızca monorepo)
test/WebExtensionHarness.swift, run.mjs     uzantıyı macOS WebKit uzantı motorunda çalıştıran test
COMPAT.md                                   Safari uyumluluk denetimi
```

Kimlikler: uygulama `com.ctss.awucat.safari`, uzantı `com.ctss.awucat.safari.Extension`
(App Store, uzantı kimliğinin uygulama kimliğiyle başlamasını ister).

## Derleme

Kök dizinden:

```bash
pnpm --dir apps/browser-extension install --ignore-workspace   # bir kez
pnpm extension:build:safari      # uzantıyı derle → Resources'a kopyala → xcodebuild (ad-hoc imzalı, Debug)
pnpm extension:verify:safari     # WebKit testleri (Playwright WebKit + WKWebExtension düzeneği)
```

Tek tek:

```bash
node apps/safari-extension/scripts/sync-resources.mjs --build   # dist/safari üret ve Xcode projesine kopyala
sh apps/safari-extension/scripts/build-app.sh                    # ad-hoc imzalı Debug → build/DerivedData/Build/Products/Debug/
SIGN=none sh apps/safari-extension/scripts/build-app.sh          # hiç imzasız (yalnızca derleme kontrolü)
node apps/safari-extension/test/run.mjs                          # WKWebExtension testi (uygulama localhost:3000'de açıksa aktarımı da dener)
```

`src/` altındaki TypeScript değişince önce `sync-resources.mjs --build` çalıştırın; Xcode yalnızca
`Resources/` kopyasını görür. Uzantıya yeni bir üst düzey dosya eklenirse betik durur: dosyayı Xcode'da
"AwuCat Uzantı Extension" hedefinin Resources'ına ekleyin (veya projeyi yeniden üretin, aşağıda).

Projeyi baştan üretmek gerekirse (ör. iOS hedefi eklemek için `--rebuild-project`):

```bash
xcrun safari-web-extension-converter apps/browser-extension/dist/safari \
  --project-location apps/safari-extension --app-name "AwuCat Uzantı" \
  --bundle-identifier com.ctss.awucat.safari --macos-only --swift \
  --copy-resources --no-open --no-prompt --force
```

Dönüştürücü uygulama kimliğini ada göre yanlış üretir (`com.ctss.awucat.AwuCat-Uzant-`), dağıtım
hedefini Xcode sürümüne eşitler ve İngilizce metin koyar; bu klasördeki düzeltmeleri (kimlik, macOS
13.5, kategori, telif, şifreleme beyanı, Türkçe arayüz, simgeler) yeniden uygulamak gerekir. `world` ve
`open_in_tab` için verdiği "desteklenmiyor" uyarısı eskidir (COMPAT.md).

## Yerel çalıştırma (Safari'de deneme)

1. `pnpm extension:build:safari`
2. Safari > Ayarlar > Gelişmiş > **"Web geliştiricileri için özellikleri göster"**i işaretleyin.
3. İmzasız uzantılara izin verin — Safari 17 ve sonrası: Safari > Ayarlar > **Geliştirici** >
   **"İmzasız uzantılara izin ver"** (eski sürümlerde Geliştir menüsü > "İmzasız Uzantılara İzin Ver").
   Yönetici parolası ister; Safari her kapandığında sıfırlanır.
4. `apps/safari-extension/build/DerivedData/Build/Products/Debug/AwuCat Uzantı.app`'i **bir kez
   açın** (Finder'dan veya `open`). Uygulama uzantıyı Safari'ye tanıtır ve talimatları gösterir.
5. Safari > Ayarlar > Uzantılar > **AwuCat**'i işaretleyin.
6. Site erişimi: aynı ekranda "Web Siteleri"nden `awucat.app` ve `web.whatsapp.com` için **İzin Ver**
   (veya uzantı penceresindeki "Erişim izni ver" düğmesi). Safari bu izinleri kurulumda vermez; verilmezse
   dosya aktarımı ve WhatsApp düzeltmesi çalışmaz. Yerel uygulamaya karşı denemek için uzantı ayarlarından
   "Yerel geliştirme" seçip `localhost` için de izin verin.
7. Arka plan sayfasını incelemek için: Geliştir menüsü > Web Uzantısı Arka Plan İçeriği > AwuCat.

Elle kontrol listesi (otomatik testlerin kapsamadıkları): WhatsApp Web'den `.zip` olarak gelen bir UDF'yi
indirin → İndirilenler'de `.udf` olmalı ve köşede "dosya .udf olarak kaydedildi" notu çıkmalı; sıradan bir
zip `.zip` kalmalı; bir `.udf`/`.pdf` bağlantısına sağ tık → "AwuCat'te aç"; başka siteye giden
bağlantıda izin istemi; popup'tan dosya seçme ve sürükle-bırak; hata durumunda simgede `!` rozeti ve
popup'ta mesaj.

## Yayınlama (Mac App Store)

Safari uzantıları yalnızca Mac App Store'dan (veya Developer ID ile imzalanıp notarize edilmiş bir
uygulamanın içinde) dağıtılabilir. Önerilen yol App Store.

1. **Apple Developer Program** üyeliği — yıllık 99 USD. Şirket adına (CTSS LLC) kayıt için D-U-N-S
   numarası gerekir; onay birkaç gün sürebilir.
2. **İmzalama**: Xcode'da projeyi açın → her iki hedefte (uygulama ve uzantı) Signing & Capabilities >
   Team = geliştirici hesabı, "Automatically manage signing" açık. Kimlikler (`com.ctss.awucat.safari`
   ve `.Extension`) Xcode tarafından kaydedilir. App Sandbox iki hedefte de açık (zorunlu).
3. **App Store Connect** > Uygulamalar > "+" > Yeni macOS uygulaması: ad (mağazada benzersiz olmalı, ör.
   "AwuCat — Safari Uzantısı"), birincil dil Türkçe, paket kimliği `com.ctss.awucat.safari`, SKU.
4. **Sürüm/derleme numarası**: `MARKETING_VERSION` manifest sürümünden gelir (`sync-resources.mjs`);
   her yüklemede `CURRENT_PROJECT_VERSION`'ı (derleme numarası) Xcode'da artırın.
5. **Arşiv ve yükleme**: `pnpm extension:build:safari` ile Resources'ı güncelleyin → Xcode'da şema
   "AwuCat Uzantı", hedef "Any Mac" → Product > **Archive** → Organizer > **Validate App** →
   **Distribute App** > App Store Connect > Upload. Mac App Store için ayrıca notarizasyon gerekmez; Apple
   imzalar. (Mağaza dışı dağıtımda: Developer ID ile imzala → `xcrun notarytool submit … --wait` →
   `xcrun stapler staple`.)
6. **Mağaza bilgileri**: açıklama ve anahtar kelimeler (`../browser-extension/STORE_LISTING.md`'deki
   metinler uyarlanabilir; Safari'de düzeltmenin yalnızca WhatsApp Web'de çalıştığını yazın), destek URL'si,
   gizlilik politikası URL'si `https://awucat.app/uzanti#gizlilik`, kategori **Üretkenlik**, en az bir
   ekran görüntüsü (Mac: 1280×800, 1440×900, 2560×1600 veya 2880×1800), yaş derecelendirmesi anketi (4+),
   fiyat: ücretsiz.
7. **App Privacy (gizlilik etiketi)**: "Veri toplanmıyor" (**Data Not Collected**). Uzantının ve uygulamanın
   sunucusu, analitiği yoktur; dosyalar cihazdan çıkmaz.
8. **Şifreleme beyanı**: `ITSAppUsesNonExemptEncryption = NO` Info.plist'e eklendi; yüklemede ayrıca
   sorulmaz.
9. **İnceleme notu** (App Review Information): "Uzantıyı Safari > Ayarlar > Uzantılar'dan etkinleştirin ve
   web.whatsapp.com ile awucat.app için site erişimi verin. Bir .udf/.pdf bağlantısına sağ tıklayıp
   'AwuCat'te aç'ı seçin; dosya awucat.app sekmesinde açılır. Giriş gerekmez. Uzantı veri toplamaz."
   İnceleme genelde 1–3 gün sürer; geniş isteğe bağlı site erişimi (`http(s)://*/*`) için gerekçe
   sorulabilir — "yalnızca kullanıcının sağ tıkladığı bağlantının sitesi için, o anda istenir" deyin.
10. Onaydan sonra `/uzanti` sayfasındaki Safari bölümünü App Store bağlantısıyla güncelleyin.

Alternatif: App Store Connect hesabınızda web uzantısı paketleme seçeneği (ZIP yükleyip Apple'ın
paketlemesi) açıksa Xcode olmadan da gönderilebilir; bu depo Xcode yolunu varsayar.

## Gizlilik

Safari paketi Chrome paketinden daha az izin ister (`downloads` ve `notifications` yok) ve daha az veri
tutar: WhatsApp Web koklama sonuçları arka plana gönderilmez/saklanmaz; bildirim yerine son durum mesajı
en fazla 15 dk `storage.session`'da tutulur ve popup açılınca silinir. Ayrıntı: `../browser-extension/PRIVACY.md`.
