import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isZip, looksLikeUdf, looksLikeUdfBytes } from "../src/lib/sniff.ts";

const fixture = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../tests/fixtures/ornek-dilekce.udf")));

/** Minimal stored (uncompressed) zip with a single entry — enough for signature checks. */
function tinyZip(entryName: string, payload = "x"): Uint8Array {
  const name = new TextEncoder().encode(entryName);
  const data = new TextEncoder().encode(payload);
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const local = [0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...name, ...data];
  const central = [0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...name];
  const end = [0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(1), ...le16(1), ...le32(central.length), ...le32(local.length), ...le16(0)];
  return new Uint8Array([...local, ...central, ...end]);
}

test("the real fixture is recognised as a UDF", () => {
  assert.equal(isZip(fixture), true);
  assert.equal(looksLikeUdfBytes(fixture), true);
});

test("zips without content.xml and non-zip files are rejected", () => {
  assert.equal(looksLikeUdfBytes(tinyZip("fotograf.jpg")), false);
  assert.equal(looksLikeUdfBytes(new TextEncoder().encode("content.xml but not a zip")), false);
  assert.equal(looksLikeUdfBytes(new Uint8Array(0)), false);
});

test("content.xml is found in the tail (central directory) when the head is padded", () => {
  const zip = tinyZip("content.xml", "a".repeat(10_000));
  const head = zip.subarray(0, 64); // too short to contain the name? no — the local header has it; blank it out
  const blankedHead = new Uint8Array(head);
  blankedHead.fill(0x20, 30); // overwrite the local file name in the head copy
  assert.equal(looksLikeUdf(blankedHead, zip.subarray(zip.length - 200)), true);
});
