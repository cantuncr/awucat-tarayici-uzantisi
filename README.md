# AwuCat tarayıcı uzantısı

Örnek dosya (test için): [ornek-dilekce.udf](https://raw.githubusercontent.com/cantuncr/awucat-tarayici-uzantisi/main/ornek/ornek-dilekce.udf)

Chrome, Edge, Brave, Opera ve Yandex Browser için Manifest V3 uzantısı (Firefox ve Safari için ayrı
paketler aynı kaynaktan üretilir, bkz. aşağı). Üç iş yapar, hiçbir veri toplamaz:

1. **WhatsApp ".udf → .zip" düzeltmesi.** WhatsApp Web'den (ve bazı e-posta istemcilerinden)
   indirilen UDF dosyaları `dilekce.udf.zip` ya da `dilekce.zip` olarak gelir. Uzantı, dosya
   kaydedilirken adı `.udf` yapar ve kısa bir bildirim gösterir ("AwuCat: dosya .udf olarak
   düzeltildi"). WhatsApp Web'de dosyanın içine de bakar: yalnızca gerçekten UDF olan (içinde
   `content.xml` bulunan) arşivler yeniden adlandırılır, sıradan zip'ler dokunulmadan kalır.
2. **Sağ tık → "AwuCat'te aç".** `.udf`, `.zip`, `.pdf`, `.docx`, `.doc`, `.odt`, `.rtf`, `.tif`
   bağlantılarında görünür; dosyayı tarayıcı içinde indirip AwuCat sekmesine aktarır. Seçili
   metin için "Seçili metinle AwuCat'te yeni belge" seçeneği editörde yeni belge açar.
3. **Araç çubuğu penceresi.** Editör / Görüntüleyici / Dönüştürücü kısayolları, dosya seçici
   (sürükle-bırak da olur), `.zip` düzeltmesi anahtarı. Ayarlar sayfasında uygulama adresi
   (üretim, yerel geliştirme veya özel), bildirim ve tahmin anahtarları, verilen site izinleri.

Dosyalar hiçbir sunucuya gönderilmez; uzantı dosyayı tarayıcının içinde okur ve `postMessage`
ile AwuCat sekmesine verir. Ayrıntılar için [PRIVACY.md](PRIVACY.md).

## Kurulum (geliştirici modu)

```bash
cd apps/browser-extension
pnpm install --ignore-workspace   # kendi node_modules'ı; kök çalışma alanına dokunmaz
pnpm build                        # dist/chrome, dist/firefox ve dist/safari
```

Chrome/Edge: `chrome://extensions` → **Geliştirici modu** → **Paketlenmemiş öğe yükle** →
`apps/browser-extension/dist/chrome`. Yerel uygulamaya karşı denemek için uzantı ayarlarından
"Yerel geliştirme (http://localhost:3000)" seçin (`pnpm dev` çalışıyor olmalı).

Firefox: `about:debugging#/runtime/this-firefox` → **Geçici eklenti yükle** →
`dist/firefox/manifest.json`. Firefox'ta indirme adı düzeltmesi yoktur (aşağıya bakın).

Safari (macOS): `dist/safari` bir Xcode projesiyle paketlenir — `../safari-extension/README.md`
(kök dizinden `pnpm extension:build:safari`). Safari'deki farklar: `../safari-extension/COMPAT.md`.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `pnpm build` / `pnpm watch` | esbuild ile `src/*.ts` → `dist/chrome`, `dist/firefox`, `dist/safari` (kaynak haritası yalnızca watch'ta) |
| `pnpm typecheck` | `tsc --noEmit` (`@types/chrome`) |
| `pnpm test` | `node --test` — saf mantık testleri (`test/*.test.ts`, Node ≥ 22.18) |
| `pnpm verify` | Playwright Chromium'a paketlenmemiş uzantıyı yükler ve 12 uçtan uca kontrol çalıştırır (uygulama `http://localhost:3000`'de açık olmalı; `APP_URL` ile değiştirilebilir, `HEADED=1` ile pencereli) |
| `pnpm verify:webkit` | Safari yedeğini Playwright WebKit'te dener: `dist/safari`'nin WhatsApp betikleri WhatsApp benzeri bir sayfada, UDF blob'u `.zip` adıyla indirilince WebKit'in `.udf` kaydettiğini kontrol eder (10 kontrol; uygulama gerekmez) |
| `pnpm zip` | `dist/awucat-extension.zip` (Chrome/Edge) ve `dist/awucat-extension-firefox.zip` |
| `pnpm icons` | `public/icons/icon.svg`'den 16/32/48/128 px PNG üretir (`icons/`) |

