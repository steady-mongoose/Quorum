import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

function slice(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, start);
  assert.ok(to > from, end);
  return text.slice(from, to);
}

test("coturn is a calls profile that docker compose up does not start", () => {
  const compose = readFileSync(join(root, "deploy/docker-compose.yml"), "utf8");
  const script = readFileSync(join(root, "deploy/coturn.sh"), "utf8");
  assert.match(compose, /Not started by `docker compose up`/);
  assert.match(compose, /these calls are not recorded/);
  assert.equal(compose.includes("image: livekit"), false);
  const coturn = slice(compose, "  coturn:", "\nnetworks:");
  assert.match(coturn, /profiles: \["calls"\]/);
  assert.match(coturn, /network_mode: host/);
  assert.match(
    coturn,
    /coturn\/coturn:4\.6\.3@sha256:71c3c990283385567f11794ee692e3a47b66fd9b0bb39e42afbe776e331dd888/,
  );
  assert.match(coturn, /cap_drop:\n\s+- ALL/);
  assert.equal(coturn.includes("ports:"), false);
  assert.equal(coturn.includes("env_file:"), false);
  assert.match(script, /use-auth-secret/);
  assert.match(script, /no-cli/);
  assert.match(script, /no-loopback-peers/);
  assert.match(script, /denied-peer-ip=10\.0\.0\.0-10\.255\.255\.255/);
  assert.match(script, /denied-peer-ip=172\.16\.0\.0-172\.31\.255\.255/);
  assert.match(script, /static-auth-secret=/);
  assert.equal(script.includes("recording"), false);
  const syntax = spawnSync("sh", ["-n", join(root, "deploy/coturn.sh")]);
  assert.equal(syntax.status, 0);
  const refused = spawnSync("sh", [join(root, "deploy/coturn.sh")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /CALLS_TURN_SECRET/);
});

test("call membership is a read, and the module does not write the room tables", () => {
  const membership = readFileSync(join(root, "server/calls/membership.ts"), "utf8");
  assert.match(membership, /select user_id from room_member/);
  assert.equal(/insert into|update |delete from/i.test(membership), false);
  const routes = readFileSync(join(root, "server/calls/routes.ts"), "utf8");
  assert.match(routes, /record: false/);
  assert.equal(routes.includes("record: true"), false);
  const migrations = readFileSync(join(root, "scripts/migration-plan.test.mjs"), "utf8");
  assert.equal(migrations.includes("0009"), false);
});
