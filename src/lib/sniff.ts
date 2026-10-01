/**
 * Content check for UDF files (pure, unit-tested). A UDF is a zip archive whose main entry is
 * `content.xml`; UYAP's editor writes that entry first, and every zip lists its entries again
 * in the central directory at the end. Checking the head and the tail is therefore enough.
 */

export const SNIFF_HEAD_BYTES = 4096;
export const SNIFF_TAIL_BYTES = 65536;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const CONTENT_XML = Array.from("content.xml", (c) => c.charCodeAt(0));

function indexOfBytes(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && ZIP_MAGIC.every((b, i) => head[i] === b);
}

/** True when the bytes look like a UDF: a zip that mentions `content.xml` in its head or tail. */
export function looksLikeUdf(head: Uint8Array, tail: Uint8Array): boolean {
  if (!isZip(head)) return false;
  return indexOfBytes(head, CONTENT_XML) !== -1 || indexOfBytes(tail, CONTENT_XML) !== -1;
}

/** Convenience for whole files (tests, small buffers). */
export function looksLikeUdfBytes(bytes: Uint8Array): boolean {
  return looksLikeUdf(bytes.subarray(0, SNIFF_HEAD_BYTES), bytes.subarray(Math.max(0, bytes.length - SNIFF_TAIL_BYTES)));
}
