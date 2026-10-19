import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageBounds, ImageBoundsError, MAX_EDGE, MAX_PIXELS } from "../../src/lib/media/bounds.ts";
import { VIDEO_MS } from "../../src/lib/media/limits.ts";
import { sniffVideo, type VideoContainer } from "../../src/lib/media/sniff.ts";
import { MediaReject } from "./errors.ts";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  missing?: boolean;
  sandboxDown?: boolean;
};
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export const FFMPEG_TIMEOUT_MS = 60_000;
export const FFMPEG_AS_BYTES = 384 * 1024 * 1024;
export const FFMPEG_CPU_SECONDS = 90;
export const FFMPEG_FILE_BYTES = 64 * 1024 * 1024;
export const FFMPEG_MAX_PIXELS = MAX_PIXELS;

/**
 * Demuxer names that exist on Debian ffmpeg 5.1 and on ffmpeg 6.
 * `png` and `webp` are not demuxers there; forcing them makes every picture fail.
 */
const IMAGE_INPUT: Record<string, { demuxer: string; extension: string }> = {
  "image/jpeg": { demuxer: "mjpeg", extension: "jpg" },
  "image/png": { demuxer: "png_pipe", extension: "png" },
  "image/webp": { demuxer: "webp_pipe", extension: "webp" },
  "image/gif": { demuxer: "gif", extension: "gif" },
};

export function imageDemuxer(contentType: string): string | undefined {
  return IMAGE_INPUT[contentType]?.demuxer;
}

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
  // One thread: under `prlimit --nproc` the auto thread pool cannot open
  // the decoder (pthread_create returns EAGAIN).
  return [
    "-nostdin",
    "-threads",
    "1",
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
    "-threads",
    "1",
    "-fs",
    String(FFMPEG_FILE_BYTES),
    "-update",
    "1",
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
    "-threads",
    "1",
    "-fs",
    String(FFMPEG_FILE_BYTES),
    "-update",
    "1",
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
    "-threads",
    "1",
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
    "-threads",
    "1",
    "-protocol_whitelist",
    "file",
    "-f",
    format,
    "-max_pixels",
    String(FFMPEG_MAX_PIXELS),
    "-show_entries",
    "stream=codec_type,codec_name,width,height:format=duration",
    "-of",
    "json",
    input,
  ];
}

/**
 * CPU, address, and file-size caps for one ffmpeg. `--nproc` is per user.
 * The sandbox runs one ffmpeg at a time, so this cap only matters if jobs
 * ever run in parallel. Network isolation is the sandbox container
 * (`network_mode: none`), not `unshare`: Docker's default seccomp profile
 * blocks a new user namespace once SYS_ADMIN is dropped.
 */
export function limitedCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  return {
    command: "prlimit",
    args: [
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
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env,
    });
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

function scratchDir(): string {
  const sandbox = process.env.MEDIA_SANDBOX_DIR?.trim();
  return sandbox ? join(sandbox, "jobs") : tmpdir();
}

async function withTemp(
  extension: string,
  bytes: Uint8Array,
  run: (input: string, dir: string) => Promise<void>,
): Promise<void> {
  const root = scratchDir();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "avouch-media-"));
  try {
    const input = join(dir, `in.${extension}`);
    await writeFile(input, bytes);
    await run(input, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ffmpegFailure(prefix: string, stderr: string): string {
  const detail = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(" ")
    .slice(0, 240);
  return detail ? `${prefix} ${detail}` : prefix;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

type ProbeStream = { codec_type?: string; codec_name?: string; width?: number; height?: number };

type Probe = {
  durationMs: number;
  streams: ProbeStream[];
};

function frameAllowed(stream: ProbeStream | undefined): boolean {
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    return false;
  if (width > MAX_EDGE || height > MAX_EDGE) return false;
  return width * height <= MAX_PIXELS;
}

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
  if (!frameAllowed(video[0])) throw new MediaReject("That video is too large.");
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
async function unavailableRunner(): Promise<CommandResult> {
  return {
    code: 1,
    stdout: "",
    stderr: "The media sandbox is unavailable.",
    sandboxDown: true,
  };
}

export function createFfmpegTools(runner: CommandRunner = unavailableRunner): MediaTools {
  let available: Promise<"ok" | "missing" | "sandbox"> | null = null;
  const hasFfmpeg = () => {
    available ??= runner("ffmpeg", ["-version"]).then((result) => {
      if (result.sandboxDown) return "sandbox";
      if (result.missing || result.code !== 0) return "missing";
      return "ok";
    });
    return available;
  };
  const requireTool = async (kind: "picture" | "video") => {
    const ready = await hasFfmpeg();
    if (ready === "sandbox") throw new MediaReject("The media sandbox is unavailable.");
    if (ready !== "ok") {
      throw new MediaReject(
        kind === "picture"
          ? "Picture processing needs ffmpeg on the box."
          : "Video processing needs ffmpeg on the box.",
      );
    }
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
      const image = IMAGE_INPUT[contentType];
      if (!image) throw new MediaReject("Choose a JPEG, PNG, WebP, or GIF.");
      await requireTool("picture");
      let file = new Uint8Array();
      let thumb = new Uint8Array();
      await withTemp(image.extension, bytes, async (input, dir) => {
        const filePath = join(dir, "file.jpg");
        const thumbPath = join(dir, "thumb.jpg");
        const fileRun = await runner("ffmpeg", imageFileArgs(input, filePath, image.demuxer));
        if (fileRun.sandboxDown) throw new MediaReject("The media sandbox is unavailable.");
        if (fileRun.missing) throw new MediaReject("Picture processing needs ffmpeg on the box.");
        if (fileRun.code !== 0) {
          throw new Error(ffmpegFailure("ffmpeg could not prepare that picture.", fileRun.stderr));
        }
        const thumbRun = await runner("ffmpeg", thumbArgs(input, thumbPath, image.demuxer));
        if (thumbRun.sandboxDown) throw new MediaReject("The media sandbox is unavailable.");
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
      await requireTool("video");
      const format = container === "mp4" ? "mp4" : "matroska,webm";
      let durationMs = 0;
      let file = new Uint8Array();
      let thumb = new Uint8Array();
      await withTemp(container, bytes, async (input, dir) => {
        const probed = await runner("ffprobe", probeArgs(input, format));
        if (probed.sandboxDown) throw new MediaReject("The media sandbox is unavailable.");
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
        if (encoded.sandboxDown) throw new MediaReject("The media sandbox is unavailable.");
        if (encoded.code !== 0) {
          throw new Error(ffmpegFailure("ffmpeg could not prepare that video.", encoded.stderr));
        }
        const poster = await runner("ffmpeg", thumbArgs(input, thumbPath, format));
        if (poster.sandboxDown) throw new MediaReject("The media sandbox is unavailable.");
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
