import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FFMPEG_TIMEOUT_MS,
  limitedCommand,
  spawnCommand,
  type CommandResult,
  type CommandRunner,
} from "./ffmpeg.ts";

const COMMANDS = new Set(["ffmpeg", "ffprobe"]);

export const SANDBOX_UNAVAILABLE = "The media sandbox is unavailable. The worker did not start.";

/** Child processes see PATH and nothing else. Secrets stay in the worker. */
export function sandboxChildEnv(pathValue = process.env.PATH): NodeJS.ProcessEnv {
  const path =
    pathValue && pathValue.trim()
      ? pathValue
      : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return { PATH: path };
}

/**
 * The sandbox runs ffmpeg and ffprobe only. A request that names a URL or a
 * protocol other than a local file is refused before the process starts.
 */
export function assertSandboxCommand(command: string, args: readonly string[]): void {
  if (!COMMANDS.has(command)) {
    throw new Error("The sandbox only runs ffmpeg or ffprobe.");
  }
  if (args.length > 80) throw new Error("The sandbox refused that command.");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.length > 4096 || arg.includes("\0"))
      throw new Error("The sandbox refused that command.");
    if (arg.includes("://")) throw new Error("The sandbox refuses a network path.");
    if (arg === "-protocol_whitelist" && args[index + 1] !== "file") {
      throw new Error("The sandbox refuses a network protocol.");
    }
    if (arg === "-f" && (args[index + 1] === "concat" || args[index + 1] === "hls")) {
      throw new Error("The sandbox refuses that format.");
    }
  }
  const versionOnly = args.length === 1 && args[0] === "-version";
  const readsInput = args.includes("-i");
  if (readsInput && !versionOnly) {
    const whitelist = args.indexOf("-protocol_whitelist");
    if (args[whitelist + 1] !== "file") {
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

/** One queued request. prlimit wraps the process. The environment is PATH only. */
export async function handleSandboxRequest(
  queueDir: string,
  name: string,
  spawn: SandboxSpawn = spawnCommand,
): Promise<void> {
  const requestPath = join(queueDir, name);
  const resultPath = join(queueDir, `${name.replace(/\.json$/, "")}.result.json`);
  let result: CommandResult;
  try {
    const request = JSON.parse(await readFile(requestPath, "utf8")) as {
      command?: string;
      args?: string[];
    };
    const command = request.command ?? "";
    const args = Array.isArray(request.args) ? request.args.map(String) : [];
    assertSandboxCommand(command, args);
    const limited = limitedCommand(command, args);
    result = await spawn(limited.command, limited.args, FFMPEG_TIMEOUT_MS, sandboxChildEnv());
  } catch (error) {
    result = {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "The sandbox refused that command.",
    };
  }
  const partial = `${resultPath}.partial`;
  await writeFile(partial, JSON.stringify(result));
  await rename(partial, resultPath);
  await rm(requestPath, { force: true });
}

export async function runSandboxLoop(
  dir: string,
  spawn: SandboxSpawn = spawnCommand,
): Promise<void> {
  const queueDir = join(dir, "queue");
  await mkdir(queueDir, { recursive: true });
  await mkdir(join(dir, "jobs"), { recursive: true });
  await mkdir(join(dir, "samples"), { recursive: true });
  const version = limitedCommand("ffmpeg", ["-version"]);
  const checked = await spawn(version.command, version.args, 15_000, sandboxChildEnv());
  if (checked.missing || checked.code !== 0) {
    console.error("The media sandbox is unavailable. ffmpeg did not start inside the sandbox.");
    process.exit(1);
  }
  await writeFile(join(dir, "sandbox-ready"), "ok\n");
  for (;;) {
    const names = (await readdir(queueDir))
      .filter(
        (name) =>
          name.endsWith(".json") && !name.endsWith(".result.json") && !name.includes(".partial"),
      )
      .sort();
    for (const name of names) {
      if (name.endsWith(".result.json")) continue;
      await handleSandboxRequest(queueDir, name, spawn);
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
  const queueDir = join(dir, "queue");
  return async (command, args) => {
    try {
      assertSandboxCommand(command, args);
    } catch (error) {
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "The sandbox refused that command.",
      };
    }
    const id = randomUUID();
    const requestPath = join(queueDir, `${id}.json`);
    const resultPath = join(queueDir, `${id}.result.json`);
    await mkdir(queueDir, { recursive: true });
    const partial = `${requestPath}.partial`;
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
