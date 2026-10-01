/**
 * AwuCat browser extension — background service worker (MV3).
 *
 *  1. Download fix: ".udf.zip" (WhatsApp Web, webmail) → ".udf" via downloads.onDeterminingFilename.
 *  2. Context menu "AwuCat'te aç" on document links and on selected text.
 *  3. Popup requests (open app page, open a picked file).
 *
 * Files are fetched inside the browser and handed to the AwuCat tab through a content
 * script (see lib/handover.ts and content.ts). Nothing is uploaded or logged anywhere.
 */
import { basename, decideFilename } from "./lib/filename";
import { linkPatterns, looksLikeHtmlPage, pickFilename } from "./lib/http";
import { base64ToBytes, utf8ToBytes } from "./lib/base64";
import { patternsForScript, urlMatchesPattern } from "./lib/match";
import { deliverToTab, openInApp, type HandoverFile } from "./lib/handover";
import { describeError, notify, NOTIFICATION_PREFIX_DOWNLOAD, UserError } from "./lib/notify";
import { appUrl, BASE_URL_PRESETS, getSettings, onSettingsChanged, type Settings } from "./lib/settings";
import { appOriginPattern, menusApi } from "./lib/platform";
import {
  BG_BLOB_INFO,
  BG_CLEAR_PENDING,
  BG_OPEN_APP,
  BG_OPEN_FILE,
  BG_RETRY_PENDING,
  MAX_FILE_BYTES,
  PENDING_KEY,
  type BackgroundMessage,
  type PendingOpen,
} from "./lib/protocol";

const MENU_LINK = "awucat-open-link";
const MENU_SELECTION = "awucat-open-selection";
const CUSTOM_CS_ID = "awucat-app-custom";

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void setupMenus();
  void getSettings().then(syncCustomContentScript);
});

chrome.runtime.onStartup.addListener(() => {
  void setupMenus();
  void getSettings().then(syncCustomContentScript);
});

onSettingsChanged((s) => void syncCustomContentScript(s));

/** `contextMenus` in Chromium; Safari and Firefox also expose it as `menus`. */
const menus = menusApi();

async function setupMenus(): Promise<void> {
  if (!menus) return;
  await menus.removeAll();
  menus.create({
    id: MENU_LINK,
    title: "AwuCat'te aç",
    contexts: ["link"],
    targetUrlPatterns: linkPatterns(),
  });
  menus.create({
    id: MENU_SELECTION,
    title: "Seçili metinle AwuCat'te yeni belge",
    contexts: ["selection"],
  });
}

/**
 * The two preset origins have static content scripts in the manifest. A custom base URL
 * (options page) gets a dynamically registered one — only once its host permission was granted.
 */
