/**
 * Runs in the MAIN world of https://web.whatsapp.com (declared in the manifest with
 * `"world": "MAIN"`, `document_start`). It has no extension APIs; the only import is the pure
 * naming logic, which esbuild bundles into this file.
 *
 * WhatsApp Web downloads documents through `URL.createObjectURL(blob)` + an `<a download>`.
 * UDF files sent from phones usually arrive as `application/zip` blobs named "x.udf.zip" or
 * "x.zip". Chrome forces a MIME type's preferred extension onto any name an extension
 * suggests, so a zip-typed blob can never be saved as ".udf" — this shim re-types zip blobs to
 * `application/octet-stream` (which has no preferred extension) before the URL is created.
 * The download name still comes from the anchor's `download` attribute, so ordinary zip files
 * are unaffected.
 *
 * It also reads the first/last bytes of the blob to check for a real UDF (a zip containing
 * `content.xml`) and reports the verdict to the isolated-world script (whatsapp.ts), which
 * forwards it to the service worker. That verdict lets the download hook rename "Karar.zip" →
 * "Karar.udf" based on content rather than guessing from the name.
 *
 * Browsers without a download hook (Safari): the isolated world posts
 * `{ type: "awucat-ext:config", renameInPage: true, … }`. The shim then renames at click
 * time instead — it rewrites the anchor's `download` attribute before the browser starts the
 * download (WebKit honours that name whatever the blob type). The sniff is asynchronous, so a
 * click that arrives before the verdict is held back (≤ 1.5 s) and replayed, and a
 * `revokeObjectURL` issued in the meantime is postponed until after the replay. In Chromium
 * none of this is activated.
 */
import { decideFilename } from "./lib/filename";

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
  const REVOKE_GRACE_MS = 30_000;
  const TRACK_LIMIT = 200;

  const original = URL.createObjectURL.bind(URL);
  if ((URL as unknown as { __awucatPatched?: boolean }).__awucatPatched) return;
  (URL as unknown as { __awucatPatched?: boolean }).__awucatPatched = true;

  /** Blob URLs created here that may be a UDF, with their (eventual) sniff verdict. */
  interface Tracked {
    type: string;
    size: number;
    verdict?: boolean;
    ready: Promise<boolean | undefined>;
  }
  const tracked = new Map<string, Tracked>();

  const config = { renameInPage: false, fixZip: true, heuristic: true };

  function contains(bytes: Uint8Array, needle: number[]): boolean {
    outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }

  async function sniff(blob: Blob): Promise<boolean> {
    const head = new Uint8Array(await blob.slice(0, HEAD).arrayBuffer());
    if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return false;
    if (contains(head, CONTENT_XML)) return true;
    const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - TAIL)).arrayBuffer());
    return contains(tail, CONTENT_XML);
  }

  URL.createObjectURL = function (obj: Blob | MediaSource): string {
    if (!(obj instanceof Blob) || obj.size > MAX_BYTES || obj.size < 4) return original(obj);
    const type = (obj.type || "").split(";")[0].trim().toLowerCase();
    const zipLike = ZIP_TYPES.test(type);
    if (!zipLike && type !== "application/octet-stream" && type !== "") return original(obj);

    const blob = zipLike ? new Blob([obj], { type: "application/octet-stream" }) : obj;
    const url = original(blob);
    const entry: Tracked = { type: blob.type, size: blob.size, ready: Promise.resolve(undefined) };
    entry.ready = sniff(blob).then(
      (udf) => {
        entry.verdict = udf;
        window.postMessage({ type: MESSAGE_TYPE, url, udf, size: blob.size }, window.location.origin);
        return udf;
      },
      () => undefined,
    );
    tracked.set(url, entry);
    if (tracked.size > TRACK_LIMIT) tracked.delete(tracked.keys().next().value as string);
    return url;
  };

  // -------------------------------------------------------------------------------------------
  // Click-time rename (only after the isolated world asked for it — see header)
  // -------------------------------------------------------------------------------------------

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    const d = e.data as { type?: string; renameInPage?: unknown; fixZip?: unknown; heuristic?: unknown };
    if (d.type !== CONFIG_TYPE) return;
    if (typeof d.fixZip === "boolean") config.fixZip = d.fixZip;
    if (typeof d.heuristic === "boolean") config.heuristic = d.heuristic;
    if (d.renameInPage === true && !config.renameInPage) {
      config.renameInPage = true;
      installClickHooks();
    }
  });

  /** Anchors whose click is being replayed after the verdict arrived (let those through). */
  const replaying = new WeakSet<HTMLAnchorElement>();
  /** Blob URLs whose download is on hold; `revokeObjectURL` waits for them. */
  const held = new Set<string>();
  const deferredRevokes = new Set<string>();

  function candidate(a: HTMLAnchorElement): Tracked | undefined {
    if (!config.renameInPage || !config.fixZip) return undefined;
    const name = a.getAttribute("download");
    if (!name || !a.href.startsWith("blob:")) return undefined;
    return tracked.get(a.href);
  }

  function applyName(a: HTMLAnchorElement, entry: Tracked): void {
    const from = a.getAttribute("download") || "";
    const decision = decideFilename(
      { filename: from, mime: entry.type, url: a.href, referrer: window.location.href, fileSize: entry.size, sniff: entry.verdict },
      { fixZip: config.fixZip, heuristic: config.heuristic },
    );
    if (!decision) return;
    a.setAttribute("download", decision.filename);
    window.postMessage({ type: RENAMED_TYPE, from, to: decision.filename, reason: decision.reason }, window.location.origin);
  }

  /**
   * Returns true when the click was taken over (verdict still pending); `replay` then runs once
   * the verdict is in or the wait timed out. Returns false to let the click proceed now.
   */
  function intercept(a: HTMLAnchorElement, replay: () => void): boolean {
    if (replaying.has(a)) return false;
    const entry = candidate(a);
    if (!entry) return false;
    if (entry.verdict !== undefined) {
      applyName(a, entry);
      return false;
    }
    const url = a.href;
    held.add(url);
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), VERDICT_WAIT_MS));
    void Promise.race([entry.ready, timeout]).then(() => {
      if (entry.verdict !== undefined) applyName(a, entry);
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

  function installClickHooks(): void {
    const originalClick = HTMLAnchorElement.prototype.click;
    // Programmatic downloads: `a.click()` on a (usually detached) anchor.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
      if (intercept(this, () => originalClick.call(this))) return;
      originalClick.call(this);
    };
    // Clicks dispatched on anchors in the document (user clicks, dispatchEvent).
    window.addEventListener(
      "click",
      (e: MouseEvent) => {
        const a = (e.target as Element | null)?.closest?.("a");
        if (!(a instanceof HTMLAnchorElement)) return;
        if (intercept(a, () => originalClick.call(a))) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    URL.revokeObjectURL = function (url: string): void {
      if (held.has(url)) {
        deferredRevokes.add(url);
        return;
      }
      tracked.delete(url);
      originalRevoke(url);
    };
  }
})();
