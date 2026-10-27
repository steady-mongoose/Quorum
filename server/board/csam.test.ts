import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { readForMember } from "../media/service.ts";
import {
  CSAM_QUEUE_SQL,
  HOLD_MS,
  STATUTORY_HOLD_DAYS,
  fileCsamReport,
  holdDays,
  holdKey,
  holdKeyError,
  openBytes,
  openHold,
  purgeExpiredHolds,
  rawHoldKey,
  heldUploadKey,
  holdKeyId,
  reencryptPendingHolds,
  RESEAL_LOCK_NAME,
  sealedObjectKey,
  warnMissingHoldKey,
  withHoldKey,
} from "./csam.ts";
import {
  createPost,
  decideAppeal,
  fileAppeal,
  listBoard,
  listOwnAppeals,
  markPost,
  removePost,
  setRemovePostAfterSaveForTests,
} from "./store.ts";

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

async function attachImage(
  db: Db,
  store: ReturnType<typeof createMemoryStore>,
  owner: string,
  postId: string,
  bytes: Uint8Array,
) {
  const mediaId = randomUUID();
  const fileKey = `ready/${mediaId}/file`;
  await db.query(
    `insert into media_object (
      id, owner_user_id, scope, kind, status, content_type, byte_size,
      room_id, post_id, encryption, upload_key, file_key
    ) values ($1, $2, 'room', 'image', 'ready', 'image/jpeg', $3, 'shop', $4, 'server-processed', $5, $6)`,
    [mediaId, owner, bytes.byteLength, postId, `incoming/${mediaId}`, fileKey],
  );
  await store.put(fileKey, bytes, "image/jpeg");
  return { mediaId, fileKey };
}

function failMediaClear(inner: Db): Db {
  const wrap = (db: Db): Db => ({
    async query<T>(text: string, params?: unknown[]) {
      if (text.includes("update media_object") && text.includes("upload_key")) {
        throw new Error("forced media clear failure");
      }
      return db.query<T>(text, params);
    },
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    session: db.session
      ? (fn) => {
          const run = db.session;
          return run ? run(fn) : fn(db);
        }
      : undefined,
  });
  return wrap(inner);
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
  // These tests read the hold queue as an admin, so name every admin a CSAM custodian.
  // csam-custody.test.ts covers the admin who is not one.
  if (role === "admin") {
    await db.query(`insert into csam_custodian (user_id) values ($1) on conflict do nothing`, [userId]);
  }
}

