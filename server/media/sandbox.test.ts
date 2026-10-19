import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MediaReject } from "./errors.ts";
import { createFfmpegTools } from "./ffmpeg.ts";
import {
  SANDBOX_UNAVAILABLE,
  assertSandboxCommand,
  assertSandboxReady,
  createSandboxRunner,
  handleSandboxRequest,
  sandboxChildEnv,
} from "./sandbox.ts";

test("ffmpeg's environment is PATH and nothing else", () => {
  const env = sandboxChildEnv("/usr/bin");
  assert.deepEqual(env, { PATH: "/usr/bin" });
  assert.equal("DATABASE_URL" in env, false);
  assert.equal("MEDIA_S3_SECRET_ACCESS_KEY" in env, false);
});

test("the sandbox refuses a network path and a playlist format", () => {
  assert.throws(
    () => assertSandboxCommand("ffmpeg", ["-i", "http://169.254.169.254/"]),
    /network path/,
  );
  assert.throws(
    () => assertSandboxCommand("ffmpeg", ["-protocol_whitelist", "file,http", "-i", "in.mp4"]),
    /network protocol/,
  );
  assert.throws(() => assertSandboxCommand("bash", ["-c", "id"]), /only runs ffmpeg/);
  assert.doesNotThrow(() =>
    assertSandboxCommand("ffprobe", ["-protocol_whitelist", "file", "-f", "mp4", "-i", "in.mp4"]),
  );
});

test("a sandbox request runs under prlimit with an empty environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "avouch-sandbox-"));
  const queue = join(root, "queue");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(queue);
  await writeFile(
    join(queue, "job.json"),
    JSON.stringify({
      command: "ffmpeg",
      args: ["-protocol_whitelist", "file", "-f", "mp4", "-i", "in.mp4"],
    }),
  );
  const seen: { command: string; args: string[]; env: NodeJS.ProcessEnv } = {
    command: "",
    args: [],
    env: {},
  };
  await handleSandboxRequest(queue, "job.json", async (command, args, _timeout, env) => {
    seen.command = command;
    seen.args = args;
    seen.env = env;
    return { code: 0, stdout: "ok", stderr: "" };
  });
  assert.equal(seen.command, "prlimit");
  assert.equal(seen.args.includes("unshare"), false);
  assert.equal(seen.args.at(-1), "in.mp4");
  assert.deepEqual(Object.keys(seen.env), ["PATH"]);
  const result = JSON.parse(await readFile(join(queue, "job.result.json"), "utf8")) as {
    code: number;
  };
  assert.equal(result.code, 0);
});

test("startup says the sandbox is unavailable, not that ffmpeg is missing", async () => {
  await assert.rejects(
    () =>
      assertSandboxReady(async () => ({
        code: 1,
        stdout: "",
        stderr: "unshare: Operation not permitted",
        sandboxDown: true,
      })),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, SANDBOX_UNAVAILABLE);
      assert.equal(error.message.includes("needs ffmpeg"), false);
      return true;
    },
  );
});

test("the worker and the sandbox agree on a finished command", async () => {
  const root = await mkdtemp(join(tmpdir(), "avouch-sandbox-run-"));
  const runner = createSandboxRunner(root, 2_000);
  const pending = runner("ffmpeg", ["-version"]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(join(root, "queue"));
  const request = names.find((name) => name.endsWith(".json") && !name.endsWith(".result.json"));
  assert.ok(request);
  await handleSandboxRequest(join(root, "queue"), request, async () => ({
    code: 0,
    stdout: "ffmpeg version",
    stderr: "",
  }));
  const result = await pending;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ffmpeg version");
});

test("a down sandbox refuses a picture without blaming a missing binary", async () => {
  const tools = createFfmpegTools(async () => ({
    code: 1,
    stdout: "",
    stderr: "down",
    sandboxDown: true,
  }));
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 2);
  view.setUint32(20, 2);
  await assert.rejects(
    () => tools.processImage(png, "image/png"),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /sandbox is unavailable/);
      assert.equal(error.message.includes("needs ffmpeg"), false);
      return true;
    },
  );
});
