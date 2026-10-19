import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageBounds, ImageBoundsError } from "../../src/lib/media/bounds.ts";
import { VIDEO_MS } from "../../src/lib/media/limits.ts";
import { sniffVideo, type VideoContainer } from "../../src/lib/media/sniff.ts";
import { MediaReject } from "./errors.ts";

export type CommandResult = { code: number; stdout: string; stderr: string; missing?: boolean };
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export const FFMPEG_TIMEOUT_MS = 60_000;
export const FFMPEG_AS_BYTES = 384 * 1024 * 1024;
export const FFMPEG_CPU_SECONDS = 90;
export const FFMPEG_FILE_BYTES = 64 * 1024 * 1024;
export const FFMPEG_MAX_PIXELS = 50_000_000;

const IMAGE_FORMAT: Record<string, string> = {
  "image/jpeg": "mjpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const VIDEO_CODECS: Record<VideoContainer, readonly string[]> = {
  mp4: ["h264", "hevc", "mpeg4"],
  webm: ["vp8", "vp9", "av1"],
};
const AUDIO_CODECS: Record<VideoContainer, readonly string[]> = {
  mp4: ["aac", "mp3"],
  webm: ["opus", "vorbis"],
};

function inputGuard(format: string, input: string): string[] {
  // `-safe` belongs to the concat demuxer. Forcing `-f mp4` or `-f webm`
  // means that demuxer is not used, and ffmpeg rejects `-safe` on these.
  return [
    "-nostdin",
    "-max_alloc",
    "67108864",
    "-y",
    "-protocol_whitelist",
    "file",
    "-f",
    format,
    "-max_pixels",
    String(FFMPEG_MAX_PIXELS),
    "-i",
    input,
  ];
}

export function imageFileArgs(input: string, output: string, format: string): string[] {
  return [
    ...inputGuard(format, input),
    "-map",
    "0:v:0",
    "-map_metadata",
    "-1",
    "-frames:v",
    "1",
    "-vf",
    "scale='min(1280,iw)':-2",
    "-fs",
    String(FFMPEG_FILE_BYTES),
    output,
  ];
}

export function thumbArgs(input: string, output: string, format: string): string[] {
  return [
    ...inputGuard(format, input),
    "-map",
    "0:v:0",
    "-map_metadata",
    "-1",
    "-vf",
    "scale='min(480,iw)':-2",
    "-frames:v",
    "1",
    "-fs",
    String(FFMPEG_FILE_BYTES),
    output,
  ];
}

export function videoFileArgs(input: string, output: string, format: string): string[] {
  return [
    ...inputGuard(format, input),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-dn",
    "-sn",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-fs",
    String(FFMPEG_FILE_BYTES),
    output,
  ];
}

export function probeArgs(input: string, format: string): string[] {
  return [
    "-v",
    "error",
    "-protocol_whitelist",
    "file",
    "-f",
    format,
    "-max_pixels",
    String(FFMPEG_MAX_PIXELS),
    "-show_entries",
    "stream=codec_type,codec_name:format=duration",
    "-of",
    "json",
    input,
  ];
}

/**
 * ffmpeg and ffprobe run with no network namespace, a CPU cap, and an address
 * cap. A hang is SIGKILL'd. Tests pass their own runner and skip this wrapper.
 */
export function isolatedCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return {
    command: "unshare",
    args: [
      "--user",
      "--map-root-user",
      "--net",
      "--",
      "prlimit",
      `--as=${FFMPEG_AS_BYTES}`,
      `--cpu=${FFMPEG_CPU_SECONDS}`,
      `--fsize=${FFMPEG_FILE_BYTES}`,
      "--nproc=32",
      "--",
      command,
      ...args,
    ],
  };
}

