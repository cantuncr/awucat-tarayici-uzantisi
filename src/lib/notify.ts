/**
 * Small wrapper around chrome.notifications (basic type only — that is all Firefox supports).
 *
 * Safari has no notifications API. There the message is kept in storage.session, the toolbar
 * icon gets a "!" badge, and the popup shows the message once (see popup.ts → NOTICE_KEY).
 */
import { NOTICE_KEY, type StoredNotice } from "./protocol";

export const NOTIFICATION_PREFIX_DOWNLOAD = "udf-dl-";

export async function notify(message: string, opts: { id?: string; title?: string } = {}): Promise<string | undefined> {
  if (!chrome.notifications) return noticeFallback(message, opts.title ?? "AwuCat");
  const options: chrome.notifications.NotificationCreateOptions = {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: opts.title ?? "AwuCat",
    message,
  };
  try {
    return await new Promise<string>((resolve, reject) => {
      const cb = (id: string) => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id));
      if (opts.id) chrome.notifications.create(opts.id, options, cb);
      else chrome.notifications.create(options, cb);
    });
  } catch {
    return undefined;
  }
}

async function noticeFallback(message: string, title: string): Promise<undefined> {
  const notice: StoredNotice = { title, message, createdAt: Date.now() };
  try {
    await (chrome.storage.session ?? chrome.storage.local).set({ [NOTICE_KEY]: notice });
  } catch {
    /* storage unavailable */
  }
  try {
    await chrome.action?.setBadgeText({ text: "!" });
    await chrome.action?.setTitle({ title: `${title}\n${message}` });
  } catch {
    /* action API unavailable */
  }
  console.info(`[AwuCat] ${title}: ${message}`);
  return undefined;
}

/** Popup side of the fallback: reads the pending notice (if any) and clears it with the badge. */
export async function takeStoredNotice(maxAgeMs = 15 * 60_000): Promise<StoredNotice | undefined> {
  const area = chrome.storage.session ?? chrome.storage.local;
  try {
    const notice = (await area.get(NOTICE_KEY))?.[NOTICE_KEY] as StoredNotice | undefined;
    if (!notice) return undefined;
    await area.remove(NOTICE_KEY);
    await chrome.action?.setBadgeText({ text: "" });
    await chrome.action?.setTitle({ title: "AwuCat" });
    return Date.now() - notice.createdAt <= maxAgeMs ? notice : undefined;
  } catch {
    return undefined;
  }
}

/** Error surfaced to the user; message is already in Turkish. */
export class UserError extends Error {}

export function describeError(err: unknown): string {
  if (err instanceof UserError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|net::ERR|Load failed/i.test(msg)) return "Dosya indirilemedi (ağ hatası veya site erişimi engellendi).";
  return msg || "Bilinmeyen hata.";
}