async function syncCustomContentScript(settings: Settings): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  const isPreset = BASE_URL_PRESETS.some((p) => p.url === settings.baseUrl);
  let existing: chrome.scripting.RegisteredContentScript[] = [];
  try {
    // CUSTOM_CS_ID is the only script this extension registers; drop any left over under an
    // older id (pre-rename builds) so the app page never gets content.js injected twice.
    const stale = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).filter((id) => id !== CUSTOM_CS_ID);
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  } catch {
    /* nothing to clean up */
  }
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_CS_ID] });
  } catch {
    /* none registered */
  }
  try {
    if (isPreset) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_CS_ID] });
      return;
    }
    const pattern = appOriginPattern(settings.baseUrl);
    if (!(await chrome.permissions.contains({ origins: [pattern] }))) return;
    const script: chrome.scripting.RegisteredContentScript = {
      id: CUSTOM_CS_ID,
      matches: [pattern],
      js: ["content.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (err) {
    console.warn("[AwuCat] content script registration failed", err);
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Download fix (Chromium only — Firefox and Safari have no downloads API; Safari renames
//    WhatsApp Web downloads in the page instead, see whatsapp-main.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Blob verdicts reported by the WhatsApp Web shim (whatsapp-main.ts → whatsapp.ts → here),
 * keyed by blob URL. Kept in memory and mirrored to storage.session in case the worker is
 * restarted between the report and the download.
 */
const blobVerdicts = new Map<string, { udf: boolean; size: number; at: number }>();
const BLOB_VERDICT_TTL_MS = 10 * 60_000;
const BLOB_VERDICT_WAIT_MS = 1500;
const VERDICT_PREFIX = "verdict:";

function rememberBlobVerdict(url: string, udf: boolean, size: number): void {
  const now = Date.now();
  blobVerdicts.set(url, { udf, size, at: now });
  for (const [k, v] of blobVerdicts) if (now - v.at > BLOB_VERDICT_TTL_MS) blobVerdicts.delete(k);
  void sessionStore()
    .set({ [VERDICT_PREFIX + url]: { udf, size, at: now } })
    .then(() => (blobVerdicts.size % 25 === 0 ? purgeStoredVerdicts(now) : undefined))
    .catch(() => undefined);
}

/** Drops expired verdicts from storage.session (only entries this worker wrote). */
async function purgeStoredVerdicts(now: number): Promise<void> {
  const all = await sessionStore().get(null);
  const stale = Object.entries(all)
    .filter(([k, v]) => k.startsWith(VERDICT_PREFIX) && now - ((v as { at?: number }).at ?? 0) > BLOB_VERDICT_TTL_MS)
    .map(([k]) => k);
  if (stale.length) await sessionStore().remove(stale);
}

/** Where the page-world shim runs (from the manifest, so a test build can widen it). */
const SHIM_PATTERNS = patternsForScript(chrome.runtime.getManifest(), "whatsapp-main.js");

/** Waits briefly for the shim's verdict; downloads start only milliseconds after the URL is created. */
async function lookupBlobVerdict(url: string): Promise<boolean | undefined> {
  if (!url.startsWith("blob:")) return undefined;
  if (!SHIM_PATTERNS.some((p) => urlMatchesPattern(url, p))) return undefined;
  const deadline = Date.now() + BLOB_VERDICT_WAIT_MS;
  for (;;) {
    const hit = blobVerdicts.get(url);
    if (hit) return hit.udf;
    try {
      const stored = (await sessionStore().get(VERDICT_PREFIX + url))[VERDICT_PREFIX + url] as { udf: boolean } | undefined;
      if (stored) return stored.udf;
    } catch {
      /* no session storage */
    }
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Last rename decision (diagnostics for scripts/verify.mjs). */
let lastDecision: { input: string; mime: string; sniff: boolean | undefined; output: string | null } | null = null;

chrome.downloads?.onDeterminingFilename?.addListener((item, suggest) => {
  let done = false;
  const finish = (suggestion?: chrome.downloads.FilenameSuggestion) => {
    if (done) return;
    done = true;
    suggest(suggestion);
  };
  void (async () => {
    try {
      const s = await getSettings();
      const sniff = s.fixZip ? await lookupBlobVerdict(item.url) : undefined;
      const decision = decideFilename(
        { filename: item.filename, mime: item.mime, url: item.url, finalUrl: item.finalUrl, referrer: item.referrer, fileSize: item.fileSize, sniff },
        { fixZip: s.fixZip, heuristic: s.heuristic },
      );
      lastDecision = { input: item.filename, mime: item.mime, sniff, output: decision?.filename ?? null };
      if (!decision) return finish();
      finish({ filename: decision.filename, conflictAction: "uniquify" });
      if (s.notify) {
        await notify(`${basename(item.filename)} → ${basename(decision.filename)}\nDosya .udf olarak düzeltildi.`, {
          id: NOTIFICATION_PREFIX_DOWNLOAD + item.id,
          title: "AwuCat: dosya .udf olarak düzeltildi",
        });
      }
    } catch (err) {
      console.warn("[AwuCat] filename decision failed", err);
      finish();
    }
  })();
  // Async `suggest` — the listener must return true.
  return true;
});

chrome.notifications?.onClicked?.addListener((id) => {
  if (id.startsWith(NOTIFICATION_PREFIX_DOWNLOAD)) {
    const downloadId = Number(id.slice(NOTIFICATION_PREFIX_DOWNLOAD.length));
    if (Number.isFinite(downloadId)) chrome.downloads.show(downloadId);
  }
  chrome.notifications.clear(id);
});

// ---------------------------------------------------------------------------------------------
// 2. Context menu
// ---------------------------------------------------------------------------------------------

menus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION && info.selectionText) {
    void openSelection(info.selectionText);
    return;
  }
  if (info.menuItemId !== MENU_LINK || !info.linkUrl) return;

  const link = info.linkUrl;
  if (!/^(https?:|blob:)/i.test(link)) {
    void notify("Bu tür bağlantılar açılamıyor. Yerel dosyalar için uzantı simgesindeki \"Dosya seç\" düğmesini kullanın.");
    return;
  }
  let linkOrigin: string;
  try {
    linkOrigin = originOf(link);
  } catch {
    void notify("Bağlantı adresi okunamadı.");
    return;
  }
  const frameOrigin = safeOrigin(info.frameUrl || info.pageUrl || "");
  const sameOrigin = linkOrigin === frameOrigin;

  // Cross-origin links need a host permission for the fetch. `permissions.request` is only
  // allowed inside a user gesture, so it must be called synchronously here — before any await.
  // If the origin was granted earlier the call resolves without showing a prompt.
  let permission: Promise<boolean> = Promise.resolve(true);
  if (!sameOrigin && chrome.permissions?.request) {
    try {
      permission = chrome.permissions.request({ origins: [linkOrigin + "/*"] }).catch(() => false);
    } catch {
      permission = Promise.resolve(false);
    }
  }

  void openLink({ url: link, origin: linkOrigin, sameOrigin, tabId: tab?.id, frameId: info.frameId, permission });
});

interface LinkRequest {
  url: string;
  origin: string;
  sameOrigin: boolean;
  tabId?: number;
  frameId?: number;
  permission: Promise<boolean>;
}

interface FetchedFile extends HandoverFile {
  finalUrl?: string;
}

/** The worker could not reach the origin — a host permission is missing. */
class NeedsPermission extends Error {}
/** executeScript itself failed (no activeTab grant, restricted page…) — try the worker instead. */
class InjectError extends Error {}

async function openLink(req: LinkRequest): Promise<void> {
  const settings = await getSettings();
  try {
    const file = await fetchLink(req);
    await openInApp(file, { baseUrl: settings.baseUrl, target: settings.openTarget });
  } catch (err) {
    if (err instanceof NeedsPermission) {
      await setPending({ url: req.url, origin: req.origin, name: pickFilename({ url: req.url }), createdAt: Date.now() });
      await notify(`${hostOf(req.origin)} adresinden dosya almak için izin gerekiyor. Uzantı simgesine tıklayıp "İzin ver ve aç" deyin.`, {
        title: "AwuCat: izin gerekli",
      });
      return;
    }
    await notify(describeError(err), { title: "AwuCat: dosya açılamadı" });
  }
}

/**
 * Same-origin (and blob:) links are fetched inside the page itself — that works with the
 * page's session cookies and needs nothing beyond activeTab. Cross-origin links are fetched
 * from the worker with the host permission requested at click time.
 */
async function fetchLink(req: LinkRequest): Promise<FetchedFile> {
  const granted = await req.permission;

  if (req.sameOrigin && req.tabId !== undefined && hasScripting()) {
    try {
      return await fetchInPage(req.tabId, req.frameId, req.url);
    } catch (err) {
      // A fetch that ran inside the page and failed is a real error; only injection failures fall through.
      if (!(err instanceof InjectError)) throw err;
    }
  }

  if (req.url.startsWith("blob:")) throw new UserError("Bu bağlantı sayfa içi geçici bir dosyaya işaret ediyor; dosyayı indirip uzantı simgesindeki \"Dosya seç\" ile açın.");

  try {
    return await fetchInWorker(req.url);
  } catch (err) {
    // Without a host permission the worker's fetch is rejected with a generic TypeError.
    if (err instanceof TypeError && (!granted || req.sameOrigin)) throw new NeedsPermission(req.origin);
    throw err;
  }
}

/** Runs in the page (isolated world); must stay self-contained — it is serialized by executeScript. */
function pageFetch(url: string, maxBytes: number): Promise<{ ok?: true; error?: string; size?: number; data?: string; mime?: string; disposition?: string; finalUrl?: string }> {
  return fetch(url, { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) return { error: "HTTP " + res.status };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) return { error: "too-large", size: buf.byteLength };
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      return {
        ok: true as const,
        data: btoa(bin),
        mime: res.headers.get("content-type") || "",
        disposition: res.headers.get("content-disposition") || "",
        finalUrl: res.url,
      };
    })
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
}

