import assert from "node:assert/strict";
import test from "node:test";
import {
  POST_TYPES,
  ROOMS,
  blankDraft,
  composerCheck,
  postButtonLabel,
  roomById,
  typesFor,
  type CheckContext,
} from "./model.ts";

const ctx: CheckContext = {
  author: "Josh",
  steward: false,
  posts: [],
  cards: [],
  removals: [],
  now: Date.now(),
};

test("a Share post needs only the writing: no reason, no date, no card", () => {
  const meta = POST_TYPES.find((item) => item.id === "shared");
  assert.ok(meta);
  assert.equal(meta.label, "Share");
  assert.equal(meta.reasonLabel, undefined);
  assert.equal(meta.dateLabel, undefined);
  assert.equal(meta.cardPick, "none");
  assert.equal(POST_TYPES[0]?.id, "shared", "Share is the first choice in the composer");
  assert.equal(postButtonLabel("shared"), "Share");

  const check = composerCheck(
    { ...blankDraft("shop"), type: "shared", claim: "The new bench vise is mounted by the door." },
    ctx,
  );
  assert.equal(check.ok, true);

  const empty = composerCheck({ ...blankDraft("shop"), type: "shared" }, ctx);
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.fields?.claim, ["Missing: what you want to share."]);
});

test("every room that takes member posts takes a Share post, churches included", () => {
  for (const room of ROOMS) {
    if (room.takes.length === 0) {
      assert.equal(room.takes.includes("shared"), false, `${room.id} stays steward-only`);
      continue;
    }
    assert.equal(room.takes.includes("shared"), true, `${room.id} takes a Share post`);
  }
  assert.equal(typesFor(roomById("baptist"), false).includes("shared"), true);
});

test("a Share post is held to the same hard rules as every other post", () => {
  const threat = composerCheck(
    { ...blankDraft("shop"), type: "shared", claim: "I'll hurt him if he comes back." },
    ctx,
  );
  assert.equal(threat.ok, false);
});
