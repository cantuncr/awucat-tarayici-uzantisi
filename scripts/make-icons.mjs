#!/usr/bin/env node
/**
 * Renders the web app's vector icon (public/icons/icon.svg) to the PNG sizes an extension
 * needs (16/32/48/128) using Playwright's Chromium, so the toolbar icon matches the PWA icon
 * exactly. Falls back to public/icons/icon-512.png when the SVG is missing.
 *
 * Usage: node scripts/make-icons.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repo = resolve(root, "..", "..");
const sizes = [16, 32, 48, 128];
const outDir = join(root, "icons");
mkdirSync(outDir, { recursive: true });

const svgPath = join(repo, "public", "icons", "icon.svg");
const pngPath = join(repo, "public", "icons", "icon-512.png");

let source;
if (existsSync(svgPath)) {
  source = `data:image/svg+xml;base64,${readFileSync(svgPath).toString("base64")}`;
} else if (existsSync(pngPath)) {
  source = `data:image/png;base64,${readFileSync(pngPath).toString("base64")}`;
} else {
  throw new Error("No icon source found under public/icons");
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent"><img src="${source}" width="${size}" height="${size}" style="display:block;image-rendering:auto"></body></html>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete);
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(join(outDir, `icon-${size}.png`), buf);
    await page.close();
    console.log(`icons/icon-${size}.png (${buf.length} bytes)`);
  }
} finally {
  await browser.close();
}