export function spawnCommand(
  command: string,
  args: string[],
  timeoutMs = FFMPEG_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 65_536) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: 127, stdout, stderr: error.message, missing: error.code === "ENOENT" });
    });
    child.on("close", (code) => {
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isolatedRunner(command: string, args: string[]): Promise<CommandResult> {
  const wrapped = isolatedCommand(command, args);
  return spawnCommand(wrapped.command, wrapped.args);
}

export type ImageResult = {
  file: Uint8Array;
  fileType: string;
  thumb: Uint8Array;
  thumbType: string;
};

export type VideoResult = ImageResult & { durationMs: number };

export type MediaTools = {
  processImage(bytes: Uint8Array, contentType: string): Promise<ImageResult>;
  processVideo(bytes: Uint8Array): Promise<VideoResult>;
};

async function withTemp(
  extension: string,
  bytes: Uint8Array,
  run: (input: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "avouch-media-"));
  try {
    const input = join(dir, `in.${extension}`);
    await writeFile(input, bytes);
    await run(input, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

type Probe = {
  durationMs: number;
  streams: Array<{ codec_type?: string; codec_name?: string }>;
};

function readProbe(stdout: string, container: VideoContainer): Probe {
  let parsed: { streams?: Probe["streams"]; format?: { duration?: string } };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new MediaReject("That video could not be read.");
  }
  const streams = parsed.streams ?? [];
  const video = streams.filter((stream) => stream.codec_type === "video");
  if (video.length !== 1 || !VIDEO_CODECS[container].includes(video[0]?.codec_name ?? "")) {
    throw new MediaReject("That video uses a codec this box does not accept.");
  }
  for (const stream of streams) {
    if (stream.codec_type !== "audio") continue;
    if (!AUDIO_CODECS[container].includes(stream.codec_name ?? "")) {
      throw new MediaReject("That video uses a codec this box does not accept.");
    }
  }
  const seconds = Number(parsed.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new MediaReject("That video has no duration.");
  }
  return { durationMs: Math.round(seconds * 1000), streams };
}

/**
 * Every room file is re-encoded. The original bytes are never stored as the
 * file members download. ffmpeg is required; a missing binary is a refusal.
 */
export function createFfmpegTools(runner: CommandRunner = isolatedRunner): MediaTools {
  let available: Promise<boolean> | null = null;
  const hasFfmpeg = () => {
    available ??= runner("ffmpeg", ["-version"]).then(
      (result) => result.code === 0 && !result.missing,
    );
    return available;
  };

  return {
    async processImage(bytes, contentType) {
      let bounds;
      try {
        bounds = imageBounds(bytes, contentType);
      } catch (error) {
        throw new MediaReject(
          error instanceof ImageBoundsError
            ? error.message
            : "That file is not a picture we can keep.",
        );
      }
      if (bounds.width * bounds.height > FFMPEG_MAX_PIXELS) {
        throw new MediaReject("That picture is too large.");
      }
      const format = IMAGE_FORMAT[contentType];
      if (!format) throw new MediaReject("Choose a JPEG, PNG, WebP, or GIF.");
      if (!(await hasFfmpeg())) {
        throw new MediaReject("Picture processing needs ffmpeg on the box.");
      }
      let file = new Uint8Array();
      let thumb = new Uint8Array();
      await withTemp(format === "mjpeg" ? "jpg" : format, bytes, async (input, dir) => {
        const filePath = join(dir, "file.jpg");
        const thumbPath = join(dir, "thumb.jpg");
        const fileRun = await runner("ffmpeg", imageFileArgs(input, filePath, format));
        if (fileRun.missing) throw new MediaReject("Picture processing needs ffmpeg on the box.");
        if (fileRun.code !== 0) throw new Error("ffmpeg could not prepare that picture.");
        const thumbRun = await runner("ffmpeg", thumbArgs(input, thumbPath, format));
        if (thumbRun.code !== 0) throw new Error("ffmpeg could not make a thumbnail.");
        file = new Uint8Array(await readFile(filePath));
        thumb = new Uint8Array(await readFile(thumbPath));
      });
      if (file.byteLength < 1 || sameBytes(file, bytes)) {
        throw new MediaReject("That picture could not be prepared.");
      }
      return { file, fileType: "image/jpeg", thumb, thumbType: "image/jpeg" };
    },
    async processVideo(bytes) {
      const container = sniffVideo(bytes);
      if (!container) throw new MediaReject("That video is not an MP4 or a WebM.");
      if (!(await hasFfmpeg())) {
        throw new MediaReject("Video processing needs ffmpeg on the box.");
      }
      const format = container === "mp4" ? "mp4" : "matroska,webm";
      let durationMs = 0;
      let file = new Uint8Array();
      let thumb = new Uint8Array();
      await withTemp(container, bytes, async (input, dir) => {
        const probed = await runner("ffprobe", probeArgs(input, format));
        if (probed.missing || probed.code !== 0) {
          throw new MediaReject("That video could not be read.");
        }
        const probe = readProbe(probed.stdout, container);
        if (probe.durationMs > VIDEO_MS)
          throw new MediaReject("That video is longer than 60 seconds.");
        durationMs = probe.durationMs;
        const filePath = join(dir, "file.mp4");
        const thumbPath = join(dir, "thumb.jpg");
        const encoded = await runner("ffmpeg", videoFileArgs(input, filePath, format));
        if (encoded.code !== 0) throw new Error("ffmpeg could not prepare that video.");
        const poster = await runner("ffmpeg", thumbArgs(input, thumbPath, format));
        if (poster.code !== 0) throw new Error("ffmpeg could not make a thumbnail.");
        file = new Uint8Array(await readFile(filePath));
        thumb = new Uint8Array(await readFile(thumbPath));
      });
      if (file.byteLength < 1 || sameBytes(file, bytes)) {
        throw new MediaReject("That video could not be prepared.");
      }
      return { file, fileType: "video/mp4", thumb, thumbType: "image/jpeg", durationMs };
    },
  };
}
