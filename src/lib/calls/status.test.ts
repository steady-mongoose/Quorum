import assert from "node:assert/strict";
import test from "node:test";
import { callsAreAvailable, parseCallJoin, parseCallPoll, refusesRecording } from "./status.ts";

test("the button needs calls on and recording off", () => {
  assert.equal(callsAreAvailable({ enabled: true, record: false }), true);
  assert.equal(callsAreAvailable({ enabled: false, record: false }), false);
  assert.equal(callsAreAvailable({ enabled: true, record: true }), false);
  assert.equal(callsAreAvailable({ enabled: true }), false);
  assert.equal(callsAreAvailable(null), false);
  assert.equal(refusesRecording({ record: false }), false);
  assert.equal(refusesRecording({ record: true }), true);
  assert.equal(refusesRecording({}), true);
});

test("a join with a vendor ICE server is refused by the page", () => {
  const good = parseCallJoin({
    selfId: "ada",
    peers: [{ id: "bob", name: "Bob", generation: 1 }],
    iceServers: [{ urls: "stun:turn.example.com:3478" }],
    cursor: 0,
    record: false,
  });
  assert.equal(good?.selfId, "ada");
  assert.equal(good?.peers[0]?.generation, 1);
  assert.equal(
    parseCallJoin({
      selfId: "ada",
      peers: [],
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      cursor: 0,
      record: false,
    }),
    null,
  );
  assert.equal(
    parseCallJoin({
      selfId: "ada",
      peers: [],
      iceServers: [],
      cursor: 0,
      record: true,
    }),
    null,
  );
});

test("a poll that claims recording is not applied", () => {
  assert.equal(
    parseCallPoll({
      peers: [{ id: "bob", name: "Bob", generation: 2 }],
      signals: [{ id: 4, from: "bob", kind: "offer", payload: { type: "offer", sdp: "v=0\r\n" } }],
      cursor: 4,
      record: false,
    })?.signals[0]?.kind,
    "offer",
  );
  assert.equal(
    parseCallPoll({
      peers: [],
      signals: [],
      cursor: 0,
      record: true,
    }),
    null,
  );
  assert.equal(
    parseCallPoll({
      peers: [],
      signals: [{ id: 1, from: "bob", kind: "record", payload: {} }],
      cursor: 1,
      record: false,
    }),
    null,
  );
});
