#!/usr/bin/env node
/**
 * WebKit check of the Safari download fallback (no browser extension involved — Playwright's
 * WebKit cannot load Safari Web Extensions). It loads the *built* Safari scripts into a
 * WhatsApp-like page the way Safari would:
 *
 *   dist/safari/whatsapp-main.js  → page world at document start (manifest `"world": "MAIN"`)
 *   dist/safari/whatsapp.js       → with a minimal `chrome.*` stub standing in for the isolated
 *                                   world (manifest without "downloads", default settings)
 *
 * and checks what WebKit actually saves when the page downloads blobs like WhatsApp Web does
 * (`URL.createObjectURL(zip blob)` + `<a download>` + click, often followed by an immediate
 * `revokeObjectURL`):
 *
 *   - a real UDF named "Gerekçeli Karar.zip" is saved as "Gerekçeli Karar.udf", bytes intact,
 *   - "tensip.udf.zip" (UDF) → "tensip.udf"; a user click on an anchor in the page → ".udf",
 *   - an ordinary zip and a non-UDF "sahte.udf.zip" keep their names,
 *   - the "fixZip" setting turned off leaves names alone,
 *   - the in-page notice appears; without the shim WebKit keeps ".zip" (control).
 *
 * Usage: node scripts/build.mjs && node scripts/verify-webkit.mjs   (HEADED=1 to watch)
 */
import { webkit } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "..", "..");
const dist = join(root, "dist", "safari");
const fixture = join(repo, "tests", "fixtures", "ornek-dilekce.udf");
for (const f of [join(dist, "whatsapp-main.js"), join(dist, "whatsapp.js"), fixture]) {
  if (!existsSync(f)) {
    console.error(`missing: ${f} — run node scripts/build.mjs`);
    process.exit(1);
  }
}

const mainWorld = readFileSync(join(dist, "whatsapp-main.js"), "utf8");
const isolated = readFileSync(join(dist, "whatsapp.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const udf = readFileSync(fixture);

/** A stored zip with one non-UDF entry (what a photo archive looks like to the sniffer). */
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

const server = createServer((req, res) => {
  if (req.url === "/udf") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(udf);
  if (req.url === "/zip") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(nonUdfZip());
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>WhatsApp-like</title><body><p>chat</p>
<script>
  // What WhatsApp Web does for a document message: fetch bytes → zip-typed Blob → <a download> → click.
  window.download = async (src, name, { attach = false, revoke = true, delay = 0 } = {}) => {
    const bytes = await (await fetch(src)).arrayBuffer();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    if (attach) { a.id = "dl"; a.textContent = name; document.body.append(a); return url; }
    if (delay) await new Promise((r) => setTimeout(r, delay));
    a.click();
    if (revoke) URL.revokeObjectURL(url);
    return url;
  };
</script></body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

/** Stand-in for the extension APIs the isolated script touches in Safari. */
function chromeStub(settings) {
  return `window.chrome = {
    runtime: { getManifest: () => (${JSON.stringify(manifest)}), getURL: (p) => "safari-web-extension://test/" + (p || ""), sendMessage: () => Promise.resolve() },
    storage: {
      sync: { get: async (d) => ({ ...d, ...${JSON.stringify(settings)} }), set: async () => {} },
      local: { get: async (d) => ({ ...d }), set: async () => {} },
      onChanged: { addListener() {} },
    },
  };`;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await webkit.launch({ headless: !process.env.HEADED });

async function newPage({ shim = true, settings = {} } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  if (shim) {
    await page.addInitScript({ content: mainWorld });
    await page.addInitScript({ content: chromeStub(settings) + "\n" + isolated });
  }
  await page.goto(base + "/");
  return page;
}

async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), trigger()]);
  const stream = await dl.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  // macOS WebKit reports decomposed (NFD) Turkish letters; compare in NFC.
  return { name: dl.suggestedFilename().normalize("NFC"), bytes: Buffer.concat(chunks), failure: await dl.failure() };
}

try {
  console.log(`WebKit ${browser.version()} · page ${base}`);

  const page = await newPage();

  let r = await download(page, () => page.evaluate(() => window.download("/udf", "Gerekçeli Karar.zip")));
  check("UDF 'Gerekçeli Karar.zip' (detached anchor, immediate revoke) → .udf", r.name === "Gerekçeli Karar.udf", r.name);
  check("saved bytes are the original UDF", !r.failure && r.bytes.equals(udf), r.failure || `${r.bytes.length} bytes`);

  r = await download(page, () => page.evaluate(() => window.download("/udf", "tensip.udf.zip")));
  check("UDF 'tensip.udf.zip' → 'tensip.udf'", r.name === "tensip.udf", r.name);

  r = await download(page, () => page.evaluate(() => window.download("/udf", "Karar.zip", { delay: 300 })));
  check("click after the verdict is known → renamed synchronously", r.name === "Karar.udf", r.name);

  r = await download(page, () => page.evaluate(() => window.download("/zip", "fotograflar.zip")));
  check("ordinary zip keeps its name", r.name === "fotograflar.zip", r.name);

  r = await download(page, () => page.evaluate(() => window.download("/zip", "sahte.udf.zip")));
  check("non-UDF 'sahte.udf.zip' keeps its name (content wins over name)", r.name === "sahte.udf.zip", r.name);

  await page.evaluate(() => window.download("/udf", "Tensip Zaptı.zip", { attach: true }));
  r = await download(page, () => page.click("#dl"));
  check("user click on an anchor in the page → .udf", r.name === "Tensip Zaptı.udf", r.name);

  const notice = await page.locator("[data-awucat-notice]").count();
  check("in-page notice shown (Safari has no notifications API)", notice > 0, `${notice} notice(s)`);
  await page.screenshot({ path: join(root, "dist", "verify-webkit.png") }).catch(() => undefined);
  await page.context().close();

  const off = await newPage({ settings: { fixZip: false } });
  await off.waitForTimeout(200); // settings arrive asynchronously, like storage.sync in Safari
  r = await download(off, () => off.evaluate(() => window.download("/udf", "Karar.zip")));
  check("setting 'fixZip' off → name untouched", r.name === "Karar.zip", r.name);
  await off.context().close();

  const control = await newPage({ shim: false });
  r = await download(control, () => control.evaluate(() => window.download("/udf", "Karar.zip")));
  check("control without the extension: WebKit saves 'Karar.zip'", r.name === "Karar.zip", r.name);
  await control.context().close();
} catch (err) {
  check("run", false, err instanceof Error ? err.stack : String(err));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
