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
  sandboxReadyPath,
  workerReadyPath,
} from "./sandbox.ts";

test("the sandbox cannot write the worker control file", () => {
  const ready = sandboxReadyPath("/jobs");
  const control = workerReadyPath("/control");
  assert.equal(ready, "/jobs/sandbox-ready");
  assert.equal(control, "/control/worker-ready");
  assert.equal(ready.startsWith("/control"), false);
  assert.equal(control.startsWith("/jobs"), false);
});

test("ffmpeg's environment is PATH and nothing else", () => {
  const env = sandboxChildEnv("/usr/bin");
  assert.deepEqual(env, { PATH: "/usr/bin" });
  assert.equal("DATABASE_URL" in env, false);
  assert.equal("MEDIA_S3_SECRET_ACCESS_KEY" in env, false);
});

test("the sandbox allows only known formats and protocols", () => {
  assert.throws(
    () => assertSandboxCommand("ffmpeg", ["-i", "http://169.254.169.254/"]),
    /network path/,
  );
  assert.throws(
    () => assertSandboxCommand("ffmpeg", ["-protocol_whitelist", "file,http", "-i", "in.mp4"]),
    /network protocol/,
  );
  assert.throws(
    () =>
      assertSandboxCommand("ffmpeg", [
        "-protocol_whitelist",
        "file",
        "-f",
        "concat",
        "-i",
        "in.txt",
      ]),
    /format/,
  );
  assert.throws(
    () =>
      assertSandboxCommand("ffmpeg", ["-protocol_whitelist", "file", "-f", "hls", "-i", "in.m3u8"]),
    /format/,
  );
  assert.throws(
    () =>
      assertSandboxCommand("ffmpeg", ["-protocol_whitelist", "file", "-f", "lavfi", "-i", "color"]),
    /format/,
  );
  assert.throws(() => assertSandboxCommand("bash", ["-c", "id"]), /only runs ffmpeg/);
  assert.doesNotThrow(() =>
    assertSandboxCommand("ffprobe", ["-protocol_whitelist", "file", "-f", "mp4", "-i", "in.mp4"]),
  );
  assert.doesNotThrow(() =>
    assertSandboxCommand(
      "ffmpeg",
      ["-protocol_whitelist", "file", "-f", "png_pipe", "-i", "/jobs/job/in.png"],
      "/jobs/job",
    ),
  );
  assert.throws(
    () =>
      assertSandboxCommand(
        "ffmpeg",
        ["-protocol_whitelist", "file", "-f", "png_pipe", "-i", "/control/worker-ready"],
        "/jobs/job",
      ),
    /outside the job/,
  );
  assert.throws(
    () =>
      assertSandboxCommand(
        "ffmpeg",
        ["-protocol_whitelist", "file", "-f", "png_pipe", "-i", "../secret.png"],
        "/jobs/job",
      ),
    /outside the job/,
  );
  assert.throws(
    () =>
      assertSandboxCommand(
        "ffmpeg",
        ["-protocol_whitelist", "file", "-f", "image2", "-i", "/jobs/job/in.png"],
        "/jobs/job",
      ),
    /format/,
  );
});

test("a job request cannot point ffmpeg at the worker control file", async () => {
  const root = await mkdtemp(join(tmpdir(), "avouch-sandbox-path-"));
  const job = join(root, "job");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(job);
  await writeFile(
    join(job, "request.json"),
    JSON.stringify({
      command: "ffmpeg",
      args: ["-protocol_whitelist", "file", "-f", "mp4", "-i", "/etc/passwd"],
    }),
  );
  let spawned = false;
  await handleSandboxRequest(job, async () => {
    spawned = true;
    return { code: 0, stdout: "", stderr: "" };
  });
  assert.equal(spawned, false);
  const result = JSON.parse(await readFile(join(job, "result.json"), "utf8")) as {
    stderr: string;
  };
  assert.match(result.stderr, /outside the job/);
});

test("a sandbox request runs under prlimit with an empty environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "avouch-sandbox-"));
  const job = join(root, "job");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(job);
  await writeFile(
    join(job, "request.json"),
    JSON.stringify({
      command: "ffmpeg",
      args: ["-protocol_whitelist", "file", "-f", "mp4", "-i", join(job, "in.mp4")],
    }),
  );
  const seen: { command: string; args: string[]; env: NodeJS.ProcessEnv } = {
    command: "",
    args: [],
    env: {},
  };
  await handleSandboxRequest(job, async (command, args, _timeout, env) => {
    seen.command = command;
    seen.args = args;
    seen.env = env;
    return { code: 0, stdout: "ok", stderr: "" };
  });
  assert.equal(seen.command, "prlimit");
  assert.equal(seen.args.includes("unshare"), false);
  assert.equal(seen.args.at(-1), join(job, "in.mp4"));
  assert.deepEqual(Object.keys(seen.env), ["PATH"]);
  const result = JSON.parse(await readFile(join(job, "result.json"), "utf8")) as {
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
  const names = await readdir(root);
  const request = names.find((name) => name !== "samples");
  assert.ok(request);
  await handleSandboxRequest(join(root, request), async () => ({
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
