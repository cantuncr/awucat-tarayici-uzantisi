#!/usr/bin/env node
/**
 * Bundles the TypeScript sources with esbuild and assembles two unpacked extensions:
 *   dist/chrome   — Chrome, Edge, Brave, Opera, Yandex (MV3 service worker)
 *   dist/firefox  — Firefox (MV3 event page; no onDeterminingFilename, so no download fix)
 *   dist/safari   — Safari 18+ (MV3 event page; no downloads API — WhatsApp Web downloads are
 *                   renamed in the page instead). Wrapped into the Xcode project in
 *                   apps/safari-extension by its scripts/sync-resources.mjs.
 *
 * All targets share the same bundles; browser differences are feature-detected at runtime
 * (src/lib/platform.ts), only the manifest differs.
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

const ENTRIES = ["background", "content", "popup", "options", "whatsapp", "whatsapp-main"];
const STATIC = ["popup.html", "options.html", "ui.css"];

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

/**
 * Firefox needs an event page instead of a service worker and a fixed add-on id. It has no
 * downloads.onDeterminingFilename, so the WhatsApp Web download fix (and its host permission)
 * is left out entirely there.
 */
function firefoxManifest(base) {
  const m = structuredClone(base);
  m.background = { scripts: ["background.js"] };
  delete m.minimum_chrome_version;
  m.content_scripts = m.content_scripts.filter((cs) => !cs.js.some((f) => f.startsWith("whatsapp")));
  delete m.host_permissions;
  m.browser_specific_settings = {
    gecko: { id: "uzanti@awucat.app", strict_min_version: "128.0", data_collection_permissions: { required: ["none"] } },
  };
  return m;
}

/**
 * Safari (18+, for `"world": "MAIN"` content scripts): a non-persistent background page like
 * Apple's own Xcode template, and without the permissions Safari does not implement
 * (`downloads`, `notifications`) — see apps/safari-extension/COMPAT.md.
 */
function safariManifest(base) {
  const m = structuredClone(base);
  m.background = { scripts: ["background.js"] };
  delete m.minimum_chrome_version;
  m.permissions = m.permissions.filter((p) => p !== "downloads" && p !== "notifications");
  m.browser_specific_settings = { safari: { strict_min_version: "18.0" } };
  // WebKit rejects match patterns with a port ("http://localhost:3000/*" is silently dropped).
  const noPort = (list) => [...new Set(list.map((p) => p.replace(/^([a-z*]+:\/\/[^/:]+):\d+\//i, "$1/")))];
  for (const cs of m.content_scripts) cs.matches = noPort(cs.matches);
  m.host_permissions = noPort(m.host_permissions);
  m.optional_host_permissions = noPort(m.optional_host_permissions);
  return m;
}

function assemble(target, manifestJson) {
  const out = join(dist, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestJson, null, 2) + "\n");
  for (const f of STATIC) cpSync(join(src, f), join(out, f));
  const icons = join(root, "icons");
  if (!existsSync(icons) || !readdirSync(icons).some((f) => f.endsWith(".png"))) {
    throw new Error("icons/*.png missing — run `node scripts/make-icons.mjs` first");
  }
  for (const f of readdirSync(icons)) if (f.endsWith(".png")) cpSync(join(icons, f), join(out, "icons", f));
  return out;
}

const targets = [
  ["chrome", manifest],
  ["firefox", firefoxManifest(manifest)],
  ["safari", safariManifest(manifest)],
];

const outdirs = targets.map(([name, m]) => assemble(name, m));

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ENTRIES.map((e) => join(src, `${e}.ts`)),
  // Same output whatever the caller's cwd (module path comments are relative to it).
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  target: ["chrome116", "firefox128", "safari18"],
  platform: "browser",
  sourcemap: watch ? "inline" : false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  write: false,
};

async function run() {
  if (watch) {
    const ctx = await context({
      ...options,
      write: true,
      outdir: outdirs[0],
      plugins: [
        {
          name: "mirror",
          setup(b) {
            b.onEnd(() => {
              for (const dir of outdirs.slice(1)) for (const e of ENTRIES) cpSync(join(outdirs[0], `${e}.js`), join(dir, `${e}.js`));
              console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
            });
          },
        },
      ],
    });
    await ctx.watch();
    console.log("watching…", outdirs.join(", "));
    return;
  }
  const result = await build({ ...options, outdir: outdirs[0] });
  for (const file of result.outputFiles) {
    const rel = file.path.slice(outdirs[0].length);
    for (const dir of outdirs) {
      // Firefox gets no WhatsApp scripts (see firefoxManifest).
      if (dir.endsWith("firefox") && /whatsapp/.test(rel)) continue;
      writeFileSync(join(dir, rel), file.contents);
    }
  }
  console.log("built:", outdirs.join(", "));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
