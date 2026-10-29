import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { readCsamQueue, setCustodian } from "./csam-custody.ts";
import { flagCsam, removeFlagged } from "./csam-flag.ts";
import { listBoard } from "./store.ts";
import { createPost } from "./test-posting.ts";

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

test("listBoard tells an admin whether they are a custodian", async () => {
  const { db, close } = await setup();
  try {
    const ann = await listBoard(db, "ann", now);
    const di = await listBoard(db, "di", now);
    assert.equal(ann.ok && ann.value.csamCustodian, true);
    assert.equal(di.ok && di.value.csamCustodian, false);
    const maria = await listBoard(db, "maria", now);
    assert.equal(maria.ok && maria.value.csamCustodian, false);
  } finally {
    await close();
  }
});

test("a non-custodian admin gets no queue data, and a member is refused", async () => {
  const { db, close, postId } = await setup();
  try {
    await flagCsam(db, { userId: "rae", name: "rae", postId, reason: "child", now });
    const di = await readCsamQueue(db, { userId: "di", now });
    assert.equal(di.ok, true);
    if (di.ok) assert.deepEqual(di.value, { custodian: false, owner: false, reports: [], flags: [], admins: [] });
    const maria = await readCsamQueue(db, { userId: "maria", now });
    assert.equal(maria.ok, false);
  } finally {
    await close();
  }
});

test("a custodian sees flag metadata only, never the words or a file link", async () => {
  const { db, close, postId, mediaId } = await setup();
  try {
    await flagCsam(db, { userId: "rae", name: "rae", postId, reason: "A child.", now });
    const queue = await readCsamQueue(db, { userId: "ann", now });
    assert.equal(queue.ok, true);
    if (!queue.ok) return;
    const [flag] = queue.value.flags;
    assert.ok(flag);
    assert.equal(flag.reporter, "rae");
    assert.equal(flag.reason, "A child.");
    assert.equal(flag.uploader, "maria");
    assert.deepEqual(flag.fileIds, [mediaId]);
    assert.equal(flag.at, now.getTime());
    const text = JSON.stringify(queue.value);
    assert.equal(text.includes(claim), false);
    assert.equal(/url|ready\//i.test(text), false);
  } finally {
    await close();
  }
});

test("a custodian preserves and removes a flagged post blind, and the hold keeps a hash", async () => {
  const { db, close, store, postId, mediaId, bytes } = await setup();
  try {
    await flagCsam(db, { userId: "rae", name: "rae", postId, reason: "A child.", now });
    const refused = await removeFlagged(db, { userId: "di", name: "di", flagId: "x", now, store });
    assert.equal(refused.ok, false);
    const queue = await readCsamQueue(db, { userId: "ann", now });
    const flagId = queue.ok ? queue.value.flags[0]?.id ?? "" : "";
    const removed = await removeFlagged(db, { userId: "ann", name: "ann", flagId, now, store });
    assert.equal(removed.ok, true);
    const after = await readCsamQueue(db, { userId: "ann", now });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.flags.length, 0);
    const [report] = after.value.reports;
    assert.ok(report);
    assert.deepEqual(report.fileIds, [mediaId]);
    assert.deepEqual(report.fileHashes, [createHash("sha256").update(bytes).digest("hex")]);
    assert.equal(report.reporter, "rae");
    assert.equal(report.reportReason, "A child.");
    assert.equal(report.author, "maria");
    assert.equal(JSON.stringify(after.value).includes(claim), false);
    const actions = await db.query<{ action: string }>(`select action from csam_access_log`);
    assert.ok(actions.some((row) => row.action === "remove_flagged"));
    assert.ok(actions.some((row) => row.action === "flag"));
  } finally {
    await close();
  }
});

test("the owner sees admins to name as custodians", async () => {
  const { db, close } = await setup();
  try {
    const queue = await readCsamQueue(db, { userId: "owner", now });
    assert.equal(queue.ok, true);
    if (!queue.ok) return;
    assert.equal(queue.value.owner, true);
    assert.deepEqual(
      queue.value.admins.map((a) => [a.id, a.custodian]),
      [["ann", true], ["di", false]],
    );
    const ann = await readCsamQueue(db, { userId: "ann", now });
    assert.equal(ann.ok && ann.value.admins.length, 0);
  } finally {
    await close();
  }
});
