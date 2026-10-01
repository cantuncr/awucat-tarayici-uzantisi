/**
 * Runtime feature detection shared by all extension contexts. The same bundles run in Chrome,
 * Edge, Firefox and Safari; only the manifest differs per target (scripts/build.mjs), so every
 * browser difference is decided here from what the running browser actually provides.
 */
import { patternsForScript } from "./match";
import { originPattern } from "./settings";

/**
 * Safari serves extension pages from `safari-web-extension://` (other WebKit hosts of the same
 * extension engine use `webkit-extension://`). Used for wording/UX and WebKit-specific rules.
 */
export function isSafari(): boolean {
  try {
    return /^(safari-web-extension|webkit-extension):/.test(chrome.runtime.getURL(""));
  } catch {
    return false;
  }
}

/**
 * Match pattern for the app origin. WebKit rejects patterns with a port
 * ("http://localhost:3000/*" is invalid there), so Safari gets the port-less form.
 */
export function appOriginPattern(baseUrl: string): string {
  return originPattern(baseUrl, !isSafari());
}

/** Chromium: downloads can be renamed before they are written. Firefox and Safari: no. */
export function hasDownloadHook(): boolean {
  return !!(chrome as unknown as { downloads?: { onDeterminingFilename?: unknown } }).downloads?.onDeterminingFilename;
}

/**
 * Content-script variant of `hasDownloadHook`: content scripts never see `chrome.downloads`,
 * so they go by the manifest (the Safari package does not request the permission).
 */
export function declaresDownloads(): boolean {
  try {
    return (chrome.runtime.getManifest().permissions ?? []).includes("downloads");
  } catch {
    return false;
  }
}

/** True when the build ships the WhatsApp Web page shim (Chrome and Safari packages; not Firefox). */
export function hasWhatsAppShim(): boolean {
  try {
    return patternsForScript(chrome.runtime.getManifest(), "whatsapp-main.js").length > 0;
  } catch {
    return false;
  }
}

/**
 * Where the ".zip → .udf" fix can work in this browser:
 *  - "download-hook": every download (Chromium, via downloads.onDeterminingFilename),
 *  - "page": only WhatsApp Web blob downloads, renamed by the page shim at click time (Safari),
 *  - "none": not at all (Firefox package).
 */
export function zipFixMode(): "download-hook" | "page" | "none" {
  if (hasDownloadHook()) return "download-hook";
  return hasWhatsAppShim() ? "page" : "none";
}

/** `contextMenus` (Chromium, Safari alias) or `menus` (Firefox, Safari). */
export function menusApi(): typeof chrome.contextMenus | undefined {
  const c = chrome as unknown as { contextMenus?: typeof chrome.contextMenus; menus?: typeof chrome.contextMenus };
  return c.contextMenus ?? c.menus;
}
