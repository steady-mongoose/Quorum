import assert from "node:assert/strict";
import test from "node:test";
import { stripImageMetadata } from "../../src/lib/media/strip.ts";

function jpegWithGps(): Uint8Array {
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude");
  const length = 2 + payload.length;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}

test("a JPEG loses its EXIF GPS segment", () => {
  const cleaned = stripImageMetadata(jpegWithGps(), "image/jpeg");
  assert.equal(new TextDecoder().decode(cleaned).includes("GPSLatitude"), false);
  assert.equal(cleaned[0], 0xff);
  assert.equal(cleaned[1], 0xd8);
  assert.equal(cleaned.includes(0xda), true);
});

test("a PNG loses text metadata and keeps the image chunks", () => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk("IHDR", new Uint8Array(13));
  const text = chunk("tEXt", new TextEncoder().encode("Comment\0GPSLatitude"));
  const iend = chunk("IEND", new Uint8Array());
  const file = new Uint8Array(signature.length + ihdr.length + text.length + iend.length);
  file.set(signature, 0);
  file.set(ihdr, signature.length);
  file.set(text, signature.length + ihdr.length);
  file.set(iend, signature.length + ihdr.length + text.length);
  const cleaned = stripImageMetadata(file, "image/png");
  const decoded = new TextDecoder().decode(cleaned);
  assert.equal(decoded.includes("GPSLatitude"), false);
  assert.equal(decoded.includes("IHDR"), true);
  assert.equal(decoded.includes("IEND"), true);
  assert.equal(decoded.includes("tEXt"), false);
});

test("a WebP loses the EXIF chunk and clears the feature flag", () => {
  const exif = new TextEncoder().encode("GPSLatitude!");
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x08;
  const vp8 = new TextEncoder().encode("frame");
  const parts = [
    new TextEncoder().encode("RIFF"),
    new Uint8Array(4),
    new TextEncoder().encode("WEBP"),
    new TextEncoder().encode("VP8X"),
    Uint8Array.of(10, 0, 0, 0),
    vp8x,
    new TextEncoder().encode("EXIF"),
    Uint8Array.of(exif.length, 0, 0, 0),
    exif,
    new TextEncoder().encode("VP8 "),
    Uint8Array.of(vp8.length, 0, 0, 0),
    vp8,
  ];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const file = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }
  new DataView(file.buffer).setUint32(4, size - 8, true);
  const cleaned = stripImageMetadata(file, "image/webp");
  assert.equal(new TextDecoder().decode(cleaned).includes("GPSLatitude"), false);
  assert.equal(new TextDecoder().decode(cleaned).includes("VP8 "), true);
  const flagsAt = new TextDecoder().decode(cleaned).indexOf("VP8X");
  assert.equal(flagsAt > 0, true);
  assert.equal(cleaned[flagsAt + 8] & 0x08, 0);
});

test("a GIF loses a comment that carries a location", () => {
  const comment = new TextEncoder().encode("GPS 1,2");
  const file = Uint8Array.from([
    ..."GIF89a".split("").map((char) => char.charCodeAt(0)),
    1,
    0,
    1,
    0,
    0,
    0,
    0,
    0x21,
    0xfe,
    comment.length,
    ...comment,
    0x00,
    0x3b,
  ]);
  const cleaned = stripImageMetadata(file, "image/gif");
  assert.equal(new TextDecoder().decode(cleaned).includes("GPS"), false);
  assert.equal(cleaned[cleaned.length - 1], 0x3b);
  assert.equal(asciiStart(cleaned), "GIF89a");
});

test("a file that is not a JPEG is refused", () => {
  assert.throws(() => stripImageMetadata(Uint8Array.of(1, 2, 3, 4), "image/jpeg"), /not a JPEG/);
});

function asciiStart(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.slice(0, 6));
}
