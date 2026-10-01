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

  // src/whatsapp-main.ts
  (() => {
    const MAX_BYTES = 25 * 1024 * 1024;
    const HEAD = 4096;
    const TAIL = 65536;
    const ZIP_TYPES = /^(application\/(zip|x-zip|x-zip-compressed|zip-compressed)|multipart\/x-zip)$/i;
    const MESSAGE_TYPE = "awucat-ext:blob";
    const CONFIG_TYPE = "awucat-ext:config";
    const RENAMED_TYPE = "awucat-ext:renamed";
    const CONTENT_XML = Array.from("content.xml", (c) => c.charCodeAt(0));
    const VERDICT_WAIT_MS = 1500;
    const REVOKE_GRACE_MS = 3e4;
    const TRACK_LIMIT = 200;
    const original = URL.createObjectURL.bind(URL);
    if (URL.__awucatPatched) return;
    URL.__awucatPatched = true;
    const tracked = /* @__PURE__ */ new Map();
    const config = { renameInPage: false, fixZip: true, heuristic: true };
    function contains(bytes, needle) {
      outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
        for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
        return true;
      }
      return false;
    }
    async function sniff(blob) {
      const head = new Uint8Array(await blob.slice(0, HEAD).arrayBuffer());
      if (!(head[0] === 80 && head[1] === 75 && head[2] === 3 && head[3] === 4)) return false;
      if (contains(head, CONTENT_XML)) return true;
      const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - TAIL)).arrayBuffer());
      return contains(tail, CONTENT_XML);
    }
    URL.createObjectURL = function(obj) {
      if (!(obj instanceof Blob) || obj.size > MAX_BYTES || obj.size < 4) return original(obj);
      const type = (obj.type || "").split(";")[0].trim().toLowerCase();
      const zipLike = ZIP_TYPES.test(type);
      if (!zipLike && type !== "application/octet-stream" && type !== "") return original(obj);
      const blob = zipLike ? new Blob([obj], { type: "application/octet-stream" }) : obj;
      const url = original(blob);
      const entry = { type: blob.type, size: blob.size, ready: Promise.resolve(void 0) };
      entry.ready = sniff(blob).then(
        (udf) => {
          entry.verdict = udf;
          window.postMessage({ type: MESSAGE_TYPE, url, udf, size: blob.size }, window.location.origin);
          return udf;
        },
        () => void 0
      );
      tracked.set(url, entry);
      if (tracked.size > TRACK_LIMIT) tracked.delete(tracked.keys().next().value);
      return url;
    };
    window.addEventListener("message", (e) => {
      if (e.source !== window || !e.data || typeof e.data !== "object") return;
      const d = e.data;
      if (d.type !== CONFIG_TYPE) return;
      if (typeof d.fixZip === "boolean") config.fixZip = d.fixZip;
      if (typeof d.heuristic === "boolean") config.heuristic = d.heuristic;
      if (d.renameInPage === true && !config.renameInPage) {
        config.renameInPage = true;
        installClickHooks();
      }
    });
    const replaying = /* @__PURE__ */ new WeakSet();
    const held = /* @__PURE__ */ new Set();
    const deferredRevokes = /* @__PURE__ */ new Set();
    function candidate(a) {
      if (!config.renameInPage || !config.fixZip) return void 0;
      const name = a.getAttribute("download");
      if (!name || !a.href.startsWith("blob:")) return void 0;
      return tracked.get(a.href);
    }
    function applyName(a, entry) {
      const from = a.getAttribute("download") || "";
      const decision = decideFilename(
        { filename: from, mime: entry.type, url: a.href, referrer: window.location.href, fileSize: entry.size, sniff: entry.verdict },
        { fixZip: config.fixZip, heuristic: config.heuristic }
      );
      if (!decision) return;
      a.setAttribute("download", decision.filename);
      window.postMessage({ type: RENAMED_TYPE, from, to: decision.filename, reason: decision.reason }, window.location.origin);
    }
    function intercept(a, replay) {
      if (replaying.has(a)) return false;
      const entry = candidate(a);
      if (!entry) return false;
      if (entry.verdict !== void 0) {
        applyName(a, entry);
        return false;
      }
      const url = a.href;
      held.add(url);
      const timeout = new Promise((r) => setTimeout(() => r(void 0), VERDICT_WAIT_MS));
      void Promise.race([entry.ready, timeout]).then(() => {
        if (entry.verdict !== void 0) applyName(a, entry);
        replaying.add(a);
        try {
          replay();
        } finally {
          replaying.delete(a);
          held.delete(url);
          if (deferredRevokes.delete(url)) setTimeout(() => originalRevoke(url), REVOKE_GRACE_MS);
        }
      });
      return true;
    }
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    function installClickHooks() {
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (intercept(this, () => originalClick.call(this))) return;
        originalClick.call(this);
      };
      window.addEventListener(
        "click",
        (e) => {
          const a = e.target?.closest?.("a");
          if (!(a instanceof HTMLAnchorElement)) return;
          if (intercept(a, () => originalClick.call(a))) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        true
      );
      URL.revokeObjectURL = function(url) {
        if (held.has(url)) {
          deferredRevokes.add(url);
          return;
        }
        tracked.delete(url);
        originalRevoke(url);
      };
    }
  })();
})();
