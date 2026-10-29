import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { flagCsam } from "../board/csam-flag.ts";
import { createMemoryStore } from "./memory-store.ts";
import { prepareUpload, readForMember, type MediaServiceDeps } from "./service.ts";

const now = new Date("2026-10-27T12:00:00Z");

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, now(), now())`,
    [id, `${id}@example.test`],
  );
}

async function admin(db: Db, id: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'n', 'admin', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
    [randomUUID(), id, now],
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  for (const id of ["owner", "ann", "josh"]) await user(db, id);
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', 'owner')
                  on conflict (id) do update set user_id = excluded.user_id`);
  await admin(db, "ann");
  // Josh, the owner and the admin all stand in the room, so only the block can refuse them.
  for (const id of ["josh", "owner", "ann"]) {
    await db.query(`insert into room_member (room_id, user_id) values ('shop', $1) on conflict do nothing`, [id]);
  }
  await db.query(`insert into room_post (id, room_id, author_user_id) values ('post-1', 'shop', 'josh')`);
  const deps: MediaServiceDeps = { db, store: createMemoryStore(), now: () => now, videoEnabled: true };
  const prepared = await prepareUpload(deps, "josh", {
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 4,
    scope: "room",
    roomId: "shop",
    postId: "post-1",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("upload");
  const id = prepared.body.id;
  await db.query(`update media_object set status = 'ready', file_key = $2 where id = $1`, [id, `media/${id}`]);
  return { ...opened, deps, id };
}

const everyone = ["josh", "owner", "ann"];

test("a ready room picture is served before any report", async () => {
  const { close, deps, id } = await setup();
  try {
    for (const who of everyone) {
      const read = await readForMember(deps, who, id);
      assert.equal(read.ok, true, who);
      if (read.ok) assert.ok(read.body.url, who);
    }
  } finally {
    await close();
  }
});

test("a single member report blocks the file for the uploader, an admin and the owner", async () => {
  const { db, close, deps, id } = await setup();
  try {
    const flagged = await flagCsam(db, { userId: "ann", name: "ann", postId: "post-1", now });
    assert.equal(flagged.ok, true);
    for (const who of everyone) {
      const read = await readForMember(deps, who, id);
      assert.equal(read.ok, false, who);
      if (!read.ok) assert.equal(read.status, 404, who);
      assert.equal(JSON.stringify(read).includes("url"), false, who);
    }
  } finally {
    await close();
  }
});

test("a scanner flag on one file blocks that file for everyone", async () => {
  const { db, close, deps, id } = await setup();
  try {
    const flagged = await flagCsam(db, { userId: "", name: "scanner", mediaId: id, source: "scanner", now });
    assert.equal(flagged.ok, true);
    for (const who of everyone) assert.equal((await readForMember(deps, who, id)).ok, false, who);
  } finally {
    await close();
  }
});

test("a held post's file is refused to everyone, the owner and admins included", async () => {
  const { db, close, deps, id } = await setup();
  try {
    await db.query(
      `insert into board_csam_hold (id, post_id, post_ids, room_id, author_user_id, author_name,
         sealed, media_count, byte_size, created_at, retain_until)
       values ($1, 'post-1', array['post-1'], 'shop', 'josh', 'josh', 'x', 1, 4, $2, $3)`,
      [randomUUID(), now, new Date(now.getTime() + 365 * 86_400_000)],
    );
    for (const who of everyone) assert.equal((await readForMember(deps, who, id)).ok, false, who);
  } finally {
    await close();
  }
});
