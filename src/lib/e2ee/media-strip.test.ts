import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_METADATA_LEFT, stripBeforeSeal } from "./media-strip.ts";

const text = (value: string) => new TextEncoder().encode(value);

function concat(...parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function jpegWithGps(): Uint8Array {
  const exif = text("Exif\0GPS latitude 37.1");
  const length = exif.length + 2;
  const app1 = new Uint8Array(4 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (length >> 8) & 0xff;
  app1[3] = length & 0xff;
  app1.set(exif, 4);
  return concat(Uint8Array.of(0xff, 0xd8), app1, Uint8Array.of(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(text(type), 4);
  out.set(data, 8);
  return out;
}

function pngWithGps(): Uint8Array {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", new Uint8Array(13)),
    pngChunk("tEXt", text("GPS latitude")),
    pngChunk("IDAT", text("FRAME")),
    pngChunk("IEND", new Uint8Array()),
  );
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(text(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function webpWithGps(): Uint8Array {
  const payload = concat(webpChunk("EXIF", text("GPS latitude")), webpChunk("VP8 ", text("FRAME")));
  const out = new Uint8Array(12 + payload.length);
  out.set(text("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, 4 + payload.length, true);
  out.set(text("WEBP"), 8);
  out.set(payload, 12);
  return out;
}

function gifWithGps(): Uint8Array {
  const comment = text("GPS latitude");
  return concat(
    text("GIF89a"),
    new Uint8Array(7),
    Uint8Array.of(0x21, 0xfe, comment.length),
    comment,
    Uint8Array.of(0x00, 0x3b),
  );
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(text(type), 4);
  out.set(payload, 8);
  return out;
}

function mp4WithGps(): Uint8Array {
  const hdlr = box("hdlr", concat(new Uint8Array(8), text("vide"), new Uint8Array(12)));
  const stco = box("stco", new Uint8Array(12));
  const video = box(
    "trak",
    concat(
      box("tkhd", new Uint8Array(4)),
      box("mdia", concat(box("mdhd", new Uint8Array(4)), hdlr, box("minf", box("stbl", stco)))),
    ),
  );
  const meta = box(
    "trak",
    box(
      "mdia",
      concat(
        box("mdhd", new Uint8Array(4)),
        box("hdlr", concat(new Uint8Array(8), text("meta"))),
        box("minf", text("GPS latitude")),
      ),
    ),
  );
  const moov = box(
    "moov",
    concat(box("mvhd", new Uint8Array(4)), video, meta, box("udta", text("GPS latitude"))),
  );
  const ftyp = box("ftyp", text("isom"));
  const mdat = box("mdat", text("FRAME"));
  const file = concat(ftyp, moov, mdat);
  const stcoAt = findBox(file, "stco");
  new DataView(file.buffer).setUint32(stcoAt + 12, 1);
  new DataView(file.buffer).setUint32(stcoAt + 16, ftyp.length + moov.length + 8);
  return file;
}

function findBox(file: Uint8Array, type: string): number {
  const needle = text(type);
  for (let i = 0; i + 8 < file.length; i += 1) {
    if (needle.every((byte, index) => file[i + index] === byte)) {
      const sizeAt = i - 4;
      if (sizeAt < 0) continue;
      const size = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(sizeAt);
      if (size >= 8 && sizeAt + size <= file.length) return sizeAt;
    }
  }
  throw new Error(`missing ${type}`);
}

function readStco(file: Uint8Array): number {
  const at = findBox(file, "stco");
  return new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(at + 16);
}

function ebmlSize(value: number): Uint8Array {
  if (value < 127) return Uint8Array.of(0x80 | value);
  const raw = value + 0x4000;
  return Uint8Array.of((raw >> 8) & 0xff, raw & 0xff);
}

function element(id: Uint8Array, payload: Uint8Array): Uint8Array {
  return concat(id, ebmlSize(payload.length), payload);
}

const EBML = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3);
const SEGMENT = Uint8Array.of(0x18, 0x53, 0x80, 0x67);
const INFO = Uint8Array.of(0x15, 0x49, 0xa9, 0x66);
const TAGS = Uint8Array.of(0x12, 0x54, 0xc3, 0x67);
const CLUSTER = Uint8Array.of(0x1f, 0x43, 0xb6, 0x75);
const SEEK_HEAD = Uint8Array.of(0x11, 0x4d, 0x9b, 0x74);
const SEEK = Uint8Array.of(0x4d, 0xbb);
const SEEK_ID = Uint8Array.of(0x53, 0xab);
const SEEK_POSITION = Uint8Array.of(0x53, 0xac);
const TITLE = Uint8Array.of(0x7b, 0xa9);
const BLOCK = Uint8Array.of(0xa3);

function webmWithGps(withSeek: boolean): Uint8Array {
  const info = element(INFO, element(TITLE, text("x")));
  const tags = element(TAGS, text("GPS latitude"));
  const cluster = element(CLUSTER, element(BLOCK, text("FRAME")));
  if (!withSeek) {
    return concat(element(EBML, text("webm")), element(SEGMENT, concat(info, tags, cluster)));
  }
  const clusterAt = (headLength: number) => headLength + info.length + tags.length;
  const head = (at: number) =>
    element(
      SEEK_HEAD,
      concat(
        element(SEEK, concat(element(SEEK_ID, CLUSTER), element(SEEK_POSITION, Uint8Array.of(at)))),
        element(
          SEEK,
          concat(element(SEEK_ID, TAGS), element(SEEK_POSITION, Uint8Array.of(info.length))),
        ),
      ),
    );
  let headBytes = head(0);
  headBytes = head(clusterAt(headBytes.length));
  return concat(
    element(EBML, text("webm")),
    element(SEGMENT, concat(headBytes, info, tags, cluster)),
  );
}

test("pictures lose GPS text and stay pictures", () => {
  const jpeg = stripBeforeSeal(jpegWithGps(), "image", "image/jpeg");
  assert.equal(new TextDecoder().decode(jpeg).includes("GPS latitude"), false);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  assert.deepEqual(stripBeforeSeal(jpeg, "image", "image/jpeg"), jpeg);

  const png = stripBeforeSeal(pngWithGps(), "image", "image/png");
  assert.equal(new TextDecoder().decode(png).includes("GPS latitude"), false);
  assert.equal(new TextDecoder().decode(png).includes("FRAME"), true);

  const webp = stripBeforeSeal(webpWithGps(), "image", "image/webp");
  assert.equal(new TextDecoder().decode(webp).includes("GPS latitude"), false);
  assert.equal(new TextDecoder().decode(webp).includes("FRAME"), true);

  const gif = stripBeforeSeal(gifWithGps(), "image", "image/gif");
  assert.equal(new TextDecoder().decode(gif).includes("GPS latitude"), false);
  assert.equal(gif.at(-1), 0x3b);
});

test("an MP4 loses its location box and keeps the frame offset honest", () => {
  const original = mp4WithGps();
  const cleaned = stripBeforeSeal(original, "video", "video/mp4");
  const decoded = new TextDecoder().decode(cleaned);
  assert.equal(decoded.includes("GPS latitude"), false);
  assert.equal(decoded.includes("FRAME"), true);
  const mdat = findBox(cleaned, "mdat");
  assert.equal(readStco(cleaned), mdat + 8);
  assert.deepEqual(stripBeforeSeal(cleaned, "video", "video/mp4"), cleaned);
});

test("a WebM loses tags, and a seek position follows the cluster", () => {
  const cleaned = stripBeforeSeal(webmWithGps(false), "video", "video/webm");
  assert.equal(new TextDecoder().decode(cleaned).includes("GPS latitude"), false);
  assert.equal(new TextDecoder().decode(cleaned).includes("FRAME"), true);
  assert.deepEqual(stripBeforeSeal(cleaned, "video", "video/webm"), cleaned);

  const sought = stripBeforeSeal(webmWithGps(true), "video", "video/webm");
  const soughtText = new TextDecoder().decode(sought);
  assert.equal(soughtText.includes("GPS latitude"), false);
  assert.equal(soughtText.includes("FRAME"), true);
  const cluster = findBytes(sought, CLUSTER, true);
  const segment = findBytes(sought, SEGMENT, true);
  const segmentHeader = segment + SEGMENT.length;
  const sizeLen = (sought[segmentHeader] ?? 0) & 0x80 ? 1 : 2;
  const dataStart = segmentHeader + sizeLen;
  const positionAt = findBytes(sought, SEEK_POSITION, true);
  const position = sought[positionAt + SEEK_POSITION.length + 1] ?? 0;
  assert.equal(position, cluster - dataStart);
});

test("a video whose container cannot be rewritten is refused", () => {
  const tags = element(TAGS, text("GPS latitude"));
  const cluster = element(CLUSTER, text("FRAME"));
  const segment = concat(SEGMENT, Uint8Array.of(0xff), tags, cluster);
  const file = concat(element(EBML, text("webm")), segment);
  assert.throws(() => stripBeforeSeal(file, "video", "video/webm"), /cannot remove/);
});

test("what a sealed video can still carry is stated", () => {
  assert.match(MEDIA_METADATA_LEFT, /compressed frames/);
  assert.match(MEDIA_METADATA_LEFT, /creation time/);
  assert.match(MEDIA_METADATA_LEFT, /does not transcode/);
});

function findBytes(file: Uint8Array, needle: Uint8Array, last = false): number {
  let found = -1;
  for (let i = 0; i + needle.length <= file.length; i += 1) {
    if (!needle.every((byte, index) => file[i + index] === byte)) continue;
    found = i;
    if (!last) return i;
  }
  if (found < 0) throw new Error("missing bytes");
  return found;
}
