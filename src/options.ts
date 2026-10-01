/** Options page: base URL (presets or custom), download-fix toggles, granted site access. */
import { appUrl, BASE_URL_PRESETS, getSettings, normalizeBaseUrl, saveSettings, type OpenTarget } from "./lib/settings";
import { appOriginPattern, zipFixMode } from "./lib/platform";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(text: string, kind: "" | "ok" | "error" = ""): void {
  const el = $<HTMLSpanElement>("saveStatus");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function renderPresets(current: string): void {
  const box = $<HTMLDivElement>("presets");
  box.innerHTML = "";
  for (const p of BASE_URL_PRESETS) {
    const label = document.createElement("label");
    label.className = "radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "base";
    input.value = p.url;
    input.checked = p.url === current;
    const text = document.createElement("span");
    text.textContent = p.label;
    label.append(input, text);
    box.append(label);
  }
  const isPreset = BASE_URL_PRESETS.some((p) => p.url === current);
  $<HTMLInputElement>("base-custom").checked = !isPreset;
  $<HTMLInputElement>("customUrl").value = isPreset ? "" : current;
}

function selectedBaseUrl(): string | null {
  const checked = document.querySelector<HTMLInputElement>('input[name="base"]:checked');
  if (!checked) return null;
  if (checked.value !== "custom") return checked.value;
  return normalizeBaseUrl($<HTMLInputElement>("customUrl").value);
}

async function save(): Promise<void> {
  const baseUrl = selectedBaseUrl();
  if (!baseUrl) {
    setStatus("Geçerli bir http(s) adresi girin.", "error");
    return;
  }
  const isPreset = BASE_URL_PRESETS.some((p) => p.url === baseUrl);
  if (!isPreset) {
    // A custom origin needs a host permission so the content script can be registered there.
    const pattern = appOriginPattern(baseUrl);
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [pattern] });
    } catch (err) {
      setStatus("İzin istenemedi: " + (err instanceof Error ? err.message : String(err)), "error");
      return;
    }
    if (!granted) {
      setStatus("Bu adres için erişim izni verilmedi; kaydedilmedi.", "error");
      return;
    }
  }
  await saveSettings({ baseUrl });
  setStatus("Kaydedildi.", "ok");
  await refreshLinks();
  await renderOrigins();
}

async function renderOrigins(): Promise<void> {
  const list = $<HTMLUListElement>("origins");
  list.innerHTML = "";
  let origins: string[] = [];
  try {
    origins = (await chrome.permissions.getAll()).origins ?? [];
  } catch {
    /* unavailable */
  }
  if (!origins.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Henüz izin verilen ek site yok.";
    list.append(li);
    return;
  }
  // Origins declared in the manifest cannot be revoked at runtime; show them as such.
  const manifest = chrome.runtime.getManifest();
  const required = new Set<string>([...(manifest.host_permissions ?? []), ...(manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? [])]);
  for (const origin of origins) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = origin;
    li.append(code);
    if (required.has(origin)) {
      const tag = document.createElement("span");
      tag.className = "muted";
      tag.textContent = origin.includes("whatsapp") ? "gerekli · indirme düzeltmesi" : "gerekli · dosya aktarımı";
      li.append(tag);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost danger";
      btn.textContent = "Kaldır";
      btn.addEventListener("click", async () => {
        try {
          await chrome.permissions.remove({ origins: [origin] });
        } catch {
          /* ignore */
        }
        await renderOrigins();
      });
      li.append(btn);
    }
    list.append(li);
  }
}

async function refreshLinks(): Promise<void> {
  const s = await getSettings();
  $<HTMLAnchorElement>("privacy").href = appUrl(s.baseUrl, "privacy", false);
  $<HTMLAnchorElement>("app").href = appUrl(s.baseUrl, "viewer", false);
}

async function init(): Promise<void> {
  const s = await getSettings();
  renderPresets(s.baseUrl);

  const toggles: Array<["fixZip" | "heuristic" | "notify", boolean]> = [
    ["fixZip", s.fixZip],
    ["heuristic", s.heuristic],
    ["notify", s.notify],
  ];
  for (const [key, value] of toggles) {
    const el = $<HTMLInputElement>(key);
    el.checked = value;
    el.addEventListener("change", () => void saveSettings({ [key]: el.checked }));
  }
  const mode = zipFixMode();
  if (mode === "none") {
    for (const id of ["fixZip", "heuristic"]) {
      const el = $<HTMLInputElement>(id);
      el.disabled = true;
      el.title = "Bu tarayıcı indirme adı düzeltmesini desteklemiyor (Chrome/Edge gerekir).";
    }
  } else if (mode === "page") {
    // Safari: no downloads API — WhatsApp Web downloads are renamed in the page at click time.
    $<HTMLElement>("fixZip-sub").textContent =
      "WhatsApp Web'den .zip olarak inen UDF'leri, indirme başlamadan önce içeriğe bakarak .udf yapar. Safari'de yalnızca WhatsApp Web'de çalışır; e-posta eklerinin adı değiştirilemez (Safari indirme API'si sunmuyor).";
    $<HTMLElement>("notify-sub").textContent = "Bir dosya düzeltildiğinde WhatsApp Web sayfasının köşesinde kısa bir not gösterir (Safari'de sistem bildirimi yok).";
  }

  const target = $<HTMLSelectElement>("openTarget");
  target.value = s.openTarget;
  target.addEventListener("change", () => void saveSettings({ openTarget: target.value as OpenTarget }));

  $<HTMLInputElement>("customUrl").addEventListener("focus", () => {
    $<HTMLInputElement>("base-custom").checked = true;
  });
  $<HTMLButtonElement>("save").addEventListener("click", () => void save());

  $<HTMLSpanElement>("version").textContent = "v" + chrome.runtime.getManifest().version;
  await refreshLinks();
  await renderOrigins();
}

void init();