test("the admin queue selects no sealed column", () => {
  assert.equal(/\bsealed\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(/\bclaim\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(/\bfile_key\b/i.test(CSAM_QUEUE_SQL), false);
  assert.equal(CSAM_QUEUE_SQL.includes("cybertipline"), false);
});

test("a hold key is a random 32-byte key or an HKDF passphrase", () => {
  assert.match(holdKeyError("") ?? "", /CSAM_HOLD_KEY/);
  assert.match(holdKeyError("short") ?? "", /CSAM_HOLD_KEY/);
  assert.equal(holdKeyError("test-hold-key-value"), null);
  const hex = randomBytes(32).toString("hex");
  assert.equal(holdKeyError(hex), null);
  assert.equal(rawHoldKey(hex)?.length, 32);
  assert.equal(holdDays("90"), STATUTORY_HOLD_DAYS);
  assert.equal(holdDays("400"), 400);
  assert.equal(holdDays(""), STATUTORY_HOLD_DAYS);
});

test("an unset hold key keeps the text and media unserved until a key encrypts them", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria-nokey@example.com");
    await user(db, tom, "Tom", "tom-nokey@example.com");
    await user(db, josh, "Josh", "josh-nokey@example.com");
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
    const plain = Uint8Array.of(9, 8, 7, 6);
    await store.put(fileKey, plain, "image/jpeg");
    await withHoldKey(undefined, async () => {
      const removed = await removePost(db, {
        userId: tom,
        name: "Tom",
        postId: posted.value.id,
        reason: "csam",
        now,
        store,
      });
      assert.equal(removed.ok, true);
      if (!removed.ok) return;
      assert.equal(removed.value.ban.reason, "csam");
      const stored = await db.query<{ claim: string; removed: boolean }>(
        `select claim, removed from board_post where id = $1`,
        [posted.value.id],
      );
      assert.equal(stored[0]?.removed, true);
      assert.equal(stored[0]?.claim, "[removed]");
      const hold = await db.query<{ sealed: string; seal_status: string }>(
        `select sealed, seal_status from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(hold.length, 1);
      assert.equal(hold[0]?.seal_status, "pending_seal");
      const pending = JSON.parse(hold[0]?.sealed ?? "") as { claim: string };
      assert.equal(pending.claim, claim);
      assert.equal(await reencryptPendingHolds(db, store), 0);
      const alerts = await db.query<{ kind: string }>(`select kind from board_admin_alert`);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0]?.kind, "csam_pending_seal");
      assert.equal(store.objects.has(fileKey), false);
      const moved = [...store.objects.keys()];
      assert.equal(moved.length, 1);
      const heldKey = moved[0] ?? "";
      assert.equal(heldKey.startsWith("csam-hold/"), true);
      assert.deepEqual(store.objects.get(heldKey)?.bytes, plain);
      const reading = await readForMember(
        { db, store, now: () => now, videoEnabled: false },
        tom,
        mediaId,
      );
      assert.equal(reading.ok, false);
      const admin = await listBoard(db, josh, now);
      assert.equal(admin.ok, true);
      if (!admin.ok) return;
      assert.equal(admin.value.csamReports[0]?.status, "pending_seal");
      assert.equal(admin.value.adminAlerts[0]?.kind, "csam_pending_seal");
      assert.equal(JSON.stringify(admin.value).includes(claim), false);
      const bans = await db.query<{ reason: string; room_id: string }>(
        `select reason, room_id from board_ban where user_id = $1`,
        [maria],
      );
      assert.equal(bans[0]?.reason, "csam");
      assert.equal(bans[0]?.room_id, "");

      process.env.CSAM_HOLD_KEY = "test-hold-key-value";
      assert.equal(await reencryptPendingHolds(db, store), 1);
      const encrypted = store.objects.get(heldKey)?.bytes;
      assert.ok(encrypted);
      assert.notDeepEqual(encrypted, plain);
      assert.deepEqual(Array.from(openBytes(encrypted ?? new Uint8Array())), Array.from(plain));
      const sealed = await db.query<{ sealed: string; seal_status: string; key_id: string }>(
        `select sealed, seal_status, key_id from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(sealed[0]?.seal_status, "sealed");
      assert.equal(sealed[0]?.key_id, holdKeyId());
      assert.equal(sealed[0]?.sealed.startsWith("{"), false);
      assert.equal(openHold(sealed[0]?.sealed ?? "").claim, claim);
      assert.equal(await reencryptPendingHolds(db, store), 0);
      assert.deepEqual(store.objects.get(heldKey)?.bytes, encrypted);

      await db.query(
        `update board_csam_hold set sealed = $2, seal_status = 'pending_seal' where post_id = $1`,
        [posted.value.id, hold[0]?.sealed ?? ""],
      );
      assert.equal(await reencryptPendingHolds(db, store), 1);
      assert.deepEqual(store.objects.get(heldKey)?.bytes, encrypted);
      assert.deepEqual(
        Array.from(openBytes(store.objects.get(heldKey)?.bytes ?? new Uint8Array())),
        Array.from(plain),
      );
      assert.equal(await reencryptPendingHolds(db, store), 0);

      const after = await listBoard(db, josh, now);
      assert.equal(after.ok, true);
      if (!after.ok) return;
      assert.equal(after.value.csamReports[0]?.status, "prepared");
      assert.equal(JSON.stringify(after.value).includes(claim), false);
      const publicPost = await db.query<{ claim: string }>(
        `select claim from board_post where id = $1`,
        [posted.value.id],
      );
      assert.equal(publicPost[0]?.claim, "[removed]");
    });
  } finally {
    await close();
  }
});

test("a CSAM removal holds two files, and the next removal with media still hides the post", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      const josh = randomUUID();
      await user(db, maria, "Maria", "maria-two@example.com");
      await user(db, tom, "Tom", "tom-two@example.com");
      await user(db, josh, "Josh", "josh-two@example.com");
      await grant(db, maria, "Maria", "member");
      await grant(db, tom, "Tom", "member");
      await grant(db, tom, "Tom", "steward", "shop");
      await grant(db, josh, "Josh", "member");
      await grant(db, josh, "Josh", "admin");
      const first = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-18" },
        now,
      });
      const secondClaim = "Swept the shop floor after the chisels were put away.";
      const second = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: {
          type: "did",
          claim: secondClaim,
          reason: "Tom saw the floor on Thursday.",
          on: "2026-10-18",
        },
        now,
      });
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      const store = createMemoryStore();
      const left = Uint8Array.of(1, 2, 3, 4);
      const right = Uint8Array.of(5, 6, 7, 8);
      const later = Uint8Array.of(9, 9, 9, 9);
      const a = await attachImage(db, store, maria, first.value.id, left);
      const b = await attachImage(db, store, maria, first.value.id, right);
      const c = await attachImage(db, store, maria, second.value.id, later);
      const removed = await removePost(db, {
        userId: tom,
        name: "Tom",
        postId: first.value.id,
        reason: "csam",
        now,
        store,
      });
      assert.equal(removed.ok, true);
      const again = await removePost(db, {
        userId: josh,
        name: "Josh",
        postId: second.value.id,
        reason: "csam",
        now,
        store,
      });
      assert.equal(again.ok, true);
      const rows = await db.query<{ id: string; claim: string; removed: boolean; upload_key: string; file_key: string }>(
        `select p.id, p.claim, p.removed, m.upload_key, m.file_key
         from board_post p
         join media_object m on m.post_id = p.id
         where p.id = any($1::text[])
         order by m.upload_key`,
        [[first.value.id, second.value.id]],
      );
      assert.equal(rows.length, 3);
      assert.equal(rows.every((row) => row.removed && row.claim === "[removed]" && row.file_key === ""), true);
      assert.deepEqual(
        rows.map((row) => row.upload_key).sort(),
        [heldUploadKey(a.mediaId), heldUploadKey(b.mediaId), heldUploadKey(c.mediaId)].sort(),
      );
      assert.equal(store.objects.has(a.fileKey), false);
      assert.equal(store.objects.has(b.fileKey), false);
      assert.equal(store.objects.has(c.fileKey), false);
      const held = [...store.objects.keys()].filter((key) => key.startsWith("csam-hold/"));
      assert.equal(held.length, 3);
      const admin = await listBoard(db, josh, now);
      assert.equal(admin.ok, true);
      if (!admin.ok) return;
      assert.equal(JSON.stringify(admin.value).includes(claim), false);
      assert.equal(JSON.stringify(admin.value).includes(secondClaim), false);
      assert.equal(admin.value.csamReports.length, 2);
    } finally {
      await close();
    }
  });
});

