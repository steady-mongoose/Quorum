/**
 * Remove location and other container metadata on this device, before a
 * picture or video is sealed.
 *
 * Pictures: JPEG, PNG, WebP, and GIF lose EXIF, XMP, comments, and GPS text.
 * The same bytes are removed again if the media page already stripped them.
 *
 * Video containers: MP4/QuickTime user-data, meta, uuid, free space, and timed
 * metadata tracks are removed. WebM Tags, Void, and a seek entry that points
 * at Tags are removed, and the remaining seek and cue positions are shifted.
 *
 * Still in the sealed file, because this device does not transcode:
 * - location or a caption stored inside a compressed video frame
 *   (H.264 SEI, HEVC SEI, or a VP8/VP9 frame)
 * - the MP4 movie header's creation time
 * - a WebM Info date and encoder name, which are not a map location
 *
 * If a video's container cannot be rewritten, sealing stops. The original
 * file is not encrypted with that metadata still in it.
 */

const JPEG_ERROR = "That file is not a JPEG.";
const PNG_ERROR = "That file is not a PNG.";
const WEBP_ERROR = "That file is not a WebP.";
const GIF_ERROR = "That file is not a GIF.";
const VIDEO_LEFT = "This video still has metadata this device cannot remove.";

export const MEDIA_METADATA_LEFT =
  "Container location and EXIF are removed before a picture or video is sealed. A video can still carry a location inside its compressed frames, and an MP4 can still carry its creation time. This device does not transcode video.";

function concat(parts: Uint8Array[]): Uint8Array {
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

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[start + i] ?? 0);
  return text;
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(JPEG_ERROR);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(JPEG_ERROR);
    let markerAt = i + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1;
    if (markerAt >= bytes.length) throw new Error(JPEG_ERROR);
    const marker = bytes[markerAt];
    if (marker === 0xd9) {
      parts.push(Uint8Array.of(0xff, 0xd9));
      return concat(parts);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      parts.push(bytes.subarray(i, markerAt + 1));
      i = markerAt + 1;
      continue;
    }
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      return concat(parts);
    }
    if (markerAt + 3 >= bytes.length) throw new Error(JPEG_ERROR);
    const length = ((bytes[markerAt + 1] ?? 0) << 8) | (bytes[markerAt + 2] ?? 0);
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) throw new Error(JPEG_ERROR);
    const app = marker >= 0xe0 && marker <= 0xef;
    const comment = marker === 0xfe;
    const drop = comment || (app && marker !== 0xe0 && marker !== 0xee);
    if (!drop) parts.push(bytes.subarray(i, end));
    i = end;
  }
  throw new Error(JPEG_ERROR);
}

const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "sRGB",
  "cHRM",
  "bKGD",
  "pHYs",
  "sBIT",
]);

function stripPng(bytes: Uint8Array): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error(PNG_ERROR);
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 8 <= bytes.length) {
    const length =
      (((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0)) >>>
      0;
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + length;
    if (end > bytes.length) throw new Error(PNG_ERROR);
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error(PNG_ERROR);
  return concat(parts);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function putU32le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new Error(WEBP_ERROR);
  }
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const id = ascii(bytes, i, 4);
    const size = u32le(bytes, i + 4);
    const end = i + 8 + size;
    if (end > bytes.length) throw new Error(WEBP_ERROR);
    const padded = end + (size % 2);
    if (id === "EXIF" || id.startsWith("XMP")) {
      i = Math.min(bytes.length, padded);
      continue;
    }
    const chunk = bytes.slice(i, end);
    if (id === "VP8X" && chunk.length >= 9) chunk[8] = (chunk[8] ?? 0) & ~0x0c;
    chunks.push(chunk);
    if (size % 2 === 1) chunks.push(Uint8Array.of(0));
    i = padded;
  }
  const payload = concat(chunks);
  const out = new Uint8Array(12 + payload.length);
  out.set(bytes.subarray(0, 4), 0);
  putU32le(out, 4, 4 + payload.length);
  out.set(bytes.subarray(8, 12), 8);
  out.set(payload, 12);
  return out;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let i = start;
  while (i < bytes.length) {
    const size = bytes[i] ?? 0;
    i += 1;
    if (size === 0) return i;
    i += size;
    if (i > bytes.length) throw new Error(GIF_ERROR);
  }
  throw new Error(GIF_ERROR);
}

