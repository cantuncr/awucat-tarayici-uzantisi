/**
 * Message contracts between the extension's own contexts (service worker ↔ popup/options ↔
 * content script) and the page-level contract with the AwuCat web app.
 *
 * Page contract (owned by src/components/editor/editor-app.tsx in the web app):
 *   app → window:  { type: "awucat:ready" }                          posted once the app can receive files
 *   ext → window:  { type: "awucat:open", name, bytes, mime }        bytes is an ArrayBuffer
 * The app only accepts messages whose `e.source === window`, which is exactly what a content
 * script's `window.postMessage` produces.
 */

export const PAGE_READY = "awucat:ready";
export const PAGE_OPEN = "awucat:open";

/** Service worker → content script: is the script alive in this tab? */
export const CS_PING = "awucat-ext:ping";
/** Service worker → content script: one base64 chunk of a file. */
export const CS_CHUNK = "awucat-ext:chunk";

/** Popup/options → service worker. */
export const BG_OPEN_APP = "awucat-ext:open-app";
export const BG_OPEN_FILE = "awucat-ext:open-file";
export const BG_RETRY_PENDING = "awucat-ext:retry-pending";
export const BG_CLEAR_PENDING = "awucat-ext:clear-pending";

/** WhatsApp Web page-world shim → isolated world (window.postMessage). */
export const BLOB_MESSAGE = "awucat-ext:blob";
/** WhatsApp Web isolated world → service worker: verdict for one blob URL. */
export const BG_BLOB_INFO = "awucat-ext:blob-info";

/**
 * Browsers without `downloads.onDeterminingFilename` (Safari): the isolated world tells the
 * page-world shim to rename at click time instead ({ type, renameInPage, fixZip, heuristic }),
 * and the shim reports each rename back ({ type, from, to }) so a notice can be shown.
 */
export const PAGE_CONFIG_MESSAGE = "awucat-ext:config";
export const PAGE_RENAMED_MESSAGE = "awucat-ext:renamed";

export interface PageConfigMessage {
  type: typeof PAGE_CONFIG_MESSAGE;
  renameInPage: boolean;
  fixZip: boolean;
  heuristic: boolean;
}

export interface BlobInfoMessage {
  type: typeof BG_BLOB_INFO;
  url: string;
  /** true = zip containing content.xml (a UDF); false = something else. */
  udf: boolean;
  size: number;
}

export interface ChunkMessage {
  type: typeof CS_CHUNK;
  transferId: string;
  index: number;
  total: number;
  name: string;
  mime: string;
  data: string;
}

export interface PingMessage {
  type: typeof CS_PING;
}

export interface OpenAppMessage {
  type: typeof BG_OPEN_APP;
  page: "viewer" | "editor" | "converter";
}

export interface OpenFileMessage {
  type: typeof BG_OPEN_FILE;
  name: string;
  mime: string;
  /** base64 */
  data: string;
}

export interface RetryPendingMessage {
  type: typeof BG_RETRY_PENDING;
}

export interface ClearPendingMessage {
  type: typeof BG_CLEAR_PENDING;
}

export type BackgroundMessage = OpenAppMessage | OpenFileMessage | RetryPendingMessage | ClearPendingMessage | BlobInfoMessage;

/**
 * A link the user asked to open but which the service worker could not fetch because the
 * host permission is missing. Kept in `chrome.storage.session` until the popup grants it.
 */
export interface PendingOpen {
  url: string;
  origin: string;
  /** Suggested file name (from the link), used if the response has no better one. */
  name: string;
  createdAt: number;
}

export const PENDING_KEY = "pendingOpen";

/**
 * Last status message when the browser has no `notifications` API (Safari): kept in
 * storage.session, flagged with a toolbar badge and shown (then cleared) by the popup.
 */
export interface StoredNotice {
  title: string;
  message: string;
  createdAt: number;
}

export const NOTICE_KEY = "lastNotice";

/** Files above this size are refused (base64 messaging would get too heavy). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
