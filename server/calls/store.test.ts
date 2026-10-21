import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PEERS, PEER_TTL_MS, SIGNAL_LIMIT, callDisplayName, createCallStore } from "./store.ts";

const sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";

test("names lose control characters and stay short", () => {
  assert.equal(callDisplayName("  Ada\n"), "Ada");
  assert.equal(callDisplayName(""), "Member");
  assert.equal(callDisplayName("x".repeat(200)).length, 80);
});

test("a call holds six people, drops a stale peer, and does not replay old signals", () => {
  const store = createCallStore();
  for (let i = 1; i <= MAX_PEERS; i += 1) {
    const joined = store.join("shop", { id: `peer-${i}`, name: `Peer ${i}` }, 0);
    assert.equal(joined.ok, true);
  }
  const full = store.join("shop", { id: "peer-7", name: "Late" }, 0);
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.error, "That call is full.");

  const again = store.join("shop", { id: "peer-1", name: "Peer 1" }, 1_000);
  assert.equal(again.ok, true);
  if (again.ok) {
    const self = again.peers.find((peer) => peer.id === "peer-1");
    assert.equal(self, undefined);
    const other = again.peers.find((peer) => peer.id === "peer-2");
    assert.equal(other?.generation, 1);
  }

  const sent = store.signal(
    "shop",
    "peer-1",
    { to: "peer-2", kind: "offer", payload: { type: "offer", sdp, note: "no" } },
    1_000,
  );
  assert.equal(sent.ok, true);
  const early = store.poll("shop", "peer-2", 0, 1_000);
  assert.equal(early.ok, true);
  if (early.ok) {
    assert.equal(early.signals.length, 1);
    assert.deepEqual(early.signals[0]?.payload, { type: "offer", sdp });
    assert.equal(JSON.stringify(early.signals[0]).includes("note"), false);
  }
  const outsider = store.join("shop", { id: "peer-3", name: "Peer 3" }, 2_000);
  assert.equal(outsider.ok, true);
  const missed = store.poll("shop", "peer-3", 0, 2_000);
  assert.equal(missed.ok, true);
  if (missed.ok) assert.equal(missed.signals.length, 0);

  const later = store.poll("shop", "peer-1", 0, 1_000 + PEER_TTL_MS + 1);
  assert.equal(later.ok, true);
  if (later.ok)
    assert.equal(
      later.peers.some((peer) => peer.id === "peer-2"),
      false,
    );
  const gone = store.signal(
    "shop",
    "peer-1",
    { to: "peer-2", kind: "ice", payload: { candidate: "candidate:1" } },
    1_000 + PEER_TTL_MS + 1,
  );
  assert.equal(gone.ok, false);
});

test("signals are delivered once, only to the person they were sent to, and then stop", () => {
  const store = createCallStore();
  assert.equal(store.join("shop", { id: "ada", name: "Ada" }, 0).ok, true);
  const bob = store.join("shop", { id: "bob", name: "Bob" }, 0);
  assert.equal(bob.ok, true);
  if (bob.ok) assert.equal(bob.peers[0]?.generation, 1);

  assert.equal(
    store.signal("shop", "ada", { to: "bob", kind: "offer", payload: { type: "offer", sdp } }, 10)
      .ok,
    true,
  );
  const ada = store.poll("shop", "ada", 0, 20);
  assert.equal(ada.ok, true);
  if (ada.ok) assert.equal(ada.signals.length, 0);
  const first = store.poll("shop", "bob", 0, 20);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.signals.length, 1);
  assert.equal(first.signals[0]?.from, "ada");
  const second = store.poll("shop", "bob", first.cursor, 30);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.signals.length, 0);

  store.leave("shop", "ada");
  const left = store.poll("shop", "ada", 0, 40);
  assert.equal(left.ok, false);
  const bobAfter = store.poll("shop", "bob", 0, 40);
  assert.equal(bobAfter.ok, true);
  if (bobAfter.ok)
    assert.equal(
      bobAfter.peers.some((peer) => peer.id === "ada"),
      false,
    );
});

test("a rejoining member gets a new generation and does not receive the previous offer", () => {
  const store = createCallStore();
  store.join("shop", { id: "ada", name: "Ada" }, 0);
  store.join("shop", { id: "bob", name: "Bob" }, 0);
  store.signal("shop", "bob", { to: "ada", kind: "offer", payload: { type: "offer", sdp } }, 5);
  const rejoined = store.join("shop", { id: "ada", name: "Ada\u0000" }, 10);
  assert.equal(rejoined.ok, true);
  if (!rejoined.ok) return;
  assert.equal(rejoined.peers[0]?.name, "Bob");
  const bob = store.poll("shop", "bob", 0, 11);
  assert.equal(bob.ok, true);
  if (bob.ok) assert.equal(bob.peers[0]?.generation, 2);
  const ada = store.poll("shop", "ada", 0, 12);
  assert.equal(ada.ok, true);
  if (ada.ok) assert.equal(ada.signals.length, 0);
});

test("the signal rate has a ceiling, and a recording is not a signal", () => {
  const store = createCallStore();
  store.join("shop", { id: "ada", name: "Ada" }, 0);
  store.join("shop", { id: "bob", name: "Bob" }, 0);
  for (let i = 0; i < SIGNAL_LIMIT; i += 1) {
    const sent = store.signal(
      "shop",
      "ada",
      { to: "bob", kind: "ice", payload: { candidate: `candidate:${i}` } },
      100,
    );
    assert.equal(sent.ok, true);
  }
  const blocked = store.signal(
    "shop",
    "ada",
    { to: "bob", kind: "ice", payload: { candidate: "candidate:more" } },
    100,
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 429);
  const recorded = store.signal(
    "shop",
    "ada",
    { to: "bob", kind: "record", payload: { bytes: "no" } },
    20_000,
  );
  assert.equal(recorded.ok, false);
  if (!recorded.ok) assert.equal(recorded.status, 400);
});
