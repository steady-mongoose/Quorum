import { imageBounds, ImageBoundsError, MAX_EDGE, MAX_PIXELS } from "../../src/lib/media/bounds.ts";
import { VIDEO_MS } from "../../src/lib/media/limits.ts";
import { MediaReject } from "./errors.ts";

const ENCODER_COMMENT = /^Lavc[\d.]+$/;
const ENCODER_TOOL = /^Lavf[\d.]+$/;

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function latin1(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}

type Box = { type: string; payload: number; end: number };

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = latin1(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      const high = u32(bytes, offset + 8);
      const low = u32(bytes, offset + 12);
      size = high * 0x100000000 + low;
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > end) break;
    found.push({ type, payload: offset + header, end: offset + size });
    offset += size;
  }
  return found;
}

function walk(bytes: Uint8Array, start: number, end: number, visit: (box: Box) => void): void {
  for (const box of boxes(bytes, start, end)) {
    visit(box);
    if (["moov", "trak", "mdia", "minf", "stbl", "udta", "edts"].includes(box.type)) {
      walk(bytes, box.payload, box.end, visit);
    }
    if (box.type === "meta" && box.payload + 4 <= box.end) {
      walk(bytes, box.payload + 4, box.end, visit);
    }
    if (box.type === "ilst") walk(bytes, box.payload, box.end, visit);
  }
}

function handler(bytes: Uint8Array, box: Box): string {
  if (box.type !== "hdlr" || box.payload + 12 > box.end) return "";
  return latin1(bytes, box.payload + 8, 4);
}

function trackSize(bytes: Uint8Array, box: Box): { width: number; height: number } | null {
  if (box.type !== "tkhd" || box.payload >= box.end) return null;
  const version = bytes[box.payload];
  const widthAt = box.payload + (version === 1 ? 88 : 76);
  if (widthAt + 8 > box.end) return null;
  const width = u32(bytes, widthAt) / 65536;
  const height = u32(bytes, widthAt + 4) / 65536;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  return { width, height };
}

function movieDuration(bytes: Uint8Array, box: Box): number | null {
  if (box.type !== "mvhd" || box.payload + 20 > box.end) return null;
  const version = bytes[box.payload];
  const scaleAt = box.payload + (version === 1 ? 20 : 12);
  const durationAt = scaleAt + 4;
  if (durationAt + (version === 1 ? 8 : 4) > box.end) return null;
  const scale = u32(bytes, scaleAt);
  const duration =
    version === 1
      ? u32(bytes, durationAt) * 0x100000000 + u32(bytes, durationAt + 4)
      : u32(bytes, durationAt);
  if (scale < 1) return null;
  return Math.round((duration / scale) * 1000);
}

function locationText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("gps") ||
    lower.includes("exif") ||
    lower.includes("latitude") ||
    lower.includes("longitude") ||
    lower.includes("iso6709") ||
    lower.includes("location")
  );
}

/**
 * Permanent worker invariant. The sandbox writes result.json and the output
 * file, so a successful sandbox result is not evidence the bytes are safe.
 * processImage and processVideo read the file and call this before anything
 * is stored. Size, JPEG markers, and dimensions come from those bytes.
 */
export function assertKeptJpeg(
  bytes: Uint8Array,
  maxBytes: number,
): { width: number; height: number } {
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw new MediaReject("That picture is too large.");
  }
  let bounds;
  try {
    bounds = imageBounds(bytes, "image/jpeg");
  } catch (error) {
    throw new MediaReject(
      error instanceof ImageBoundsError ? error.message : "That file is not a JPEG.",
    );
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    const payload = bytes.subarray(offset + 2, offset + length);
    if (marker === 0xe1 || marker === 0xed) {
      throw new MediaReject("That picture still has location data.");
    }
    if (marker === 0xfe) {
      const text = latin1(payload, 0, payload.length).replace(/\0+$/, "");
      if (locationText(text) || !ENCODER_COMMENT.test(text)) {
        throw new MediaReject("That picture still has location data.");
      }
    }
    offset += length;
  }
  if (
    bounds.width > MAX_EDGE ||
    bounds.height > MAX_EDGE ||
    bounds.width * bounds.height > MAX_PIXELS
  ) {
    throw new MediaReject("That picture is too large.");
  }
  return { width: bounds.width, height: bounds.height };
}

/**
 * MP4 size, ftyp, track dimensions, duration, and user metadata. Encoder
 * tags (Lavf / Lavc) may remain. Location, title, and chapter boxes may not.
 */
export function assertKeptMp4(
  bytes: Uint8Array,
  maxBytes: number,
): { width: number; height: number; durationMs: number } {
  if (bytes.byteLength < 12 || bytes.byteLength > maxBytes) {
    throw new MediaReject("That video is too large.");
  }
  if (latin1(bytes, 4, 4) !== "ftyp") throw new MediaReject("That video is not an MP4.");
  const top = boxes(bytes, 0, bytes.length);
  const moov = top.find((box) => box.type === "moov");
  if (!moov) throw new MediaReject("That video is not an MP4.");
  const moovText = latin1(bytes, moov.payload, moov.end - moov.payload);
  if (locationText(moovText)) throw new MediaReject("That video still has location data.");
  let durationMs: number | null = null;
  let width = 0;
  let height = 0;
  let videoTracks = 0;
  const trakBoxes = boxes(bytes, moov.payload, moov.end).filter((box) => box.type === "trak");
  walk(bytes, moov.payload, moov.end, (box) => {
    if (box.type === "mvhd") durationMs = movieDuration(bytes, box);
    if (box.type === "ilst") {
      for (const child of boxes(bytes, box.payload, box.end)) {
        if (child.type !== "\xa9too") {
          throw new MediaReject("That video still has location data.");
        }
        const data = boxes(bytes, child.payload, child.end).find((item) => item.type === "data");
        const tool = data
          ? latin1(bytes, data.payload + 8, data.end - data.payload - 8).replace(/\0+$/, "")
          : "";
        if (!ENCODER_TOOL.test(tool)) throw new MediaReject("That video still has location data.");
      }
    }
  });
  for (const trak of trakBoxes) {
    const found = { video: false, width: 0, height: 0 };
    walk(bytes, trak.payload, trak.end, (box) => {
      if (handler(bytes, box) === "vide") found.video = true;
      const frame = trackSize(bytes, box);
      if (frame && (frame.width > 0 || frame.height > 0)) {
        found.width = frame.width;
        found.height = frame.height;
      }
    });
    if (!found.video) continue;
    videoTracks += 1;
    width = found.width;
    height = found.height;
  }
  if (videoTracks !== 1 || width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) {
    throw new MediaReject("That video is too large.");
  }
  if (width * height > MAX_PIXELS) throw new MediaReject("That video is too large.");
  if (durationMs === null || durationMs < 1) throw new MediaReject("That video has no duration.");
  if (durationMs > VIDEO_MS) throw new MediaReject("That video is longer than 60 seconds.");
  return { width, height, durationMs };
}
