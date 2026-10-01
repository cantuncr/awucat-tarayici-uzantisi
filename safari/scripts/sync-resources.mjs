#!/usr/bin/env node
/**
 * Copies the built Safari extension (dist/safari of the shared extension sources) into the
 * Xcode project's extension Resources, and keeps the app version in step with manifest.json.
 *
 *   node scripts/sync-resources.mjs [--build]     (--build runs the extension build first)
 *
 * The Xcode project lists each resource file individually (that is how the converter
 * generates it). When the extension gains a new top-level file, this script stops and says
 * so — add the file to the "AwuCat Uzantı Extension" target in Xcode (or regenerate the
 * project, see ../README.md).
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Monorepo: apps/browser-extension next to apps/safari-extension. Exported repo: safari/ inside the extension repo.
const extensionRoot = [resolve(pkg, "..", "browser-extension"), resolve(pkg, "..")].find((d) => existsSync(join(d, "scripts", "build.mjs")));
if (!extensionRoot) fail("extension sources not found (../browser-extension or ..)");

if (process.argv.includes("--build")) execFileSync(process.execPath, [join(extensionRoot, "scripts", "build.mjs")], { stdio: "inherit" });

const dist = join(extensionRoot, "dist", "safari");
if (!existsSync(join(dist, "manifest.json"))) fail(`${dist} missing — run the extension build first (or pass --build)`);

const project = join(pkg, "AwuCat Uzantı");
const resources = join(project, "AwuCat Uzantı Extension", "Resources");
const pbxproj = join(project, "AwuCat Uzantı.xcodeproj", "project.pbxproj");
let pbx = readFileSync(pbxproj, "utf8");

// Every top-level entry of the build must already be a resource of the extension target.
const missing = readdirSync(dist).filter((name) => !pbx.includes(`path = ${JSON.stringify("Resources/" + name)}`) && !pbx.includes(`path = Resources/${name};`));
if (missing.length) fail(`not in the Xcode project yet: ${missing.join(", ")} — add them to the extension target's Resources (see README).`);

rmSync(resources, { recursive: true, force: true });
cpSync(dist, resources, { recursive: true });

const version = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")).version;
const next = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
if (next !== pbx) {
  writeFileSync(pbxproj, next);
  pbx = next;
}
console.log(`synced ${readdirSync(dist).length} entries → ${resources.slice(pkg.length + 1)} (v${version})`);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
