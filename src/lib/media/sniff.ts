/** Container check before ffmpeg sees the bytes. A playlist is not a video. */

export type VideoContainer = "mp4" | "webm";

const FTYP = [0x66, 0x74, 0x79, 0x70];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(bytes: Uint8Array, magic: number[], offset: number): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((value, index) => bytes[offset + index] === value);
}

/** MP4 `ftyp` at byte 4, or a WebM EBML header. Anything else is refused. */
export function sniffVideo(bytes: Uint8Array): VideoContainer | null {
  if (startsWith(bytes, FTYP, 4)) return "mp4";
  if (startsWith(bytes, EBML, 0)) return "webm";
  return null;
}
