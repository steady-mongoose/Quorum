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
  assert.match(caddyfile, /Retry-After/);
  assert.match(caddyfile, /429/);
  const dockerfile = readFileSync(join(root, "deploy/Dockerfile.caddy"), "utf8");
  assert.match(dockerfile, /caddy:2\.10-builder/);
  assert.match(dockerfile, /github\.com\/mholt\/caddy-ratelimit/);
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  assert.match(compose, /dockerfile: Dockerfile\.caddy/);
  assert.equal(compose.includes("image: caddy:2.10"), false);
});
