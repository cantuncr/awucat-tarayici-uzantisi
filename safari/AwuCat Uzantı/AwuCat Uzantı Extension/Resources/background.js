"use strict";
(() => {
  // src/lib/filename.ts
  var DEFAULT_MAX_HEURISTIC_BYTES = 25 * 1024 * 1024;
  var HEURISTIC_HOSTS = [
    "web.whatsapp.com",
    "whatsapp.com",
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "outlook.com",
    "mail.yahoo.com",
    "mail.yandex.com",
    "mail.yandex.com.tr",
    "mail.proton.me",
    "mail.zoho.com",
    "mail.aol.com",
    "e-posta.turkcell.com.tr",
    "posta.turk.net",
    "mynet.com"
  ];
  var LEGAL_WORDS = [
    "udf",
    "uyap",
    "dilekce",
    "dilekcesi",
    "karar",
    "karari",
    "tensip",
    "zapti",
    "zabit",
    "zabti",
    "tebligat",
    "teblig",
    "bilirkisi",
    "durusma",
    "ihtar",
    "ihtarname",
    "ihbarname",
    "iddianame",
    "mahkeme",
    "mahkemesi",
    "icra",
    "dava",
    "savcilik",
    "savciligi",
    "itiraz",
    "istinaf",
    "temyiz",
    "gerekceli",
    "muzekkere",
    "tutanak",
    "tutanagi",
    "vekaletname",
    "haciz",
    "tahliye",
    "kesif",
    "arabuluculuk"
  ];
  var UDF_ZIP_RE = /^(.*?)\.udf(\s*\(\d+\))?\.zip$/i;
  function splitPath(path) {
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return i === -1 ? { dir: "", base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
  }
  function foldTurkish(s) {
    return s.replace(/İ/g, "i").replace(/I/g, "i").toLowerCase().replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
  }
  function sourceHost(item) {
    for (const candidate of [item.referrer, item.finalUrl, item.url]) {
      if (!candidate) continue;
      const raw = candidate.startsWith("blob:") ? candidate.slice(5) : candidate;
      try {
        const host = new URL(raw).hostname.toLowerCase();
        if (host) return host;
      } catch {
      }
    }
    return "";
  }
  function isHeuristicHost(host) {
    if (!host) return false;
    return HEURISTIC_HOSTS.some((h) => host === h || host.endsWith("." + h));
  }
  function isUdfMime(mime) {
    if (!mime) return false;
    const m = mime.toLowerCase();
    return m.includes("udf") || m.includes("uyap");
  }
  var GENERIC_MIMES = /* @__PURE__ */ new Set([
    "application/octet-stream",
    "binary/octet-stream",
    "application/download",
    "application/x-download",
    "application/force-download",
    "application/unknown",
    "application/x-unknown",
    "application/binary"
  ]);
  function mimeAllowsRename(mime) {
    const m = (mime || "").split(";")[0].trim().toLowerCase();
    if (!m) return true;
    if (isUdfMime(m)) return true;
    return GENERIC_MIMES.has(m);
  }
  function looksLikeLegalDocument(stem) {
    const words = foldTurkish(stem).split(/[^a-z0-9]+/).filter(Boolean);
    return words.some((w) => LEGAL_WORDS.includes(w));
  }
  function decideFilename(item, opts) {
    const { dir, base } = splitPath(item.filename || "");
    if (!base) return null;
    const lower = base.toLowerCase();
    if (lower.endsWith(".udf")) return null;
    if (!mimeAllowsRename(item.mime)) return null;
    if (item.sniff === false) return null;
    if (opts.fixZip && item.sniff === true && lower.endsWith(".zip")) {
      const m = UDF_ZIP_RE.exec(base);
      const stem = m ? (m[1] || "belge") + (m[2] ? " " + m[2].trim() : "") : base.slice(0, -4);
      return { filename: dir + stem + ".udf", reason: "sniff" };
    }
    if (opts.fixZip) {
      const m = UDF_ZIP_RE.exec(base);
      if (m) {
        const stem = m[1] || "belge";
        const counter = m[2] ? " " + m[2].trim() : "";
        return { filename: dir + stem + counter + ".udf", reason: "udf-zip" };
      }
    }
    if (opts.fixZip && isUdfMime(item.mime)) {
      if (lower.endsWith(".zip")) return { filename: dir + base.slice(0, -4) + ".udf", reason: "mime" };
      if (!/\.[a-z0-9]{1,5}$/i.test(base)) return { filename: dir + base + ".udf", reason: "mime" };
      return null;
    }
    if (opts.heuristic && lower.endsWith(".zip")) {
      const max = opts.maxHeuristicBytes ?? DEFAULT_MAX_HEURISTIC_BYTES;
      const size = item.fileSize ?? -1;
      if (size > max) return null;
      if (!isHeuristicHost(sourceHost(item))) return null;
      const stem = base.slice(0, -4);
      if (looksLikeLegalDocument(stem)) return { filename: dir + stem + ".udf", reason: "heuristic" };
    }
    return null;
  }
  function basename(path) {
    return splitPath(path).base;
  }

  // src/lib/http.ts
  var MIME_EXT = [
    [/udf|uyap/i, "udf"],
    [/pdf/i, "pdf"],
    [/wordprocessingml/i, "docx"],
    [/msword/i, "doc"],
    [/opendocument\.text/i, "odt"],
    [/rtf/i, "rtf"],
    [/tiff?/i, "tif"],
    [/zip/i, "zip"],
    [/plain/i, "txt"],
    [/html/i, "html"]
  ];
  var MENU_EXTENSIONS = ["udf", "zip", "tif", "tiff", "pdf", "docx", "doc", "odt", "rtf"];
  function linkPatterns(extensions = MENU_EXTENSIONS) {
    const out = [];
    for (const ext of extensions) {
      for (const e of /* @__PURE__ */ new Set([ext.toLowerCase(), ext.toUpperCase()])) {
        out.push(`*://*/*.${e}`, `*://*/*.${e}?*`);
      }
    }
    return out;
  }
  function filenameFromDisposition(header) {
    if (!header) return null;
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
    if (star) {
      try {
        return sanitizeName(decodeURIComponent(star[1].trim()));
      } catch {
      }
    }
    const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header);
    if (quoted) return sanitizeName(quoted[1].replace(/\\(.)/g, "$1"));
    const bare = /filename\s*=\s*([^;]+)/.exec(header);
    if (bare) return sanitizeName(bare[1].trim());
    return null;
  }
  function filenameFromUrl(url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split("/").filter(Boolean).pop();
      if (!seg) return null;
      let name;
      try {
        name = decodeURIComponent(seg);
      } catch {
        name = seg;
      }
      return /\.[a-z0-9]{1,5}$/i.test(name) ? sanitizeName(name) : null;
    } catch {
      return null;
    }
  }
  function extensionForMime(mime) {
    if (!mime) return null;
    const type = mime.split(";")[0].trim();
    if (!type || type === "application/octet-stream") return null;
    for (const [re, ext] of MIME_EXT) if (re.test(type)) return ext;
    return null;
  }
  function sanitizeName(name) {
    const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
    return cleaned.slice(0, 180) || "belge";
  }
  function pickFilename(opts) {
    const fromHeader = filenameFromDisposition(opts.disposition);
    if (fromHeader) return fromHeader;
    const fromUrl = filenameFromUrl(opts.url) ?? (opts.finalUrl ? filenameFromUrl(opts.finalUrl) : null);
    if (fromUrl) return fromUrl;
    if (opts.fallback) return sanitizeName(opts.fallback);
    return "belge." + (extensionForMime(opts.mime) ?? "udf");
  }
  function looksLikeHtmlPage(mime, name) {
    const type = (mime || "").split(";")[0].trim().toLowerCase();
    return type === "text/html" && !/\.(html?|xhtml)$/i.test(name);
  }

  // src/lib/base64.ts
  var SLICE = 32768;
  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += SLICE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE));
    }
    return btoa(binary);
  }
  function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  function utf8ToBytes(text) {
    return new TextEncoder().encode(text);
  }

  // src/lib/match.ts
  function urlMatchesPattern(url, pattern) {
    if (pattern === "<all_urls>") return /^(https?|file|ftp|ws|wss):/.test(url);
    const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
    if (!m) return false;
    const [, scheme, hostPart, pathPart] = m;
    let u;
    try {
      u = new URL(url.startsWith("blob:") ? url.slice(5) : url);
    } catch {
      return false;
    }
    const scheme_ = u.protocol.slice(0, -1);
    if (scheme === "*" ? !(scheme_ === "http" || scheme_ === "https") : scheme.toLowerCase() !== scheme_) return false;
    const [host, port] = splitHostPort(hostPart);
    if (host === "*") {
    } else if (host.startsWith("*.")) {
      const suffix = host.slice(2).toLowerCase();
      if (u.hostname !== suffix && !u.hostname.endsWith("." + suffix)) return false;
    } else if (host.toLowerCase() !== u.hostname) {
      return false;
    }
    if (port && port !== "*" && port !== (u.port || defaultPort(scheme_))) return false;
    const path = u.pathname + u.search;
    const re = new RegExp("^" + pathPart.split("*").map(escapeRegExp).join(".*") + "$");
    return re.test(path);
  }
  function splitHostPort(hostPart) {
    const i = hostPart.lastIndexOf(":");
    if (i === -1 || hostPart.endsWith("]")) return [hostPart, ""];
    return [hostPart.slice(0, i), hostPart.slice(i + 1)];
  }
  function defaultPort(scheme) {
    return scheme === "https" ? "443" : scheme === "http" ? "80" : "";
  }
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function patternsForScript(manifest, file) {
    return (manifest.content_scripts ?? []).filter((cs) => cs.js?.includes(file)).flatMap((cs) => cs.matches ?? []);
  }

  // src/lib/settings.ts
  var PRODUCTION_URL = "https://awucat.app";
  var LOCAL_DEV_URL = "http://localhost:3000";
  var BASE_URL_PRESETS = [
    { id: "production", label: "awucat.app (varsay\u0131lan)", url: PRODUCTION_URL },
    { id: "local", label: "Yerel geli\u015Ftirme (http://localhost:3000)", url: LOCAL_DEV_URL }
  ];
  var DEFAULT_SETTINGS = {
    baseUrl: PRODUCTION_URL,
    fixZip: true,
    heuristic: true,
    notify: true,
    openTarget: "viewer"
  };
  var APP_PATHS = {
    viewer: "/goruntuleyici",
    editor: "/editor",
    converter: "/donustur",
    privacy: "/gizlilik"
  };
  function normalizeBaseUrl(input) {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;
    let u;
    try {
      u = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    const path = u.pathname.replace(/\/+$/, "");
    return u.origin + path;
  }
  function originPattern(baseUrl, withPort = true) {
    const u = new URL(baseUrl);
    return `${u.protocol}//${withPort ? u.host : u.hostname}/*`;
  }
  function appUrl(baseUrl, page, fromExtension = true) {
    const base = normalizeBaseUrl(baseUrl) ?? PRODUCTION_URL;
    const url = base + APP_PATHS[page];
    return fromExtension && page !== "privacy" ? url + "?ext=1" : url;
  }
  function storage() {
    return chrome.storage.sync ?? chrome.storage.local;
  }
  async function getSettings() {
    try {
      const raw = await storage().get(DEFAULT_SETTINGS);
      return sanitize(raw);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function sanitize(raw) {
    return {
      baseUrl: normalizeBaseUrl(raw.baseUrl ?? "") ?? DEFAULT_SETTINGS.baseUrl,
      fixZip: raw.fixZip ?? DEFAULT_SETTINGS.fixZip,
      heuristic: raw.heuristic ?? DEFAULT_SETTINGS.heuristic,
      notify: raw.notify ?? DEFAULT_SETTINGS.notify,
      openTarget: raw.openTarget === "editor" ? "editor" : "viewer"
    };
  }
  function onSettingsChanged(cb) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === "sync" || area === "local") void getSettings().then(cb);
    });
  }

  // src/lib/protocol.ts
  var CS_PING = "awucat-ext:ping";
  var CS_CHUNK = "awucat-ext:chunk";
  var BG_OPEN_APP = "awucat-ext:open-app";
  var BG_OPEN_FILE = "awucat-ext:open-file";
  var BG_RETRY_PENDING = "awucat-ext:retry-pending";
  var BG_CLEAR_PENDING = "awucat-ext:clear-pending";
  var BG_BLOB_INFO = "awucat-ext:blob-info";
  var PENDING_KEY = "pendingOpen";
  var NOTICE_KEY = "lastNotice";
  var MAX_FILE_BYTES = 50 * 1024 * 1024;

  // src/lib/platform.ts
  function isSafari() {
    try {
      return /^(safari-web-extension|webkit-extension):/.test(chrome.runtime.getURL(""));
    } catch {
      return false;
    }
  }
  function appOriginPattern(baseUrl) {
    return originPattern(baseUrl, !isSafari());
  }
  function menusApi() {
    const c = chrome;
    return c.contextMenus ?? c.menus;
  }

  // src/lib/handover.ts
  var CHUNK_CHARS = 4 * 1024 * 1024;
  var CONTENT_SCRIPT_TIMEOUT_MS = 3e4;
  async function openInApp(file, opts) {
    const url = appUrl(opts.baseUrl, opts.target);
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id === void 0) throw new Error("Sekme a\xE7\u0131lamad\u0131.");
    await deliverToTab(tab.id, file);
    return tab.id;
  }
  async function deliverToTab(tabId, file) {
    await waitForContentScript(tabId, CONTENT_SCRIPT_TIMEOUT_MS);
    const b64 = bytesToBase64(file.bytes);
    const total = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
    const transferId = crypto.randomUUID();
    for (let index = 0; index < total; index++) {
      const msg = {
        type: CS_CHUNK,
        transferId,
        index,
        total,
        name: file.name,
        mime: file.mime,
        data: b64.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS)
      };
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (!res?.ok) throw new Error(res?.error || "Dosya sekmeye aktar\u0131lamad\u0131.");
    }
  }
  async function waitForContentScript(tabId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let delay = 100;
    for (; ; ) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: CS_PING });
        if (res?.ok) return;
      } catch {
      }
      if (Date.now() > deadline) {
        if (isSafari()) {
          throw new Error(`AwuCat sekmesi yan\u0131t vermedi. Safari'de uygulama sitesine eri\u015Fim izni verin: ara\xE7 \xE7ubu\u011Fundaki AwuCat simgesi \u2192 "Bu web sitesinde her zaman izin ver" (veya Safari > Ayarlar > Uzant\u0131lar > AwuCat).`);
        }
        throw new Error("AwuCat sekmesi yan\u0131t vermedi. Ayarlardaki uygulama adresini ve i\xE7erik beti\u011Fi iznini kontrol edin.");
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 1e3);
    }
  }

  // src/lib/notify.ts
  var NOTIFICATION_PREFIX_DOWNLOAD = "udf-dl-";
  async function notify(message, opts = {}) {
    if (!chrome.notifications) return noticeFallback(message, opts.title ?? "AwuCat");
    const options = {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: opts.title ?? "AwuCat",
      message
    };
    try {
      return await new Promise((resolve, reject) => {
        const cb = (id) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id);
        if (opts.id) chrome.notifications.create(opts.id, options, cb);
        else chrome.notifications.create(options, cb);
      });
    } catch {
      return void 0;
    }
  }
  async function noticeFallback(message, title) {
    const notice = { title, message, createdAt: Date.now() };
    try {
      await (chrome.storage.session ?? chrome.storage.local).set({ [NOTICE_KEY]: notice });
    } catch {
    }
    try {
      await chrome.action?.setBadgeText({ text: "!" });
      await chrome.action?.setTitle({ title: `${title}
${message}` });
    } catch {
    }
    console.info(`[AwuCat] ${title}: ${message}`);
    return void 0;
  }
  var UserError = class extends Error {
  };
  function describeError(err) {
    if (err instanceof UserError) return err.message;
    const msg = err instanceof Error ? err.message : String(err);
    if (/Failed to fetch|NetworkError|net::ERR|Load failed/i.test(msg)) return "Dosya indirilemedi (a\u011F hatas\u0131 veya site eri\u015Fimi engellendi).";
    return msg || "Bilinmeyen hata.";
  }

  // src/background.ts
  var MENU_LINK = "awucat-open-link";
  var MENU_SELECTION = "awucat-open-selection";
  var CUSTOM_CS_ID = "awucat-app-custom";
  chrome.runtime.onInstalled.addListener(() => {
    void setupMenus();
    void getSettings().then(syncCustomContentScript);
  });
  chrome.runtime.onStartup.addListener(() => {
    void setupMenus();
    void getSettings().then(syncCustomContentScript);
  });
  onSettingsChanged((s) => void syncCustomContentScript(s));
  var menus = menusApi();
  async function setupMenus() {
    if (!menus) return;
    await menus.removeAll();
    menus.create({
      id: MENU_LINK,
      title: "AwuCat'te a\xE7",
      contexts: ["link"],
      targetUrlPatterns: linkPatterns()
    });
    menus.create({
      id: MENU_SELECTION,
      title: "Se\xE7ili metinle AwuCat'te yeni belge",
      contexts: ["selection"]
    });
  }
  async function syncCustomContentScript(settings) {
    if (!chrome.scripting?.registerContentScripts) return;
    const isPreset = BASE_URL_PRESETS.some((p) => p.url === settings.baseUrl);
    let existing = [];
    try {
      const stale = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).filter((id) => id !== CUSTOM_CS_ID);
      if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
    } catch {
    }
    try {
      existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_CS_ID] });
    } catch {
    }
    try {
      if (isPreset) {
        if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_CS_ID] });
        return;
      }
      const pattern = appOriginPattern(settings.baseUrl);
      if (!await chrome.permissions.contains({ origins: [pattern] })) return;
      const script = {
        id: CUSTOM_CS_ID,
        matches: [pattern],
        js: ["content.js"],
        runAt: "document_start",
        persistAcrossSessions: true
      };
      if (existing.length) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    } catch (err) {
      console.warn("[AwuCat] content script registration failed", err);
    }
  }
  var blobVerdicts = /* @__PURE__ */ new Map();
  var BLOB_VERDICT_TTL_MS = 10 * 6e4;
  var BLOB_VERDICT_WAIT_MS = 1500;
  var VERDICT_PREFIX = "verdict:";
  function rememberBlobVerdict(url, udf, size) {
    const now = Date.now();
    blobVerdicts.set(url, { udf, size, at: now });
    for (const [k, v] of blobVerdicts) if (now - v.at > BLOB_VERDICT_TTL_MS) blobVerdicts.delete(k);
    void sessionStore().set({ [VERDICT_PREFIX + url]: { udf, size, at: now } }).then(() => blobVerdicts.size % 25 === 0 ? purgeStoredVerdicts(now) : void 0).catch(() => void 0);
  }
  async function purgeStoredVerdicts(now) {
    const all = await sessionStore().get(null);
    const stale = Object.entries(all).filter(([k, v]) => k.startsWith(VERDICT_PREFIX) && now - (v.at ?? 0) > BLOB_VERDICT_TTL_MS).map(([k]) => k);
    if (stale.length) await sessionStore().remove(stale);
  }
  var SHIM_PATTERNS = patternsForScript(chrome.runtime.getManifest(), "whatsapp-main.js");
  async function lookupBlobVerdict(url) {
    if (!url.startsWith("blob:")) return void 0;
    if (!SHIM_PATTERNS.some((p) => urlMatchesPattern(url, p))) return void 0;
    const deadline = Date.now() + BLOB_VERDICT_WAIT_MS;
    for (; ; ) {
      const hit = blobVerdicts.get(url);
      if (hit) return hit.udf;
      try {
        const stored = (await sessionStore().get(VERDICT_PREFIX + url))[VERDICT_PREFIX + url];
        if (stored) return stored.udf;
      } catch {
      }
      if (Date.now() > deadline) return void 0;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  var lastDecision = null;
  chrome.downloads?.onDeterminingFilename?.addListener((item, suggest) => {
    let done = false;
    const finish = (suggestion) => {
      if (done) return;
      done = true;
      suggest(suggestion);
    };
    void (async () => {
      try {
        const s = await getSettings();
        const sniff = s.fixZip ? await lookupBlobVerdict(item.url) : void 0;
        const decision = decideFilename(
          { filename: item.filename, mime: item.mime, url: item.url, finalUrl: item.finalUrl, referrer: item.referrer, fileSize: item.fileSize, sniff },
          { fixZip: s.fixZip, heuristic: s.heuristic }
        );
        lastDecision = { input: item.filename, mime: item.mime, sniff, output: decision?.filename ?? null };
        if (!decision) return finish();
        finish({ filename: decision.filename, conflictAction: "uniquify" });
        if (s.notify) {
          await notify(`${basename(item.filename)} \u2192 ${basename(decision.filename)}
Dosya .udf olarak d\xFCzeltildi.`, {
            id: NOTIFICATION_PREFIX_DOWNLOAD + item.id,
            title: "AwuCat: dosya .udf olarak d\xFCzeltildi"
          });
        }
      } catch (err) {
        console.warn("[AwuCat] filename decision failed", err);
        finish();
      }
    })();
    return true;
  });
  chrome.notifications?.onClicked?.addListener((id) => {
    if (id.startsWith(NOTIFICATION_PREFIX_DOWNLOAD)) {
      const downloadId = Number(id.slice(NOTIFICATION_PREFIX_DOWNLOAD.length));
      if (Number.isFinite(downloadId)) chrome.downloads.show(downloadId);
    }
    chrome.notifications.clear(id);
  });
  menus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SELECTION && info.selectionText) {
      void openSelection(info.selectionText);
      return;
    }
    if (info.menuItemId !== MENU_LINK || !info.linkUrl) return;
    const link = info.linkUrl;
    if (!/^(https?:|blob:)/i.test(link)) {
      void notify('Bu t\xFCr ba\u011Flant\u0131lar a\xE7\u0131lam\u0131yor. Yerel dosyalar i\xE7in uzant\u0131 simgesindeki "Dosya se\xE7" d\xFC\u011Fmesini kullan\u0131n.');
      return;
    }
    let linkOrigin;
    try {
      linkOrigin = originOf(link);
    } catch {
      void notify("Ba\u011Flant\u0131 adresi okunamad\u0131.");
      return;
    }
    const frameOrigin = safeOrigin(info.frameUrl || info.pageUrl || "");
    const sameOrigin = linkOrigin === frameOrigin;
    let permission = Promise.resolve(true);
    if (!sameOrigin && chrome.permissions?.request) {
      try {
        permission = chrome.permissions.request({ origins: [linkOrigin + "/*"] }).catch(() => false);
      } catch {
        permission = Promise.resolve(false);
      }
    }
    void openLink({ url: link, origin: linkOrigin, sameOrigin, tabId: tab?.id, frameId: info.frameId, permission });
  });
  var NeedsPermission = class extends Error {
  };
  var InjectError = class extends Error {
  };
  async function openLink(req) {
    const settings = await getSettings();
    try {
      const file = await fetchLink(req);
      await openInApp(file, { baseUrl: settings.baseUrl, target: settings.openTarget });
    } catch (err) {
      if (err instanceof NeedsPermission) {
        await setPending({ url: req.url, origin: req.origin, name: pickFilename({ url: req.url }), createdAt: Date.now() });
        await notify(`${hostOf(req.origin)} adresinden dosya almak i\xE7in izin gerekiyor. Uzant\u0131 simgesine t\u0131klay\u0131p "\u0130zin ver ve a\xE7" deyin.`, {
          title: "AwuCat: izin gerekli"
        });
        return;
      }
      await notify(describeError(err), { title: "AwuCat: dosya a\xE7\u0131lamad\u0131" });
    }
  }
  async function fetchLink(req) {
    const granted = await req.permission;
    if (req.sameOrigin && req.tabId !== void 0 && hasScripting()) {
      try {
        return await fetchInPage(req.tabId, req.frameId, req.url);
      } catch (err) {
        if (!(err instanceof InjectError)) throw err;
      }
    }
    if (req.url.startsWith("blob:")) throw new UserError('Bu ba\u011Flant\u0131 sayfa i\xE7i ge\xE7ici bir dosyaya i\u015Faret ediyor; dosyay\u0131 indirip uzant\u0131 simgesindeki "Dosya se\xE7" ile a\xE7\u0131n.');
    try {
      return await fetchInWorker(req.url);
    } catch (err) {
      if (err instanceof TypeError && (!granted || req.sameOrigin)) throw new NeedsPermission(req.origin);
      throw err;
    }
  }
  function pageFetch(url, maxBytes) {
    return fetch(url, { credentials: "include" }).then(async (res) => {
      if (!res.ok) return { error: "HTTP " + res.status };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) return { error: "too-large", size: buf.byteLength };
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
      return {
        ok: true,
        data: btoa(bin),
        mime: res.headers.get("content-type") || "",
        disposition: res.headers.get("content-disposition") || "",
        finalUrl: res.url
      };
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  }
  async function fetchInPage(tabId, frameId, url) {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: frameId !== void 0 ? [frameId] : void 0 },
        func: pageFetch,
        args: [url, MAX_FILE_BYTES]
      });
    } catch (err) {
      throw new InjectError(err instanceof Error ? err.message : String(err));
    }
    const r = results?.[0]?.result;
    if (!r) throw new InjectError("Sayfa i\xE7i indirme sonu\xE7 d\xF6nd\xFCrmedi.");
    if (r.error === "too-large") throw new UserError(`Dosya \xE7ok b\xFCy\xFCk (${Math.round((r.size ?? 0) / 1048576)} MB). S\u0131n\u0131r ${MAX_FILE_BYTES / 1048576} MB.`);
    if (r.error || !r.ok || !r.data) throw new UserError(/^HTTP \d+/.test(r.error || "") ? `Sunucu ${r.error.slice(5)} yan\u0131t\u0131 verdi.` : describeError(new Error(r.error || "Sayfa i\xE7i indirme ba\u015Far\u0131s\u0131z.")));
    return finishFetched({ data: r.data, mime: r.mime ?? "", disposition: r.disposition ?? "", url, finalUrl: r.finalUrl });
  }
  async function fetchInWorker(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new UserError(`Sunucu ${res.status} yan\u0131t\u0131 verdi.`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FILE_BYTES) throw new UserError(`Dosya \xE7ok b\xFCy\xFCk (${Math.round(buf.byteLength / 1048576)} MB). S\u0131n\u0131r ${MAX_FILE_BYTES / 1048576} MB.`);
    const mime = res.headers.get("content-type") || "";
    const name = pickFilename({ disposition: res.headers.get("content-disposition"), url, finalUrl: res.url, mime });
    if (looksLikeHtmlPage(mime, name)) throw new UserError("Ba\u011Flant\u0131 bir belge yerine web sayfas\u0131 d\xF6nd\xFCrd\xFC (oturum a\xE7man\u0131z gerekebilir).");
    return { name, mime: mime.split(";")[0].trim(), bytes: new Uint8Array(buf), finalUrl: res.url };
  }
  function finishFetched(r) {
    const name = pickFilename({ disposition: r.disposition, url: r.url, finalUrl: r.finalUrl, mime: r.mime });
    if (looksLikeHtmlPage(r.mime, name)) throw new UserError("Ba\u011Flant\u0131 bir belge yerine web sayfas\u0131 d\xF6nd\xFCrd\xFC (oturum a\xE7man\u0131z gerekebilir).");
    return { name, mime: r.mime.split(";")[0].trim(), bytes: base64ToBytes(r.data), finalUrl: r.finalUrl };
  }
  async function openSelection(text) {
    const settings = await getSettings();
    try {
      await openInApp({ name: "secilen-metin.txt", mime: "text/plain", bytes: utf8ToBytes(text) }, { baseUrl: settings.baseUrl, target: "editor" });
    } catch (err) {
      await notify(describeError(err), { title: "AwuCat: metin a\xE7\u0131lamad\u0131" });
    }
  }
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw;
    if (!msg || typeof msg !== "object") return;
    const reply = (p) => {
      p.then((result) => sendResponse({ ok: true, result })).catch((err) => sendResponse({ ok: false, error: describeError(err) }));
      return true;
    };
    switch (msg.type) {
      case BG_OPEN_APP:
        return reply(
          getSettings().then((s) => {
            const page = msg.page === "editor" ? "editor" : msg.page === "converter" ? "converter" : "viewer";
            return chrome.tabs.create({ url: appUrl(s.baseUrl, page) });
          })
        );
      case BG_OPEN_FILE:
        return reply(
          getSettings().then((s) => {
            const bytes = base64ToBytes(msg.data);
            if (bytes.byteLength > MAX_FILE_BYTES) throw new UserError(`Dosya \xE7ok b\xFCy\xFCk. S\u0131n\u0131r ${MAX_FILE_BYTES / 1048576} MB.`);
            const name = msg.name || "belge.udf";
            const target = /\.(docx?|odt|ott|rtf|txt|html?)$/i.test(name) ? "editor" : s.openTarget;
            return openInApp({ name, mime: msg.mime || "", bytes }, { baseUrl: s.baseUrl, target });
          })
        );
      case BG_RETRY_PENDING:
        return reply(retryPending());
      case BG_CLEAR_PENDING:
        return reply(clearPending());
      case BG_BLOB_INFO:
        if (typeof msg.url === "string" && typeof msg.udf === "boolean") rememberBlobVerdict(msg.url, msg.udf, msg.size);
        return;
      default:
        return;
    }
  });
  function sessionStore() {
    return chrome.storage.session ?? chrome.storage.local;
  }
  async function setPending(p) {
    await sessionStore().set({ [PENDING_KEY]: p });
  }
  async function clearPending() {
    await sessionStore().remove(PENDING_KEY);
  }
  async function retryPending() {
    const data = await sessionStore().get(PENDING_KEY);
    const pending = data?.[PENDING_KEY];
    if (!pending) throw new UserError("Bekleyen bir istek yok.");
    const settings = await getSettings();
    const file = await fetchInWorker(pending.url);
    await clearPending();
    await openInApp(file, { baseUrl: settings.baseUrl, target: settings.openTarget });
  }
  function hasScripting() {
    const scripting = chrome.scripting;
    return typeof scripting?.executeScript === "function";
  }
  function originOf(url) {
    const raw = url.startsWith("blob:") ? url.slice(5) : url;
    return new URL(raw).origin;
  }
  function safeOrigin(url) {
    try {
      return originOf(url);
    } catch {
      return "";
    }
  }
  function hostOf(origin) {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  }
  globalThis.__awucat = { openInApp, deliverToTab, openLink, getSettings, lastDecision: () => lastDecision };
})();
