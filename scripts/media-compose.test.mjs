import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { projectRoot } from "./with-app-env.mjs";

function slice(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, start);
  assert.ok(to > from, end);
  return text.slice(from, to);
}

test("ffmpeg runs in a container with no network, and the worker does not load the full env", () => {
  const root = projectRoot();
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  const sandbox = slice(compose, "  media-sandbox:", "  media-proxy:");
  assert.match(sandbox, /network_mode: none/);
  assert.equal(sandbox.includes("unshare"), false);
  assert.match(sandbox, /pids_limit: 64/);
  assert.match(compose, /if jobs ever run in parallel/);
  const worker = slice(compose, "  media-worker:", "  migrate:");
  assert.equal(worker.includes("env_file:"), false);
  assert.match(worker, /postgres:\/\/media_worker:/);
  assert.equal(worker.includes("POSTGRES_PASSWORD"), false);
  assert.match(worker, /MEDIA_S3_SECRET_ACCESS_KEY/);
  assert.match(compose, /internal: true/);
  const postgres = slice(compose, "  postgres:", "  api:");
  assert.equal(postgres.includes("ports:"), false);
  const api = slice(compose, "  api:", "  caddy:");
  assert.equal(api.includes("\n    ports:"), false);
  const dockerfile = readFileSync(join(root, "deploy/Dockerfile"), "utf8");
  assert.match(dockerfile, /ffmpeg=7:5\.1\.9-0\+deb12u1/);
  assert.match(dockerfile, /FROM app AS media/);
  const appStage = dockerfile.slice(0, dockerfile.indexOf("FROM app AS media"));
  assert.equal(appStage.includes("ffmpeg"), false);
});
