/** User settings kept in `chrome.storage.sync` (nothing else is ever stored). */

export const PRODUCTION_URL = "https://awucat.app";
export const LOCAL_DEV_URL = "http://localhost:3000";

export const BASE_URL_PRESETS = [
  { id: "production", label: "awucat.app (varsayılan)", url: PRODUCTION_URL },
  { id: "local", label: "Yerel geliştirme (http://localhost:3000)", url: LOCAL_DEV_URL },
] as const;

export type OpenTarget = "viewer" | "editor";

export interface Settings {
  /** Origin (plus optional path prefix) of the AwuCat deployment, without a trailing slash. */
  baseUrl: string;
  /** Rename ".udf.zip" downloads (and UDF-typed responses) back to ".udf". */
  fixZip: boolean;
  /** Also guess from the name for ".zip" downloads coming from WhatsApp Web / webmail. */
  heuristic: boolean;
  /** Show a system notification when a download was renamed. */
  notify: boolean;
  /** Which app page receives files opened from links / the picker. */
  openTarget: OpenTarget;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: PRODUCTION_URL,
  fixZip: true,
  heuristic: true,
  notify: true,
  openTarget: "viewer",
};

export const APP_PATHS = {
  viewer: "/goruntuleyici",
  editor: "/editor",
  converter: "/donustur",
  privacy: "/gizlilik",
} as const;

/**
 * Validates a base URL typed by the user. Accepts http(s) origins with an optional path
 * prefix ("https://example.com/udf"); rejects everything else. Returns `null` when invalid.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  let u: URL;
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

/**
 * Match pattern covering every page of the given base URL's origin (for content scripts).
 * `withPort: false` drops the port — WebKit/Safari rejects match patterns that contain one.
 */
export function originPattern(baseUrl: string, withPort = true): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${withPort ? u.host : u.hostname}/*`;
}

export function appUrl(baseUrl: string, page: keyof typeof APP_PATHS, fromExtension = true): string {
  const base = normalizeBaseUrl(baseUrl) ?? PRODUCTION_URL;
  const url = base + APP_PATHS[page];
  return fromExtension && page !== "privacy" ? url + "?ext=1" : url;
}

function storage(): chrome.storage.SyncStorageArea {
  // `sync` is unavailable in a few managed profiles; fall back to `local` transparently.
  return (chrome.storage.sync ?? chrome.storage.local) as chrome.storage.SyncStorageArea;
}

export async function getSettings(): Promise<Settings> {
  try {
    const raw = (await storage().get(DEFAULT_SETTINGS)) as Partial<Settings>;
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitize({ ...(await getSettings()), ...patch });
  await storage().set(next);
  return next;
}

function sanitize(raw: Partial<Settings>): Settings {
  return {
    baseUrl: normalizeBaseUrl(raw.baseUrl ?? "") ?? DEFAULT_SETTINGS.baseUrl,
    fixZip: raw.fixZip ?? DEFAULT_SETTINGS.fixZip,
    heuristic: raw.heuristic ?? DEFAULT_SETTINGS.heuristic,
    notify: raw.notify ?? DEFAULT_SETTINGS.notify,
    openTarget: raw.openTarget === "editor" ? "editor" : "viewer",
  };
}

/** Calls `cb` whenever settings change in any extension context. */
export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync" || area === "local") void getSettings().then(cb);
  });
}
