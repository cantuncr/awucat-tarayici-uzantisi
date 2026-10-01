/**
 * Service-worker side of the file handover: open an app tab, wait for the content script,
 * stream the file to it in base64 chunks. The content script then posts the bytes into the
 * page (see content.ts). Nothing leaves the browser.
 */
import { bytesToBase64 } from "./base64";
import { appUrl, type OpenTarget } from "./settings";
import { CS_CHUNK, CS_PING, type ChunkMessage } from "./protocol";
import { isSafari } from "./platform";

export interface HandoverFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** ~4 MB of base64 per message keeps well below Chrome's IPC message ceiling. */
const CHUNK_CHARS = 4 * 1024 * 1024;
const CONTENT_SCRIPT_TIMEOUT_MS = 30_000;

export async function openInApp(file: HandoverFile, opts: { baseUrl: string; target: OpenTarget }): Promise<number> {
  const url = appUrl(opts.baseUrl, opts.target);
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error("Sekme açılamadı.");
  await deliverToTab(tab.id, file);
  return tab.id;
}

export async function deliverToTab(tabId: number, file: HandoverFile): Promise<void> {
  await waitForContentScript(tabId, CONTENT_SCRIPT_TIMEOUT_MS);
  const b64 = bytesToBase64(file.bytes);
  const total = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
  const transferId = crypto.randomUUID();
  for (let index = 0; index < total; index++) {
    const msg: ChunkMessage = {
      type: CS_CHUNK,
      transferId,
      index,
      total,
      name: file.name,
      mime: file.mime,
      data: b64.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS),
    };
    const res = (await chrome.tabs.sendMessage(tabId, msg)) as { ok?: boolean; error?: string } | undefined;
    if (!res?.ok) throw new Error(res?.error || "Dosya sekmeye aktarılamadı.");
  }
}

/** Polls the tab until the content script answers (it is injected at document_start). */
async function waitForContentScript(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 100;
  for (;;) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, { type: CS_PING })) as { ok?: boolean } | undefined;
      if (res?.ok) return;
    } catch {
      /* "Receiving end does not exist" until the document is created */
    }
    if (Date.now() > deadline) {
      // Safari runs content scripts only on sites the user allowed (extension icon → "Always Allow").
      if (isSafari()) {
        throw new Error("AwuCat sekmesi yanıt vermedi. Safari'de uygulama sitesine erişim izni verin: araç çubuğundaki AwuCat simgesi → \"Bu web sitesinde her zaman izin ver\" (veya Safari > Ayarlar > Uzantılar > AwuCat).");
      }
      throw new Error("AwuCat sekmesi yanıt vermedi. Ayarlardaki uygulama adresini ve içerik betiği iznini kontrol edin.");
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 1000);
  }
}
