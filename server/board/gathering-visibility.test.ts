import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { cardListed, newCard } from "../../src/lib/board/model.ts";
import { listGatheringsFor, saveGathering } from "./gathering-record.ts";
import { removePost } from "./store.ts";
import { createPost } from "./test-posting.ts";

const now = new Date("2026-10-27T12:00:00Z");

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.test`, now],
  );
}

async function grant(db: Db, userId: string, name: string, role: string, roomId = "") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

test("a new gathering shows to the room's members, not only its host", async () => {
  const { db, close } = await openTestDb();
  try {
    const henry = randomUUID();
    const mary = randomUUID();
    const mark = randomUUID();
    const sam = randomUUID();
    for (const [id, name] of [
      [henry, "Henry"],
      [mary, "Mary"],
      [mark, "Mark"],
      [sam, "Sam"],
    ] as const) {
      await user(db, id, name);
      await grant(db, id, name, "member");
    }
    await grant(db, sam, "Sam", "steward", "shop");
    const id = randomUUID();
    const saved = await saveGathering(db, {
      userId: henry,
      roomId: "shop",
      id,
      title: "TEST Bench Night",
      date: "2026-10-30",
      time: "7 p.m.",
      place: "The shop",
      now,
    });
    assert.equal(saved.ok, true);

    const forMary = await listGatheringsFor(db, { userId: mary, now });
    const row = forMary.find((item) => item.id === id);
    assert.ok(row, "another member sees the gathering");
    assert.equal(row.mine, false);
    assert.equal((await listGatheringsFor(db, { userId: henry, now }))[0]?.mine, true);

    const posted = await createPost(db, {
      userId: mark,
      name: "Mark",
      roomId: "shop",
      body: {
        type: "did",
        claim: "Swept the shop floor.",
        reason: "Sam saw it.",
        on: "2026-10-26",
      },
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await removePost(db, {
      userId: sam,
      name: "Sam",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    const forMark = await listGatheringsFor(db, { userId: mark, now });
    assert.equal(
      forMark.some((item) => item.id === id),
      false,
      "a member barred from the room does not",
    );
  } finally {
    await close();
  }
});

test("a meeting card lists as soon as it is saved", () => {
  const card = newCard({
    room: "shop",
    kind: "meeting",
    name: "TEST Bench Night",
    place: "The shop",
    time: "Thursday 7 p.m.",
    host: "Henry",
    wentBy: ["Henry"],
    next: "2026-10-30",
  });
  assert.equal(cardListed(card, new Map()), true);
  assert.equal(cardListed({ ...card, wentBy: [] }, new Map()), true);
  assert.equal(cardListed({ ...card, lastFour: [false, false] }, new Map()), false);
});

test("sharing shows and copies the public link", () => {
  const share = readFileSync(
    new URL("../../src/components/board/gathering-share.tsx", import.meta.url),
    "utf8",
  );
  assert.match(share, /const link = gatheringPublicUrl\(card\.id\)/);
  assert.match(share, /Copy link/);
  assert.match(share, /navigator\.clipboard\.writeText/);
  assert.match(share, /checked=\{wanted \?\? shared\}/);
  assert.equal(share.includes("disabled={pending}"), false);
});
