import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import {
  FFMPEG_AS_BYTES,
  imageDemuxer,
  imageFileArgs,
  limitedCommand,
  probeArgs,
  spawnCommand,
  thumbArgs,
  videoFileArgs,
  createFfmpegTools,
  type CommandRunner,
} from "./ffmpeg.ts";
import { MediaReject } from "./errors.ts";

function ftyp(): Uint8Array {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, 16);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4);
  return bytes;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("ffmpeg commands force a local format and drop chapters and side streams", () => {
  assert.equal(imageDemuxer("image/png"), "png_pipe");
  assert.equal(imageDemuxer("image/webp"), "webp_pipe");
  assert.equal(imageDemuxer("image/jpeg"), "mjpeg");
  assert.equal(imageDemuxer("image/gif"), "gif");
  const image = imageFileArgs("in.png", "out.jpg", "png_pipe");
  assert.equal(image.includes("-protocol_whitelist"), true);
  assert.equal(image[image.indexOf("-protocol_whitelist") + 1], "file");
  assert.equal(image[image.indexOf("-f") + 1], "png_pipe");
  assert.equal(image[image.indexOf("-threads") + 1], "1");
  assert.equal(image[image.indexOf("-update") + 1], "1");
  assert.equal(image[image.indexOf("-max_pixels") + 1], "50000000");
  assert.equal(image[image.indexOf("-fs") + 1], "67108864");
  assert.equal(image.includes("-map_metadata"), true);
  assert.ok(thumbArgs("in.png", "thumb.jpg", "png_pipe").includes("-frames:v"));
  const video = videoFileArgs("in.mp4", "out.mp4", "mp4");
  assert.equal(video.includes("-update"), false);
  assert.equal(video[video.indexOf("-threads") + 1], "1");
  assert.deepEqual(video.filter((arg) => arg === "-map" || arg.startsWith("0:")).slice(0, 4), [
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
  ]);
  assert.equal(video.includes("-map_chapters"), true);
  assert.equal(video[video.indexOf("-map_chapters") + 1], "-1");
  assert.equal(video.includes("-dn"), true);
  assert.equal(video.includes("-sn"), true);
  assert.equal(video[video.indexOf("-max_pixels") + 1], "50000000");
  assert.equal(video[video.indexOf("-fs") + 1], "67108864");
  assert.equal(video.includes("-map_metadata"), true);
  const probe = probeArgs("in.mp4", "mp4");
  assert.equal(probe.includes("-protocol_whitelist"), true);
  assert.equal(probe[probe.indexOf("-threads") + 1], "1");
});

test("ffmpeg is capped without unshare, which Docker seccomp would block", () => {
  const wrapped = limitedCommand("ffmpeg", ["-version"]);
  assert.equal(wrapped.command, "prlimit");
  assert.equal(wrapped.args.includes("unshare"), false);
  assert.equal(wrapped.args.includes("--net"), false);
  assert.ok(wrapped.args.some((arg) => arg === `--as=${FFMPEG_AS_BYTES}`));
  assert.equal(wrapped.args.includes("--nproc=32"), true);
  assert.equal(wrapped.args.at(-2), "ffmpeg");
  assert.equal(wrapped.args.at(-1), "-version");
});

test("a command that runs too long is killed", async () => {
  const started = Date.now();
  const result = await spawnCommand("sleep", ["30"], 400);
  assert.ok(Date.now() - started < 5_000);
  assert.notEqual(result.code, 0);
});

test("pictures are refused when ffmpeg is not installed", async () => {
  const runner: CommandRunner = async () => ({
    code: 127,
    stdout: "",
    stderr: "missing",
    missing: true,
  });
  const tools = createFfmpegTools(runner);
  await assert.rejects(
    () => tools.processImage(png(2, 2), "image/png"),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /ffmpeg/);
      return true;
    },
  );
});

test("an image over 50 megapixels is refused before ffmpeg", async () => {
  let calls = 0;
  const tools = createFfmpegTools(async () => {
    calls += 1;
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => tools.processImage(png(10_000, 10_000), "image/png"),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /too large/);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("a playlist uploaded as MP4 is rejected", async () => {
  let calls = 0;
  const tools = createFfmpegTools(async () => {
    calls += 1;
    return { code: 0, stdout: "ffmpeg", stderr: "" };
  });
  const playlist = new TextEncoder().encode("#EXTM3U\nhttp://169.254.169.254/latest/meta-data/\n");
  await assert.rejects(
    () => tools.processVideo(playlist),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /MP4 or a WebM/);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("video is refused when ffmpeg is not installed", async () => {
  const runner: CommandRunner = async () => ({
    code: 127,
    stdout: "",
    stderr: "missing",
    missing: true,
  });
  const tools = createFfmpegTools(runner);
  await assert.rejects(
    () => tools.processVideo(ftyp()),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /ffmpeg/);
      return true;
    },
  );
});

test("a video over 60 seconds is refused after probing", async () => {
  const tools = createFfmpegTools(async (command, args) => {
    if (args[0] === "-version") return { code: 0, stdout: "ffmpeg", stderr: "" };
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 64, height: 64 }],
          format: { duration: "90" },
        }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => tools.processVideo(ftyp()),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /60 seconds/);
      return true;
    },
  );
});

