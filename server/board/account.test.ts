import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HELD_POST_ERROR } from "../../src/lib/board/account-copy.ts";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  BANNED_DEACTIVATE_ERROR,
  REPORTED_POST_ERROR,
  deactivateAccount,
  deleteOwnPost,
  listDeletionRequests,
  reactivateAccount,
  requestAccountDeletion,
} from "./account.ts";
import { banMember, createPost, listBoard, replyToPost } from "./store.ts";

const now = new Date("2026-10-19T12:00:00Z");

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

async function user(db: Db, id: string, name: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
}

async function grant(db: Db, userId: string, name: string, role: "member" | "admin") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
    [randomUUID(), userId, name, role, now],
  );
}

function visibleIds(board: Awaited<ReturnType<typeof listBoard>>): string[] {
  assert.equal(board.ok, true);
  if (!board.ok) return [];
  return board.value.posts.map((post) => post.id);
}

test("migration 0030 stores author delete, deactivation, and a deletion queue", () => {
  const sql = readFileSync(new URL("../../migrations/0030_account_removal.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0030/);
  assert.match(sql, /0029 is the member report queue/);
  assert.match(sql, /author_deleted_at/);
  assert.match(sql, /deactivated_at/);
  assert.match(sql, /account_deletion_request/);
  assert.match(sql, /account_audit/);
  assert.match(sql, /deletion-requested/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/anonymize_/i.test(sql), false);
  assert.equal(sql.includes("0010_moderation"), false);
});

test("the author can delete a post and someone else cannot", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const reply = await replyToPost(db, {
      userId: josh,
      name: "Josh",
      postId: posted.value.id,
      claim: "They cut cleanly. I tried one.",
      now,
    });
    assert.equal(reply.ok, true);
    if (!reply.ok) return;

    const refused = await deleteOwnPost(db, { userId: josh, postId: posted.value.id, now });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 404);

    const deleted = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.equal(deleted.ok, true);
    const again = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 404);

    const board = await listBoard(db, josh, now, { room: "shop" });
    assert.equal(visibleIds(board).includes(posted.value.id), false);
    const replyRow = await db.query<{ author_deleted_at: Date | null }>(
      `select author_deleted_at from board_post where id = $1`,
      [reply.value.id],
    );
    assert.equal(replyRow[0]?.author_deleted_at ?? null, null);
  } finally {
    await close();
  }
});

test("an open CSAM hold blocks the author delete", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const reply = await replyToPost(db, {
      userId: josh,
      name: "Josh",
      postId: posted.value.id,
      claim: "They cut cleanly. I tried one.",
      now,
    });
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    const until = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db.query(
      `insert into board_csam_hold
       (id, post_id, post_ids, room_id, author_user_id, author_name, sealed, seal_status,
        media_count, byte_size, media_types, created_at, retain_until)
       values ($1, $2, $3, 'shop', $4, 'Maria', 'sealed', 'sealed', 0, 0, '{}', $5, $6)`,
      [randomUUID(), posted.value.id, [posted.value.id, reply.value.id], maria, now, until],
    );

    const blocked = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.status, 403);
      assert.equal(blocked.error, HELD_POST_ERROR);
    }
    const replyBlocked = await deleteOwnPost(db, { userId: josh, postId: reply.value.id, now });
    assert.equal(replyBlocked.ok, false);
    if (!replyBlocked.ok) assert.equal(replyBlocked.error, HELD_POST_ERROR);
    const row = await db.query<{ author_deleted_at: Date | null; claim: string }>(
      `select author_deleted_at, claim from board_post where id = $1`,
      [posted.value.id],
    );
    assert.equal(row[0]?.author_deleted_at ?? null, null);
    assert.match(row[0]?.claim ?? "", /chisels/);

    await db.query(`update board_csam_hold set purged_at = $2 where post_id = $1`, [
      posted.value.id,
      now,
    ]);
    const deleted = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.equal(deleted.ok, true);
  } finally {
    await close();
  }
});

test("deactivation hides posts until the member turns it back on", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.equal(visibleIds(await listBoard(db, josh, now, { room: "shop" })).includes(posted.value.id), true);

    const hidden = await deactivateAccount(db, { userId: maria, name: "Maria", now });
    assert.equal(hidden.ok, true);
    assert.equal(visibleIds(await listBoard(db, josh, now, { room: "shop" })).includes(posted.value.id), false);
    assert.equal(visibleIds(await listBoard(db, maria, now, { room: "shop" })).includes(posted.value.id), false);

    const back = await reactivateAccount(db, { userId: maria, name: "Maria", now });
    assert.equal(back.ok, true);
    assert.equal(visibleIds(await listBoard(db, josh, now, { room: "shop" })).includes(posted.value.id), true);
    const audit = await db.query<{ action: string }>(
      `select action from account_audit where user_id = $1 order by created_at asc, action asc`,
      [maria],
    );
    assert.deepEqual(
      audit.map((row) => row.action),
      ["deactivate", "reactivate"],
    );
  } finally {
    await close();
  }
});

