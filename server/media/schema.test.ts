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
      "media_object_peer_idx",
      "media_job_queue_idx",
    ]) {
      assert.equal(names.includes(name), true, name);
    }
  } finally {
    await close();
  }
});

test("deleting a member keeps a message picture the other person sent", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    for (const [id, email] of [
      [maria, "maria@example.com"],
      [josh, "josh@example.com"],
    ] as const) {
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $1, $2, true, now(), now())`,
        [id, email],
      );
    }
    const mediaId = randomUUID();
    await db.query(
      `insert into media_object (
        id, owner_user_id, scope, kind, status, content_type, byte_size,
        peer_user_id, encryption, key_envelope, upload_key, file_key
      ) values ($1, $2, 'dm', 'image', 'ready', 'image/jpeg', 4, $3, 'client-e2e', 'wrapped', $4, $4)`,
      [mediaId, maria, josh, `dm/${mediaId}/cipher`],
    );
    await db.query(`delete from "user" where id = $1`, [josh]);
    const kept = await db.query<{
      owner_user_id: string;
      peer_user_id: string | null;
      deleted_at: string | null;
    }>(`select owner_user_id, peer_user_id, deleted_at from media_object where id = $1`, [mediaId]);
    assert.equal(kept[0]?.owner_user_id, maria);
    assert.equal(kept[0]?.peer_user_id, null);
    assert.equal(kept[0]?.deleted_at, null);
    await db.query(`delete from "user" where id = $1`, [maria]);
    const tomb = await db.query<{ owner_user_id: string | null; deleted_at: string | null }>(
      `select owner_user_id, deleted_at from media_object where id = $1`,
      [mediaId],
    );
    assert.equal(tomb[0]?.owner_user_id, null);
    assert.ok(tomb[0]?.deleted_at);
  } finally {
    await close();
  }
});
