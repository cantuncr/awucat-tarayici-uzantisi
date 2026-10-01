/**
 * Pure download-filename logic (no browser APIs) so it can be unit-tested with `node --test`.
 *
 * Background: UDF files are zip containers. WhatsApp (especially iOS) and some mail clients
 * identify them as archives and deliver "dilekce.udf.zip" or plain "dilekce.zip". The
 * `chrome.downloads.onDeterminingFilename` hook lets us hand the browser a corrected name
 * before the file is written.
 *
 * Two hard facts shape the rules (verified in Chromium, see scripts/verify.mjs):
 *  - A service worker cannot read the bytes, so by default only the *name* and *MIME type*
 *    are available. On WhatsApp Web a page-world shim (whatsapp-main.ts) does look at the
 *    blob and reports a `sniff` verdict, which takes precedence over name guessing.
 *  - Chrome forces the MIME type's preferred extension onto any name an extension suggests
 *    ("x.udf" for `application/zip` is silently saved as "x.zip"). Renaming is therefore only
 *    attempted for MIME types without a preferred extension (octet-stream, unknown, UDF).
 */

export interface DownloadLike {
  /** Tentative filename (may contain sub-directories, uses the OS separator). */
  filename: string;
  mime?: string;
  url?: string;
  finalUrl?: string;
  referrer?: string;
  /** -1 or 0 when unknown (blob downloads report -1 until finished). */
  fileSize?: number;
  /** Content verdict from the WhatsApp Web shim: true = UDF, false = not a UDF, undefined = unknown. */
  sniff?: boolean;
}

export interface RenameOptions {
  /** ".udf.zip" → ".udf" and MIME-based fixes (safe, on by default). */
  fixZip: boolean;
  /** Name-based guess for ".zip" files coming from WhatsApp Web / webmail (on by default). */
  heuristic: boolean;
  /** Heuristic only applies below this size (default 25 MB). */
  maxHeuristicBytes?: number;
}

export type RenameReason = "udf-zip" | "mime" | "heuristic" | "sniff";

export interface RenameDecision {
  filename: string;
  reason: RenameReason;
}

export const DEFAULT_MAX_HEURISTIC_BYTES = 25 * 1024 * 1024;

/** Hosts whose ".zip" downloads are frequently mislabelled UDF files. Matched by suffix. */
export const HEURISTIC_HOSTS = [
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
  "mynet.com",
];

/**
 * Turkish legal-document words that make a ".zip" from WhatsApp/webmail very likely to be a
 * UDF. Matched against a lower-cased, accent-folded stem, as whole words.
 */
const LEGAL_WORDS = [
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
  "arabuluculuk",
];

const UDF_ZIP_RE = /^(.*?)\.udf(\s*\(\d+\))?\.zip$/i;

/** Splits "dir/sub/name.ext" into the directory prefix (with trailing separator) and the basename. */
function splitPath(path: string): { dir: string; base: string } {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? { dir: "", base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

/** Lower-cases and folds Turkish letters so "Dilekçe" and "DILEKCE" compare equal. */
export function foldTurkish(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

/** Host of the download source: referrer first, then the (blob-stripped) URL. */
export function sourceHost(item: Pick<DownloadLike, "url" | "finalUrl" | "referrer">): string {
  for (const candidate of [item.referrer, item.finalUrl, item.url]) {
    if (!candidate) continue;
    const raw = candidate.startsWith("blob:") ? candidate.slice(5) : candidate;
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host) return host;
    } catch {
      /* not a URL */
    }
  }
  return "";
}

export function isHeuristicHost(host: string): boolean {
  if (!host) return false;
  return HEURISTIC_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export function isUdfMime(mime: string | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m.includes("udf") || m.includes("uyap");
}

/** MIME types Chrome has no preferred extension for — the only ones where a ".udf" suggestion sticks. */
const GENERIC_MIMES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
  "application/x-download",
  "application/force-download",
  "application/unknown",
  "application/x-unknown",
  "application/binary",
]);

/**
 * False when Chrome would override our suggestion with the MIME type's own extension
 * (e.g. `application/zip` → ".zip", `text/plain` → ".txt"); renaming is pointless then.
 */
export function mimeAllowsRename(mime: string | undefined): boolean {
  const m = (mime || "").split(";")[0].trim().toLowerCase();
  if (!m) return true;
  if (isUdfMime(m)) return true;
  return GENERIC_MIMES.has(m);
}

/** True when the stem contains a legal-document word (whole word, accent-insensitive). */
export function looksLikeLegalDocument(stem: string): boolean {
  const words = foldTurkish(stem).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => LEGAL_WORDS.includes(w));
}

/**
 * Decides whether a download should be renamed. Returns `null` to leave it alone.
 * The returned `filename` keeps the original directory part and only changes the basename.
 */
export function decideFilename(item: DownloadLike, opts: RenameOptions): RenameDecision | null {
  const { dir, base } = splitPath(item.filename || "");
  if (!base) return null;
  const lower = base.toLowerCase();
  if (lower.endsWith(".udf")) return null;
  if (!mimeAllowsRename(item.mime)) return null;
  // The shim looked inside and it is not a UDF — never touch it, whatever the name says.
  if (item.sniff === false) return null;

  // 0. Content-verified UDF (WhatsApp Web shim): any ".zip" name becomes ".udf".
  if (opts.fixZip && item.sniff === true && lower.endsWith(".zip")) {
    const m = UDF_ZIP_RE.exec(base);
    const stem = m ? (m[1] || "belge") + (m[2] ? " " + m[2].trim() : "") : base.slice(0, -4);
    return { filename: dir + stem + ".udf", reason: "sniff" };
  }

  // 1. "dilekce.udf.zip" / "dilekce.udf (1).zip" → "dilekce.udf" / "dilekce (1).udf"
  if (opts.fixZip) {
    const m = UDF_ZIP_RE.exec(base);
    if (m) {
      const stem = m[1] || "belge";
      const counter = m[2] ? " " + m[2].trim() : "";
      return { filename: dir + stem + counter + ".udf", reason: "udf-zip" };
    }
  }

  // 2. The server said it is a UDF but the name does not agree.
  if (opts.fixZip && isUdfMime(item.mime)) {
    if (lower.endsWith(".zip")) return { filename: dir + base.slice(0, -4) + ".udf", reason: "mime" };
    if (!/\.[a-z0-9]{1,5}$/i.test(base)) return { filename: dir + base + ".udf", reason: "mime" };
    return null;
  }

  // 3. Name-based guess for ".zip" from WhatsApp Web / webmail, small files only.
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

export function basename(path: string): string {
  return splitPath(path).base;
}
