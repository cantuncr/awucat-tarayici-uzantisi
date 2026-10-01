/** Toolbar popup: quick links, file picker (handover to the app), zip-fix toggle, pending permission. */
import { bytesToBase64 } from "./lib/base64";
import { appUrl, getSettings, saveSettings } from "./lib/settings";
import { takeStoredNotice } from "./lib/notify";
import { appOriginPattern, isSafari, zipFixMode } from "./lib/platform";
import { BG_CLEAR_PENDING, BG_OPEN_APP, BG_OPEN_FILE, BG_RETRY_PENDING, MAX_FILE_BYTES, PENDING_KEY, type BackgroundMessage, type PendingOpen } from "./lib/protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>("status");

function setStatus(text: string, kind: "" | "ok" | "error" = ""): void {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

async function send<T = unknown>(msg: BackgroundMessage): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; result?: T; error?: string } | undefined;
  if (!res) throw new Error("Arka plan betiği yanıt vermedi.");
  if (!res.ok) throw new Error(res.error || "Bilinmeyen hata.");
  return res.result as T;
}

async function openPage(page: "viewer" | "editor" | "converter"): Promise<void> {
  try {
    await send({ type: BG_OPEN_APP, page });
    window.close();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

async function openFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`Dosya çok büyük (${Math.round(file.size / 1048576)} MB). Sınır ${MAX_FILE_BYTES / 1048576} MB.`, "error");
    return;
  }
  setStatus(`${file.name} açılıyor…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await send({ type: BG_OPEN_FILE, name: file.name, mime: file.type, data: bytesToBase64(bytes) });
    setStatus("AwuCat sekmesinde açıldı.", "ok");
    setTimeout(() => window.close(), 400);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

function sessionStore(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

async function loadPending(): Promise<void> {
  const banner = $<HTMLElement>("pending");
  try {
    const data = await sessionStore().get(PENDING_KEY);
    const pending = data?.[PENDING_KEY] as PendingOpen | undefined;
    if (!pending || Date.now() - pending.createdAt > 15 * 60_000) {
      banner.hidden = true;
      return;
    }
    $<HTMLElement>("pending-host").textContent = new URL(pending.origin).host;
    banner.hidden = false;
    $<HTMLButtonElement>("pending-grant").onclick = async () => {
      try {
        const granted = await chrome.permissions.request({ origins: [pending.origin + "/*"] });
        if (!granted) {
          setStatus("İzin verilmedi.", "error");
          return;
        }
        setStatus("Dosya alınıyor…");
        await send({ type: BG_RETRY_PENDING });
        window.close();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), "error");
      }
    };
    $<HTMLButtonElement>("pending-dismiss").onclick = async () => {
      await send({ type: BG_CLEAR_PENDING }).catch(() => undefined);
      banner.hidden = true;
    };
  } catch {
    banner.hidden = true;
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  const fixZip = $<HTMLInputElement>("fixZip");
  fixZip.checked = settings.fixZip;
  fixZip.addEventListener("change", () => void saveSettings({ fixZip: fixZip.checked }));
  const mode = zipFixMode();
  if (mode === "none") {
    // Firefox: the downloads hook does not exist; make that visible instead of failing silently.
    fixZip.disabled = true;
    fixZip.title = "Bu tarayıcı indirme adı düzeltmesini desteklemiyor (Chrome/Edge gerekir).";
  } else if (mode === "page") {
    // Safari: no downloads API — only WhatsApp Web downloads are renamed, inside the page.
    $<HTMLElement>("fixZip-sub").textContent = "WhatsApp Web'den .zip olarak inen UDF'leri .udf yapar (Safari'de yalnızca WhatsApp Web).";
  }

  $<HTMLAnchorElement>("privacy").href = appUrl(settings.baseUrl, "privacy", false);
  $<HTMLSpanElement>("base").textContent = new URL(settings.baseUrl).host;

  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((b) => {
    b.addEventListener("click", () => void openPage(b.dataset.page as "viewer" | "editor" | "converter"));
  });

  $<HTMLButtonElement>("settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());

  const input = $<HTMLInputElement>("file");
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) void openFile(f);
    input.value = "";
  });

  const drop = $<HTMLLabelElement>("drop");
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("active");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("active");
    });
  }
  drop.addEventListener("drop", (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void openFile(f);
  });

  await loadPending();
  await loadNotice();
  if (isSafari()) await loadSiteAccess(settings.baseUrl);
}

/** Browsers without system notifications (Safari) leave the last message for the popup. */
async function loadNotice(): Promise<void> {
  const notice = await takeStoredNotice();
  if (notice && !status.textContent) setStatus(`${notice.title}: ${notice.message}`, /açılamadı|izin/i.test(notice.title) ? "error" : "");
}

/**
 * Safari grants no site access at install time: content scripts (file handover on the app
 * origin, the WhatsApp Web fix) only run once the user allows those sites. Offer it here.
 */
async function loadSiteAccess(baseUrl: string): Promise<void> {
  const banner = $<HTMLElement>("access");
  const wanted = [appOriginPattern(baseUrl), "https://web.whatsapp.com/*"];
  const missing: string[] = [];
  for (const origin of wanted) {
    try {
      if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
    } catch {
      /* unknown — do not nag */
    }
  }
  if (!missing.length) {
    banner.hidden = true;
    return;
  }
  $<HTMLElement>("access-hosts").textContent = missing.map((o) => new URL(o.replace("/*", "/")).host).join(", ");
  banner.hidden = false;
  $<HTMLButtonElement>("access-grant").onclick = async () => {
    try {
      const granted = await chrome.permissions.request({ origins: missing });
      if (granted) {
        banner.hidden = true;
        setStatus("Site erişimi verildi. Açık WhatsApp Web / AwuCat sekmelerini yenileyin.", "ok");
        return;
      }
    } catch {
      /* fall through to the manual route */
    }
    setStatus("İzin verilmedi. Safari > Ayarlar > Uzantılar > AwuCat > Web Siteleri bölümünden \"İzin Ver\" seçin.", "error");
  };
}

void init();
