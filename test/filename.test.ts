// Run with: node --test test/   (Node ≥ 22.18 strips the types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFilename, foldTurkish, isHeuristicHost, looksLikeLegalDocument, mimeAllowsRename, sourceHost } from "../src/lib/filename.ts";

const on = { fixZip: true, heuristic: true };
const zipOnly = { fixZip: true, heuristic: false };
const off = { fixZip: false, heuristic: false };

test("'.udf.zip' becomes '.udf' regardless of source", () => {
  assert.deepEqual(decideFilename({ filename: "dilekce.udf.zip" }, on), { filename: "dilekce.udf", reason: "udf-zip" });
  assert.deepEqual(decideFilename({ filename: "Gerekçeli Karar.UDF.ZIP", mime: "application/octet-stream" }, zipOnly), { filename: "Gerekçeli Karar.udf", reason: "udf-zip" });
});

test("MIME types with a preferred extension are left alone (Chrome would revert the suggestion)", () => {
  // Verified in Chromium: an extension-suggested "x.udf" for application/zip is saved as "x.zip".
  assert.equal(decideFilename({ filename: "dilekce.udf.zip", mime: "application/zip" }, on), null);
  assert.equal(decideFilename({ filename: "dilekce.udf.zip", mime: "text/plain" }, on), null);
  assert.equal(mimeAllowsRename("application/zip"), false);
  assert.equal(mimeAllowsRename("application/x-zip-compressed"), false);
  assert.equal(mimeAllowsRename("application/octet-stream; charset=binary"), true);
  assert.equal(mimeAllowsRename(""), true);
  assert.equal(mimeAllowsRename("application/udf"), true);
});

test("content verdict from the WhatsApp Web shim beats name guessing", () => {
  const wa = { url: "blob:https://web.whatsapp.com/1", referrer: "https://web.whatsapp.com/", mime: "application/octet-stream" };
  assert.deepEqual(decideFilename({ ...wa, filename: "IMG-2026.zip", sniff: true }, on), { filename: "IMG-2026.udf", reason: "sniff" });
  assert.deepEqual(decideFilename({ ...wa, filename: "karar.udf (2).zip", sniff: true }, zipOnly), { filename: "karar (2).udf", reason: "sniff" });
  assert.equal(decideFilename({ ...wa, filename: "fake.udf.zip", sniff: false }, on), null, "not a UDF inside");
  assert.equal(decideFilename({ ...wa, filename: "Cevap Dilekçesi.zip", sniff: false }, on), null, "heuristic suppressed too");
  assert.equal(decideFilename({ ...wa, filename: "belge.pdf", sniff: true }, on), null, "only .zip names are touched");
  assert.equal(decideFilename({ ...wa, filename: "IMG-2026.zip", sniff: true }, off), null);
});

test("keeps the directory part and moves a '(1)' counter behind the stem", () => {
  assert.equal(decideFilename({ filename: "WhatsApp/tensip.udf (1).zip" }, on)?.filename, "WhatsApp/tensip (1).udf");
  assert.equal(decideFilename({ filename: "sub\\dir\\karar.udf.zip" }, on)?.filename, "sub\\dir\\karar.udf");
});

test("does nothing when the fix is disabled or the name is already fine", () => {
  assert.equal(decideFilename({ filename: "dilekce.udf.zip" }, off), null);
  assert.equal(decideFilename({ filename: "dilekce.udf" }, on), null);
  assert.equal(decideFilename({ filename: "fotograflar.zip", referrer: "https://web.whatsapp.com/" }, on), null);
  assert.equal(decideFilename({ filename: "" }, on), null);
});

test("UDF MIME type fixes a '.zip' or extension-less name but leaves other extensions alone", () => {
  assert.deepEqual(decideFilename({ filename: "belge.zip", mime: "application/udf" }, zipOnly), { filename: "belge.udf", reason: "mime" });
  assert.deepEqual(decideFilename({ filename: "download", mime: "application/x-udf; charset=binary" }, zipOnly), { filename: "download.udf", reason: "mime" });
  assert.equal(decideFilename({ filename: "belge.pdf", mime: "application/udf" }, zipOnly), null);
});

test("name heuristic only applies to '.zip' from WhatsApp Web / webmail, small files", () => {
  const wa = { filename: "Cevap Dilekçesi.zip", url: "blob:https://web.whatsapp.com/8a1c-…", fileSize: -1 };
  assert.deepEqual(decideFilename(wa, on), { filename: "Cevap Dilekçesi.udf", reason: "heuristic" });
  assert.equal(decideFilename(wa, zipOnly), null, "disabled by the toggle");
  assert.equal(decideFilename({ ...wa, fileSize: 30 * 1024 * 1024 }, on), null, "too large");
  assert.equal(decideFilename({ ...wa, url: "https://example.com/x" }, on), null, "unknown source");
  assert.deepEqual(decideFilename({ filename: "karar_udf.zip", referrer: "https://mail.google.com/mail/u/0/" }, on), { filename: "karar_udf.udf", reason: "heuristic" });
  assert.equal(decideFilename({ filename: "tatil resimleri.zip", referrer: "https://mail.google.com/" }, on), null);
});

test("source host handling", () => {
  assert.equal(sourceHost({ url: "blob:https://web.whatsapp.com/1234" }), "web.whatsapp.com");
  assert.equal(sourceHost({ referrer: "https://outlook.office.com/mail/", url: "https://attachments.office.net/x" }), "outlook.office.com");
  assert.equal(sourceHost({ url: "not a url" }), "");
  assert.equal(isHeuristicHost("web.whatsapp.com"), true);
  assert.equal(isHeuristicHost("evil-whatsapp.com"), false);
  assert.equal(isHeuristicHost("mail.yandex.com.tr"), true);
});

test("Turkish folding and legal-word detection", () => {
  assert.equal(foldTurkish("DİLEKÇE Gerekçeli KARARI"), "dilekce gerekceli karari");
  assert.equal(looksLikeLegalDocument("2024-123 Duruşma Zaptı"), true);
  assert.equal(looksLikeLegalDocument("IMG_0001"), false);
  assert.equal(looksLikeLegalDocument("udfler"), false, "whole words only");
});
