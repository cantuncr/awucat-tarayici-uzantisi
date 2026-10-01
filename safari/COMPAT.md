# Safari uyumluluk denetimi (Safari 18 → 26/27, macOS)

Kısa sonuç: Uzantının üç işinden ikisi Safari'de aynen çalışır (sağ tık → "AwuCat'te aç", araç
çubuğu penceresi). WhatsApp `.zip → .udf` düzeltmesi Safari'de **yalnızca WhatsApp Web'de** ve farklı
bir yolla çalışır (Safari'de `downloads` API'si yok). Sistem bildirimleri yerine rozet + popup /
sayfa içi not kullanılır. Kod tek: tüm farklar çalışma anında algılanır (`src/lib/platform.ts`),
Safari paketi yalnızca farklı bir manifest alır (`scripts/build.mjs` → `dist/safari`).

**Kaynaklar**

- MDN browser-compat-data (`webextensions/*`, 30 Eylül 2026'da çekildi) — sürüm numaraları buradan.
- Bu makinede ölçüm: macOS 27.0, Safari 27.0, Xcode 27.0 (`safari-web-extension-converter` 27.0).
  - `test/WebExtensionHarness.swift`: paketi macOS'un kendi WebKit uzantı motoruna
    (`WKWebExtension` / `WKWebExtensionController` — Safari'nin kullandığı motor) yükler.
  - `apps/browser-extension/scripts/verify-webkit.mjs`: Playwright WebKit 26.6 ile sayfa betikleri.
- "Doğrulandı" = yukarıdaki testlerden birinde gözlendi. "BCD" = yalnızca uyumluluk verisine dayanır.

## API / manifest tablosu

| Özellik | Chrome paketi | Safari desteği | Safari paketinde ne yapıldı |
| --- | --- | --- | --- |
| `downloads` (`onDeterminingFilename`, `show`) | İndirme adı düzeltmesi, bildirimde "klasörde göster" | **Yok** (hiçbir sürümde; BCD) | İzin manifestten çıkarıldı. WhatsApp Web indirmeleri sayfa içinde, tıklama anında yeniden adlandırılır (aşağıda). Ağ indirmeleri (webmail ekleri) düzeltilemez. |
| `notifications` | Durum/hata bildirimleri | **Yok** (BCD) | İzin çıkarıldı. `notify()` mesajı `storage.session`'a yazar, simgeye `!` rozeti koyar; popup açılınca gösterip temizler. WhatsApp Web'deki yeniden adlandırma için sayfanın köşesinde kısa bir not. |
| `contextMenus` / `menus` (`link`, `selection`, `targetUrlPatterns`) | Sağ tık menüsü | Var, 14+ (BCD). `*://*/*.udf?*` desenleri WebKit tarafından geçerli sayılıyor (doğrulandı) | Aynı kod; `menusApi()` her iki adı da dener. Gerçek sağ tık **elle denenmeli**. |
| `scripting.executeScript` (`func`+`args`, `frameIds`) | Aynı origin bağlantısını sayfa içinde indirmek | 15.4+, `InjectionResult.result` 17+ (BCD) | Aynı kod. |
| `scripting.registerContentScripts` (`persistAcrossSessions`) | Özel uygulama adresi | 16.4+ (BCD) | Aynı kod; desenden port düşürülür (aşağıda). |
| `content_scripts[].world: "MAIN"` | WhatsApp sayfa kancası | 18+ (BCD). Xcode 27'nin dönüştürücüsü hâlâ "desteklenmiyor" uyarısı veriyor — **uyarı eski**: WebKit betiği sayfa dünyasında çalıştırıyor (doğrulandı) | Kullanılıyor; `browser_specific_settings.safari.strict_min_version = "18.0"`. |
| `storage.session` | Bekleyen izin isteği, koklama sonuçları | 16.4+ (BCD; doğrulandı) | Aynı kod. Safari'de koklama sonuçları arka plana hiç gönderilmez. |
| `storage.sync` | Ayarlar | Var ama **eşitlemez**, `local` gibi davranır (BCD) | Ayarlar Mac başına. |
| `host_permissions`, içerik betiği eşleşmeleri | Kurulumda verilir | Kurulumda **verilmez**: kullanıcı site başına izin verene kadar içerik betikleri çalışmaz (BCD notu) | Popup'ta Safari'ye özel "Erişim izni ver" şeridi (`permissions.request`), kapsayıcı uygulamada ve README'de talimat; zaman aşımı hatası Safari'ye özel yönlendirme verir. |
| `optional_host_permissions` + `permissions.request` | Başka siteye giden bağlantı için o anda izin | 15.5+ / 14+ (BCD); Safari belirli origin'ler için kullanıcıya sorar | Aynı kod. İstemin sağ tık anındaki davranışı **elle denenmeli**. |
| Arka plan: `service_worker` / `scripts` | Servis çalışanı | İkisi de var (15.4+ / 14+) | Apple'ın kendi Xcode şablonundaki gibi kalıcı olmayan arka plan sayfası (`background.scripts`); Firefox paketiyle aynı. WebKit "non-persistent" olarak tanıyor (doğrulandı). Kod aynı. |
| `options_ui.open_in_tab` | Sekmede ayarlar | Yok sayılır, ayarlar her zaman sekmede açılır; dönüştürücü uyarı verir | Zararsız, bırakıldı. |
| `action.setBadgeText` / `setTitle` | — | 15.4+; `setBadgeBackgroundColor` etkisiz (BCD) | Bildirim yedeği için. |
| `minimum_chrome_version` | 116 | Yok sayılır | Safari manifestinden çıkarıldı. |
| **Portlu eşleşme deseni** (`http://localhost:3000/*`) | Çalışır | **Geçersiz**: `"localhost:3000" is invalid` — içerik betiği sessizce düşer (doğrulandı, `WKWebExtension.MatchPattern`) | Safari manifesti `http://localhost/*` kullanır; çalışma anında üretilen desenlerde port atılır (`appOriginPattern`). |
| `chrome.*` ad alanı, Promise dönüşleri | — | `chrome` ve `browser` ikisi de var, Promise döndürür (doğrulandı) | Polyfill gerekmez. |
| `fetch` hata metni | `Failed to fetch` | `Load failed` | `describeError` ikisini de tanır. |

Doğrulanan `WKWebExtension` çıktısı: manifest **hatasız ve uyarısız** ayrıştırıldı; istenen izinler
`activeTab, contextMenus, scripting, storage`; isteğe bağlı site erişimi `http://*/*, https://*/*`;
uzantı sayfasında `contextMenus`, `scripting`, `storage.session` var, `downloads` ve `notifications` yok.

## WhatsApp `.zip → .udf`: Safari'de ne oluyor?

**Chrome'da** servis çalışanı `downloads.onDeterminingFilename` ile adı değiştirir; sayfa kancası yalnızca
blob türünü `application/octet-stream` yapar ve içerik kararını bildirir.

**Safari'de** böyle bir kanca yok. Ölçülenler (Playwright WebKit ve sistem WebKit'i):

- WebKit, blob'un MIME türü ne olursa olsun `<a download="…">` adını aynen kullanıyor:
  `application/zip` blob + `download="Karar.udf"` → `Karar.udf`. Chrome'daki "MIME türünün uzantısını
  zorla" davranışı WebKit katmanında yok.
- Uzantı olmadan WhatsApp tarzı bir indirme `Karar.zip` olarak kalıyor (kontrol testi).
- Kullanıcı etkileşimi olmadan, gecikmeli programatik `a.click()` da indirmeyi başlatıyor.

Bu yüzden Safari'de sayfa kancası (`whatsapp-main.ts`, `world: "MAIN"`) indirme başlamadan hemen önce
`download` özniteliğini değiştirir:

1. İzole dünya betiği (`whatsapp.ts`) manifestte `downloads` izni olmadığını görünce sayfa kancasına
   `{ type: "awucat-ext:config", renameInPage: true, fixZip, heuristic }` gönderir. (İçerik
   betikleri `chrome.downloads`'u hiçbir tarayıcıda göremez; karar manifestten verilir.) Chrome'da bu
   mesaj hiç gönderilmez ve aşağıdaki kancalar kurulmaz — Chrome davranışı değişmedi.
2. Kanca `HTMLAnchorElement.prototype.click`'i ve belge düzeyinde `click` olayını yakalar. Hedef,
   kancanın izlediği bir zip/octet-stream blob'u ise Chrome'daki **aynı** `decideFilename` kuralları
   (içerik koklaması önce, sonra `.udf.zip`, sonra ada göre tahmin) uygulanır.
3. Koklama asenkron olduğu için karar gelmeden gelen tıklama en fazla 1,5 sn bekletilip yeniden
   oynatılır; arada çağrılan `URL.revokeObjectURL` indirme başlayana kadar ertelenir (WhatsApp tıklamadan
   hemen sonra iptal edebilir). Karar zaten hazırsa ad eşzamanlı değişir.
4. Ad değiştiyse, "Bildirim göster" açıksa WhatsApp Web sayfasının köşesinde 5 sn'lik bir not çıkar.

Sistem WebKit'inde doğrulanan sonuç: `Gerekçeli Karar.zip` (gerçek UDF) → indirme temsilcisine
`Gerekçeli Karar.udf` önerildi ve baytlar birebir aynı; `tensip.udf.zip` → `tensip.udf`; sıradan zip ve
içi UDF olmayan `sahte.udf.zip` adlarını korudu; "fixZip" kapalıyken ad değişmedi.

**Safari'de bu düzeltme neden daha önemli:** Safari'nin "Güvenli dosyaları indirdikten sonra aç"
ayarı (varsayılan açık) `.zip` dosyalarını otomatik açar; `.zip` olarak inen bir UDF, içinde
`content.xml` olan bir klasöre dönüşür. `.udf` olarak kaydedilen dosyaya dokunulmaz.

**Kısıtlar (Safari'de gerileyenler)**

- Yalnızca WhatsApp Web'deki blob indirmeleri. Webmail veya başka sitelerden ağ üzerinden gelen
  `x.udf.zip` indirmelerinin adı değiştirilemez (Safari'de indirme API'si yok).
- WhatsApp indirmeyi `<a download>` yerine `window.open(blob)` / `location = blob` ile yaparsa ad
  değiştirilemez (bugünkü davranış `<a download>` + tıklama; değişirse kanca etkisiz kalır, zarar vermez).
- Safari.app'in kendi indirme katmanının (İndirilenler klasörü, "güvenli dosya" işlemesi) önerilen adı
  aynen kullandığı varsayılıyor; bu katman otomatik testle denenemedi — **elle denenmeli**.
- "Klasörde göster" (bildirime tıklama) yok.

## Doğrulananlar / doğrulanamayanlar

| Kontrol | Nasıl | Sonuç |
| --- | --- | --- |
| Safari manifesti WebKit'te hatasız ayrışıyor, arka plan kalıcı değil | `node test/run.mjs` | Geçti |
| `whatsapp-main.js` sayfa dünyasında çalışıyor (`world: "MAIN"`) | aynı | Geçti |
| WhatsApp tarzı indirmeler: UDF → `.udf`, bayt bütünlüğü, sıradan/sahte zip korunuyor, not görünüyor | aynı + `pnpm --dir apps/browser-extension verify:webkit` (10 kontrol) | Geçti |
| Uzantı sayfasında API varlığı; ayarlarda `.zip` anahtarı Safari'de açık kalıyor | `node test/run.mjs` | Geçti |
| Popup/dosya seçici yolu: uzantı sayfası → arka plan → `tabs.create` → içerik betiği (`localhost`) → parça parça aktarım → uygulama belgeyi gösteriyor | `node test/run.mjs` (uygulama `APP_URL`'de açıkken) | Aktarım her çalıştırmada geçti; uygulamanın belgeyi çizmesi birkaç çalıştırmada geçti, diğerlerinde `next dev` sayfayı teslimden sonra yeniden yükledi (aşağıdaki not) |
| Xcode projesi derleniyor (imzasız ve ad-hoc imzalı) | `SIGN=none sh scripts/build-app.sh`, `sh scripts/build-app.sh` | BUILD SUCCEEDED |
| Chrome paketi değişmedi | `pnpm --dir apps/browser-extension verify` (12 kontrol), `pnpm test`, `typecheck` | Geçti |

Otomatik denenemeyenler (gerçek Safari.app gerekir, README'deki "Yerel çalıştırma" adımları):

- Uzantının Safari'ye yüklenmesi ("İmzasız uzantılara izin ver"), Ayarlar > Uzantılar'da görünmesi.
- Safari'nin site erişimi istemi ve popup'taki "Erişim izni ver" düğmesinin gerçek davranışı.
- Gerçek sağ tık menüsü, `activeTab` ile sayfa içi indirme ve sağ tık anında `permissions.request`.
- Popup'un araç çubuğu penceresi olarak açılması; popup içindeki dosya seçicinin (Safari popover'ı
  odak kaybında kapanabilir — sürükle-bırak ve uygulamanın kendi seçicisi alternatif).
- Gerçek web.whatsapp.com (oturum gerektirir) ve Safari'nin İndirilenler klasörüne yazdığı ad.

Test düzeneğine ait not: `next dev` ile çalışan uygulama sayfası, yeni bir WebKit görünümünde ilk
yüklemeden hemen sonra kendini bir kez yeniden yüklüyor (uzantı hiç yokken düz `WKWebView`'da da
görüldü — geliştirme sunucusunun davranışı). Dosya bu yeniden yüklemeden önce teslim edilirse kaybolur;
bu yüzden "belgeyi çizdi" kontrolü geliştirme sunucusuna karşı kararsız. Kararlı sonuç için üretim
derlemesine karşı çalıştırın (`APP_URL=… node test/run.mjs`). Uzantının aktarım yolu (sekme açma, içerik
betiği, parçalı aktarım) her çalıştırmada geçti.

## iOS / iPadOS

Şimdilik anlamlı değil:

- iOS Safari'de `menus`/`contextMenus` **yok** (BCD) — "AwuCat'te aç" sağ tık menüsü olmaz.
- iPhone'da WhatsApp Web kullanılmaz (yerel uygulama); asıl sorun, WhatsApp uygulamasından paylaşılan
  `.zip` dosyası. Bu Safari'nin değil **Dosyalar / paylaşım sayfası** alanı: çözümü, mobil uygulamaya
  (`apps/mobile`) `.zip`/`.udf` için "Birlikte aç" / paylaşım uzantısı eklemek ya da PWA'nın `.zip`'i
  doğrudan açmasıdır (uygulama zaten `.zip` uzantılı UDF'yi açıyor).
- iPad'de web.whatsapp.com masaüstü modunda açılabildiği için kanca çalışabilir, ama kullanıcı kitlesi
  küçük. İleride gerekirse aynı Xcode projesine `--rebuild-project` ile iOS hedefi eklenebilir; kod
  değişikliği gerekmez (background zaten kalıcı değil).
