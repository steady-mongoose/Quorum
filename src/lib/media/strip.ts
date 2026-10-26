/**
 * Remove EXIF, XMP, comments, and other metadata that can carry a location.
 * The bytes that remain are the picture. This runs in the media worker for
 * room pictures, and on the device before a message picture is encrypted.
 */

const JPEG_ERROR = "That file is not a JPEG.";
const PNG_ERROR = "That file is not a PNG.";
const WEBP_ERROR = "That file is not a WebP.";
const GIF_ERROR = "That file is not a GIF.";

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
    // Restart markers have no length.
    if (marker >= 0xd0 && marker <= 0xd7) {
      parts.push(bytes.subarray(i, markerAt + 1));
      i = markerAt + 1;
      continue;
    }
    // The scan follows the start-of-scan header. Metadata is before that.
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      return concat(parts);
    }
    if (markerAt + 3 >= bytes.length) throw new Error(JPEG_ERROR);
    const length = (bytes[markerAt + 1] << 8) | bytes[markerAt + 2];
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) throw new Error(JPEG_ERROR);
    // Keep JFIF (APP0) and Adobe (APP14). Drop every other APP segment and comments.
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
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value))
    throw new Error(PNG_ERROR);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 8 <= bytes.length) {
    const length =
      ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
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
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
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
    if (id === "VP8X" && chunk.length >= 9) {
      // Clear the EXIF (0x08) and XMP (0x04) feature bits. The chunk stays 10 bytes.
      chunk[8] = chunk[8] & ~0x0c;
    }
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
    const size = bytes[i];
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
  const packed = bytes[10];
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
      const local = bytes[i + 9] & 0x80 ? 3 * (2 << (bytes[i + 9] & 0x07)) : 0;
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
        // XMP and ICC can carry a location. Animation loop blocks stay.
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
