import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionForMime, filenameFromDisposition, filenameFromUrl, linkPatterns, looksLikeHtmlPage, pickFilename } from "../src/lib/http.ts";
import { appUrl, normalizeBaseUrl, originPattern } from "../src/lib/settings.ts";

test("Content-Disposition parsing prefers RFC 5987 filename*", () => {
  assert.equal(filenameFromDisposition(`attachment; filename="fallback.udf"; filename*=UTF-8''Dilek%C3%A7e.udf`), "Dilekçe.udf");
  assert.equal(filenameFromDisposition(`attachment; filename="a\\"b.pdf"`), 'a"b.pdf'.replace('"', "_"));
  assert.equal(filenameFromDisposition("inline; filename=karar.udf"), "karar.udf");
  assert.equal(filenameFromDisposition("attachment"), null);
  assert.equal(filenameFromDisposition(null), null);
});

test("URL and MIME fallbacks", () => {
  assert.equal(filenameFromUrl("https://uyap.gov.tr/dosya/Tensip%20Zapt%C4%B1.udf?token=1"), "Tensip Zaptı.udf");
  assert.equal(filenameFromUrl("https://example.com/download/123"), null);
  assert.equal(extensionForMime("application/pdf"), "pdf");
  assert.equal(extensionForMime("application/octet-stream"), null);
  assert.equal(pickFilename({ url: "https://example.com/download/123", mime: "application/udf" }), "belge.udf");
  assert.equal(pickFilename({ disposition: null, url: "https://example.com/x", mime: "image/tiff" }), "belge.tif");
});

test("HTML responses are flagged unless the link really pointed at HTML", () => {
  assert.equal(looksLikeHtmlPage("text/html; charset=utf-8", "belge.udf"), true);
  assert.equal(looksLikeHtmlPage("text/html", "sayfa.html"), false);
  assert.equal(looksLikeHtmlPage("application/udf", "belge.udf"), false);
});

test("context-menu link patterns cover case and query variants", () => {
  const patterns = linkPatterns(["udf"]);
  assert.deepEqual(patterns, ["*://*/*.udf", "*://*/*.udf?*", "*://*/*.UDF", "*://*/*.UDF?*"]);
});

test("base URL normalisation", () => {
  assert.equal(normalizeBaseUrl(" awucat.app/ "), "https://awucat.app");
  assert.equal(normalizeBaseUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(normalizeBaseUrl("https://ornek.com/udf/"), "https://ornek.com/udf");
  assert.equal(normalizeBaseUrl("ftp://x"), null);
  assert.equal(normalizeBaseUrl(""), null);
  assert.equal(originPattern("https://ornek.com/udf"), "https://ornek.com/*");
  assert.equal(appUrl("http://localhost:3000", "viewer"), "http://localhost:3000/goruntuleyici?ext=1");
  assert.equal(appUrl("https://awucat.app", "privacy"), "https://awucat.app/gizlilik");
});
