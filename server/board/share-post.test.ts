import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { contentStops } from "./check.ts";
import { createPost } from "./test-posting.ts";

const now = new Date("2026-10-29T12:00:00.000Z");

async function person(db: Db, name: string) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
  return id;
}

const room = { name: "The Shop", takes: ["shared", "did", "asked", "hosted"], stewardTakes: ["noted"] };
const base = {
  claim: "",
  reason: "",
  on: "",
  next: "",
  came: [] as string[],
  named: "",
  author: "Tom",
  attested: false,
  mediaCount: 0,
  steward: false,
  room,
};

test("the server takes a Share post with only the writing and one picture", () => {
  assert.deepEqual(
    contentStops({ ...base, type: "shared", claim: "Pictures from the lathe night.", mediaCount: 1 }),
    [],
  );
  assert.deepEqual(contentStops({ ...base, type: "shared" }), ["Write the post."]);
  assert.deepEqual(
    contentStops({ ...base, type: "shared", claim: "Two from the night.", mediaCount: 2 }),
    ["One picture per post."],
  );
  assert.deepEqual(
    contentStops({ ...base, type: "shared", claim: "Lathe night.", room: { ...room, takes: ["hosted"] } }),
    ["The Shop does not take that kind of post."],
  );
  assert.deepEqual(
    contentStops({ ...base, type: "shared", claim: "I'll hurt him if he comes back." }),
    ["That reads as a threat and will not post."],
  );
});

test("after the migration every member room takes a Share post, and the steward-only room does not", async () => {
  const { db, close } = await openTestDb();
  try {
    const rows = await db.query<{ id: string; takes: string[] }>(`select id, takes from room`);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      if (row.takes.length === 0) continue;
      assert.equal(row.takes.includes("shared"), true, `${row.id} takes a Share post`);
      assert.equal(row.takes.filter((item) => item === "shared").length, 1);
    }
    const baptist = rows.find((row) => row.id === "baptist");
    assert.deepEqual(baptist?.takes, ["shared", "hosted"]);
    const dispatch = rows.find((row) => row.id === "dispatch");
    assert.deepEqual(dispatch?.takes, []);
  } finally {
    await close();
  }
});

test("a member posts a Share in a church room and in the shop", async () => {
  const { db, close } = await openTestDb();
  try {
    const tom = await person(db, "Tom");
    for (const roomId of ["baptist", "shop"]) {
      const post = await createPost(db, {
        userId: tom,
        name: "Tom",
        roomId,
        body: { type: "shared", claim: "Please pray for the Hale family this week." },
        now,
      });
      assert.equal(post.ok, true, post.ok ? "" : post.error);
      if (!post.ok) return;
      const stored = await db.query<{ type: string; reason: string; on_date: string }>(
        `select type, reason, on_date from board_post where id = $1`,
        [post.value.id],
      );
      assert.deepEqual(stored[0], { type: "shared", reason: "", on_date: "" });
    }
  } finally {
    await close();
  }
});
