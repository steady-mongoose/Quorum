import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  FFMPEG_TIMEOUT_MS,
  limitedCommand,
  spawnCommand,
  type CommandResult,
  type CommandRunner,
} from "./ffmpeg.ts";

const COMMANDS = new Set(["ffmpeg", "ffprobe"]);

/** Input formats the worker asks for. Anything else is refused. */
export const SANDBOX_INPUT_FORMATS = new Set([
  "mjpeg",
  "png_pipe",
  "webp_pipe",
  "gif",
  "mp4",
  "matroska,webm",
]);

export const SANDBOX_PROTOCOLS = new Set(["file"]);

export const SANDBOX_UNAVAILABLE = "The media sandbox is unavailable. The worker did not start.";

export function sandboxReadyPath(jobsDir: string): string {
  return join(jobsDir, "sandbox-ready");
}

export function workerReadyPath(controlDir: string): string {
  return join(controlDir, "worker-ready");
}

/** Child processes see PATH and nothing else. Secrets stay in the worker. */
export function sandboxChildEnv(pathValue = process.env.PATH): NodeJS.ProcessEnv {
  const path =
    pathValue && pathValue.trim()
      ? pathValue
      : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return { PATH: path };
}

function insideJob(root: string, target: string): boolean {
  const base = resolve(root);
  const full = resolve(target);
  return full === base || full.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * The sandbox runs ffmpeg and ffprobe only. Input formats and protocols are
 * an allowlist. File paths have to stay inside the job directory.
 */
export function assertSandboxCommand(
  command: string,
  args: readonly string[],
  jobDir?: string,
): void {
  if (!COMMANDS.has(command)) {
    throw new Error("The sandbox only runs ffmpeg or ffprobe.");
  }
  if (args.length > 80) throw new Error("The sandbox refused that command.");
  const versionOnly = args.length === 1 && args[0] === "-version";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.length > 4096 || arg.includes("\0"))
      throw new Error("The sandbox refused that command.");
    if (arg.includes("://")) throw new Error("The sandbox refuses a network path.");
    if (arg === "-protocol_whitelist" && !SANDBOX_PROTOCOLS.has(args[index + 1] ?? "")) {
      throw new Error("The sandbox refuses a network protocol.");
    }
    if (arg === "-f" && !SANDBOX_INPUT_FORMATS.has(args[index + 1] ?? "")) {
      throw new Error("The sandbox refuses that format.");
    }
    if (jobDir && (arg.includes("..") || (arg.startsWith("/") && !insideJob(jobDir, arg)))) {
      throw new Error("The sandbox refuses a path outside the job.");
    }
  }
  const readsInput = args.includes("-i");
  if (readsInput && !versionOnly) {
    const format = args[args.indexOf("-f") + 1] ?? "";
    if (!SANDBOX_INPUT_FORMATS.has(format)) throw new Error("The sandbox refuses that format.");
    const whitelist = args.indexOf("-protocol_whitelist");
    if (!SANDBOX_PROTOCOLS.has(args[whitelist + 1] ?? "")) {
      throw new Error("The sandbox refuses a network protocol.");
    }
  }
}

export function sandboxDown(stderr = SANDBOX_UNAVAILABLE): CommandResult {
  return { code: 1, stdout: "", stderr, sandboxDown: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SandboxSpawn = (
  command: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

/** One job directory. prlimit wraps the process. The environment is PATH only. */
export async function handleSandboxRequest(
  jobDir: string,
  spawn: SandboxSpawn = spawnCommand,
): Promise<void> {
  const requestPath = join(jobDir, "request.json");
  const resultPath = join(jobDir, "result.json");
  let result: CommandResult;
  try {
    const request = JSON.parse(await readFile(requestPath, "utf8")) as {
      command?: string;
      args?: string[];
    };
    const command = request.command ?? "";
    const args = Array.isArray(request.args) ? request.args.map(String) : [];
    assertSandboxCommand(command, args, jobDir);
    const limited = limitedCommand(command, args);
    result = await spawn(limited.command, limited.args, FFMPEG_TIMEOUT_MS, sandboxChildEnv());
  } catch (error) {
    result = {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "The sandbox refused that command.",
    };
  }
  const partial = join(jobDir, "result.json.partial");
  await writeFile(partial, JSON.stringify(result));
  await rename(partial, resultPath);
  await rm(requestPath, { force: true });
}

export async function runSandboxLoop(
  dir: string,
  spawn: SandboxSpawn = spawnCommand,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "samples"), { recursive: true });
  const version = limitedCommand("ffmpeg", ["-version"]);
  const checked = await spawn(version.command, version.args, 15_000, sandboxChildEnv());
  if (checked.missing || checked.code !== 0) {
    console.error("The media sandbox is unavailable. ffmpeg did not start inside the sandbox.");
    process.exit(1);
  }
  await writeFile(sandboxReadyPath(dir), "ok\n");
  for (;;) {
    const names = await readdir(dir, { withFileTypes: true });
    const jobs = names
      .filter((entry) => entry.isDirectory() && entry.name !== "samples")
      .map((entry) => entry.name)
      .sort();
    for (const name of jobs) {
      const jobDir = join(dir, name);
      try {
        await readFile(join(jobDir, "request.json"));
      } catch {
        continue;
      }
      try {
        await readFile(join(jobDir, "result.json"));
        continue;
      } catch {
        // The worker is still waiting for this result.
      }
      await handleSandboxRequest(jobDir, spawn);
    }
    await sleep(30);
  }
}

/**
 * Hand a command to the sandbox container through the shared directory.
 * The worker does not spawn ffmpeg itself.
 */
export function createSandboxRunner(
  dir: string,
  timeoutMs = FFMPEG_TIMEOUT_MS + 5_000,
): CommandRunner {
  return async (command, args) => {
    const pathArg = args.find((arg) => arg.startsWith("/"));
    const jobDir = pathArg ? dirname(pathArg) : join(dir, randomUUID());
    try {
      assertSandboxCommand(command, args, pathArg ? jobDir : undefined);
    } catch (error) {
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "The sandbox refused that command.",
      };
    }
    await mkdir(jobDir, { recursive: true });
    const requestPath = join(jobDir, "request.json");
    const resultPath = join(jobDir, "result.json");
    const partial = join(jobDir, "request.json.partial");
    await writeFile(partial, JSON.stringify({ command, args }));
    await rename(partial, requestPath);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const body = JSON.parse(await readFile(resultPath, "utf8")) as CommandResult;
        await rm(resultPath, { force: true });
        return body;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code !== "ENOENT") return sandboxDown();
      }
      await sleep(40);
    }
    await rm(requestPath, { force: true });
    return sandboxDown();
  };
}

/** Startup check. A missing sandbox is not reported as a missing ffmpeg binary. */
export async function assertSandboxReady(runner: CommandRunner): Promise<void> {
  let result: CommandResult;
  try {
    result = await runner("ffmpeg", ["-version"]);
  } catch {
    throw new Error(SANDBOX_UNAVAILABLE);
  }
  if (result.sandboxDown || result.missing || result.code !== 0) {
    throw new Error(SANDBOX_UNAVAILABLE);
  }
}