test("a failed CSAM removal deletes the hold copies and leaves the post public", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      await user(db, maria, "Maria", "maria-fail@example.com");
      await user(db, tom, "Tom", "tom-fail@example.com");
      await grant(db, maria, "Maria", "member");
      await grant(db, tom, "Tom", "member");
      await grant(db, tom, "Tom", "steward", "shop");
      const posted = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-18" },
        now,
      });
      assert.equal(posted.ok, true);
      if (!posted.ok) return;
      const store = createMemoryStore();
      const plain = Uint8Array.of(4, 3, 2, 1);
      const media = await attachImage(db, store, maria, posted.value.id, plain);
      await assert.rejects(
        () =>
          removePost(failMediaClear(db), {
            userId: tom,
            name: "Tom",
            postId: posted.value.id,
            reason: "csam",
            now,
            store,
          }),
        /forced media clear failure/,
      );
      const stored = await db.query<{ claim: string; removed: boolean }>(
        `select claim, removed from board_post where id = $1`,
        [posted.value.id],
      );
      assert.equal(stored[0]?.removed, false);
      assert.equal(stored[0]?.claim, claim);
      const holds = await db.query<{ id: string }>(`select id from board_csam_hold`);
      assert.equal(holds.length, 0);
      const bans = await db.query<{ id: string }>(`select id from board_ban where user_id = $1`, [maria]);
      assert.equal(bans.length, 0);
      assert.deepEqual(store.objects.get(media.fileKey)?.bytes, plain);
      assert.equal([...store.objects.keys()].some((key) => key.startsWith("csam-hold/")), false);
    } finally {
      await close();
    }
  });
});

