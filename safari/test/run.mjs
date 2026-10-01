#!/usr/bin/env node
/**
 * Runs test/WebExtensionHarness.swift: the built Safari extension inside macOS's own WebKit
 * extension engine (WKWebExtension), against a local WhatsApp-like page and — when it is
 * reachable — the AwuCat app (APP_URL, default http://localhost:3000).
 *
 *   node test/run.mjs          (after `pnpm --dir ../browser-extension build`)
 *
 * Needs macOS 15.4+ (WKWebExtension API) and the Xcode command line tools (swiftc).
 * The test copy of the extension additionally matches http://127.0.0.1/* for the WhatsApp
 * scripts — the shipped manifest only targets web.whatsapp.com.
 */
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
// Monorepo: apps/browser-extension next to apps/safari-extension. Exported repo: safari/ inside the extension repo.
const extensionRoot = [resolve(pkg, "..", "browser-extension"), resolve(pkg, "..")].find((d) => existsSync(join(d, "scripts", "build.mjs")));
if (!extensionRoot) fail("extension sources not found (../browser-extension or ..)");
const dist = join(extensionRoot, "dist", "safari");
if (!existsSync(join(dist, "manifest.json"))) fail(`${dist} missing — run: pnpm --dir ${extensionRoot} build`);

const work = join(pkg, "build", "test");
mkdirSync(work, { recursive: true });

// 1. Compile the harness (only when the source changed).
const source = join(here, "WebExtensionHarness.swift");
const binary = join(work, "WebExtensionHarness");
if (!existsSync(binary) || statSync(binary).mtimeMs < statSync(source).mtimeMs) {
  console.log("compiling harness…");
  execFileSync("xcrun", ["swiftc", "-O", "-o", binary, source], { stdio: "inherit" });
}

// 2. Test copy of the extension.
const testExt = join(work, "ext");
rmSync(testExt, { recursive: true, force: true });
cpSync(dist, testExt, { recursive: true });
const manifest = JSON.parse(readFileSync(join(testExt, "manifest.json"), "utf8"));
for (const cs of manifest.content_scripts) if (cs.js.some((f) => f.startsWith("whatsapp"))) cs.matches.push("http://127.0.0.1/*");
manifest.host_permissions.push("http://127.0.0.1/*");
writeFileSync(join(testExt, "manifest.json"), JSON.stringify(manifest, null, 2));

// 3. Fixture: the repo's sample UDF, or a minimal synthetic one (download checks only).
const repoFixture = resolve(extensionRoot, "..", "..", "tests", "fixtures", "ornek-dilekce.udf");
const fixturePath = process.env.UDF_FIXTURE || (existsSync(repoFixture) ? repoFixture : join(work, "synthetic.udf"));
if (!existsSync(fixturePath)) writeFileSync(fixturePath, storedZip("content.xml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><template/>')));
const fixture = readFileSync(fixturePath);

/** A stored (uncompressed) single-entry zip. */
function storedZip(entryName, data) {
  const name = Buffer.from(entryName);
  const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0)]), name, data]);
  const central = Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0)]), name]);
  const end = Buffer.from([0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(1), ...le16(1), ...le32(central.length), ...le32(local.length), ...le16(0)]);
  return Buffer.concat([local, central, end]);
}

// 4. WhatsApp-like page: fetch → zip-typed Blob → <a download> → click → immediate revoke.
const server = createServer((req, res) => {
  if (req.url === "/udf") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(fixture);
  if (req.url === "/zip") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(storedZip("fotograf.jpg", Buffer.from("not really a jpeg")));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>WhatsApp-like</title><body><p>chat</p><script>
  window.download = async (src, name) => {
    const bytes = await (await fetch(src)).arrayBuffer();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
</script></body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

// 5. The app (optional).
const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
let appArgs = [];
if (fixturePath === repoFixture || process.env.UDF_FIXTURE) {
  try {
    const r = await fetch(`${appUrl}/goruntuleyici?ext=1`, { signal: AbortSignal.timeout(30000) });
    if (r.ok) appArgs = [appUrl];
  } catch {
    /* not running */
  }
}
if (!appArgs.length) console.log(`(app not reachable at ${appUrl} — handover check skipped)`);

const child = spawn(binary, [testExt, pageUrl, fixturePath, ...appArgs], { stdio: ["ignore", "pipe", "pipe"] });
// WebKit prints harmless sandbox notices for off-screen views; keep the output readable.
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => {
  const text = d.toString().split("\n").filter((l) => l && !l.includes("sandbox_extension_issue_file")).join("\n");
  if (text) process.stderr.write(text + "\n");
});
const timer = setTimeout(() => {
  console.error("harness timed out");
  child.kill("SIGKILL");
}, 180_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  server.close();
  process.exit(code ?? 1);
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
