/**
 * Content script — runs only on the AwuCat origin (manifest `content_scripts` for the
 * presets; dynamically registered for a custom base URL).
 *
 * It receives a file from the service worker in base64 chunks and posts it into the page as
 * { type: "awucat:open", name, bytes, mime } once the app has announced
 * { type: "awucat:ready" } (or after a 5 s fallback). The app accepts the message because
 * `e.source === window` — a content script shares the page's window.
 */
import { base64ToBytes } from "./lib/base64";
import { CS_CHUNK, CS_PING, PAGE_OPEN, PAGE_READY, type ChunkMessage, type PingMessage } from "./lib/protocol";

const READY_FALLBACK_MS = 5000;

interface Transfer {
  name: string;
  mime: string;
  total: number;
  parts: string[];
  received: number;
}

interface WaitingFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** Set once posted; a late `ready` re-posts only files delivered blindly by the fallback. */
  postedBlind: boolean;
  posted: boolean;
}

const transfers = new Map<string, Transfer>();
const waiting: WaitingFile[] = [];
let readySeen = false;

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || typeof e.data !== "object") return;
  if ((e.data as { type?: string }).type !== PAGE_READY) return;
  readySeen = true;
  for (const f of waiting) {
    if (!f.posted || f.postedBlind) post(f);
  }
  waiting.length = 0;
});

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as PingMessage | ChunkMessage;
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

function receiveChunk(msg: ChunkMessage): boolean {
  let t = transfers.get(msg.transferId);
  if (!t) {
    t = { name: msg.name, mime: msg.mime, total: msg.total, parts: new Array<string>(msg.total).fill(""), received: 0 };
    transfers.set(msg.transferId, t);
  }
  if (msg.index < 0 || msg.index >= t.total) throw new Error("Geçersiz parça.");
  if (!t.parts[msg.index]) t.received++;
  t.parts[msg.index] = msg.data;
  if (t.received < t.total) return false;
  transfers.delete(msg.transferId);
  const bytes = base64ToBytes(t.parts.join(""));
  schedule({ name: t.name, mime: t.mime, bytes, postedBlind: false, posted: false });
  return true;
}

function schedule(file: WaitingFile): void {
  if (readySeen) {
    post(file);
    return;
  }
  waiting.push(file);
  const fire = () => {
    setTimeout(() => {
      if (file.posted) return;
      // The app never said "ready" — post anyway; if "ready" arrives later we post again,
      // which at worst re-opens the same document in the viewer.
      file.postedBlind = true;
      post(file);
    }, READY_FALLBACK_MS);
  };
  if (document.readyState === "complete") fire();
  else window.addEventListener("load", fire, { once: true });
}

function post(file: WaitingFile): void {
  // Copy so a re-post after a transfer is still possible.
  const buffer = file.bytes.slice().buffer;
  file.posted = true;
  window.postMessage({ type: PAGE_OPEN, name: file.name, bytes: buffer, mime: file.mime }, window.location.origin, [buffer]);
}
