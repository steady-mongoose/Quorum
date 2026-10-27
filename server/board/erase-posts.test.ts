import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { ERASED_POST_TEXT, completeAccountDeletion, listDeletionRequests, requestAccountDeletion } from "./account.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { createPost } from "./store.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function person(db: Db, id: string, name: string, roles: ("member" | "admin")[]) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.com`, now],
  );
  for (const role of roles) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, role, now],
    );
  }
}

async function post(db: Db, userId: string, claim: string): Promise<string> {
  const posted = await createPost(db, {
    userId,
    name: "Maria",
    roomId: "shop",
    body: { type: "did", claim, reason: "Tom checked it.", on: "2026-10-18" },
    now,
  });
  if (!posted.ok) throw new Error(posted.error);
  return posted.value.id;
}

test("migration 0036 is marked for Josh's sign-off and only adds erased_at and an audit action", () => {
  const sql = readFileSync(new URL("../../migrations/0036_post_erasure.sql", import.meta.url), "utf8");
  assert.match(sql, /NEEDS JOSH'S SIGN-OFF/);
  assert.match(sql, /erased_at timestamptz/);
  assert.match(sql, /'deletion-completed'/);
  assert.equal(/create or replace function/i.test(sql), false);
});

test("completing a deletion erases the member's posts except held or reported ones", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await person(db, maria, "Maria", ["member"]);
    await person(db, josh, "Josh", ["member", "admin"]);
    const plain = await post(db, maria, "Sharpened the chisels.");
    const held = await post(db, maria, "Held post.");
    const reported = await post(db, maria, "Reported post.");
    const joshs = await post(db, josh, "Josh's own post.");
    await db.query(
      `insert into board_csam_hold
       (id, post_id, post_ids, room_id, author_user_id, author_name, sealed, seal_status,
        media_count, byte_size, media_types, created_at, retain_until)
       values ($1, $2, $3, 'shop', $4, 'Maria', 'sealed', 'sealed', 0, 0, '{}', $5, $5)`,
      [randomUUID(), held, [held], maria, now],
    );
    // 0029's report queue is in the test database: the reported post has an open report.
    await db.query(
      `insert into member_report
         (id, room_id, subject_kind, subject_id, reporter_user_id, reason, status, created_at)
       values ('r1', 'shop', 'post', $1, $2, 'threat', 'open', $3)`,
      [reported, maria, now],
    );

    assert.equal((await requestAccountDeletion(db, { userId: maria, name: "Maria", note: "", now })).ok, true);
    const [request] = await db.query<{ id: string }>(`select id from account_deletion_request`);
    assert.ok(request);

    const notAdmin = await completeAccountDeletion(db, { adminUserId: maria, requestId: request.id, now });
    assert.equal(notAdmin.ok, false);
    const done = await completeAccountDeletion(db, { adminUserId: josh, requestId: request.id, now });
    assert.deepEqual(done, { ok: true, value: { erased: 1, kept: 2 } });

    const rows = await db.query<{ id: string; claim: string; author_user_id: string | null; author_name: string; erased_at: unknown }>(
      `select id, claim, author_user_id, author_name, erased_at from board_post`,
    );
    const by = new Map(rows.map((row) => [row.id, row]));
    assert.equal(by.get(plain)?.claim, ERASED_POST_TEXT);
    assert.equal(by.get(plain)?.author_user_id, null);
    assert.equal(by.get(plain)?.author_name, "Former member");
    assert.ok(by.get(plain)?.erased_at);
    for (const kept of [held, reported]) {
      assert.equal(by.get(kept)?.author_user_id, maria, "a held or reported post is untouched");
      assert.equal(by.get(kept)?.erased_at, null);
    }
    assert.equal(by.get(joshs)?.claim, "Josh's own post.");

    const audit = await db.query<{ detail: string }>(
      `select detail from account_audit where action = 'deletion-completed'`,
    );
    assert.equal(audit[0]?.detail, "Posts erased: 1. Kept for a hold or open report: 2.");
    assert.equal(audit[0]?.detail.includes("chisels"), false);

    const again = await completeAccountDeletion(db, { adminUserId: josh, requestId: request.id, now });
    assert.equal(again.ok, false);
  } finally {
    await close();
  }
});

test("an admin cannot complete their own deletion request", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await person(db, josh, "Josh", ["member", "admin"]);
    await requestAccountDeletion(db, { userId: josh, name: "Josh", note: "", now });
    const [request] = await db.query<{ id: string }>(`select id from account_deletion_request`);
    const self = await completeAccountDeletion(db, { adminUserId: josh, requestId: request!.id, now });
    assert.equal(self.ok, false);
    const open = await db.query<{ status: string }>(`select status from account_deletion_request`);
    assert.equal(open[0]?.status, "open", "the request stays open");
  } finally {
    await close();
  }
});

test("erasing keeps a CSAM-flagged post and a removed post under appeal, deletes other files, and refuses a banned admin", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await person(db, maria, "Maria", ["member"]);
    await person(db, josh, "Josh", ["member", "admin"]);
    const plain = await post(db, maria, "Sharpened the chisels.");
    const flagged = await post(db, maria, "A flagged post.");
    const appealed = await post(db, maria, "A removed post under appeal.");
    await db.query(`create table if not exists csam_flag (
      id text primary key, post_id text not null default '', media_id text not null default '', resolved_at timestamptz)`);
    await db.query(`insert into csam_flag (id, post_id) values ($1, $2)`, [randomUUID(), flagged]);
    await db.query(`update board_post set removed = true where id = $1`, [appealed]);
    await db.query(
      `insert into board_appeal (id, room_id, post_id, author_user_id, author_name, kind, target_id, reason, created_at)
       values ($1, 'shop', $2, $3, 'Maria', 'removal', 'r1', 'This was not a threat.', $4)`,
      [randomUUID(), appealed, maria, now],
    );
    const store = createMemoryStore();
    const fileOf = async (postId: string) => {
      const id = randomUUID();
      await db.query(
        `insert into media_object (id, owner_user_id, scope, kind, status, content_type, byte_size, room_id, post_id,
           encryption, upload_key, file_key)
         values ($1, $2, 'room', 'image', 'ready', 'image/jpeg', 4, 'shop', $3, 'server-processed', $4, $5)`,
        [id, maria, postId, `incoming/${id}`, `ready/${id}/file`],
      );
      await store.put(`ready/${id}/file`, Uint8Array.of(1, 2), "image/jpeg");
      return `ready/${id}/file`;
    };
    const plainFile = await fileOf(plain);
    const flaggedFile = await fileOf(flagged);
    assert.equal((await requestAccountDeletion(db, { userId: maria, name: "Maria", note: "", now })).ok, true);
    const [row] = await db.query<{ id: string }>(`select id from account_deletion_request`);
    assert.ok(row);
    const request = { value: { id: row.id } };

    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Josh', 'threat', null, 'owner', 1, $3, '', $4)`,
      [randomUUID(), josh, new Date(now.getTime() + 86_400_000), now],
    );
    const banned = await completeAccountDeletion(db, { adminUserId: josh, requestId: request.value.id, now, store });
    assert.deepEqual(banned, { ok: false, status: 403, error: "This account is banned and cannot act as an admin right now." });
    assert.equal((await listDeletionRequests(db, josh, now)).ok, false);
    await db.query(`delete from board_ban where user_id = $1`, [josh]);

    const done = await completeAccountDeletion(db, { adminUserId: josh, requestId: request.value.id, now, store });
    assert.deepEqual(done, { ok: true, value: { erased: 1, kept: 2 } });
    const left = await db.query<{ id: string; erased: boolean }>(
      `select id, erased_at is not null as erased from board_post where id = any($1) order by claim`,
      [[plain, flagged, appealed]],
    );
    assert.deepEqual(
      Object.fromEntries(left.map((row) => [row.id, row.erased])),
      { [plain]: true, [flagged]: false, [appealed]: false },
    );
    assert.equal(store.objects.has(plainFile), false, "the erased post's file is deleted");
    assert.equal(store.objects.has(flaggedFile), true, "a kept post's file stays");
    assert.equal((await db.query(`select 1 from media_object where post_id = $1`, [plain])).length, 0);
  } finally {
    await close();
  }
});
