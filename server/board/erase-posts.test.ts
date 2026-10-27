import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { ERASED_POST_TEXT, completeAccountDeletion, requestAccountDeletion } from "./account.ts";
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
    await db.query(
      `create table if not exists member_report (
         id text primary key, room_id text not null, subject_kind text not null,
         subject_id text not null, status text not null default 'open'
       )`,
    );
    await db.query(
      `insert into member_report (id, room_id, subject_kind, subject_id, status) values ('r1', 'shop', 'post', $1, 'open')`,
      [reported],
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
