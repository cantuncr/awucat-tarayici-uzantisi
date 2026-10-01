"use strict";
(() => {
  // src/lib/base64.ts
  function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // src/lib/protocol.ts
  var PAGE_READY = "awucat:ready";
  var PAGE_OPEN = "awucat:open";
  var CS_PING = "awucat-ext:ping";
  var CS_CHUNK = "awucat-ext:chunk";
  var MAX_FILE_BYTES = 50 * 1024 * 1024;

  // src/content.ts
  var READY_FALLBACK_MS = 5e3;
  var transfers = /* @__PURE__ */ new Map();
  var waiting = [];
  var readySeen = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    if (e.data.type !== PAGE_READY) return;
    readySeen = true;
    for (const f of waiting) {
      if (!f.posted || f.postedBlind) post(f);
    }
    waiting.length = 0;
  });
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === CS_PING) {
      sendResponse({ ok: true, ready: readySeen });
      return;
    }
    if (msg.type === CS_CHUNK) {
      try {
        const complete = receiveChunk(msg);
        sendResponse({ ok: true, complete });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
  function receiveChunk(msg) {
    let t = transfers.get(msg.transferId);
    if (!t) {
      t = { name: msg.name, mime: msg.mime, total: msg.total, parts: new Array(msg.total).fill(""), received: 0 };
      transfers.set(msg.transferId, t);
    }
    if (msg.index < 0 || msg.index >= t.total) throw new Error("Ge\xE7ersiz par\xE7a.");
    if (!t.parts[msg.index]) t.received++;
    t.parts[msg.index] = msg.data;
    if (t.received < t.total) return false;
    transfers.delete(msg.transferId);
    const bytes = base64ToBytes(t.parts.join(""));
    schedule({ name: t.name, mime: t.mime, bytes, postedBlind: false, posted: false });
    return true;
  }
  function schedule(file) {
    if (readySeen) {
      post(file);
      return;
    }
    waiting.push(file);
    const fire = () => {
      setTimeout(() => {
        if (file.posted) return;
        file.postedBlind = true;
        post(file);
      }, READY_FALLBACK_MS);
    };
    if (document.readyState === "complete") fire();
    else window.addEventListener("load", fire, { once: true });
  }
  function post(file) {
    const buffer = file.bytes.slice().buffer;
    file.posted = true;
    window.postMessage({ type: PAGE_OPEN, name: file.name, bytes: buffer, mime: file.mime }, window.location.origin, [buffer]);
  }
})();