function stripGif(bytes: Uint8Array): Uint8Array {
  const header = ascii(bytes, 0, 6);
  if ((header !== "GIF87a" && header !== "GIF89a") || bytes.length < 13) throw new Error(GIF_ERROR);
  const packed = bytes[10] ?? 0;
  const globalColors = packed & 0x80 ? 3 * (2 << (packed & 0x07)) : 0;
  const imageStart = 13 + globalColors;
  if (imageStart > bytes.length) throw new Error(GIF_ERROR);
  const parts: Uint8Array[] = [bytes.subarray(0, imageStart)];
  let i = imageStart;
  while (i < bytes.length) {
    const marker = bytes[i];
    if (marker === 0x3b) {
      parts.push(Uint8Array.of(0x3b));
      return concat(parts);
    }
    if (marker === 0x2c) {
      if (i + 10 > bytes.length) throw new Error(GIF_ERROR);
      const local = (bytes[i + 9] ?? 0) & 0x80 ? 3 * (2 << ((bytes[i + 9] ?? 0) & 0x07)) : 0;
      const lzw = i + 10 + local;
      if (lzw >= bytes.length) throw new Error(GIF_ERROR);
      const end = skipSubBlocks(bytes, lzw + 1);
      parts.push(bytes.subarray(i, end));
      i = end;
      continue;
    }
    if (marker === 0x21) {
      const label = bytes[i + 1];
      if (label === 0xfe) {
        i = skipSubBlocks(bytes, i + 2);
        continue;
      }
      if (label === 0xff) {
        const block = bytes[i + 2] ?? 0;
        const ident = ascii(bytes, i + 3, Math.min(11, block));
        const end = skipSubBlocks(bytes, i + 3 + block);
        if (ident.startsWith("XMP Data") || ident.startsWith("ICCRGBG")) {
          i = end;
          continue;
        }
        parts.push(bytes.subarray(i, end));
        i = end;
        continue;
      }
      const end = skipSubBlocks(bytes, i + 2);
      parts.push(bytes.subarray(i, end));
      i = end;
      continue;
    }
    throw new Error(GIF_ERROR);
  }
  throw new Error(GIF_ERROR);
}

export function stripImageMetadata(bytes: Uint8Array, contentType: string): Uint8Array {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpeg") return stripJpeg(bytes);
  if (type === "image/png") return stripPng(bytes);
  if (type === "image/webp") return stripWebp(bytes);
  if (type === "image/gif") return stripGif(bytes);
  throw new Error("That file is not a picture we can keep.");
}

type Box = { start: number; end: number; type: string };

const DROP_BOX = new Set(["udta", "meta", "uuid", "loci", "free", "skip"]);
const CONTAINER_BOX = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "moof",
  "traf",
]);

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function parseBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    const size = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    if (size < 8 || size === 1 || i + size > end) throw new Error(VIDEO_LEFT);
    boxes.push({ start: i, end: i + size, type });
    i += size;
  }
  if (i !== end) throw new Error(VIDEO_LEFT);
  return boxes;
}

function childBox(bytes: Uint8Array, parent: Box, type: string): Box | null {
  return parseBoxes(bytes, parent.start + 8, parent.end).find((box) => box.type === type) ?? null;
}

function handlerOf(bytes: Uint8Array, trak: Box): string {
  const mdia = childBox(bytes, trak, "mdia");
  if (!mdia) return "";
  const hdlr = childBox(bytes, mdia, "hdlr");
  if (!hdlr || hdlr.end < hdlr.start + 20) return "";
  return ascii(bytes, hdlr.start + 16, 4);
}

function writeBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}

function dropBox(bytes: Uint8Array, box: Box): boolean {
  return DROP_BOX.has(box.type) || (box.type === "trak" && handlerOf(bytes, box) === "meta");
}

function collectBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  out: [number, number][],
): void {
  for (const box of parseBoxes(bytes, start, end)) {
    if (dropBox(bytes, box)) {
      out.push([box.start, box.end]);
      continue;
    }
    if (CONTAINER_BOX.has(box.type)) collectBoxes(bytes, box.start + 8, box.end, out);
  }
}

function rebuildBoxes(bytes: Uint8Array, start: number, end: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const box of parseBoxes(bytes, start, end)) {
    if (dropBox(bytes, box)) continue;
    if (CONTAINER_BOX.has(box.type)) {
      parts.push(writeBox(box.type, rebuildBoxes(bytes, box.start + 8, box.end)));
      continue;
    }
    parts.push(bytes.subarray(box.start, box.end));
  }
  return concat(parts);
}

function removedBefore(offset: number, ranges: [number, number][]): number {
  let total = 0;
  for (const [start, end] of ranges) {
    if (end <= offset) total += end - start;
    else if (start < offset) throw new Error(VIDEO_LEFT);
  }
  return total;
}

