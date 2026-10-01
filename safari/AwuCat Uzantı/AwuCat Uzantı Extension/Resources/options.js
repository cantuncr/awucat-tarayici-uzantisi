"use strict";
(() => {
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

  // src/options.ts
  var $ = (id) => document.getElementById(id);
  function setStatus(text, kind = "") {
    const el = $("saveStatus");
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
  }
  function renderPresets(current) {
    const box = $("presets");
    box.innerHTML = "";
    for (const p of BASE_URL_PRESETS) {
      const label = document.createElement("label");
      label.className = "radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "base";
      input.value = p.url;
      input.checked = p.url === current;
      const text = document.createElement("span");
      text.textContent = p.label;
      label.append(input, text);
      box.append(label);
    }
    const isPreset = BASE_URL_PRESETS.some((p) => p.url === current);
    $("base-custom").checked = !isPreset;
    $("customUrl").value = isPreset ? "" : current;
  }
  function selectedBaseUrl() {
    const checked = document.querySelector('input[name="base"]:checked');
    if (!checked) return null;
    if (checked.value !== "custom") return checked.value;
    return normalizeBaseUrl($("customUrl").value);
  }
  async function save() {
    const baseUrl = selectedBaseUrl();
    if (!baseUrl) {
      setStatus("Ge\xE7erli bir http(s) adresi girin.", "error");
      return;
    }
    const isPreset = BASE_URL_PRESETS.some((p) => p.url === baseUrl);
    if (!isPreset) {
      const pattern = appOriginPattern(baseUrl);
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [pattern] });
      } catch (err) {
        setStatus("\u0130zin istenemedi: " + (err instanceof Error ? err.message : String(err)), "error");
        return;
      }
      if (!granted) {
        setStatus("Bu adres i\xE7in eri\u015Fim izni verilmedi; kaydedilmedi.", "error");
        return;
      }
    }
    await saveSettings({ baseUrl });
    setStatus("Kaydedildi.", "ok");
    await refreshLinks();
    await renderOrigins();
  }
  async function renderOrigins() {
    const list = $("origins");
    list.innerHTML = "";
    let origins = [];
    try {
      origins = (await chrome.permissions.getAll()).origins ?? [];
    } catch {
    }
    if (!origins.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Hen\xFCz izin verilen ek site yok.";
      list.append(li);
      return;
    }
    const manifest = chrome.runtime.getManifest();
    const required = /* @__PURE__ */ new Set([...manifest.host_permissions ?? [], ...(manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? [])]);
    for (const origin of origins) {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = origin;
      li.append(code);
      if (required.has(origin)) {
        const tag = document.createElement("span");
        tag.className = "muted";
        tag.textContent = origin.includes("whatsapp") ? "gerekli \xB7 indirme d\xFCzeltmesi" : "gerekli \xB7 dosya aktar\u0131m\u0131";
        li.append(tag);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost danger";
        btn.textContent = "Kald\u0131r";
        btn.addEventListener("click", async () => {
          try {
            await chrome.permissions.remove({ origins: [origin] });
          } catch {
          }
          await renderOrigins();
        });
        li.append(btn);
      }
      list.append(li);
    }
  }
  async function refreshLinks() {
    const s = await getSettings();
    $("privacy").href = appUrl(s.baseUrl, "privacy", false);
    $("app").href = appUrl(s.baseUrl, "viewer", false);
  }
  async function init() {
    const s = await getSettings();
    renderPresets(s.baseUrl);
    const toggles = [
      ["fixZip", s.fixZip],
      ["heuristic", s.heuristic],
      ["notify", s.notify]
    ];
    for (const [key, value] of toggles) {
      const el = $(key);
      el.checked = value;
      el.addEventListener("change", () => void saveSettings({ [key]: el.checked }));
    }
    const mode = zipFixMode();
    if (mode === "none") {
      for (const id of ["fixZip", "heuristic"]) {
        const el = $(id);
        el.disabled = true;
        el.title = "Bu taray\u0131c\u0131 indirme ad\u0131 d\xFCzeltmesini desteklemiyor (Chrome/Edge gerekir).";
      }
    } else if (mode === "page") {
      $("fixZip-sub").textContent = "WhatsApp Web'den .zip olarak inen UDF'leri, indirme ba\u015Flamadan \xF6nce i\xE7eri\u011Fe bakarak .udf yapar. Safari'de yaln\u0131zca WhatsApp Web'de \xE7al\u0131\u015F\u0131r; e-posta eklerinin ad\u0131 de\u011Fi\u015Ftirilemez (Safari indirme API'si sunmuyor).";
      $("notify-sub").textContent = "Bir dosya d\xFCzeltildi\u011Finde WhatsApp Web sayfas\u0131n\u0131n k\xF6\u015Fesinde k\u0131sa bir not g\xF6sterir (Safari'de sistem bildirimi yok).";
    }
    const target = $("openTarget");
    target.value = s.openTarget;
    target.addEventListener("change", () => void saveSettings({ openTarget: target.value }));
    $("customUrl").addEventListener("focus", () => {
      $("base-custom").checked = true;
    });
    $("save").addEventListener("click", () => void save());
    $("version").textContent = "v" + chrome.runtime.getManifest().version;
    await refreshLinks();
    await renderOrigins();
  }
  void init();
})();