Kök `vitest` yapılandırmasına dokunulmaz; bu paket kendi başına çalışır.

## Yapı

```
manifest.json            Chrome/Edge MV3 manifesti (Firefox ve Safari sürümleri build sırasında türetilir)
src/background.ts        Servis çalışanı: indirme düzeltmesi, bağlam menüsü, popup mesajları, bekleyen izin akışı
src/content.ts           AwuCat origin'inde çalışır; dosyayı sayfaya postMessage ile verir
src/whatsapp-main.ts     web.whatsapp.com sayfa dünyası: zip blob'larını octet-stream yapar, içeriği koklar
src/whatsapp.ts          web.whatsapp.com izole dünya: koklama sonucunu servis çalışanına iletir
src/popup.*  src/options.*  src/ui.css
src/lib/filename.ts      Saf yeniden adlandırma kuralları (birim testli)
src/lib/sniff.ts         UDF imza kontrolü (zip + content.xml)
src/lib/http.ts          Content-Disposition / URL'den dosya adı, bağlam menüsü desenleri
src/lib/match.ts         Küçük match-pattern eşleştirici
src/lib/handover.ts      Sekmeye parça parça (base64) aktarım
src/lib/settings.ts      chrome.storage.sync ayarları, adres ön ayarları
src/lib/platform.ts      Tarayıcı farklarının çalışma anında algılanması (downloads/notifications/menus, Safari)
src/lib/protocol.ts      Mesaj sözleşmeleri
scripts/                 build, zip, make-icons, verify
test/                    node --test
```

### Uygulama ile sözleşme

`src/components/editor/editor-app.tsx` şunu bekler:

- Sayfa hazır olunca `window.postMessage({ type: "awucat:ready" }, origin)` yayınlar.
- İçerik betiği `window.postMessage({ type: "awucat:open", name, bytes: ArrayBuffer, mime }, origin)`
  gönderir. Uygulama `e.source === window` koşulunu arar; içerik betiğinin `window.postMessage`'ı bu
  koşulu sağlar. Uzantı "ready" mesajını bekler; gelmezse sayfa yüklendikten 5 sn sonra yine gönderir.

Uzantı sekmeyi `…/goruntuleyici?ext=1` (bağlantılar, seçici) veya `…/editor?ext=1` (Word/RTF/ODT/metin,
seçili metin) adresiyle açar. Uygulama adresi ayarlardan değiştirilebilir; ön ayar dışı bir adres
için o origin'e site erişimi istenir ve içerik betiği `chrome.scripting.registerContentScripts` ile
kaydedilir.

## İzinler

| İzin | Neden |
| --- | --- |
| `downloads` | `onDeterminingFilename` ile `.udf.zip` → `.udf`; bildirime tıklayınca dosyayı göstermek |
| `contextMenus` | "AwuCat'te aç" ve seçili metin menüleri |
| `storage` | Ayarlar (`sync`), geçici izin isteği ve WhatsApp koklama sonuçları (`session`) |
| `activeTab` | Menü tıklanan sekmede aynı origin'deki bağlantıyı sayfa içinde (çerezleriyle) indirmek |
| `scripting` | Aynı origin bağlantısı için sayfa içi `fetch`; özel uygulama adresine içerik betiği kaydı |
| `notifications` | "dosya .udf olarak düzeltildi", hata ve izin bildirimleri |
| `host_permissions: https://web.whatsapp.com/*` | İndirme düzeltmesinin çalışabilmesi için sayfa dünyasında `URL.createObjectURL` kancası (aşağıdaki Chrome kısıtı) |
| `optional_host_permissions: http(s)://*/*` | Yalnızca kullanıcı başka bir siteye giden bir bağlantıyı açtığında, o site için, o anda istenir; ayarlardan kaldırılabilir |
| İçerik betiği eşleşmeleri | `https://awucat.app/*`, `http://localhost:3000/*` (dosya aktarımı) |

`<all_urls>`, `tabs`, `webRequest`, `cookies`, `history` gibi izinler **kullanılmaz**.

## Neden WhatsApp Web için sayfa içi kanca var? (Chrome kısıtı)

