import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { MediaReject } from "./errors.ts";
import { createFfmpegTools } from "./ffmpeg.ts";
import { assertKeptJpeg, assertKeptMp4 } from "./output.ts";

function bytesOf(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(8 + payload.length), ascii(type), payload);
}

function jpeg(options?: {
  width?: number;
  height?: number;
  comment?: string | null;
  app1?: boolean;
}): Uint8Array {
  const width = options?.width ?? 8;
  const height = options?.height ?? 8;
  const parts: number[] = [0xff, 0xd8];
  if (options?.app1) {
    const payload = [...ascii("Exif\0\0")];
    parts.push(0xff, 0xe1, ...u16(payload.length + 2), ...payload);
  }
  const comment = options?.comment === undefined ? "Lavc60.31.102" : options.comment;
  if (comment) {
    const payload = [...ascii(comment)];
    parts.push(0xff, 0xfe, ...u16(payload.length + 2), ...payload);
  }
  const sof = [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0];
  parts.push(0xff, 0xc0, ...u16(sof.length + 2), ...sof, 0xff, 0xd9);
  return bytesOf(parts);
}

function mvhd(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(100);
  new DataView(payload.buffer).setUint32(12, timescale);
  new DataView(payload.buffer).setUint32(16, duration);
  return box("mvhd", payload);
}

function tkhd(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  view.setUint32(76, width * 65536);
  view.setUint32(80, height * 65536);
  return box("tkhd", payload);
}

function hdlr(kind: string): Uint8Array {
  const payload = new Uint8Array(25);
  payload.set(ascii(kind), 8);
  return box("hdlr", payload);
}

function toolBox(type: string, tool: string): Uint8Array {
  const value = ascii(tool);
  const payload = new Uint8Array(8 + value.length);
  payload.set(value, 8);
  return box(type, box("data", payload));
}

function movie(
  udtaPayload: Uint8Array,
  options?: { duration?: number; width?: number },
): Uint8Array {
  const trak = box("trak", concat(tkhd(options?.width ?? 64, 64), box("mdia", hdlr("vide"))));
  const moov = box(
    "moov",
    concat(mvhd(1000, options?.duration ?? 1000), trak, box("udta", udtaPayload)),
  );
  return concat(box("ftyp", concat(ascii("isom"), new Uint8Array(4), ascii("mp41"))), moov);
}

function keptMovie(): Uint8Array {
  return movie(box("ilst", toolBox("\xa9too", "Lavf59.27.100")));
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("a kept JPEG has a size, a type, and dimensions, and no location markers", () => {
  const kept = assertKeptJpeg(jpeg(), 8 * 1024 * 1024);
  assert.deepEqual(kept, { width: 8, height: 8 });
  assert.throws(() => assertKeptJpeg(jpeg({ app1: true }), 8 * 1024 * 1024), /location/);
  assert.throws(() => assertKeptJpeg(jpeg({ comment: "GPSLatitude" }), 1024), /location/);
  assert.throws(() => assertKeptJpeg(jpeg(), 4), /too large/);
  assert.throws(() => assertKeptJpeg(jpeg({ width: 9000, height: 8 }), 1024), /too large/);
});

test("a kept MP4 is one video track with no location metadata", () => {
  const kept = assertKeptMp4(keptMovie(), 32 * 1024 * 1024);
  assert.deepEqual(kept, { width: 64, height: 64, durationMs: 1000 });
  const gps = movie(
    concat(box("ilst", toolBox("\xa9too", "Lavf59.27.100")), box("free", ascii("GPSLatitude"))),
  );
  assert.throws(() => assertKeptMp4(gps, 32 * 1024 * 1024), /location/);
  const titled = movie(box("ilst", toolBox("\xa9xyz", "+37.0000-122.0000/")));
  assert.throws(() => assertKeptMp4(titled, 32 * 1024 * 1024), /location/);
  assert.throws(() => assertKeptMp4(box("moov", mvhd(1000, 1000)), 1024), /not an MP4/);
  assert.throws(
    () =>
      assertKeptMp4(
        movie(box("ilst", toolBox("\xa9too", "Lavf59.27.100")), { duration: 120_000 }),
        1024,
      ),
    /60 seconds/,
  );
});

test("a sandbox success cannot bypass the output re-check", async () => {
  const tools = createFfmpegTools(async (command, args) => {
    if (args.includes("-version")) return { code: 0, stdout: "ffmpeg", stderr: "" };
    const output = args.at(-1) ?? "";
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 32, height: 32 }],
          format: { duration: "5" },
        }),
        stderr: "",
      };
    }
    if (output.endsWith(".mp4")) await writeFile(output, keptMovie());
    else await writeFile(output, jpeg());
    return { code: 0, stdout: "", stderr: "" };
  });
  const header = box("ftyp", ascii("isom"));
  const movieResult = await tools.processVideo(header);
  assert.equal(movieResult.durationMs, 1000);
  assert.equal(movieResult.fileType, "video/mp4");

  const rejecting = createFfmpegTools(async (command, args) => {
    if (args.includes("-version")) return { code: 0, stdout: "ffmpeg", stderr: "" };
    const output = args.at(-1) ?? "";
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 64, height: 64 }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
    }
    await writeFile(output, output.endsWith(".jpg") ? jpeg({ app1: true }) : keptMovie());
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => rejecting.processImage(png(2, 2), "image/png"),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /location/);
      return true;
    },
  );

  const gps = movie(
    concat(box("ilst", toolBox("\xa9too", "Lavf59.27.100")), box("free", ascii("GPSLatitude"))),
  );
  const tagged = createFfmpegTools(async (command, args) => {
    if (args.includes("-version")) return { code: 0, stdout: "ffmpeg", stderr: "" };
    const output = args.at(-1) ?? "";
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 64, height: 64 }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
    }
    await writeFile(output, output.endsWith(".mp4") ? gps : jpeg());
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(() => tagged.processVideo(header), /location/);

  const dirtyThumb = createFfmpegTools(async (command, args) => {
    if (args.includes("-version")) return { code: 0, stdout: "ffmpeg", stderr: "" };
    const output = args.at(-1) ?? "";
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 64, height: 64 }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
    }
    await writeFile(output, output.endsWith(".mp4") ? keptMovie() : jpeg({ app1: true }));
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(() => dirtyThumb.processVideo(header), /location/);
});