test("a committed hold stays when a later step throws", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      await user(db, maria, "Maria", "maria-later@example.com");
      await user(db, tom, "Tom", "tom-later@example.com");
      await grant(db, maria, "Maria", "member");
      await grant(db, tom, "Tom", "member");
      await grant(db, tom, "Tom", "steward", "shop");
      const posted = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-18" },
        now,
      });
      assert.equal(posted.ok, true);
      if (!posted.ok) return;
      const store = createMemoryStore();
      const plain = Uint8Array.of(3, 1, 4, 1);
      const media = await attachImage(db, store, maria, posted.value.id, plain);
      setRemovePostAfterSaveForTests(() => {
        throw new Error("after the save");
      });
      try {
        await assert.rejects(
          () =>
            removePost(db, {
              userId: tom,
              name: "Tom",
              postId: posted.value.id,
              reason: "csam",
              now,
              store,
            }),
          /after the save/,
        );
      } finally {
        setRemovePostAfterSaveForTests(undefined);
      }
      const stored = await db.query<{ claim: string; removed: boolean }>(
        `select claim, removed from board_post where id = $1`,
        [posted.value.id],
      );
      assert.equal(stored[0]?.removed, true);
      assert.equal(stored[0]?.claim, "[removed]");
      assert.equal(store.objects.has(media.fileKey), false);
      const held = [...store.objects.keys()].filter((key) => key.startsWith("csam-hold/"));
      assert.equal(held.length, 1);
      assert.deepEqual(
        Array.from(openBytes(store.objects.get(held[0] ?? "")?.bytes ?? new Uint8Array())),
        Array.from(plain),
      );
    } finally {
      await close();
    }
  });
});

