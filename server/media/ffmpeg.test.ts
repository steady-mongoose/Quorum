import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FFMPEG_AS_BYTES,
  imageFileArgs,
  isolatedCommand,
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
  const image = imageFileArgs("in.png", "out.jpg", "png");
  assert.equal(image.includes("-protocol_whitelist"), true);
  assert.equal(image[image.indexOf("-protocol_whitelist") + 1], "file");
  assert.equal(image[image.indexOf("-f") + 1], "png");
  assert.equal(image[image.indexOf("-max_pixels") + 1], "50000000");
  assert.equal(image[image.indexOf("-fs") + 1], "67108864");
  assert.equal(image.includes("-map_metadata"), true);
  assert.ok(thumbArgs("in.png", "thumb.jpg", "png").includes("-frames:v"));
  const video = videoFileArgs("in.mp4", "out.mp4", "mp4");
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
  assert.equal(probeArgs("in.mp4", "mp4").includes("-protocol_whitelist"), true);
});

test("ffmpeg runs with no network and a memory cap", () => {
  const wrapped = isolatedCommand("ffmpeg", ["-version"]);
  assert.equal(wrapped.command, "unshare");
  assert.equal(wrapped.args.includes("--net"), true);
  assert.equal(wrapped.args.includes("--map-root-user"), true);
  assert.ok(wrapped.args.some((arg) => arg === `--as=${FFMPEG_AS_BYTES}`));
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
          streams: [{ codec_type: "video", codec_name: "h264" }],
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
