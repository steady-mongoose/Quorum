import assert from "node:assert/strict";
import test from "node:test";
import { ignoreRemoteOffer, isPolitePeer, needsRollback } from "./negotiate.ts";

test("the smaller id is the one that yields", () => {
  assert.equal(isPolitePeer("ada", "bob"), true);
  assert.equal(isPolitePeer("bob", "ada"), false);
  assert.equal(isPolitePeer("ada", "ada"), false);
});

test("glare keeps the impolite offer and rolls the polite one back", () => {
  const glare = { makingOffer: true, signalingState: "have-local-offer", polite: false };
  assert.equal(ignoreRemoteOffer(glare), true);
  assert.equal(needsRollback(glare), false);
  const polite = { ...glare, polite: true };
  assert.equal(ignoreRemoteOffer(polite), false);
  assert.equal(needsRollback(polite), true);
  const calm = { makingOffer: false, signalingState: "stable", polite: true };
  assert.equal(ignoreRemoteOffer(calm), false);
  assert.equal(needsRollback(calm), false);
  const closed = { makingOffer: false, signalingState: "closed", polite: true };
  assert.equal(ignoreRemoteOffer(closed), true);
  assert.equal(needsRollback(closed), false);
});
