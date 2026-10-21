import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bindCallEviction, evictCallMember } from "./evict.ts";
import { createCallStore } from "./store.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("evictCallMember is the hook a ban or a removal calls", () => {
  const source = readFileSync(join(root, "server/calls/evict.ts"), "utf8");
  assert.match(source, /export function evictCallMember/);
  assert.match(source, /banMember/);
  assert.match(source, /removePost/);
  assert.match(source, /store\.leave\(roomId, userId\)/);
  const host = readFileSync(join(root, "server/host.ts"), "utf8");
  assert.match(host, /bindCallEviction\(callStore\)/);

  assert.equal(evictCallMember("ada"), 0);
  const store = createCallStore();
  store.join("shop", { id: "ada", name: "Ada" }, 0);
  store.join("county", { id: "ada", name: "Ada" }, 0);
  store.join("shop", { id: "bob", name: "Bob" }, 0);
  bindCallEviction(store);
  assert.equal(evictCallMember("ada"), 2);
  const bob = store.poll("shop", "bob", 0, 1);
  assert.equal(bob.ok, true);
  if (bob.ok)
    assert.equal(
      bob.peers.some((peer) => peer.id === "ada"),
      false,
    );
  assert.equal(store.poll("county", "ada", 0, 1).ok, false);
});
