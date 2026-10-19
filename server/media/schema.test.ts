import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";

test("media tables exist, and a room row cannot carry a message key", async () => {
  const { db, close } = await openTestDb();
  try {
    const id = randomUUID();
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Josh', 'josh@example.com', true, now(), now())`,
      [id],
    );
    await assert.rejects(() =>
      db.query(
        `insert into media_object (
          id, owner_user_id, scope, kind, status, content_type, byte_size,
          room_id, post_id, encryption, key_envelope, upload_key
        ) values ($1, $2, 'room', 'image', 'pending', 'image/jpeg', 10, 'shop', 'post-1', 'server-processed', 'nope', $3)`,
        [randomUUID(), id, `incoming/${randomUUID()}`],
      ),
    );
    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename in ('media_object', 'media_job')`,
    );
    const names = indexes.map((row) => row.indexname);
    for (const name of [
      "media_object_owner_idx",
      "media_object_post_idx",
      "media_object_status_idx",
      "media_job_queue_idx",
    ]) {
      assert.equal(names.includes(name), true, name);
    }
  } finally {
    await close();
  }
});
