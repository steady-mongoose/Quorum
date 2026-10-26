import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { createFfmpegTools } from "./media/ffmpeg.ts";
import { createSandboxRunner } from "./media/sandbox.ts";

function connectOnce(host: string, port: number, payload: string, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out connecting to ${host}:${port}`));
    }, ms);
    socket.on("connect", () => {
      if (payload) socket.write(payload);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      socket.end();
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function blocked(host: string, port: number): Promise<boolean> {
  return connectOnce(host, port, "", 2_000).then(
    () => false,
    () => true,
  );
}

/**
 * Runs inside the worker container. Processes one picture and one video
 * through the sandbox, then checks that only the storage host answers.
 */
export async function main(): Promise<void> {
  const dir = process.env.MEDIA_JOBS_DIR?.trim();
  const endpoint = process.env.MEDIA_S3_ENDPOINT?.trim();
  if (!dir || !endpoint) {
    console.error("The media sandbox is unavailable. The worker did not start.");
    process.exit(1);
  }
  const tools = createFfmpegTools(createSandboxRunner(dir));
  const picture = new Uint8Array(await readFile(`${dir}/samples/in.png`));
  const video = new Uint8Array(await readFile(`${dir}/samples/in.mp4`));
  const image = await tools.processImage(picture, "image/png");
  const movie = await tools.processVideo(video);
  if (image.file[0] !== 0xff || image.file[1] !== 0xd8) {
    throw new Error("The sample picture was not re-encoded to JPEG.");
  }
  if (image.fileType !== "image/jpeg" || movie.fileType !== "video/mp4") {
    throw new Error("The sample files came back with the wrong type.");
  }
  const ftyp = movie.file[4] === 0x66 && movie.file[5] === 0x74 && movie.file[6] === 0x79;
  if (!ftyp || movie.durationMs < 1 || movie.durationMs > 60_000) {
    throw new Error("The sample video was not re-encoded to MP4.");
  }
  const url = new URL(endpoint);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const allowed = await connectOnce(url.hostname, port, "ping", 5_000);
  if (!allowed.includes("pong")) {
    throw new Error("The storage host did not answer through the egress proxy.");
  }
  if (!(await blocked("203.0.113.1", 443))) {
    throw new Error("The worker reached a host that is not the storage endpoint.");
  }
  console.log(
    JSON.stringify({
      event: "media-smoke",
      image: image.file.byteLength,
      video: movie.file.byteLength,
    }),
  );
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