async function fetchInPage(tabId: number, frameId: number | undefined, url: string): Promise<FetchedFile> {
  let results: chrome.scripting.InjectionResult[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: frameId !== undefined ? [frameId] : undefined },
      func: pageFetch,
      args: [url, MAX_FILE_BYTES],
    });
  } catch (err) {
    throw new InjectError(err instanceof Error ? err.message : String(err));
  }
  const r = results?.[0]?.result as Awaited<ReturnType<typeof pageFetch>> | undefined;
  if (!r) throw new InjectError("Sayfa içi indirme sonuç döndürmedi.");
  if (r.error === "too-large") throw new UserError(`Dosya çok büyük (${Math.round((r.size ?? 0) / 1048576)} MB). Sınır ${MAX_FILE_BYTES / 1048576} MB.`);
  if (r.error || !r.ok || !r.data) throw new UserError(/^HTTP \d+/.test(r.error || "") ? `Sunucu ${r.error!.slice(5)} yanıtı verdi.` : describeError(new Error(r.error || "Sayfa içi indirme başarısız.")));
  return finishFetched({ data: r.data, mime: r.mime ?? "", disposition: r.disposition ?? "", url, finalUrl: r.finalUrl });
}

async function fetchInWorker(url: string): Promise<FetchedFile> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new UserError(`Sunucu ${res.status} yanıtı verdi.`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FILE_BYTES) throw new UserError(`Dosya çok büyük (${Math.round(buf.byteLength / 1048576)} MB). Sınır ${MAX_FILE_BYTES / 1048576} MB.`);
  const mime = res.headers.get("content-type") || "";
  const name = pickFilename({ disposition: res.headers.get("content-disposition"), url, finalUrl: res.url, mime });
  if (looksLikeHtmlPage(mime, name)) throw new UserError("Bağlantı bir belge yerine web sayfası döndürdü (oturum açmanız gerekebilir).");
  return { name, mime: mime.split(";")[0].trim(), bytes: new Uint8Array(buf), finalUrl: res.url };
}

