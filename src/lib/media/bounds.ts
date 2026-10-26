/** Pixel and frame caps. These run before ffmpeg allocates a decoded frame. */

export const MAX_PIXELS = 50_000_000;
export const MAX_EDGE = 8192;
export const MAX_GIF_FRAMES = 300;

export class ImageBoundsError extends Error {}

export type ImageBounds = { width: number; height: number; frames: number };

function u16(bytes: Uint8Array, offset: number, little: boolean): number {
  if (offset + 2 > bytes.length) throw new ImageBoundsError("That picture is cut off.");
  return little
    ? bytes[offset]! | (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new ImageBoundsError("That picture is cut off.");
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function accept(width: number, height: number, frames: number): ImageBounds {
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) {
    throw new ImageBoundsError("That picture is too large.");
  }
  if (width * height > MAX_PIXELS || frames < 1 || frames > MAX_GIF_FRAMES) {
    throw new ImageBoundsError("That picture is too large.");
  }
  return { width, height, frames };
}

function jpegBounds(bytes: Uint8Array): ImageBounds {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new ImageBoundsError("That file is not a JPEG.");
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new ImageBoundsError("That file is not a JPEG.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    const length = u16(bytes, offset, false);
    if (length < 2 || offset + length > bytes.length)
      throw new ImageBoundsError("That file is not a JPEG.");
    const startOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (startOfFrame) {
      return accept(u16(bytes, offset + 5, false), u16(bytes, offset + 3, false), 1);
    }
    if (marker === 0xda) break;
    offset += length;
  }
  throw new ImageBoundsError("That file is not a JPEG.");
}

function pngBounds(bytes: Uint8Array): ImageBounds {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((value, index) => bytes[index] !== value)) {
    throw new ImageBoundsError("That file is not a PNG.");
  }
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new ImageBoundsError("That file is not a PNG.");
  }
  return accept(u32(bytes, 16), u32(bytes, 20), 1);
}

function webpBounds(bytes: Uint8Array): ImageBounds {
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") throw new ImageBoundsError("That file is not a WebP.");
  const fourcc = String.fromCharCode(...bytes.subarray(12, 16));
  if (fourcc === "VP8X") {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return accept(width, height, 1);
  }
  if (fourcc === "VP8 ") {
    const start = 20;
    if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      throw new ImageBoundsError("That file is not a WebP.");
    }
    const width = (bytes[start + 6]! | (bytes[start + 7]! << 8)) & 0x3fff;
    const height = (bytes[start + 8]! | (bytes[start + 9]! << 8)) & 0x3fff;
    return accept(width, height, 1);
  }
  if (fourcc === "VP8L") {
    if (bytes[20] !== 0x2f) throw new ImageBoundsError("That file is not a WebP.");
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return accept(width, height, 1);
  }
  throw new ImageBoundsError("That file is not a WebP.");
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const size = bytes[offset]!;
    offset += 1;
    if (size === 0) return offset;
    offset += size;
    if (offset > bytes.length) throw new ImageBoundsError("That file is not a GIF.");
  }
  throw new ImageBoundsError("That file is not a GIF.");
}

function gifBounds(bytes: Uint8Array): ImageBounds {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a")
    throw new ImageBoundsError("That file is not a GIF.");
  const width = u16(bytes, 6, true);
  const height = u16(bytes, 8, true);
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      offset += 2;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      if (frames > MAX_GIF_FRAMES) throw new ImageBoundsError("That picture is too large.");
      const local = bytes[offset + 9] ?? 0;
      offset += 10;
      if (local & 0x80) offset += 3 * (1 << ((local & 0x07) + 1));
      offset += 1;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    throw new ImageBoundsError("That file is not a GIF.");
  }
  return accept(width, height, frames);
}

export function imageBounds(bytes: Uint8Array, contentType: string): ImageBounds {
  if (contentType === "image/jpeg") return jpegBounds(bytes);
  if (contentType === "image/png") return pngBounds(bytes);
  if (contentType === "image/webp") return webpBounds(bytes);
  if (contentType === "image/gif") return gifBounds(bytes);
  throw new ImageBoundsError("Choose a JPEG, PNG, WebP, or GIF.");
}
