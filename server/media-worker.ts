import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPool, pgDb } from "./db.ts";
import { readMediaConfig } from "./media/config.ts";
import { PENDING_MS } from "../src/lib/media/limits.ts";
import { createFfmpegTools } from "./media/ffmpeg.ts";
import { storeFromConfig } from "./media/s3.ts";
import { redactSecrets } from "./media/redact.ts";
import { assertSandboxReady, createSandboxRunner, SANDBOX_UNAVAILABLE } from "./media/sandbox.ts";
import { applyWorkerEnv } from "./media/worker-env.ts";
import {
  expireStaleUploads,
  recoverStuckJobs,
  runOneMediaJob,
  sweepDeletedMedia,
} from "./media/worker.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Separate process from the API. It does not apply migrations and it does not
 * start unless object-storage credentials are set.
 */
export async function main(): Promise<void> {
  applyWorkerEnv(process.env);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("Set DATABASE_URL before starting the media worker.");
    process.exit(1);
  }
  const config = readMediaConfig(process.env);
  if (!config.enabled) {
    console.log("Picture and video storage is not set up. The worker is not running.");
    process.exit(0);
  }
  const store = storeFromConfig(config);
  if (!store) {
    console.log("Picture and video storage is not set up. The worker is not running.");
    process.exit(0);
  }
  const sandboxDir = process.env.MEDIA_SANDBOX_DIR?.trim();
  if (!sandboxDir) {
    console.error(SANDBOX_UNAVAILABLE);
    process.exit(1);
  }
  const runner = createSandboxRunner(sandboxDir);
  const tools = createFfmpegTools(runner);
  try {
    await assertSandboxReady(runner);
  } catch (error) {
    console.error(error instanceof Error ? error.message : SANDBOX_UNAVAILABLE);
    process.exit(1);
  }
  const pool = createPool(databaseUrl);
  const db = pgDb(pool);
  const deps = { db, store, tools, now: () => new Date() };
  console.log(JSON.stringify({ event: "media-worker", video: config.video }));
  try {
    await recoverStuckJobs(deps);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "42P01") {
      console.error(
        "The media tables are not there. Approve migrations/0004_media.sql before starting this worker.",
      );
      process.exit(1);
    }
    if (code === "28000" || code === "28P01") {
      console.error(
        "The media worker could not sign in to Postgres. Approve migrations/0005_media_worker_role.sql and set MEDIA_WORKER_DB_PASSWORD.",
      );
      process.exit(1);
    }
    throw error;
  }
  await writeFile(join(sandboxDir, "worker-ready"), "ok\n");
  for (;;) {
    const outcome = await runOneMediaJob(deps);
    await expireStaleUploads(deps, PENDING_MS);
    await sweepDeletedMedia(deps);
    await sleep(outcome === "idle" ? 2000 : 50);
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecrets(message));
    process.exit(1);
  });
}