test("a video whose frame is too large is refused before decoding", async () => {
  const ffmpegArgs: string[][] = [];
  const tools = createFfmpegTools(async (command, args) => {
    if (command === "ffmpeg") ffmpegArgs.push(args);
    if (args[0] === "-version") return { code: 0, stdout: "ffmpeg", stderr: "" };
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", width: 8000, height: 8000 }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => tools.processVideo(ftyp()),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /too large/);
      return true;
    },
  );
  assert.deepEqual(
    ffmpegArgs.map((args) => args[0]),
    ["-version"],
  );
});

test("a sandbox that is down is not reported as a missing ffmpeg", async () => {
  const tools = createFfmpegTools(async () => ({
    code: 1,
    stdout: "",
    stderr: "unshare: Operation not permitted",
    sandboxDown: true,
  }));
  await assert.rejects(
    () => tools.processVideo(ftyp()),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /sandbox is unavailable/);
      assert.equal(error.message.includes("needs ffmpeg"), false);
      return true;
    },
  );
});

test("a video codec outside the allowlist is refused", async () => {
  const tools = createFfmpegTools(async (command, args) => {
    if (args[0] === "-version") return { code: 0, stdout: "ffmpeg", stderr: "" };
    if (command === "ffprobe") {
      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "ansi" }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => tools.processVideo(ftyp()),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /codec/);
      return true;
    },
  );
});

test("a transcode drops chapters, data, and subtitles", async () => {
  const version = await spawnCommand("ffmpeg", ["-version"], 5_000);
  assert.equal(version.missing, undefined);
  assert.equal(version.code, 0);
  const dir = await mkdtemp(join(tmpdir(), "avouch-ffmpeg-"));
  try {
    const source = join(dir, "source.mp4");
    const chapter = join(dir, "chapters.txt");
    const subtitle = join(dir, "note.srt");
    const tagged = join(dir, "tagged.mp4");
    const output = join(dir, "out.mp4");
    await writeFile(
      chapter,
      ";FFMETADATA1\ntitle=secret-place\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=500\ntitle=intro\n",
    );
    await writeFile(subtitle, "1\n00:00:00,000 --> 00:00:00,500\nGPSLatitude\n");
    const built = await spawnCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=1",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono:d=1",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        source,
      ],
      20_000,
    );
    assert.equal(built.code, 0, built.stderr);
    const withSide = await spawnCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        source,
        "-i",
        chapter,
        "-i",
        subtitle,
        "-map",
        "0",
        "-map",
        "2",
        "-map_metadata",
        "1",
        "-c",
        "copy",
        "-c:s",
        "mov_text",
        tagged,
      ],
      20_000,
    );
    assert.equal(withSide.code, 0, withSide.stderr);
    const encoded = await spawnCommand("ffmpeg", videoFileArgs(tagged, output, "mp4"), 20_000);
    assert.equal(encoded.code, 0, encoded.stderr);
    const probed = await spawnCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type:format_tags:chapter",
        "-of",
        "json",
        output,
      ],
      10_000,
    );
    assert.equal(probed.code, 0, probed.stderr);
    const body = JSON.parse(probed.stdout) as {
      streams?: Array<{ codec_type?: string }>;
      chapters?: unknown[];
      format?: { tags?: Record<string, string> };
    };
    const types = (body.streams ?? []).map((stream) => stream.codec_type);
    assert.deepEqual(types.filter((type) => type === "video").length, 1);
    assert.equal(types.includes("data"), false);
    assert.equal(types.includes("subtitle"), false);
    assert.equal((body.chapters ?? []).length, 0);
    assert.equal(JSON.stringify(body).includes("secret-place"), false);
    assert.equal(JSON.stringify(body).includes("GPSLatitude"), false);
    const bytes = new Uint8Array(await readFile(output));
    const original = new Uint8Array(await readFile(tagged));
    assert.equal(bytes.byteLength > 0, true);
    assert.equal(Buffer.from(bytes).equals(Buffer.from(original)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function realPng(): Buffer {
  const width = 8;
  const height = 8;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw[y * stride + 1 + x * 3] = 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a png is re-encoded with the pipe demuxer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "avouch-png-"));
  try {
    const input = join(dir, "in.png");
    const output = join(dir, "out.jpg");
    await writeFile(input, realPng());
    const demuxer = imageDemuxer("image/png");
    assert.equal(demuxer, "png_pipe");
    const encoded = await spawnCommand(
      "ffmpeg",
      imageFileArgs(input, output, demuxer ?? "png_pipe"),
      20_000,
    );
    assert.equal(encoded.code, 0, encoded.stderr);
    const jpeg = await readFile(output);
    assert.equal(jpeg[0], 0xff);
    assert.equal(jpeg[1], 0xd8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
