/**
 * Isolated-world companion of whatsapp-main.ts on https://web.whatsapp.com.
 *
 * Chromium (downloads.onDeterminingFilename available): relays the blob verdicts posted by the
 * page-world shim to the service worker, which consults them when the download is named.
 *
 * Safari (no downloads API): nothing is sent to the background. Instead the page shim is told
 * to rename at click time (with the user's settings), and each rename it reports is shown as a
 * small in-page notice when "notify" is on — Safari has no system notifications for extensions.
 *
 * Nothing else is read from the page.
 */
import { BG_BLOB_INFO, BLOB_MESSAGE, PAGE_CONFIG_MESSAGE, PAGE_RENAMED_MESSAGE, type BlobInfoMessage, type PageConfigMessage } from "./lib/protocol";
import { declaresDownloads } from "./lib/platform";
import { getSettings, onSettingsChanged, type Settings } from "./lib/settings";

// Content scripts cannot see chrome.downloads; the manifest tells whether the worker has the hook.
const downloadHook = declaresDownloads();
let notifyEnabled = true;

if (!downloadHook) {
  // Default config right away (the shim is already listening at document_start), then the real settings.
  postConfig({ fixZip: true, heuristic: true });
  void getSettings().then(applySettings);
  onSettingsChanged(applySettings);
}

function applySettings(s: Pick<Settings, "fixZip" | "heuristic" | "notify">): void {
  notifyEnabled = s.notify;
  postConfig(s);
}

function postConfig(s: Pick<Settings, "fixZip" | "heuristic">): void {
  const msg: PageConfigMessage = { type: PAGE_CONFIG_MESSAGE, renameInPage: true, fixZip: s.fixZip, heuristic: s.heuristic };
  window.postMessage(msg, window.location.origin);
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || typeof e.data !== "object") return;
  const d = e.data as { type?: string; url?: string; udf?: boolean; size?: number; from?: unknown; to?: unknown };

  if (d.type === PAGE_RENAMED_MESSAGE) {
    if (!downloadHook && notifyEnabled && typeof d.from === "string" && typeof d.to === "string") showNotice(d.from, d.to);
    return;
  }

  if (!downloadHook) return;
  if (d.type !== BLOB_MESSAGE || typeof d.url !== "string" || typeof d.udf !== "boolean") return;
  if (!d.url.startsWith("blob:")) return;
  const msg: BlobInfoMessage = { type: BG_BLOB_INFO, url: d.url, udf: d.udf, size: typeof d.size === "number" ? d.size : -1 };
  try {
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    /* extension reloaded — ignore */
  }
});

/** Small, self-dismissing notice in a closed shadow root (the page's CSS cannot touch it). */
function showNotice(from: string, to: string): void {
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
  body.textContent = `${from} → ${to}`;
  box.append(title, body);
  root.append(style, box);
  (document.body ?? document.documentElement).append(host);
  setTimeout(() => host.remove(), 5000);
}
