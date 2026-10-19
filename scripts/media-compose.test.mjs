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
  assert.match(sandbox, /read_only: true/);
  assert.match(sandbox, /cap_drop:\n\s+- ALL/);
  assert.match(sandbox, /\/tmp:uid=1000,gid=1000,mode=1777/);
  assert.match(sandbox, /media-jobs:\/jobs/);
  assert.equal(sandbox.includes("media-control"), false);
  assert.match(compose, /one job runs at a time/);
  const init = slice(compose, "  media-init:", "  media-sandbox:");
  assert.match(init, /chown 1000:1000/);
  assert.equal(init.includes("cap_drop:"), false);
  const worker = slice(compose, "  media-worker:", "  migrate:");
  assert.equal(worker.includes("env_file:"), false);
  assert.match(worker, /postgres:\/\/media_worker:/);
  assert.equal(worker.includes("POSTGRES_PASSWORD"), false);
  assert.match(worker, /MEDIA_S3_SECRET_ACCESS_KEY/);
  assert.match(worker, /read_only: true/);
  assert.match(worker, /cap_drop:\n\s+- ALL/);
  assert.match(worker, /\/tmp:uid=1000,gid=1000,mode=1777/);
  assert.match(worker, /media-jobs:\/jobs/);
  assert.match(worker, /media-control:\/control/);
  assert.match(worker, /\/control\/worker-ready/);
  assert.equal(compose.includes("EGRESS_ALLOW_HOST"), false);
  assert.equal(compose.includes("media-work:"), false);
  const override = readFileSync(join(root, "deploy/docker-compose.media-test.yml"), "utf8");
  assert.match(override, /EGRESS_ALLOW_HOST/);
  assert.match(override, /EGRESS_ALLOW_PORT/);
  const smoke = readFileSync(join(root, "scripts/media-compose-smoke.sh"), "utf8");
  assert.match(smoke, /docker-compose\.media-test\.yml/);
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
