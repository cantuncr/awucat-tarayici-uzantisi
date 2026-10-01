#!/usr/bin/env node
/**
 * End-to-end verification: loads dist/chrome unpacked into Playwright's Chromium and checks
 *   A. the popup opens the app,
 *   B. a file picked in the popup is handed over to the app tab and rendered,
 *   C. a ".udf.zip" network download (octet-stream, as webmail serves it) is saved as ".udf",
 *   D. WhatsApp-style blob downloads: the page-world shim + content sniffing rename real UDFs
 *      ("Karar.zip" → "Karar.udf") and leave ordinary zips alone,
 *   E. the context-menu link path: same-origin links are fetched inside the page
 *      (scripting.executeScript) and cross-origin links from the worker, then handed over.
 *
 * For D the extension is copied to .verify/ext with the WhatsApp content scripts widened to the
 * local test origin (the production manifest only targets web.whatsapp.com).
 *
 * Requirements: `node scripts/build.mjs` done; the web app running at APP_URL
 * (default http://localhost:3000). Set HEADED=1 to watch it.
 *
 *   node scripts/verify.mjs
 */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "..", "..");
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const HEADED = !!process.env.HEADED;
const extDir = join(root, "dist", "chrome");
const fixture = join(repo, "tests", "fixtures", "ornek-dilekce.udf");
const work = join(root, ".verify");
const profile = join(work, "profile");
const downloads = join(work, "downloads");
const testExt = join(work, "ext");

if (!existsSync(extDir)) fail("dist/chrome missing — run node scripts/build.mjs");
if (!existsSync(fixture)) fail(`fixture missing: ${fixture}`);

rmSync(work, { recursive: true, force: true });
mkdirSync(join(profile, "Default"), { recursive: true });
mkdirSync(downloads, { recursive: true });
// Make Chrome save silently into our folder (the extension's rename hook runs before saving).
writeFileSync(
  join(profile, "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, safebrowsing: { enabled: false } }),
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// Tiny origin serving the fixture under a WhatsApp-style ".udf.zip" name.
const fixtureBytes = readFileSync(fixture);
const server = createServer((req, res) => {
  if (req.url?.startsWith("/ornek-dilekce.udf.zip")) {
    // What webmail typically sends for an attachment it does not recognise.
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="ornek-dilekce.udf.zip"',
      "content-length": fixtureBytes.length,
    });
    res.end(fixtureBytes);
    return;
  }
  if (req.url?.startsWith("/page")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>test</title><body>test page</body>");
    return;
  }
  res.writeHead(404).end();
});

/** A stored zip with one non-UDF entry (what a real photo archive looks like to the sniffer). */
function nonUdfZip() {
  const name = Buffer.from("fotograf.jpg");
  const data = Buffer.from("not really a jpeg");
  const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const local = Buffer.from([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0)]);
  const central = Buffer.from([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0)]);
  const centralFull = Buffer.concat([central, name]);
  const localFull = Buffer.concat([local, name, data]);
  const end = Buffer.from([0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(1), ...le16(1), ...le32(centralFull.length), ...le32(localFull.length), ...le16(0)]);
  return Buffer.concat([localFull, centralFull, end]);
}
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const serverUrl = `http://127.0.0.1:${server.address().port}`;

// Test build: same files, WhatsApp shim additionally matched on the local test origin.
cpSync(extDir, testExt, { recursive: true });
{
  const m = JSON.parse(readFileSync(join(testExt, "manifest.json"), "utf8"));
  for (const cs of m.content_scripts) if (cs.js.some((f) => f.startsWith("whatsapp"))) cs.matches.push("http://127.0.0.1/*");
  m.host_permissions.push("http://127.0.0.1/*");
  writeFileSync(join(testExt, "manifest.json"), JSON.stringify(m, null, 2));
}