test("a reseal logs and leaves the hold when the lock is already held", async () => {
  await withHoldKey(undefined, async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      await user(db, maria, "Maria", "maria-lock@example.com");
      await user(db, tom, "Tom", "tom-lock@example.com");
      await grant(db, maria, "Maria", "member");
      await grant(db, tom, "Tom", "member");
      await grant(db, tom, "Tom", "steward", "shop");
      const posted = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-18" },
        now,
      });
      assert.equal(posted.ok, true);
      if (!posted.ok) return;
      const store = createMemoryStore();
      const plain = Uint8Array.of(2, 2, 2, 2);
      await attachImage(db, store, maria, posted.value.id, plain);
      const removed = await removePost(db, {
        userId: tom,
        name: "Tom",
        postId: posted.value.id,
        reason: "csam",
        now,
        store,
      });
      assert.equal(removed.ok, true);
      process.env.CSAM_HOLD_KEY = "test-hold-key-value";
      const seen: string[] = [];
      const watching: Db = {
        async query<T>(text: string, params?: unknown[]) {
          seen.push(text);
          if (text.includes("pg_try_advisory_lock")) return [{ locked: false }] as T[];
          return db.query<T>(text, params);
        },
        transaction: (fn) => db.transaction(fn),
        session: (fn) => fn(watching),
      };
      const lines: string[] = [];
      const original = console.log;
      console.log = (message?: unknown, ...rest: unknown[]) => {
        lines.push(String(message));
        original(message, ...rest);
      };
      try {
        assert.equal(await reencryptPendingHolds(watching, store), 0);
      } finally {
        console.log = original;
      }
      assert.equal(lines.some((line) => line.includes("csam-hold-reseal-skipped")), true);
      assert.equal(lines.some((line) => line.includes("lock-held")), true);
      assert.equal(seen.some((sql) => sql.includes("pg_advisory_unlock")), false);
      assert.equal(seen.some((sql) => sql.includes("update board_csam_hold")), false);
      const heldKey = [...store.objects.keys()].find((key) => key.startsWith("csam-hold/")) ?? "";
      assert.deepEqual(store.objects.get(heldKey)?.bytes, plain);
      const pending = await db.query<{ seal_status: string }>(
        `select seal_status from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(pending[0]?.seal_status, "pending_seal");
    } finally {
      await close();
    }
  });
});

test("a reseal skips a hold marked with another key and takes the advisory lock", async () => {
  await withHoldKey(undefined, async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      await user(db, maria, "Maria", "maria-key@example.com");
      await user(db, tom, "Tom", "tom-key@example.com");
      await grant(db, maria, "Maria", "member");
      await grant(db, tom, "Tom", "member");
      await grant(db, tom, "Tom", "steward", "shop");
      const posted = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { type: "did", claim, reason: "Tom checked them on Thursday.", on: "2026-10-18" },
        now,
      });
      assert.equal(posted.ok, true);
      if (!posted.ok) return;
      const store = createMemoryStore();
      const plain = Uint8Array.of(8, 7, 6, 5);
      await attachImage(db, store, maria, posted.value.id, plain);
      const removed = await removePost(db, {
        userId: tom,
        name: "Tom",
        postId: posted.value.id,
        reason: "csam",
        now,
        store,
      });
      assert.equal(removed.ok, true);
      await db.query(`update board_csam_hold set key_id = 'other-key' where post_id = $1`, [
        posted.value.id,
      ]);
      process.env.CSAM_HOLD_KEY = "test-hold-key-value";
      const seen: { text: string; params: unknown[] }[] = [];
      const watching: Db = {
        async query<T>(text: string, params?: unknown[]) {
          seen.push({ text, params: params ?? [] });
          return db.query<T>(text, params);
        },
        transaction: (fn) => db.transaction(fn),
        session: (fn) => fn(watching),
      };
      assert.equal(await reencryptPendingHolds(watching, store), 0);
      assert.equal(seen.some((row) => row.text.includes("pg_try_advisory_lock")), true);
      assert.equal(seen.some((row) => row.text.includes("pg_advisory_unlock")), true);
      assert.equal(seen.some((row) => row.params.includes(RESEAL_LOCK_NAME)), true);
      const heldKey = [...store.objects.keys()].find((key) => key.startsWith("csam-hold/")) ?? "";
      assert.deepEqual(store.objects.get(heldKey)?.bytes, plain);
      const pending = await db.query<{ seal_status: string; key_id: string }>(
        `select seal_status, key_id from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(pending[0]?.seal_status, "pending_seal");
      assert.equal(pending[0]?.key_id, "other-key");
      await db.query(`update board_csam_hold set key_id = '' where post_id = $1`, [posted.value.id]);
      assert.equal(await reencryptPendingHolds(db, store), 1);
      assert.notDeepEqual(store.objects.get(heldKey)?.bytes, plain);
      assert.deepEqual(Array.from(openBytes(store.objects.get(heldKey)?.bytes ?? new Uint8Array())), Array.from(plain));
      const sealed = await db.query<{ seal_status: string; key_id: string }>(
        `select seal_status, key_id from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(sealed[0]?.seal_status, "sealed");
      assert.equal(sealed[0]?.key_id, holdKeyId());
      assert.equal(await reencryptPendingHolds(db, store), 0);
    } finally {
      await close();
    }
  });
});

test("CSAM is removed, banned, held for one year, and never returned", async () => {
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
      store,
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
    const hold = await db.query<{ id: string; sealed: string; retain_until: Date | string }>(
      `select id, sealed, retain_until from board_csam_hold where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(hold.length, 1);
    assert.equal(hold[0]?.sealed.includes(claim), false);
    const opened = openHold(hold[0]?.sealed ?? "");
    assert.equal(opened.claim, claim);
    const sealedKey = sealedObjectKey(hold[0]?.id ?? "", mediaId);
    assert.equal(opened.files[0]?.fileKey, sealedKey);
    assert.equal(store.objects.has(fileKey), false);
    const sealedBytes = store.objects.get(sealedKey)?.bytes;
    assert.ok(sealedBytes);
    assert.notDeepEqual(Array.from(sealedBytes ?? []), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(openBytes(sealedBytes ?? new Uint8Array())), [1, 2, 3, 4]);
    const kept = await db.query<{
      deleted_at: Date | string | null;
      file_key: string;
      upload_key: string;
      thumb_key: string;
    }>(`select deleted_at, file_key, upload_key, thumb_key from media_object where id = $1`, [
      mediaId,
    ]);
    assert.equal(kept[0]?.deleted_at, null);
    assert.equal(kept[0]?.file_key, "");
    assert.equal(kept[0]?.thumb_key, "");
    assert.equal(kept[0]?.upload_key, heldUploadKey(mediaId));

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
    assert.equal(admin.value.adminAlerts[0]?.kind, "csam_hold");
    assert.equal(report?.mediaCount, 1);
    assert.equal(report?.byteSize, 4);
    assert.deepEqual(report?.mediaTypes, ["image/jpeg"]);
    assert.equal(report?.accountId, maria);
    assert.equal("sealed" in (report ?? {}), false);
    assert.equal(report && "fileKey" in report, false);

    const early = new Date(now.getTime() + (STATUTORY_HOLD_DAYS - 1) * 24 * 60 * 60 * 1000);
    assert.equal(await purgeExpiredHolds(db, early, store), 0);
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
    const ownUpheld = await listOwnAppeals(db, maria);
    assert.equal(ownUpheld.find((row) => row.kind === "removal")?.decision, "uphold");
    const stillOut = await listBoard(db, maria, now);
    assert.equal(stillOut.ok, false);

    await assert.rejects(() => db.query(`delete from "user" where id = $1`, [maria]));
    const refused = await fileCsamReport(db, {
      userId: tom,
      name: "Tom",
      holdId: hold[0]?.id ?? "",
      reportId: "42",
      now,
    });
    assert.equal(refused.ok, false);
    const filed = await fileCsamReport(db, {
      userId: josh,
      name: "Josh",
      holdId: hold[0]?.id ?? "",
      reportId: "42",
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    assert.equal(filed.value.status, "filed");
    assert.equal(filed.value.reportId, "42");
    assert.equal(filed.value.filedBy, "Josh");
    const due = new Date(now.getTime() + HOLD_MS);
    assert.equal(await purgeExpiredHolds(db, due, store), 1);
    assert.equal(store.objects.has(sealedKey), false);
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
    await db.query(`delete from "user" where id = $1`, [maria]);
    const goneAuthor = await db.query<{ author_user_id: string | null }>(
      `select author_user_id from board_csam_hold where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(goneAuthor[0]?.author_user_id, null);
  } finally {
    await close();
  }
  });
});

test("opening the board does not purge an expired hold, and an expired hold does not block deletion", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const josh = randomUUID();
      await user(db, maria, "Maria", "maria-expire@example.com");
      await user(db, josh, "Josh", "josh-expire@example.com");
      await grant(db, maria, "Maria", "member");
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
      const removed = await removePost(db, {
        userId: josh,
        name: "Josh",
        postId: posted.value.id,
        reason: "csam",
        now,
      });
      assert.equal(removed.ok, true);
      const past = new Date(now.getTime() - 1000);
      await db.query(`update board_csam_hold set retain_until = $2 where post_id = $1`, [
        posted.value.id,
        past,
      ]);
      const listed = await listBoard(db, josh, now);
      assert.equal(listed.ok, true);
      const still = await db.query<{ sealed: string; purged_at: Date | string | null }>(
        `select sealed, purged_at from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(still[0]?.purged_at, null);
      assert.notEqual(still[0]?.sealed, "");
      await db.query(`delete from "user" where id = $1`, [maria]);
      const author = await db.query<{ author_user_id: string | null; author_name: string }>(
        `select author_user_id, author_name from board_csam_hold where post_id = $1`,
        [posted.value.id],
      );
      assert.equal(author[0]?.author_user_id, null);
      assert.equal(author[0]?.author_name, "Removed member");
    } finally {
      await close();
    }
  });
});

test("appeals and moderation logs stay with the author, that room's stewards, and admins", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = randomUUID();
      const tom = randomUUID();
      const ada = randomUUID();
      const sam = randomUUID();
      const josh = randomUUID();
      await user(db, maria, "Maria", "maria-appeal@example.com");
      await user(db, tom, "Tom", "tom-appeal@example.com");
      await user(db, ada, "Ada", "ada-appeal@example.com");
      await user(db, sam, "Sam", "sam-appeal@example.com");
      await user(db, josh, "Josh", "josh-appeal@example.com");
      for (const [id, name] of [
        [maria, "Maria"],
        [tom, "Tom"],
        [ada, "Ada"],
        [sam, "Sam"],
        [josh, "Josh"],
      ] as const) {
        await grant(db, id, name, "member");
      }
      await grant(db, tom, "Tom", "steward", "shop");
      await grant(db, ada, "Ada", "steward", "county");
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
      await markPost(db, {
        userId: tom,
        name: "Tom",
        postId: posted.value.id,
        mark: "out_of_scope",
        reason: "This belongs in the county room.",
        now,
      });
      const filed = await fileAppeal(db, {
        userId: maria,
        name: "Maria",
        postId: posted.value.id,
        kind: "mark",
        reason: "The post is about the shop night.",
        now,
      });
      assert.equal(filed.ok, true);
      const before = {
        author: await listBoard(db, maria, now),
        shop: await listBoard(db, tom, now),
        county: await listBoard(db, ada, now),
        member: await listBoard(db, sam, now),
        admin: await listBoard(db, josh, now),
      };
      assert.equal(before.author.ok, true);
      assert.equal(before.shop.ok, true);
      assert.equal(before.county.ok, true);
      assert.equal(before.member.ok, true);
      assert.equal(before.admin.ok, true);
      if (!before.author.ok || !before.shop.ok || !before.county.ok || !before.member.ok || !before.admin.ok) {
        return;
      }
      assert.equal(before.author.value.appeals.length, 1);
      assert.equal(before.shop.value.appeals.length, 1);
      assert.equal(before.county.value.appeals.length, 0);
      assert.equal(before.member.value.appeals.length, 0);
      assert.equal(before.admin.value.appeals.length, 1);
      const removed = await removePost(db, {
        userId: josh,
        name: "Josh",
        postId: posted.value.id,
        reason: "csam",
        now,
      });
      assert.equal(removed.ok, true);
      const csamAppeal = await fileAppeal(db, {
        userId: maria,
        name: "Maria",
        postId: posted.value.id,
        kind: "removal",
        reason: "Please put the post back up.",
        now,
      });
      assert.equal(csamAppeal.ok, true);

      const author = await listBoard(db, maria, now);
      const shop = await listBoard(db, tom, now);
      const county = await listBoard(db, ada, now);
      const member = await listBoard(db, sam, now);
      const admin = await listBoard(db, josh, now);
      assert.equal(author.ok, false);
      const own = await listOwnAppeals(db, maria);
      const ownRemoval = own.find((row) => row.kind === "removal");
      assert.equal(ownRemoval?.decision, null);
      assert.equal(ownRemoval?.rule, "csam");
      assert.equal((await listOwnAppeals(db, sam)).length, 0);
      assert.equal(shop.ok, true);
      assert.equal(county.ok, true);
      assert.equal(member.ok, true);
      assert.equal(admin.ok, true);
      if (!shop.ok || !county.ok || !member.ok || !admin.ok) return;
      assert.equal(shop.value.appeals.length, 2);
      assert.equal(county.value.appeals.length, 0);
      assert.equal(member.value.appeals.length, 0);
      assert.equal(admin.value.appeals.length, 2);
      assert.equal(
        shop.value.appeals.find((row) => row.kind === "removal")?.rule,
        null,
      );
      assert.equal(
        admin.value.appeals.find((row) => row.kind === "removal")?.rule,
        "csam",
      );
      assert.equal(shop.value.removals.length, 1);
      assert.equal(shop.value.bans.length, 0);
      assert.equal(county.value.removals.length, 0);
      assert.equal(county.value.bans.length, 0);
      assert.equal(member.value.removals.length, 0);
      assert.equal(member.value.bans.length, 0);
      assert.equal(admin.value.removals.length, 1);
      assert.equal(admin.value.bans.length, 1);
      assert.equal(admin.value.csamReports.length, 1);
      assert.equal(shop.value.csamReports.length, 0);
    } finally {
      await close();
    }
  });
});