function patchChunkOffsets(file: Uint8Array, ranges: [number, number][]): void {
  const visit = (start: number, end: number): void => {
    for (const box of parseBoxes(file, start, end)) {
      if (box.type === "stco" || box.type === "co64") {
        const wide = box.type === "co64";
        const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
        const count = view.getUint32(box.start + 12);
        const width = wide ? 8 : 4;
        if (box.start + 16 + count * width > box.end) throw new Error(VIDEO_LEFT);
        for (let i = 0; i < count; i += 1) {
          const at = box.start + 16 + i * width;
          const old = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
          const next = old - removedBefore(old, ranges);
          if (!Number.isSafeInteger(old) || next < 0 || next > file.length)
            throw new Error(VIDEO_LEFT);
          if (wide) view.setBigUint64(at, BigInt(next));
          else view.setUint32(at, next);
        }
      }
      if (CONTAINER_BOX.has(box.type)) visit(box.start + 8, box.end);
    }
  };
  visit(0, file.length);
}

function stripMp4(bytes: Uint8Array): Uint8Array {
  const top = parseBoxes(bytes, 0, bytes.length);
  if (
    !top.some((box) => box.type === "ftyp") ||
    !top.some((box) => box.type === "mdat" || box.type === "moov")
  ) {
    throw new Error(VIDEO_LEFT);
  }
  const ranges: [number, number][] = [];
  collectBoxes(bytes, 0, bytes.length, ranges);
  const rebuilt = rebuildBoxes(bytes, 0, bytes.length);
  patchChunkOffsets(rebuilt, ranges);
  return rebuilt;
}

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK = 0x4dbb;
const ID_SEEK_ID = 0x53ab;
const ID_SEEK_POSITION = 0x53ac;
const ID_CUE_CLUSTER_POSITION = 0xf1;
const ID_TAGS = 0x1254c367;
const ID_VOID = 0xec;
const MASTER = new Set([
  ID_SEGMENT,
  0x114d9b74,
  ID_SEEK,
  0x1549a966,
  0x1654ae6b,
  ID_TAGS,
  0x1c53bb6b,
  0xbb,
  0xb7,
  0x1f43b675,
]);

type Element = {
  id: number;
  start: number;
  dataStart: number;
  end: number;
  idLen: number;
  sizeLen: number;
  size: number | null;
};

function readVint(bytes: Uint8Array, offset: number): { length: number; raw: number } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset] ?? 0;
  if (first === 0) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let raw = 0;
  for (let i = 0; i < length; i += 1) raw = raw * 256 + (bytes[offset + i] ?? 0);
  if (!Number.isSafeInteger(raw)) return null;
  return { length, raw };
}

function vintData(raw: number, length: number): number {
  return raw - (1 << (7 * length));
}

function parseElement(bytes: Uint8Array, offset: number, limit: number): Element | null {
  const id = readVint(bytes, offset);
  if (!id) return null;
  const size = readVint(bytes, offset + id.length);
  if (!size) return null;
  const data = vintData(size.raw, size.length);
  const unknown = data === (1 << (7 * size.length)) - 1;
  const dataStart = offset + id.length + size.length;
  if (unknown) {
    return {
      id: id.raw,
      start: offset,
      dataStart,
      end: limit,
      idLen: id.length,
      sizeLen: size.length,
      size: null,
    };
  }
  if (data < 0 || dataStart + data > limit) return null;
  return {
    id: id.raw,
    start: offset,
    dataStart,
    end: dataStart + data,
    idLen: id.length,
    sizeLen: size.length,
    size: data,
  };
}

function parseElements(bytes: Uint8Array, start: number, end: number): Element[] {
  const elements: Element[] = [];
  let i = start;
  while (i < end) {
    const element = parseElement(bytes, i, end);
    if (!element || element.end <= i) throw new Error(VIDEO_LEFT);
    elements.push(element);
    if (element.size === null) break;
    i = element.end;
  }
  if (i !== end && elements.at(-1)?.size !== null) throw new Error(VIDEO_LEFT);
  return elements;
}

function encodeSize(value: number, width: number): Uint8Array | null {
  const max = 2 ** (7 * width) - 1;
  if (value < 0 || value >= max || width > 6) return null;
  let raw = value + 2 ** (7 * width);
  const out = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = raw & 0xff;
    raw = Math.floor(raw / 256);
  }
  if (raw !== 0) return null;
  return out;
}

function seekPointsAtTags(bytes: Uint8Array, element: Element): boolean {
  for (const child of parseElements(bytes, element.dataStart, element.end)) {
    if (child.id !== ID_SEEK_ID) continue;
    const payload = bytes.subarray(child.dataStart, child.end);
    if (
      payload.length === 4 &&
      payload[0] === 0x12 &&
      payload[1] === 0x54 &&
      payload[2] === 0xc3 &&
      payload[3] === 0x67
    ) {
      return true;
    }
  }
  return false;
}