// The app must be up — the handover test needs it.
try {
  const r = await fetch(`${APP_URL}/goruntuleyici?ext=1`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (err) {
  fail(`AwuCat is not reachable at ${APP_URL}: ${err.message}`);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: !HEADED,
  viewport: { width: 1280, height: 860 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${testExt}`, `--load-extension=${testExt}`],
});

const deadline = setTimeout(() => fail("verification timed out"), 180_000);

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const extId = new URL(sw.url()).host;
  check("service worker started", true, sw.url());

  await sw.evaluate((url) => chrome.storage.sync.set({ baseUrl: url }), APP_URL);

  // ---- A. popup → "Görüntüleyici" opens the app ---------------------------------------------
  {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.screenshot({ path: join(work, "popup.png") });
    const [appPage] = await Promise.all([context.waitForEvent("page"), popup.getByRole("button", { name: "Görüntüleyici" }).click()]);
    await appPage.waitForLoadState("domcontentloaded");
    const url = appPage.url();
    check("popup opens the viewer", url.startsWith(`${APP_URL}/goruntuleyici`) && url.includes("ext=1"), url);
    await appPage.close();
    if (!popup.isClosed()) await popup.close();
  }

  // ---- A2. options page: preset switch persists ---------------------------------------------
  {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.getByLabel("awucat.app (varsayılan)").check();
    await options.getByRole("button", { name: "Kaydet" }).click();
    await options.getByText("Kaydedildi.").waitFor({ timeout: 5000 });
    const saved = await sw.evaluate(() => chrome.storage.sync.get("baseUrl"));
    check("options page saves a base URL preset", saved.baseUrl === "https://awucat.app", JSON.stringify(saved));
    await options.getByLabel("Yerel geliştirme (http://localhost:3000)").check();
    await options.getByRole("button", { name: "Kaydet" }).click();
    await options.getByText("Kaydedildi.").waitFor({ timeout: 5000 });
    await options.screenshot({ path: join(work, "options.png"), fullPage: true });
    await options.close();
  }

  // ---- A3. pending-permission banner in the popup -------------------------------------------
  {
    await sw.evaluate(() =>
      (chrome.storage.session ?? chrome.storage.local).set({ pendingOpen: { url: "https://ornek.adalet.gov.tr/dosya/karar.udf", origin: "https://ornek.adalet.gov.tr", name: "karar.udf", createdAt: Date.now() } }),
    );
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const banner = popup.locator("#pending");
    await banner.waitFor({ state: "visible", timeout: 5000 });
    const host = await popup.locator("#pending-host").textContent();
    await popup.getByRole("button", { name: "Vazgeç" }).click();
    await banner.waitFor({ state: "hidden", timeout: 5000 });
    const left = await sw.evaluate(() => (chrome.storage.session ?? chrome.storage.local).get("pendingOpen"));
    check("popup shows the pending-permission banner and 'Vazgeç' clears it", host === "ornek.adalet.gov.tr" && !left.pendingOpen, `host=${host}`);
    await popup.close();
  }

  // ---- B. popup file picker → handover → document rendered ----------------------------------
  {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const [appPage] = await Promise.all([context.waitForEvent("page"), popup.setInputFiles("#file", fixture)]);
    await appPage.waitForLoadState("domcontentloaded");
    const editor = appPage.locator(".ProseMirror");
    let text = "";
    try {
      await editor.first().waitFor({ timeout: 60_000 });
      await appPage.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("MAHKEMESİ"), null, { timeout: 60_000 });
      text = (await editor.first().textContent()) || "";
    } catch (err) {
      text = `(${err.message})`;
    }
    await appPage.screenshot({ path: join(work, "handover.png"), fullPage: false });
    check("file picked in popup is rendered by the app (handover)", text.includes("MAHKEMESİ"), appPage.url());
    await appPage.close();
    if (!popup.isClosed()) await popup.close();
  }

  // ---- C. ".udf.zip" download is renamed ----------------------------------------------------
  {
    // Playwright routes downloads through DevTools ("allowAndName"), which bypasses the
    // extension hook. Restore Chrome's own download pipeline for this context.
    let restored = false;
    try {
      const browser = context.browser();
      const session = browser ? await browser.newBrowserCDPSession() : null;
      if (session) {
        await session.send("Browser.setDownloadBehavior", { behavior: "default", eventsEnabled: true });
        restored = true;
      }
    } catch (err) {
      console.warn("could not reset download behaviour:", err.message);
    }
    const item = await sw.evaluate(async (url) => {
      const id = await chrome.downloads.download({ url });
      const started = Date.now();
      for (;;) {
        const [it] = await chrome.downloads.search({ id });
        if (it && (it.state === "complete" || it.state === "interrupted")) return it;
        if (Date.now() - started > 30_000) return it ?? null;
        await new Promise((r) => setTimeout(r, 200));
      }
    }, `${serverUrl}/ornek-dilekce.udf.zip`);
    const name = item?.filename ? basename(item.filename) : "(none)";
    check(
      "'.udf.zip' (octet-stream) download saved as '.udf' (downloads.onDeterminingFilename)",
      item?.state === "complete" && name === "ornek-dilekce.udf",
      `state=${item?.state} filename=${name} restoredPipeline=${restored}`,
    );

    // ---- D. WhatsApp-style blob downloads through the page-world shim ----------------------
    const page = await context.newPage();
    await page.goto(`${serverUrl}/page`);
    const udfBytes = Array.from(fixtureBytes);
    const zipBytes = Array.from(nonUdfZip());
    const cases = [
      { bytes: udfBytes, type: "application/zip", download: "Gerekçeli Karar.zip", expect: "Gerekçeli Karar.udf", why: "real UDF named .zip → sniffed → .udf" },
      { bytes: udfBytes, type: "application/zip", download: "tensip.udf.zip", expect: "tensip.udf", why: "'.udf.zip' zip-typed blob → .udf" },
      { bytes: zipBytes, type: "application/zip", download: "fotograflar.zip", expect: "fotograflar.zip", why: "ordinary zip untouched" },
      { bytes: zipBytes, type: "application/zip", download: "sahte.udf.zip", expect: "sahte.udf.zip", why: "not a UDF inside → name kept" },
    ];
    for (const c of cases) {
      // A fresh document per case: Chrome's download-request limiter allows one gesture-less
      // download per page load and prompts for the rest.
      await page.goto(`${serverUrl}/page`);
      const known = await sw.evaluate(() => chrome.downloads.search({}).then((l) => l.map((d) => d.id)));
      await page.evaluate(([bytes, type, download]) => {
        const blob = new Blob([new Uint8Array(bytes)], { type });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = download;
        document.body.append(a);
        a.click();
      }, [c.bytes, c.type, c.download]);
      const item = await sw.evaluate(async (known) => {
        const started = Date.now();
        for (;;) {
          const fresh = (await chrome.downloads.search({})).filter((d) => !known.includes(d.id));
          const it = fresh[0];
          if (it && (it.state === "complete" || it.state === "interrupted")) return { ...it, decision: globalThis.__awucat.lastDecision() };
          if (Date.now() - started > 20_000) return it ? { ...it, decision: globalThis.__awucat.lastDecision() } : null;
          await new Promise((r) => setTimeout(r, 150));
        }
      }, known);
      const got = item?.filename ? basename(item.filename) : "(none)";
      check(`blob download: ${c.why}`, item?.state === "complete" && got === c.expect, `got=${got} mime=${item?.mime} sniff=${item?.decision?.sniff}`);
    }
    const onDisk = existsSync(downloads) ? readdirSync(downloads) : [];
    console.log("files on disk:", onDisk.join(", "));

    // ---- E. context-menu link path (both fetch strategies) ----------------------------------
    // The menu click itself cannot be automated; this drives the same handler with the data
    // Chrome would pass. The test build has a host permission for the test origin, which
    // stands in for the activeTab grant a real click provides.
    const linkUrl = `${serverUrl}/ornek-dilekce.udf.zip`;
    for (const sameOrigin of [true, false]) {
      const [appPage] = await Promise.all([
        context.waitForEvent("page"),
        sw.evaluate(
          async ({ pageUrl, linkUrl, sameOrigin }) => {
            const [tab] = await chrome.tabs.query({ url: pageUrl + "*" });
            await globalThis.__awucat.openLink({ url: linkUrl, origin: new URL(linkUrl).origin, sameOrigin, tabId: tab?.id, frameId: 0, permission: Promise.resolve(true) });
          },
          { pageUrl: `${serverUrl}/page`, linkUrl, sameOrigin },
        ),
      ]);
      let ok = false;
      try {
        await appPage.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("MAHKEMESİ"), null, { timeout: 60_000 });
        ok = true;
      } catch {
        /* reported below */
      }
      check(`link opened via ${sameOrigin ? "page-side fetch (executeScript)" : "worker-side fetch"} and rendered`, ok, appPage.url());
      await appPage.close();
    }
    await page.close();
  }
} catch (err) {
  check("unexpected error", false, err.stack || String(err));
} finally {
  clearTimeout(deadline);
  await context.close().catch(() => undefined);
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${work}`);
process.exit(failed.length ? 1 : 0);

function fail(msg) {
  console.error("verify: " + msg);
  process.exit(1);
}
