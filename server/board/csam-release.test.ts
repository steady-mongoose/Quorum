import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { isCustodian, setCustodian } from "./csam-custody.ts";
import { FLAG_RECEIVED, confirmFlagRelease, flagCsam, listCsamFlags, mediaIsBlocked, memberFlagCsam, requestFlagRelease } from "./csam-flag.ts";
import { createPost } from "./store.ts";

process.env.CSAM_HOLD_KEY = "test-hold-key-value";
const now = new Date("2026-10-27T12:00:00Z");
const claim = "Sharpened the chisels in the shop on Thursday afternoon.";

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, $3, $3)`,
    [id, `${id}@example.test`, now],
  );
}

async function grant(db: Db, userId: string, role: "member" | "admin") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'n', $3, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), userId, role, now],
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  for (const id of ["owner", "ann", "di", "maria", "rae"]) await user(db, id);
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', 'owner')
                  on conflict (id) do update set user_id = excluded.user_id`);
  for (const id of ["ann", "di"]) await grant(db, id, "admin");
  for (const id of ["maria", "rae"]) await grant(db, id, "member");
  const custodian = await setCustodian(db, { userId: "owner", targetUserId: "ann", grant: true, now });
  assert.equal(custodian.ok, true);
  const posted = await createPost(db, {
    userId: "maria",
    name: "maria",
    roomId: "shop",
    body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-26" },
    now,
  });
  assert.equal(posted.ok, true);
  if (!posted.ok) throw new Error("post");
  const store = createMemoryStore();
  const mediaId = randomUUID();
  const fileKey = `ready/${mediaId}/file`;
  const bytes = Uint8Array.of(9, 8, 7, 6);
  await db.query(
    `insert into media_object (
      id, owner_user_id, scope, kind, status, content_type, byte_size,
      room_id, post_id, encryption, upload_key, file_key
    ) values ($1, 'maria', 'room', 'image', 'ready', 'image/jpeg', 4, 'shop', $2, 'server-processed', $3, $4)`,
    [mediaId, posted.value.id, `incoming/${mediaId}`, fileKey],
  );
  await store.put(fileKey, bytes, "image/jpeg");
  return { ...opened, store, postId: posted.value.id, mediaId, bytes };
}

async function ban(db: Db, userId: string, roomId = "") {
  await db.query(
    `insert into board_ban (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id, created_at)
     values ($1, $2, $2, 'threat', 'owner', 'owner', 1, $3, $4, $5)`,
    [randomUUID(), userId, new Date(now.getTime() + 86_400_000), roomId, now],
  );
}

const flagCount = async (db: Db) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from csam_flag`))[0]?.n ?? 0;

test("a member flag needs sight of the post, answers the same either way, and is rate-limited", async () => {
  const { db, close, postId, mediaId } = await setup();
  try {
    const seen = await memberFlagCsam(db, { userId: "rae", name: "rae", postId, reason: "x", now });
    assert.deepEqual(seen, { ok: true, value: { message: FLAG_RECEIVED } });
    assert.equal(await flagCount(db), 1);

    const missing = await memberFlagCsam(db, { userId: "rae", name: "rae", postId: "no-such-post", now });
    assert.deepEqual(missing, seen, "the same answer for a post that does not exist");
    assert.equal(await flagCount(db), 1, "nothing written for a missing post");

    await user(db, "outsider");
    const outsider = await memberFlagCsam(db, { userId: "outsider", name: "o", postId, now });
    assert.deepEqual(outsider, seen);
    const outsiderFile = await memberFlagCsam(db, { userId: "outsider", name: "o", mediaId, now });
    assert.deepEqual(outsiderFile, seen);
    assert.equal(await flagCount(db), 1, "nothing written for a post the member cannot see");

    await ban(db, "maria", "shop");
    assert.deepEqual(await memberFlagCsam(db, { userId: "maria", name: "m", postId, now }), seen);
    assert.equal(await flagCount(db), 1, "a member banned from the room cannot flag in it");

    let last: Awaited<ReturnType<typeof memberFlagCsam>> = seen;
    for (let i = 0; i < 12; i += 1) last = await memberFlagCsam(db, { userId: "rae", name: "rae", postId, now });
    assert.equal(last.ok, false);
    if (!last.ok) assert.equal(last.status, 429);
  } finally {
    await close();
  }
});

test("releasing a false flag is blind, needs a written reason and a second custodian, and is logged", async () => {
  const { db, close, postId, mediaId } = await setup();
  try {
    const flagged = await flagCsam(db, { userId: "rae", name: "rae", postId, now });
    assert.equal(flagged.ok, true);
    if (!flagged.ok) return;
    const flagId = flagged.value.id;
    assert.equal(await mediaIsBlocked(db, { id: mediaId, post_id: postId }), true);

    const short = await requestFlagRelease(db, { userId: "ann", flagId, reason: "false", now });
    assert.equal(short.ok, false);
    const notCustodian = await requestFlagRelease(db, { userId: "di", flagId, reason: "x".repeat(30), now });
    assert.equal(notCustodian.ok, false);

    const reason = "Scanner matched a stock photo of a cat.";
    assert.equal((await requestFlagRelease(db, { userId: "ann", flagId, reason, now })).ok, true);
    const forAnn = (await listCsamFlags(db, "ann")).find((flag) => flag.id === flagId);
    const forOwner = (await listCsamFlags(db, "owner")).find((flag) => flag.id === flagId);
    assert.equal(forAnn?.releaseRequestedByMe, true);
    assert.equal(forOwner?.releaseRequestedByMe, false);
    const self = await confirmFlagRelease(db, { userId: "ann", flagId, now });
    assert.deepEqual(self, { ok: false, status: 403, error: "A second custodian must confirm the release." });
    assert.equal(await mediaIsBlocked(db, { id: mediaId, post_id: postId }), true, "still blocked until confirmed");

    const confirmed = await confirmFlagRelease(db, { userId: "owner", flagId, now });
    assert.equal(confirmed.ok, true);
    assert.equal(await mediaIsBlocked(db, { id: mediaId, post_id: postId }), false);
    const row = await db.query<{ resolution: string; release_reason: string; released_by_user_id: string }>(
      `select resolution, release_reason, released_by_user_id from csam_flag where id = $1`,
      [flagId],
    );
    assert.deepEqual(row[0], { resolution: "released", release_reason: reason, released_by_user_id: "owner" });
    const log = await db.query<{ action: string }>(
      `select action from csam_access_log where action like 'release_%' order by created_at, action`,
    );
    assert.deepEqual(log.map((entry) => entry.action).sort(), ["release_confirmed", "release_requested"]);
  } finally {
    await close();
  }
});

test("a banned admin is not a custodian", async () => {
  const { db, close } = await setup();
  try {
    assert.equal(await isCustodian(db, "ann", undefined, now), true);
    await ban(db, "ann");
    assert.equal(await isCustodian(db, "ann", undefined, now), false);
    const flagged = await flagCsam(db, { userId: "rae", name: "rae", mediaId: randomUUID().slice(0, 8), now });
    assert.equal(flagged.ok, false);
  } finally {
    await close();
  }
});
