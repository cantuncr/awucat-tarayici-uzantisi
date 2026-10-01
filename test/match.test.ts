import { test } from "node:test";
import assert from "node:assert/strict";
import { patternsForScript, urlMatchesPattern } from "../src/lib/match.ts";

test("match patterns: scheme, host, wildcard host, ports, blob URLs", () => {
  assert.equal(urlMatchesPattern("https://web.whatsapp.com/", "https://web.whatsapp.com/*"), true);
  assert.equal(urlMatchesPattern("blob:https://web.whatsapp.com/9f1c", "https://web.whatsapp.com/*"), true);
  assert.equal(urlMatchesPattern("http://web.whatsapp.com/", "https://web.whatsapp.com/*"), false);
  assert.equal(urlMatchesPattern("https://evil.com/web.whatsapp.com/", "https://web.whatsapp.com/*"), false);
  assert.equal(urlMatchesPattern("https://a.example.com/x", "*://*.example.com/*"), true);
  assert.equal(urlMatchesPattern("https://example.com/x", "*://*.example.com/*"), true);
  assert.equal(urlMatchesPattern("http://127.0.0.1:64544/page", "http://127.0.0.1/*"), true);
  assert.equal(urlMatchesPattern("http://localhost:3000/goruntuleyici", "http://localhost:3000/*"), true);
  assert.equal(urlMatchesPattern("http://localhost:3001/goruntuleyici", "http://localhost:3000/*"), false);
  assert.equal(urlMatchesPattern("https://x.com/a.udf?t=1", "*://*/*.udf?*"), true);
  assert.equal(urlMatchesPattern("https://x.com/a.udf", "*://*/*.udf?*"), false);
  assert.equal(urlMatchesPattern("not a url", "<all_urls>"), false);
});

test("patternsForScript pulls the matches of the scripts that include a file", () => {
  const manifest = { content_scripts: [{ matches: ["https://a/*"], js: ["x.js"] }, { matches: ["https://b/*", "https://c/*"], js: ["whatsapp-main.js"] }] };
  assert.deepEqual(patternsForScript(manifest, "whatsapp-main.js"), ["https://b/*", "https://c/*"]);
  assert.deepEqual(patternsForScript({}, "whatsapp-main.js"), []);
});
