import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { iceServersForMember, publicCallsStatus, readCallsConfig } from "./config.ts";
import { mintTurnCredential, turnExpirySeconds } from "./turn.ts";

const secret = "a".repeat(40);
const now = Date.parse("2026-10-21T12:00:00Z");

test("room calls stay off unless CALLS is on", () => {
  assert.deepEqual(readCallsConfig({}), { enabled: false, reason: "off" });
  assert.deepEqual(readCallsConfig({ CALLS: "yes" }), { enabled: false, reason: "off" });
  const on = readCallsConfig({ CALLS: "on" });
  assert.equal(on.enabled, true);
  assert.deepEqual(publicCallsStatus(on), { enabled: true, record: false });
  assert.deepEqual(publicCallsStatus(readCallsConfig({})), { enabled: false, record: false });
  assert.deepEqual(iceServersForMember(readCallsConfig({}), "user-1", now), []);
});

test("a vendor ICE host or half a TURN setup keeps calls off", () => {
  const google = readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "stun:stun.l.google.com:19302",
  });
  assert.deepEqual(google, { enabled: false, reason: "forbidden-ice" });
  const cloud = readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "stun:stun.cloudflare.com:3478",
  });
  assert.equal(cloud.enabled, false);
  const partial = readCallsConfig({
    CALLS: "on",
    CALLS_TURN_URLS: "turn:turn.example.com:3478",
  });
  assert.deepEqual(partial, { enabled: false, reason: "partial-turn" });
  const short = readCallsConfig({
    CALLS: "on",
    CALLS_TURN_URLS: "turn:turn.example.com:3478",
    CALLS_TURN_SECRET: "short-secret",
  });
  assert.equal(short.enabled, false);
  const swapped = readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "turn:turn.example.com:3478",
  });
  assert.equal(swapped.enabled, false);
});

test("a member receives a coturn password and the public status does not", () => {
  const config = readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "stun:turn.example.com:3478",
    CALLS_TURN_URLS: "turn:turn.example.com:3478?transport=udp",
    CALLS_TURN_SECRET: secret,
  });
  assert.equal(config.enabled, true);
  if (!config.enabled) return;
  assert.equal(config.turnTtlSeconds, 60 * 60);
  const status = JSON.stringify(publicCallsStatus(config));
  assert.equal(status.includes(secret), false);
  assert.equal(status.includes("turn.example.com"), false);
  const ice = iceServersForMember(config, "user-1", now);
  const encoded = JSON.stringify(ice);
  assert.equal(encoded.includes(secret), false);
  const turn = ice[1];
  assert.ok(turn);
  const minted = mintTurnCredential(secret, "user-1", now, config.turnTtlSeconds);
  assert.equal(turn.username, minted.username);
  assert.equal(turn.credential, minted.credential);
  const expiry = turnExpirySeconds(now, config.turnTtlSeconds);
  assert.equal(turn.username, `${expiry}:user-1`);
  const life = expiry - Math.floor(now / 1000);
  assert.ok(life >= 45 * 60 && life <= 60 * 60);
  const sameSlot = iceServersForMember(config, "user-1", now + 10 * 60 * 1000);
  assert.equal(sameSlot[1]?.username, turn.username);
  const nextSlot = iceServersForMember(config, "user-1", now + 15 * 60 * 1000);
  assert.notEqual(nextSlot[1]?.username, turn.username);
  assert.equal(
    turn.credential,
    createHmac("sha1", secret).update(minted.username).digest("base64"),
  );
});
