import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkerEnv, workerEnv } from "./worker-env.ts";

test("the worker keeps storage and database settings and drops auth secrets", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/tmp",
    TMPDIR: "/tmp",
    MEDIA_JOBS_DIR: "/jobs",
    MEDIA_CONTROL_DIR: "/control",
    MEDIA_SANDBOX_DIR: "/work",
    DATABASE_URL: "postgres://media_worker:secret@/avouch",
    MEDIA_S3_ENDPOINT: "https://media.example",
    MEDIA_S3_SECRET_ACCESS_KEY: "storage-secret",
    BETTER_AUTH_SECRET: "auth-secret",
    POSTGRES_PASSWORD: "owner-secret",
    BOOTSTRAP_OWNER_PASSWORD: "once",
  };
  const kept = workerEnv(source);
  assert.equal(kept.DATABASE_URL, source.DATABASE_URL);
  assert.equal(kept.MEDIA_JOBS_DIR, "/jobs");
  assert.equal(kept.MEDIA_CONTROL_DIR, "/control");
  assert.equal("MEDIA_SANDBOX_DIR" in kept, false);
  assert.equal(kept.MEDIA_S3_SECRET_ACCESS_KEY, "storage-secret");
  assert.equal("BETTER_AUTH_SECRET" in kept, false);
  assert.equal("POSTGRES_PASSWORD" in kept, false);
  assert.equal("BOOTSTRAP_OWNER_PASSWORD" in kept, false);
  const target = { ...source };
  applyWorkerEnv(target);
  assert.equal(target.BETTER_AUTH_SECRET, undefined);
  assert.equal(target.POSTGRES_PASSWORD, undefined);
  assert.equal(target.PATH, "/usr/bin");
});