test("the hold key is HKDF or the raw 32 bytes, and the sweep is not the board", async () => {
  const hex = randomBytes(32).toString("hex");
  await withHoldKey(hex, async () => {
    assert.deepEqual(holdKey(), rawHoldKey(hex));
  });
  await withHoldKey("test-hold-key-value", async () => {
    const derived = holdKey();
    assert.equal(derived.length, 32);
    assert.notDeepEqual(derived, createHash("sha256").update("test-hold-key-value").digest());
  });
  const host = readFileSync(new URL("../host.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(host, /startHoldSweep/);
  assert.match(host, /warnMissingHoldKey/);
  assert.match(host, /reencryptPendingHolds/);
  assert.equal(source.includes("purgeExpiredHolds"), false);
});

test("a missing hold key warns, and a set key stays quiet", async () => {
  const lines: string[] = [];
  await withHoldKey(undefined, async () => {
    warnMissingHoldKey((message) => lines.push(message));
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /WARNING/);
  assert.match(lines[0] ?? "", /CSAM_HOLD_KEY/);
  const quiet: string[] = [];
  await withHoldKey("test-hold-key-value", async () => {
    warnMissingHoldKey((message) => quiet.push(message));
  });
  assert.equal(quiet.length, 0);
});

test("migration 0010 can be applied twice and keeps its own trigger", async () => {
  const { pg, close } = await openTestDb();
  try {
    const sql = readFileSync(new URL("../../migrations/0010_moderation.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    const fun = await pg.query<{ def: string }>(
      `select pg_get_functiondef('anonymize_moderation_user'::regproc) as def`,
    );
    assert.match(fun.rows[0]?.def ?? "", /board_csam_hold/);
    assert.doesNotMatch(fun.rows[0]?.def ?? "", /anonymize_board_user/);
    const triggers = await pg.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname like 'anonymize_%'`,
    );
    const names = triggers.rows.map((row) => row.tgname);
    assert.equal(names.includes("anonymize_moderation_user"), true);
    assert.equal(names.includes("anonymize_board_user"), true);
    assert.equal(names.includes("anonymize_theme_group_user"), true);
    assert.equal(names.includes("anonymize_room_chat_user"), true);
    const widen = readFileSync(
      new URL("../../migrations/0015_hard_rules.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(widen);
    await pg.exec(widen);
    const check = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def
       from pg_constraint
       where conname = 'theme_group_removal_reason_check'`,
    );
    assert.match(check.rows[0]?.def ?? "", /doxxing/);
    assert.match(check.rows[0]?.def ?? "", /blasphemy/);
    const chat = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def
       from pg_constraint
       where conname = 'room_chat_removal_reason_check'`,
    );
    assert.match(chat.rows[0]?.def ?? "", /doxxing/);
    assert.match(chat.rows[0]?.def ?? "", /blasphemy/);
    const keyId = readFileSync(new URL("../../migrations/0017_csam_hold_key.sql", import.meta.url), "utf8");
    assert.match(keyId, /Numbered 0017/);
    assert.match(keyId, /0016 is reserved/);
    assert.equal(/create or replace function/i.test(keyId), false);
    assert.equal(/anonymize_/i.test(keyId), false);
    await pg.exec(keyId);
    await pg.exec(keyId);
    const column = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'board_csam_hold' and column_name = 'key_id'`,
    );
    assert.equal(column.rows[0]?.column_name, "key_id");
  } finally {
    await close();
  }
});