function dropElement(bytes: Uint8Array, element: Element): boolean {
  return (
    element.id === ID_TAGS ||
    element.id === ID_VOID ||
    (element.id === ID_SEEK && seekPointsAtTags(bytes, element))
  );
}

function collectElements(
  bytes: Uint8Array,
  start: number,
  end: number,
  out: [number, number][],
): void {
  for (const element of parseElements(bytes, start, end)) {
    if (element.size === null) {
      if (dropElement(bytes, element)) throw new Error(VIDEO_LEFT);
      if (MASTER.has(element.id)) collectElements(bytes, element.dataStart, element.end, out);
      continue;
    }
    if (dropElement(bytes, element)) {
      out.push([element.start, element.end]);
      continue;
    }
    if (MASTER.has(element.id)) collectElements(bytes, element.dataStart, element.end, out);
  }
}

function hasUnknownSize(bytes: Uint8Array, start: number, end: number): boolean {
  for (const element of parseElements(bytes, start, end)) {
    if (element.size === null) return true;
    if (element.id === ID_TAGS || element.id === ID_VOID) continue;
    if (MASTER.has(element.id) && hasUnknownSize(bytes, element.dataStart, element.end))
      return true;
  }
  return false;
}

function adjustPosition(
  payload: Uint8Array,
  segmentDataStart: number,
  ranges: [number, number][],
): Uint8Array {
  let value = 0;
  for (const byte of payload) value = value * 256 + byte;
  const beforeSegment = removedBefore(segmentDataStart, ranges);
  const beforeTarget = removedBefore(segmentDataStart + value, ranges);
  const next = value - (beforeTarget - beforeSegment);
  if (next < 0) throw new Error(VIDEO_LEFT);
  const out = new Uint8Array(payload.length);
  let rest = next;
  for (let i = payload.length - 1; i >= 0; i -= 1) {
    out[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  if (rest !== 0) throw new Error(VIDEO_LEFT);
  return out;
}

function writeElement(bytes: Uint8Array, element: Element, payload: Uint8Array): Uint8Array {
  if (element.size === null) throw new Error(VIDEO_LEFT);
  const size = encodeSize(payload.length, element.sizeLen);
  if (!size) throw new Error(VIDEO_LEFT);
  return concat([bytes.subarray(element.start, element.start + element.idLen), size, payload]);
}

function rebuildElements(
  bytes: Uint8Array,
  start: number,
  end: number,
  segmentDataStart: number,
  ranges: [number, number][],
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const element of parseElements(bytes, start, end)) {
    if (dropElement(bytes, element)) continue;
    let payload: Uint8Array;
    if (element.id === ID_SEEK_POSITION || element.id === ID_CUE_CLUSTER_POSITION) {
      payload = adjustPosition(
        bytes.subarray(element.dataStart, element.end),
        segmentDataStart,
        ranges,
      );
    } else if (MASTER.has(element.id)) {
      payload = rebuildElements(bytes, element.dataStart, element.end, segmentDataStart, ranges);
    } else {
      payload = bytes.slice(element.dataStart, element.end);
    }
    parts.push(writeElement(bytes, element, payload));
  }
  return concat(parts);
}

function stripWebm(bytes: Uint8Array): Uint8Array {
  const top = parseElements(bytes, 0, bytes.length);
  if (top[0]?.id !== ID_EBML) throw new Error("That file is not a WebM.");
  const segment = top.find((element) => element.id === ID_SEGMENT);
  if (!segment) throw new Error("That file is not a WebM.");
  const ranges: [number, number][] = [];
  collectElements(bytes, 0, bytes.length, ranges);
  if (ranges.length === 0) return bytes.slice();
  if (hasUnknownSize(bytes, 0, bytes.length)) throw new Error(VIDEO_LEFT);
  return rebuildElements(bytes, 0, bytes.length, segment.dataStart, ranges);
}

function stripVideo(bytes: Uint8Array, contentType: string): Uint8Array {
  if (contentType === "video/mp4") return stripMp4(bytes);
  if (contentType === "video/webm") return stripWebm(bytes);
  throw new Error("That video must be an MP4 or a WebM.");
}

export function stripBeforeSeal(
  bytes: Uint8Array,
  kind: "image" | "video",
  contentType: string,
): Uint8Array {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (kind === "image") return stripImageMetadata(bytes, type);
  if (kind === "video") return stripVideo(bytes, type);
  throw new Error("Choose a picture or a video.");
}
