"use strict";
(() => {
  // src/lib/base64.ts
  var SLICE = 32768;
  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += SLICE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE));
    }
    return btoa(binary);
  }

  // src/lib/settings.ts
  var PRODUCTION_URL = "https://awucat.app";
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
  async function saveSettings(patch) {
    const next = sanitize({ ...await getSettings(), ...patch });
    await storage().set(next);
    return next;
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

  // src/lib/protocol.ts
  var BG_OPEN_APP = "awucat-ext:open-app";
  var BG_OPEN_FILE = "awucat-ext:open-file";
  var BG_RETRY_PENDING = "awucat-ext:retry-pending";
  var BG_CLEAR_PENDING = "awucat-ext:clear-pending";
  var PENDING_KEY = "pendingOpen";
  var NOTICE_KEY = "lastNotice";
  var MAX_FILE_BYTES = 50 * 1024 * 1024;

  // src/lib/notify.ts
  async function takeStoredNotice(maxAgeMs = 15 * 6e4) {
    const area = chrome.storage.session ?? chrome.storage.local;
    try {
      const notice = (await area.get(NOTICE_KEY))?.[NOTICE_KEY];
      if (!notice) return void 0;
      await area.remove(NOTICE_KEY);
      await chrome.action?.setBadgeText({ text: "" });
      await chrome.action?.setTitle({ title: "AwuCat" });
      return Date.now() - notice.createdAt <= maxAgeMs ? notice : void 0;
    } catch {
      return void 0;
    }
  }

  // src/lib/match.ts
  function patternsForScript(manifest, file) {
    return (manifest.content_scripts ?? []).filter((cs) => cs.js?.includes(file)).flatMap((cs) => cs.matches ?? []);
  }

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
  function hasDownloadHook() {
    return !!chrome.downloads?.onDeterminingFilename;
  }
  function hasWhatsAppShim() {
    try {
      return patternsForScript(chrome.runtime.getManifest(), "whatsapp-main.js").length > 0;
    } catch {
      return false;
    }
  }
  function zipFixMode() {
    if (hasDownloadHook()) return "download-hook";
    return hasWhatsAppShim() ? "page" : "none";
  }

  // src/popup.ts
  var $ = (id) => document.getElementById(id);
  var status = $("status");
  function setStatus(text, kind = "") {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }
  async function send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res) throw new Error("Arka plan beti\u011Fi yan\u0131t vermedi.");
    if (!res.ok) throw new Error(res.error || "Bilinmeyen hata.");
    return res.result;
  }
  async function openPage(page) {
    try {
      await send({ type: BG_OPEN_APP, page });
      window.close();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }
  async function openFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`Dosya \xE7ok b\xFCy\xFCk (${Math.round(file.size / 1048576)} MB). S\u0131n\u0131r ${MAX_FILE_BYTES / 1048576} MB.`, "error");
      return;
    }
    setStatus(`${file.name} a\xE7\u0131l\u0131yor\u2026`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await send({ type: BG_OPEN_FILE, name: file.name, mime: file.type, data: bytesToBase64(bytes) });
      setStatus("AwuCat sekmesinde a\xE7\u0131ld\u0131.", "ok");
      setTimeout(() => window.close(), 400);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }
  function sessionStore() {
    return chrome.storage.session ?? chrome.storage.local;
  }
  async function loadPending() {
    const banner = $("pending");
    try {
      const data = await sessionStore().get(PENDING_KEY);
      const pending = data?.[PENDING_KEY];
      if (!pending || Date.now() - pending.createdAt > 15 * 6e4) {
        banner.hidden = true;
        return;
      }
      $("pending-host").textContent = new URL(pending.origin).host;
      banner.hidden = false;
      $("pending-grant").onclick = async () => {
        try {
          const granted = await chrome.permissions.request({ origins: [pending.origin + "/*"] });
          if (!granted) {
            setStatus("\u0130zin verilmedi.", "error");
            return;
          }
          setStatus("Dosya al\u0131n\u0131yor\u2026");
          await send({ type: BG_RETRY_PENDING });
          window.close();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), "error");
        }
      };
      $("pending-dismiss").onclick = async () => {
        await send({ type: BG_CLEAR_PENDING }).catch(() => void 0);
        banner.hidden = true;
      };
    } catch {
      banner.hidden = true;
    }
  }
  async function init() {
    const settings = await getSettings();
    const fixZip = $("fixZip");
    fixZip.checked = settings.fixZip;
    fixZip.addEventListener("change", () => void saveSettings({ fixZip: fixZip.checked }));
    const mode = zipFixMode();
    if (mode === "none") {
      fixZip.disabled = true;
      fixZip.title = "Bu taray\u0131c\u0131 indirme ad\u0131 d\xFCzeltmesini desteklemiyor (Chrome/Edge gerekir).";
    } else if (mode === "page") {
      $("fixZip-sub").textContent = "WhatsApp Web'den .zip olarak inen UDF'leri .udf yapar (Safari'de yaln\u0131zca WhatsApp Web).";
    }
    $("privacy").href = appUrl(settings.baseUrl, "privacy", false);
    $("base").textContent = new URL(settings.baseUrl).host;
    document.querySelectorAll("[data-page]").forEach((b) => {
      b.addEventListener("click", () => void openPage(b.dataset.page));
    });
    $("settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
    const input = $("file");
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void openFile(f);
      input.value = "";
    });
    const drop = $("drop");
    for (const ev of ["dragenter", "dragover"]) {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("active");
      });
    }
    for (const ev of ["dragleave", "drop"]) {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("active");
      });
    }
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) void openFile(f);
    });
    await loadPending();
    await loadNotice();
    if (isSafari()) await loadSiteAccess(settings.baseUrl);
  }
  async function loadNotice() {
    const notice = await takeStoredNotice();
    if (notice && !status.textContent) setStatus(`${notice.title}: ${notice.message}`, /açılamadı|izin/i.test(notice.title) ? "error" : "");
  }
  async function loadSiteAccess(baseUrl) {
    const banner = $("access");
    const wanted = [appOriginPattern(baseUrl), "https://web.whatsapp.com/*"];
    const missing = [];
    for (const origin of wanted) {
      try {
        if (!await chrome.permissions.contains({ origins: [origin] })) missing.push(origin);
      } catch {
      }
    }
    if (!missing.length) {
      banner.hidden = true;
      return;
    }
    $("access-hosts").textContent = missing.map((o) => new URL(o.replace("/*", "/")).host).join(", ");
    banner.hidden = false;
    $("access-grant").onclick = async () => {
      try {
        const granted = await chrome.permissions.request({ origins: missing });
        if (granted) {
          banner.hidden = true;
          setStatus("Site eri\u015Fimi verildi. A\xE7\u0131k WhatsApp Web / AwuCat sekmelerini yenileyin.", "ok");
          return;
        }
      } catch {
      }
      setStatus('\u0130zin verilmedi. Safari > Ayarlar > Uzant\u0131lar > AwuCat > Web Siteleri b\xF6l\xFCm\xFCnden "\u0130zin Ver" se\xE7in.', "error");
    };
  }
  void init();
})();
