import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VIDEO_MS } from "../../src/lib/media/limits.ts";
import { MediaReject } from "./errors.ts";

export type CommandResult = { code: number; stdout: string; stderr: string; missing?: boolean };
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export function imageFileArgs(input: string, output: string): string[] {
  return ["-y", "-i", input, "-map_metadata", "-1", "-vf", "scale='min(1280,iw)':-2", output];
}

export function thumbArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-i",
    input,
    "-map_metadata",
    "-1",
    "-vf",
    "scale='min(480,iw)':-2",
    "-frames:v",
    "1",
    output,
  ];
}

export function videoFileArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-i",
    input,
    "-map_metadata",
    "-1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    output,
  ];
}

export function probeArgs(input: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    input,
  ];
}

export function spawnCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ code: 127, stdout, stderr: error.message, missing: error.code === "ENOENT" });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
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

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
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

/**
 * Re-encode with ffmpeg when it is installed, so container metadata is gone
 * and a small thumbnail exists. Pictures still succeed without ffmpeg: the
 * caller has already stripped metadata. Video does not, because a video
 * container can keep a location the stripper does not read.
 */
export function createFfmpegTools(runner: CommandRunner = spawnCommand): MediaTools {
  let available: Promise<boolean> | null = null;
  const hasFfmpeg = () => {
    available ??= runner("ffmpeg", ["-version"]).then(
      (result) => result.code === 0 && !result.missing,
    );
    return available;
  };

  return {
    async processImage(bytes, contentType) {
      const fallback: ImageResult = {
        file: bytes,
        fileType: contentType,
        thumb: bytes,
        thumbType: contentType,
      };
      if (!(await hasFfmpeg())) return fallback;
      const extension = EXTENSION[contentType] ?? "img";
      let file = bytes;
      let thumb = bytes;
      let fileType = contentType;
      await withTemp(extension, bytes, async (input, dir) => {
        const thumbPath = join(dir, "thumb.jpg");
        const thumbRun = await runner("ffmpeg", thumbArgs(input, thumbPath));
        if (thumbRun.missing) return;
        if (thumbRun.code !== 0) throw new Error("ffmpeg could not make a thumbnail.");
        thumb = new Uint8Array(await readFile(thumbPath));
        if (contentType === "image/gif") return;
        const filePath = join(dir, "file.jpg");
        const fileRun = await runner("ffmpeg", imageFileArgs(input, filePath));
        if (fileRun.code !== 0) throw new Error("ffmpeg could not prepare that picture.");
        file = new Uint8Array(await readFile(filePath));
        fileType = "image/jpeg";
      });
      return { file, fileType, thumb, thumbType: thumb === bytes ? contentType : "image/jpeg" };
    },
    async processVideo(bytes) {
      if (!(await hasFfmpeg())) {
        throw new MediaReject("Video processing needs ffmpeg on the box.");
      }
      let durationMs = 0;
      let file = new Uint8Array();
      let thumb = new Uint8Array();
      await withTemp("mp4", bytes, async (input, dir) => {
        const probed = await runner("ffprobe", probeArgs(input));
        if (probed.missing || probed.code !== 0) {
          throw new MediaReject("That video could not be read.");
        }
        const seconds = Number(probed.stdout.trim());
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new MediaReject("That video has no duration.");
        }
        durationMs = Math.round(seconds * 1000);
        if (durationMs > VIDEO_MS) throw new MediaReject("That video is longer than 60 seconds.");
        const filePath = join(dir, "file.mp4");
        const thumbPath = join(dir, "thumb.jpg");
        const encoded = await runner("ffmpeg", videoFileArgs(input, filePath));
        if (encoded.code !== 0) throw new Error("ffmpeg could not prepare that video.");
        const poster = await runner("ffmpeg", thumbArgs(input, thumbPath));
        if (poster.code !== 0) throw new Error("ffmpeg could not make a thumbnail.");
        file = new Uint8Array(await readFile(filePath));
        thumb = new Uint8Array(await readFile(thumbPath));
      });
      return { file, fileType: "video/mp4", thumb, thumbType: "image/jpeg", durationMs };
    },
  };
}
