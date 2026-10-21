import assert from "node:assert/strict";
import test from "node:test";
import { orderPosts } from "./order.ts";

test("posts sort by the fixed tier, then newest, never by a score", () => {
  const ordered = orderPosts([
    { id: "sloppy", mark: "sloppy", type: "did", closed: false, cardId: "", at: 50, likes: 100 },
    { id: "old", mark: null, type: "did", closed: false, cardId: "", at: 1, score: 9 },
    { id: "new", mark: null, type: "asked", closed: false, cardId: "", at: 9 },
    { id: "hosted", mark: null, type: "hosted", closed: false, cardId: "card", at: 2, reshares: 4 },
    { id: "noted", mark: null, type: "noted", closed: false, cardId: "", at: 40 },
    { id: "scope", mark: "out_of_scope", type: "did", closed: false, cardId: "", at: 30 },
    { id: "legs", mark: "unsupported", type: "did", closed: false, cardId: "", at: 80 },
  ]);
  assert.deepEqual(
    ordered.map((post) => post.id),
    ["hosted", "scope", "new", "old", "noted", "legs", "sloppy"],
  );
  assert.equal(
    ordered.some((post) => post.id === "scope"),
    true,
  );
});
