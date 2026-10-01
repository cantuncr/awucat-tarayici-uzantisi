#!/usr/bin/env node
/**
 * Renders the existing AwuCat icon (public/icons/icon.svg — the same source as the
 * extension's toolbar icons, see ../browser-extension/scripts/make-icons.mjs) into the macOS
 * app icon set and the container app's Icon.png. The converter only upscales the 128 px
 * extension icon, which is blurry at 512/1024 px.
 *
 * Usage (monorepo only; the PNGs are committed): node apps/safari-extension/scripts/make-app-icons.mjs
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(pkg, "..", "..");
const app = join(pkg, "AwuCat Uzantı", "AwuCat Uzantı");
const iconset = join(app, "Assets.xcassets", "AppIcon.appiconset");
const svg = join(repo, "public", "icons", "icon.svg");
if (!existsSync(svg)) throw new Error(`${svg} missing`);

// playwright-core lives in the extension package (pnpm --dir apps/browser-extension install).
const require = createRequire(join(repo, "apps", "browser-extension", "package.json"));
const { chromium } = require("playwright-core");

const source = `data:image/svg+xml;base64,${readFileSync(svg).toString("base64")}`;
const outputs = [
  ...[16, 32, 128, 256, 512].flatMap((pt) => [
    [join(iconset, `mac-icon-${pt}@1x.png`), pt],
    [join(iconset, `mac-icon-${pt}@2x.png`), pt * 2],
  ]),
  [join(app, "Resources", "Icon.png"), 256], // shown at 96 pt in Main.html
];

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const [file, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><body style="margin:0;background:transparent"><img src="${source}" width="${size}" height="${size}" style="display:block">`);
    await page.waitForFunction(() => document.images[0]?.complete);
    writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
    console.log(`${file.slice(pkg.length + 1)} (${size}px)`);
  }
} finally {
  await browser.close();
}
