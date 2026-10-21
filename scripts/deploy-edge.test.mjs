import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { projectRoot } from "./with-app-env.mjs";

test("Caddy limits the closed-test POSTs and is built with the rate limit module", () => {
  const root = projectRoot();
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  assert.match(caddyfile, /zone closed_test/);
  assert.match(caddyfile, /method POST/);
  assert.match(caddyfile, /path \/api\/auth\/sign-in\/\* \/api\/signup \/api\/invites/);
  assert.match(caddyfile, /key \{remote_host\}/);
  assert.match(caddyfile, /events 5/);
  assert.match(caddyfile, /window 1m/);
  assert.match(caddyfile, /ipv6_prefix 64/);
  assert.match(caddyfile, /zone calls/);
  assert.match(caddyfile, /path \/api\/calls\/\*/);
  assert.match(caddyfile, /events 60/);
  assert.match(caddyfile, /window 10s/);
  assert.match(caddyfile, /429/);
  assert.equal(caddyfile.includes('Retry-After "60"'), false);
  assert.match(caddyfile, /module sets Retry-After/);
  const dockerfile = readFileSync(join(root, "deploy/Dockerfile.caddy"), "utf8");
  assert.match(
    dockerfile,
    /caddy:2\.10\.2-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc/,
  );
  assert.match(
    dockerfile,
    /caddy:2\.10\.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb/,
  );
  assert.match(
    dockerfile,
    /github\.com\/mholt\/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db/,
  );
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  assert.match(compose, /dockerfile: Dockerfile\.caddy/);
  assert.equal(compose.includes("image: caddy:2.10"), false);
});
