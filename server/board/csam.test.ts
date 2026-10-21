import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { readForMember } from "../media/service.ts";
import { CSAM_QUEUE_SQL, HOLD_MS, holdKeyError, openHold, purgeExpiredHolds, withHoldKey } from "./csam.ts";
import { createPost, decideAppeal, fileAppeal, listBoard, removePost } from "./store.ts";

process.env.CSAM_HOLD_KEY = "test-hold-key-value";

const now = new Date("2026-10-19T12:00:00Z");
const claim = "Sharpened the chisels in the shop on Thursday afternoon.";

async function user(db: Db, id: string, name: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
}

async function grant(
  db: Db,
  userId: string,
  name: string,
  role: "member" | "steward" | "admin",
  roomId = "",
) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

test("the admin queue selects no sealed column", () => {
  assert.equal(/\bsealed\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(/\bclaim\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(/\bfile_key\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(CSAM_QUEUE_SQL.includes("cybertipline"), false);
});

test("an unset hold key refuses the removal and leaves the post up", async () => {
  assert.match(holdKeyError("") ?? "", /CSAM_HOLD_KEY/);
  assert.match(holdKeyError("short") ?? "", /CSAM_HOLD_KEY/);
  assert.equal(holdKeyError("test-hold-key-value"), null);
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria-nokey@example.com");
    await user(db, tom, "Tom", "tom-nokey@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim,
        reason: "Tom checked them on Thursday.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await withHoldKey(undefined, () =>
      removePost(db, {
        userId: tom,
        name: "Tom",
        postId: posted.value.id,
        reason: "csam",
        now,
      }),
    );
    assert.equal(removed.ok, false);
    if (removed.ok) return;
    assert.equal(removed.status, 503);
    assert.match(removed.error, /CSAM_HOLD_KEY/);
    const stored = await db.query<{ claim: string; removed: boolean }>(
      `select claim, removed from board_post where id = $1`,
      [posted.value.id],
    );
    assert.equal(stored[0]?.removed, false);
    assert.equal(stored[0]?.claim, claim);
  } finally {
    await close();
  }
});

test("CSAM is removed, banned, held for 90 days, and never returned", async () => {
  await withHoldKey("test-hold-key-value", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");

    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim,
        reason: "Tom checked them on Thursday.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const mediaId = randomUUID();
    const fileKey = `ready/${mediaId}/file`;
    await db.query(
      `insert into media_object (
        id, owner_user_id, scope, kind, status, content_type, byte_size,
        room_id, post_id, encryption, upload_key, file_key
      ) values ($1, $2, 'room', 'image', 'ready', 'image/jpeg', 4, 'shop', $3, 'server-processed', $4, $5)`,
      [mediaId, maria, posted.value.id, `incoming/${mediaId}`, fileKey],
    );
    const store = createMemoryStore();
    await store.put(fileKey, Uint8Array.of(1, 2, 3, 4), "image/jpeg");

    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "csam",
      now,
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.ban.reason, "csam");
    assert.equal(removed.value.ban.strikes, 1);

    const stored = await db.query<{ claim: string; reason: string }>(
      `select claim, reason from board_post where id = $1`,
      [posted.value.id],
    );
    assert.equal(stored[0]?.claim, "[removed]");
    assert.equal(stored[0]?.reason, "");
    const hold = await db.query<{ sealed: string; retain_until: Date | string }>(
      `select sealed, retain_until from board_csam_hold where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(hold.length, 1);
    assert.equal(hold[0]?.sealed.includes(claim), false);
    const opened = openHold(hold[0]?.sealed ?? "");
    assert.equal(opened.claim, claim);
    assert.equal(opened.files[0]?.fileKey, fileKey);
    const kept = await db.query<{ deleted_at: Date | string | null }>(
      `select deleted_at from media_object where id = $1`,
      [mediaId],
    );
    assert.equal(kept[0]?.deleted_at, null);

    const reading = await readForMember(
      { db, store, now: () => now, videoEnabled: false },
      maria,
      mediaId,
    );
    assert.equal(reading.ok, false);
    if (reading.ok) return;
    assert.equal(reading.status, 404);

    const member = await listBoard(db, maria, now);
    const admin = await listBoard(db, josh, now);
    assert.equal(member.ok, false);
    assert.equal(admin.ok, true);
    if (member.ok || !admin.ok) return;
    assert.equal(JSON.stringify(admin.value).includes(claim), false);
    assert.equal(admin.value.csamReports.length, 1);
    const report = admin.value.csamReports[0];
    assert.equal(report?.status, "prepared");
    assert.equal(report?.mediaCount, 1);
    assert.equal(report?.byteSize, 4);
    assert.deepEqual(report?.mediaTypes, ["image/jpeg"]);
    assert.equal(report?.accountId, maria);
    assert.equal("sealed" in (report ?? {}), false);
    assert.equal(report && "fileKey" in report, false);

    const early = new Date(now.getTime() + 89 * 24 * 60 * 60 * 1000);
    assert.equal(await purgeExpiredHolds(db, early), 0);
    const still = await db.query<{ sealed: string }>(
      `select sealed from board_csam_hold where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(openHold(still[0]?.sealed ?? "").claim, claim);

    const blocked = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim: "A later post that should not file.",
        reason: "Tom was there on Friday.",
        on: "2026-10-18",
      },
      now: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
    });
    assert.equal(blocked.ok, false);

    const appealed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      kind: "removal",
      reason: "Please put the post back up.",
      now,
    });
    assert.equal(appealed.ok, true);
    if (!appealed.ok) return;
    const lifted = await decideAppeal(db, {
      userId: tom,
      name: "Tom",
      appealId: appealed.value.id,
      decision: "lift",
      reason: "The post should come back.",
      now,
    });
    assert.equal(lifted.ok, false);
    const upheld = await decideAppeal(db, {
      userId: tom,
      name: "Tom",
      appealId: appealed.value.id,
      decision: "uphold",
      reason: "The removal stays on the record.",
      now,
    });
    assert.equal(upheld.ok, true);
    if (!upheld.ok) return;
    assert.equal(upheld.value.appeal.decision, "uphold");
    assert.equal(upheld.value.posts.length, 0);

    const due = new Date(now.getTime() + HOLD_MS);
    assert.equal(await purgeExpiredHolds(db, due), 1);
    const wiped = await db.query<{ sealed: string; purged_at: Date | string | null }>(
      `select sealed, purged_at from board_csam_hold where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(wiped[0]?.sealed, "");
    assert.ok(wiped[0]?.purged_at);
    const gone = await db.query<{ deleted_at: Date | string | null }>(
      `select deleted_at from media_object where id = $1`,
      [mediaId],
    );
    assert.ok(gone[0]?.deleted_at);
    const after = await listBoard(db, josh, due);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.csamReports.length, 0);
    assert.equal(JSON.stringify(after.value).includes(claim), false);
  } finally {
    await close();
  }
  });
});
