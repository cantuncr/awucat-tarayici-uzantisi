#!/usr/bin/env node
/**
 * Packages the built extension for store upload:
 *   dist/awucat-extension.zip          (Chrome Web Store / Edge Add-ons — from dist/chrome)
 *   dist/awucat-extension-firefox.zip  (Firefox AMO — from dist/firefox)
 *
 * Run `node scripts/build.mjs` first (or `pnpm zip`, which does both).
 */
import { zipSync } from "fflate";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function collect(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, base, out);
    else out[relative(base, full).split("\\").join("/")] = readFileSync(full);
  }
  return out;
}

const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;

for (const [target, name] of [
  ["chrome", "awucat-extension.zip"],
  ["firefox", "awucat-extension-firefox.zip"],
]) {
  const src = join(dist, target);
  if (!existsSync(src)) throw new Error(`${src} missing — run node scripts/build.mjs first`);
  const files = collect(src);
  const zipped = zipSync(files, { level: 9, mtime: new Date("2024-01-01T00:00:00Z") });
  const out = join(dist, name);
  writeFileSync(out, zipped);
  console.log(`${relative(root, out)}  v${version}  ${Object.keys(files).length} files, ${(zipped.length / 1024).toFixed(1)} KB`);
}