function finishFetched(r: { data: string; mime: string; disposition: string; url: string; finalUrl?: string }): FetchedFile {
  const name = pickFilename({ disposition: r.disposition, url: r.url, finalUrl: r.finalUrl, mime: r.mime });
  if (looksLikeHtmlPage(r.mime, name)) throw new UserError("Bağlantı bir belge yerine web sayfası döndürdü (oturum açmanız gerekebilir).");
  return { name, mime: r.mime.split(";")[0].trim(), bytes: base64ToBytes(r.data), finalUrl: r.finalUrl };
}

async function openSelection(text: string): Promise<void> {
  const settings = await getSettings();
  try {
    await openInApp({ name: "secilen-metin.txt", mime: "text/plain", bytes: utf8ToBytes(text) }, { baseUrl: settings.baseUrl, target: "editor" });
  } catch (err) {
    await notify(describeError(err), { title: "AwuCat: metin açılamadı" });
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Popup / options messages
// ---------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as BackgroundMessage;
  if (!msg || typeof msg !== "object") return;
  const reply = (p: Promise<unknown>) => {
    p.then((result) => sendResponse({ ok: true, result })).catch((err: unknown) => sendResponse({ ok: false, error: describeError(err) }));
    return true;
  };
  switch (msg.type) {
    case BG_OPEN_APP:
      return reply(
        getSettings().then((s) => {
          const page = msg.page === "editor" ? "editor" : msg.page === "converter" ? "converter" : "viewer";
          return chrome.tabs.create({ url: appUrl(s.baseUrl, page) });
        }),
      );
    case BG_OPEN_FILE:
      return reply(
        getSettings().then((s) => {
          const bytes = base64ToBytes(msg.data);
          if (bytes.byteLength > MAX_FILE_BYTES) throw new UserError(`Dosya çok büyük. Sınır ${MAX_FILE_BYTES / 1048576} MB.`);
          const name = msg.name || "belge.udf";
          const target = /\.(docx?|odt|ott|rtf|txt|html?)$/i.test(name) ? "editor" : s.openTarget;
          return openInApp({ name, mime: msg.mime || "", bytes }, { baseUrl: s.baseUrl, target });
        }),
      );
    case BG_RETRY_PENDING:
      return reply(retryPending());
    case BG_CLEAR_PENDING:
      return reply(clearPending());
    case BG_BLOB_INFO:
      if (typeof msg.url === "string" && typeof msg.udf === "boolean") rememberBlobVerdict(msg.url, msg.udf, msg.size);
      return;
    default:
      return;
  }
});

// ---------------------------------------------------------------------------------------------
// Pending permission flow (stored in storage.session, granted from the popup)
// ---------------------------------------------------------------------------------------------

function sessionStore(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

async function setPending(p: PendingOpen): Promise<void> {
  await sessionStore().set({ [PENDING_KEY]: p });
}

async function clearPending(): Promise<void> {
  await sessionStore().remove(PENDING_KEY);
}

async function retryPending(): Promise<void> {
  const data = await sessionStore().get(PENDING_KEY);
  const pending = data?.[PENDING_KEY] as PendingOpen | undefined;
  if (!pending) throw new UserError("Bekleyen bir istek yok.");
  const settings = await getSettings();
  const file = await fetchInWorker(pending.url);
  await clearPending();
  await openInApp(file, { baseUrl: settings.baseUrl, target: settings.openTarget });
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/** `chrome.scripting` is optional at runtime (Firefox variants without the permission). */
function hasScripting(): boolean {
  const scripting = (chrome as unknown as { scripting?: { executeScript?: unknown } }).scripting;
  return typeof scripting?.executeScript === "function";
}

function originOf(url: string): string {
  const raw = url.startsWith("blob:") ? url.slice(5) : url;
  return new URL(raw).origin;
}

function safeOrigin(url: string): string {
  try {
    return originOf(url);
  } catch {
    return "";
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

// Test hook: lets the Playwright verification drive the handover exactly like the popup does.
(globalThis as unknown as { __awucat?: unknown }).__awucat = { openInApp, deliverToTab, openLink, getSettings, lastDecision: () => lastDecision };
