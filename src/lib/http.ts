/** Pure helpers for naming a fetched document (unit-tested with `node --test`). */

const MIME_EXT: Array<[RegExp, string]> = [
  [/udf|uyap/i, "udf"],
  [/pdf/i, "pdf"],
  [/wordprocessingml/i, "docx"],
  [/msword/i, "doc"],
  [/opendocument\.text/i, "odt"],
  [/rtf/i, "rtf"],
  [/tiff?/i, "tif"],
  [/zip/i, "zip"],
  [/plain/i, "txt"],
  [/html/i, "html"],
];

/** Extensions the web app can import (mirrors IMPORT_ACCEPT in src/lib/formats/kinds.ts, plus tiff). */
export const OPENABLE_EXTENSIONS = ["udf", "zip", "pdf", "docx", "docm", "doc", "odt", "ott", "rtf", "txt", "html", "htm", "tif", "tiff", "png", "jpg", "jpeg", "gif", "webp", "bmp"];

/** Extensions shown in the link context menu (kept short on purpose). */
export const MENU_EXTENSIONS = ["udf", "zip", "tif", "tiff", "pdf", "docx", "doc", "odt", "rtf"];

/**
 * Builds `targetUrlPatterns` for the context menu. Match patterns compare against the path
 * *and* the query string, and are case-sensitive, so each extension needs four variants.
 */
export function linkPatterns(extensions: string[] = MENU_EXTENSIONS): string[] {
  const out: string[] = [];
  for (const ext of extensions) {
    for (const e of new Set([ext.toLowerCase(), ext.toUpperCase()])) {
      out.push(`*://*/*.${e}`, `*://*/*.${e}?*`);
    }
  }
  return out;
}

/** Parses RFC 6266 `Content-Disposition` for a filename (prefers `filename*=`). */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
  if (star) {
    try {
      return sanitizeName(decodeURIComponent(star[1].trim()));
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header);
  if (quoted) return sanitizeName(quoted[1].replace(/\\(.)/g, "$1"));
  const bare = /filename\s*=\s*([^;]+)/.exec(header);
  if (bare) return sanitizeName(bare[1].trim());
  return null;
}

/** Last path segment of a URL, percent-decoded, or null when the path has no usable name. */
export function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (!seg) return null;
    let name: string;
    try {
      name = decodeURIComponent(seg);
    } catch {
      name = seg;
    }
    return /\.[a-z0-9]{1,5}$/i.test(name) ? sanitizeName(name) : null;
  } catch {
    return null;
  }
}

export function extensionForMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const type = mime.split(";")[0].trim();
  if (!type || type === "application/octet-stream") return null;
  for (const [re, ext] of MIME_EXT) if (re.test(type)) return ext;
  return null;
}

/** Strips path separators and control characters; keeps Turkish letters. */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(0, 180) || "belge";
}

/**
 * Chooses the name the app will see: Content-Disposition, then the URL, then a MIME-based
 * fallback. Never returns an empty string.
 */
export function pickFilename(opts: { disposition?: string | null; url: string; finalUrl?: string | null; mime?: string | null; fallback?: string | null }): string {
  const fromHeader = filenameFromDisposition(opts.disposition);
  if (fromHeader) return fromHeader;
  const fromUrl = filenameFromUrl(opts.url) ?? (opts.finalUrl ? filenameFromUrl(opts.finalUrl) : null);
  if (fromUrl) return fromUrl;
  if (opts.fallback) return sanitizeName(opts.fallback);
  return "belge." + (extensionForMime(opts.mime) ?? "udf");
}

/** True when a response is an HTML page rather than a document (typically a login redirect). */
export function looksLikeHtmlPage(mime: string | null | undefined, name: string): boolean {
  const type = (mime || "").split(";")[0].trim().toLowerCase();
  return type === "text/html" && !/\.(html?|xhtml)$/i.test(name);
}
