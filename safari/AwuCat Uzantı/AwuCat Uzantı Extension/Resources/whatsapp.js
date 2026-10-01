"use strict";
(() => {
  // src/lib/protocol.ts
  var BLOB_MESSAGE = "awucat-ext:blob";
  var BG_BLOB_INFO = "awucat-ext:blob-info";
  var PAGE_CONFIG_MESSAGE = "awucat-ext:config";
  var PAGE_RENAMED_MESSAGE = "awucat-ext:renamed";
  var MAX_FILE_BYTES = 50 * 1024 * 1024;

  // src/lib/settings.ts
  var PRODUCTION_URL = "https://awucat.app";
  var DEFAULT_SETTINGS = {
    baseUrl: PRODUCTION_URL,
    fixZip: true,
    heuristic: true,
    notify: true,
    openTarget: "viewer"
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

  // src/lib/platform.ts
  function declaresDownloads() {
    try {
      return (chrome.runtime.getManifest().permissions ?? []).includes("downloads");
    } catch {
      return false;
    }
  }

  // src/whatsapp.ts
  var downloadHook = declaresDownloads();
  var notifyEnabled = true;
  if (!downloadHook) {
    postConfig({ fixZip: true, heuristic: true });
    void getSettings().then(applySettings);
    onSettingsChanged(applySettings);
  }
  function applySettings(s) {
    notifyEnabled = s.notify;
    postConfig(s);
  }
  function postConfig(s) {
    const msg = { type: PAGE_CONFIG_MESSAGE, renameInPage: true, fixZip: s.fixZip, heuristic: s.heuristic };
    window.postMessage(msg, window.location.origin);
  }
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    const d = e.data;
    if (d.type === PAGE_RENAMED_MESSAGE) {
      if (!downloadHook && notifyEnabled && typeof d.from === "string" && typeof d.to === "string") showNotice(d.from, d.to);
      return;
    }
    if (!downloadHook) return;
    if (d.type !== BLOB_MESSAGE || typeof d.url !== "string" || typeof d.udf !== "boolean") return;
    if (!d.url.startsWith("blob:")) return;
    const msg = { type: BG_BLOB_INFO, url: d.url, udf: d.udf, size: typeof d.size === "number" ? d.size : -1 };
    try {
      void chrome.runtime.sendMessage(msg).catch(() => void 0);
    } catch {
    }
  });
  function showNotice(from, to) {
    document.querySelectorAll("[data-awucat-notice]").forEach((el) => el.remove());
    const host = document.createElement("div");
    host.setAttribute("data-awucat-notice", "");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
    .n { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: min(360px, calc(100vw - 32px));
      box-sizing: border-box; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(0,0,0,.12);
      background: #fff; color: #1a1d21; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.18); }
    .t { font-weight: 600; margin-bottom: 2px; }
    .m { color: #4b5058; word-break: break-word; }
    @media (prefers-color-scheme: dark) { .n { background: #202327; color: #eef0f2; border-color: rgba(255,255,255,.14); } .m { color: #b6bbc2; } }
  `;
    const box = document.createElement("div");
    box.className = "n";
    box.setAttribute("role", "status");
    const title = document.createElement("div");
    title.className = "t";
    title.textContent = "AwuCat: dosya .udf olarak kaydedildi";
    const body = document.createElement("div");
    body.className = "m";
    body.textContent = `${from} \u2192 ${to}`;
    box.append(title, body);
    root.append(style, box);
    (document.body ?? document.documentElement).append(host);
    setTimeout(() => host.remove(), 5e3);
  }
})();