test("a deletion request is queued once and only an admin can list it", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");

    const tooLong = await requestAccountDeletion(db, {
      userId: maria,
      name: "Maria",
      note: "x".repeat(501),
      now,
    });
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.equal(tooLong.status, 400);

    const filed = await requestAccountDeletion(db, {
      userId: maria,
      name: "Maria",
      note: "Please close this account.",
      now,
    });
    assert.equal(filed.ok, true);
    const again = await requestAccountDeletion(db, {
      userId: maria,
      name: "Maria",
      note: "A second note.",
      now,
    });
    assert.equal(again.ok, true);
    const requests = await db.query<{ note: string; status: string }>(
      `select note, status from account_deletion_request where user_id = $1`,
      [maria],
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.note, "Please close this account.");
    assert.equal(requests[0]?.status, "open");
    const audit = await db.query<{ action: string; detail: string }>(
      `select action, detail from account_audit where user_id = $1 and action = 'deletion-requested'`,
      [maria],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.detail, "Please close this account.");
    const still = await db.query<{ id: string }>(`select id from "user" where id = $1`, [maria]);
    assert.equal(still.length, 1);

    const refused = await listDeletionRequests(db, maria);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 403);
    const listed = await listDeletionRequests(db, josh);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0]?.name, "Maria");
    assert.equal(listed.value[0]?.note, "Please close this account.");
  } finally {
    await close();
  }
});

test("the delete route removes the author's post", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await grant(db, maria, "Maria", "member");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) return null;
        return { id, name: "Maria", email: "maria@example.com" };
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
    } satisfies AppDeps);
    const response = await handler(
      new Request(`http://127.0.0.1:8787/api/posts/${posted.value.id}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria },
        body: "{}",
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(visibleIds(await listBoard(db, maria, now, { room: "shop" })).includes(posted.value.id), false);
  } finally {
    await close();
  }
});

test("an open report blocks the author delete until it is closed", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await grant(db, maria, "Maria", "member");
    const posted = await createPost(db, { userId: maria, name: "Maria", roomId: "shop", body: did, now });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    // 0029's report queue is in the test database now: Maria's post is reported.
    await db.query(
      `insert into member_report
         (id, room_id, subject_kind, subject_id, reporter_user_id, reason, status, created_at)
       values ('r1', 'shop', 'post', $1, $2, 'threat', 'open', $3)`,
      [posted.value.id, maria, now],
    );
    const blocked = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.deepEqual(blocked, { ok: false, status: 409, error: REPORTED_POST_ERROR });
    await db.query(`update member_report set status = 'closed' where id = 'r1'`);
    const deleted = await deleteOwnPost(db, { userId: maria, postId: posted.value.id, now });
    assert.equal(deleted.ok, true);
  } finally {
    await close();
  }
});

test("a barred account cannot deactivate", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    const ruth = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, ruth, "Ruth", "ruth@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, ruth, "Ruth", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");
    const site = await banMember(db, { userId: josh, name: "Josh", email: "maria@example.com", reason: "threat", now });
    assert.equal(site.ok, true);
    const refused = await deactivateAccount(db, { userId: maria, name: "Maria", now });
    assert.deepEqual(refused, { ok: false, status: 403, error: BANNED_DEACTIVATE_ERROR });
    const flagged = await db.query<{ deactivated_at: unknown }>(
      `select deactivated_at from "user" where id = $1`,
      [maria],
    );
    assert.equal(flagged[0]?.deactivated_at, null);
    const room = await banMember(db, {
      userId: josh,
      name: "Josh",
      email: "ruth@example.com",
      reason: "threat",
      roomId: "shop",
      now,
    });
    assert.equal(room.ok, true);
    const roomRefused = await deactivateAccount(db, { userId: ruth, name: "Ruth", now });
    assert.equal(roomRefused.ok, false);
    const unbarred = await deactivateAccount(db, { userId: josh, name: "Josh", now });
    assert.equal(unbarred.ok, true);
  } finally {
    await close();
  }
});