Playwright ile doğrulandı: Chrome, bir uzantının `onDeterminingFilename` ile önerdiği adı MIME
türünün tercih edilen uzantısına zorlar. İndirme `application/zip` olarak etiketliyse `x.udf` önerisi
sessizce `x.zip` olarak kaydedilir; `application/octet-stream` veya bilinmeyen türlerde `.udf` kalır.
WhatsApp Web belgeleri `application/zip` tipli `Blob` + `<a download>` ile indirdiğinden, uzantı
`web.whatsapp.com`'da `URL.createObjectURL`'i sarar: zip tipli blob'ları `application/octet-stream`
yapar (ad yine `download` özniteliğinden gelir; sıradan zip'ler etkilenmez) ve ilk/son baytlara
bakarak gerçek UDF olup olmadığını servis çalışanına bildirir. Bu sayede `Karar.zip` bile ad
tahmini yapmadan, içeriğe göre `Karar.udf` olur.

Ağ üzerinden `application/zip` olarak gelen indirmelerde (bazı web posta servisleri) bu kısıt
aşılamaz; uzantı o durumda dosyaya dokunmaz ve yanıltıcı bildirim göstermez. AwuCat
görüntüleyicisi `.zip` uzantılı UDF'leri zaten doğrudan açar.

## Doğrulama

`pnpm verify` (Playwright Chromium, `--load-extension`, yeni headless) şunları gerçek tarayıcıda
kontrol eder: servis çalışanı; popup'tan "Görüntüleyici"nin uygulamayı açması; ayarlar sayfasında
adres ön ayarının kaydedilmesi; bekleyen izin şeridinin popup'ta görünmesi; popup dosya
seçicisinden verilen `tests/fixtures/ornek-dilekce.udf`'nin uygulamada "MAHKEMESİ" metniyle
görünmesi; `application/octet-stream` olarak sunulan `ornek-dilekce.udf.zip` indirmesinin
`ornek-dilekce.udf` olarak kaydedilmesi; WhatsApp tarzı blob indirmelerinde koklama ile
`Gerekçeli Karar.zip → .udf`, `tensip.udf.zip → tensip.udf`, sıradan zip'in ve içi UDF olmayan
`sahte.udf.zip`'in korunması; bağlam menüsü işleyicisinin iki indirme yolu (sayfa içi
`executeScript` ve servis çalışanı `fetch`) ile aktarım. Ekran görüntüleri `.verify/` altına yazılır.

Playwright ile tetiklenemeyenler: gerçek bağlam menüsü tıklaması ve `activeTab`/`permissions.request`
kullanıcı hareketi; popup'ın gerçek araç çubuğu penceresi olarak açılması; sistem bildirimleri;
Firefox paketi. Bunlar elle denenmelidir.

## Bilinen sınırlamalar

- Ağ indirmelerinde `application/zip` etiketi Chrome tarafından zorlanır (yukarıda). Koklama yalnızca
  `web.whatsapp.com`'da mümkündür; başka sitelerde yalnızca ad/MIME kurallarına bakılır.
- Firefox'ta `downloads.onDeterminingFilename` yoktur; Firefox paketinde indirme düzeltmesi ve
  WhatsApp betikleri bulunmaz, popup ve bağlam menüsü çalışır (Firefox'ta denenmemiştir).
- Safari'de de `downloads` ve `notifications` yoktur. Safari paketinde WhatsApp betikleri vardır:
  izole dünya betiği manifestte `downloads` izni olmadığını görünce sayfa kancasına indirme adını
  tıklama anında (`<a download>` özniteliği) düzeltmesini söyler; bildirim yerine sayfada kısa bir not,
  hatalarda simge rozeti + popup mesajı. Ağ indirmeleri (webmail) Safari'de düzeltilemez.
  Chrome'da bu yol hiç devreye girmez.
- WhatsApp Desktop (masaüstü uygulaması) indirmeleri tarayıcıdan geçmez; kapsam dışıdır.
- `file://` bağlantıları ve betik çalıştırılamayan sayfalardaki `blob:` bağlantıları açılamaz;
  popup'taki dosya seçici kullanılmalıdır. Dosya boyutu sınırı 50 MB.
- macOS'ta popup içinden dosya seçme penceresi açıldığında Chrome popup'ı kapatabilir; sürükle-bırak
  ve uygulamanın kendi dosya seçicisi alternatiftir.
- `.tif` bağlantıları aktarılır, ancak uygulamanın içe aktarma listesinde (`IMPORT_ACCEPT`) TIFF henüz
  yoktur; uygulama tarafında destek eklenene kadar reddedilebilir.
- Özel uygulama adresi için o origin'e site erişimi verilmesi gerekir (kaydederken istenir).
