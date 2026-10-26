import assert from "node:assert/strict";
import test from "node:test";
import { iceHostAllowed, parseIceUrl } from "./ice.ts";

test("public vendor ICE hosts are refused", () => {
  for (const host of [
    "stun.l.google.com",
    "stun.cloudflare.com",
    "turn.amazonaws.com",
    "relay.azure.com",
    "example.apple.com",
    "livekit.cloud",
    "foo.livekit.cloud",
  ]) {
    assert.equal(iceHostAllowed(host), false, host);
    assert.equal(parseIceUrl(`stun:${host}:3478`), null, host);
  }
  assert.equal(iceHostAllowed("notgoogle.com"), true);
  assert.equal(iceHostAllowed("google.com.example.com"), true);
});

test("an operator's own TURN url is accepted, and a sloppy one is not", () => {
  assert.deepEqual(parseIceUrl("turn:140.82.61.209:3478?transport=udp"), {
    url: "turn:140.82.61.209:3478?transport=udp",
    host: "140.82.61.209",
    relay: true,
  });
  assert.equal(parseIceUrl("stun:[2001:db8::1]:3478")?.host, "2001:db8::1");
  assert.equal(parseIceUrl("stun:turn.example.com:3478")?.relay, false);
  for (const bad of [
    "stun://turn.example.com:3478",
    "turn:user:pass@turn.example.com:3478",
    "stun:turn.example.com",
    "stun:turn.example.com:3478?transport=udp",
    "turn:turn.example.com:3478?transport=sctp",
    "https://turn.example.com:3478",
    "turn:turn.example.com:3478/path",
    "",
  ]) {
    assert.equal(parseIceUrl(bad), null, bad);
  }
});
