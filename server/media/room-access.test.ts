import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  deactivateAccount,
  deleteOwnPost,
  reactivateAccount,
} from "../board/account.ts";
import { openBytes, sealedObjectKey, withHoldKey } from "../board/csam.ts";
import { joinRoom } from "../board/places-store.ts";
import { createPost, decideAppeal, fileAppeal, removePost } from "../board/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { memberOfRoom, registerRoomPost } from "./access.ts";
import { readMedia } from "./db.ts";
import { createMemoryStore } from "./memory-store.ts";
import { prepareUpload, readForMember, type MediaServiceDeps } from "./service.ts";
import { sweepDeletedMedia } from "./worker.ts";

// Joining a room writes room_join only, so a member who had not posted got a
// 403 on upload and a 404 on view. And a removed or author-deleted post left
// media_object.deleted_at null, so its picture kept getting signed URLs.

const now = new Date("2026-10-19T12:00:00Z");
const later = new Date(now.getTime() + 60_000);

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

async function log(
  db: Db,
  id: string,
  name: string,
  action: "grant" | "revoke",
  role: string,
  room: string,
  at: Date,
) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, $6, 'test', 'test', 'test', 'Set for the test.', $7)`,
    [randomUUID(), id, name, role, room, action, at],
  );
}

/** A live member with an invite to the shop, and no row in the room yet. */
async function invited(db: Db, name: string) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`, now],
  );
  await log(db, id, name, "grant", "member", "shop", now);
  return id;
}

async function joined(db: Db, name: string) {
  const id = await invited(db, name);
  const result = await joinRoom(db, { userId: id, roomId: "shop", now });
  assert.equal(result.ok, true);
  const stood = await db.query(`select 1 from room_member where user_id = $1`, [id]);
  assert.equal(stood.length, 0, "joining writes room_join only");
  return id;
}

async function steward(db: Db, name: string) {
  const id = await joined(db, name);
  await log(db, id, name, "grant", "steward", "shop", now);
  return id;
}

async function post(db: Db, userId: string, name: string) {
  const posted = await createPost(db, { userId, name, roomId: "shop", body: did, now });
  assert.equal(posted.ok, true);
  if (!posted.ok) throw new Error("The post was not filed.");
  return posted.value.id;
}

function media(db: Db, store = createMemoryStore(), at = now) {
  const deps: MediaServiceDeps & { store: ReturnType<typeof createMemoryStore> } = {
    db,
    store,
    now: () => at,
    videoEnabled: false,
  };
  return deps;
}

/** A finished picture and thumbnail on this post. */
async function picture(db: Db, store: ReturnType<typeof createMemoryStore>, owner: string, postId: string) {
  const id = randomUUID();
  const fileKey = `ready/${id}/file`;
  const thumbKey = `ready/${id}/thumb`;
  await db.query(
    `insert into media_object (
      id, owner_user_id, scope, kind, status, content_type, byte_size,
      room_id, post_id, encryption, upload_key, file_key, thumb_key
    ) values ($1, $2, 'room', 'image', 'ready', 'image/jpeg', 4, 'shop', $3, 'server-processed', $4, $5, $6)`,
    [id, owner, postId, `incoming/${id}`, fileKey, thumbKey],
  );
  await store.put(fileKey, Uint8Array.of(1, 2, 3, 4), "image/jpeg");
  await store.put(thumbKey, Uint8Array.of(5, 6), "image/jpeg");
  return { id, fileKey, thumbKey };
}

async function assertServed(deps: MediaServiceDeps, userId: string, id: string) {
  const reading = await readForMember(deps, userId, id);
  assert.equal(reading.ok, true);
  if (!reading.ok) return;
  assert.match(reading.body.url ?? "", /^https:\/\/media\.test\//);
  assert.match(reading.body.thumbUrl ?? "", /^https:\/\/media\.test\//);
}

async function assertGone(deps: MediaServiceDeps, userId: string, id: string) {
  const reading = await readForMember(deps, userId, id);
  assert.deepEqual(reading, { ok: false, status: 404, error: "That file is not here." });
}

test("a member who joined and has not posted can upload and view a room picture", async () => {
  const { db, close } = await openTestDb();
  try {
    const tom = await joined(db, "Tom");
    const maria = await joined(db, "Maria");
    const deps = media(db);
    const tomPost = await post(db, tom, "Tom");
    const { id } = await picture(db, deps.store, tom, tomPost);
    await assertServed(deps, maria, id);

    const postId = randomUUID();
    assert.deepEqual(await registerRoomPost(db, maria, "shop", postId, now), { ok: true });
    const prepared = await prepareUpload(deps, maria, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 4,
      scope: "room",
      roomId: "shop",
      postId,
    });
    assert.equal(prepared.ok, true);
  } finally {
    await close();
  }
});

test("a member who left the room has neither row and is refused", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    await joinRoom(db, { userId: maria, roomId: "shop", now, leave: true });
    const refused = await memberOfRoom(db, maria, "shop", now);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);
  } finally {
    await close();
  }
});

test("an open ban refuses a member who only joined", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at, room_id)
       values ($1, $2, 'Maria', 'threat', 'Tom', 1, $3, $4, 'shop')`,
      [randomUUID(), maria, new Date(now.getTime() + 86_400_000), now],
    );
    const refused = await memberOfRoom(db, maria, "shop", now);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);
    assert.equal(refused.error, "banned");
  } finally {
    await close();
  }
});

test("a join left behind does not let a revoked member in", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    await log(db, maria, "Maria", "revoke", "member", "", later);
    const refused = await memberOfRoom(db, maria, "shop", later);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);
  } finally {
    await close();
  }
});

test("a join does not reach past the room's audience", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    await db.query(`update room set audience = 'men' where id = 'shop'`);
    const refused = await memberOfRoom(db, maria, "shop", now);
    assert.equal(refused.ok, false);
  } finally {
    await close();
  }
});

test("a removed post's picture is refused, and a lifted appeal brings it back", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    const ann = await joined(db, "Ann");
    const tom = await steward(db, "Tom");
    const postId = await post(db, maria, "Maria");
    const deps = media(db);
    const { id, fileKey, thumbKey } = await picture(db, deps.store, maria, postId);
    await assertServed(deps, ann, id);

    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId,
      reason: "threat",
      now,
      store: deps.store,
    });
    assert.equal(removed.ok, true);
    await assertGone(deps, ann, id);
    await assertGone(deps, maria, id);
    await assertGone(deps, tom, id);

    const row = await readMedia(db, id);
    assert.equal(row?.deleted_at, null, "the media row is not touched");
    assert.equal(row?.file_key, fileKey);
    assert.equal(row?.thumb_key, thumbKey);
    assert.equal(await sweepDeletedMedia({ ...deps, tools: noTools }), 0);
    assert.ok(await deps.store.head(fileKey));

    const appealed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId,
      kind: "removal",
      reason: "The post named no one and threatened no one.",
      now,
    });
    assert.equal(appealed.ok, true);
    if (!appealed.ok) return;
    const lifted = await decideAppeal(db, {
      userId: tom,
      name: "Tom",
      appealId: appealed.value.id,
      decision: "lift",
      reason: "The post named no one.",
      now,
    });
    assert.equal(lifted.ok, true);
    const after = media(db, deps.store, later);
    await assertServed(after, ann, id);
    await assertServed(after, maria, id);
  } finally {
    await close();
  }
});

test("an author-deleted post's picture is refused, and comes back with the post", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    const ann = await joined(db, "Ann");
    const postId = await post(db, maria, "Maria");
    const deps = media(db);
    const { id, fileKey } = await picture(db, deps.store, maria, postId);
    await assertServed(deps, ann, id);

    const deleted = await deleteOwnPost(db, { userId: maria, postId, now });
    assert.equal(deleted.ok, true);
    await assertGone(deps, ann, id);
    await assertGone(deps, maria, id);
    assert.equal((await readMedia(db, id))?.deleted_at, null);
    assert.ok(await deps.store.head(fileKey));

    await db.query(`update board_post set author_deleted_at = null where id = $1`, [postId]);
    await assertServed(deps, ann, id);
  } finally {
    await close();
  }
});

test("a deactivated author's picture is off with the post until reactivation", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await joined(db, "Maria");
    const ann = await joined(db, "Ann");
    const postId = await post(db, maria, "Maria");
    const deps = media(db);
    const { id } = await picture(db, deps.store, maria, postId);

    const off = await deactivateAccount(db, { userId: maria, name: "Maria", now });
    assert.equal(off.ok, true);
    await assertGone(deps, ann, id);

    const back = await reactivateAccount(db, { userId: maria, name: "Maria", now });
    assert.equal(back.ok, true);
    await assertServed(deps, ann, id);
    await assertServed(deps, maria, id);
  } finally {
    await close();
  }
});

test("a picture on an author-deleted post is still sealed as evidence on a CSAM removal", async () => {
  await withHoldKey("test-hold-key-value", async () => {
    const { db, close } = await openTestDb();
    try {
      const maria = await joined(db, "Maria");
      const ann = await joined(db, "Ann");
      const tom = await steward(db, "Tom");
      const postId = await post(db, maria, "Maria");
      const deps = media(db);
      const { id, fileKey } = await picture(db, deps.store, maria, postId);
      assert.equal((await deleteOwnPost(db, { userId: maria, postId, now })).ok, true);

      const removed = await removePost(db, {
        userId: tom,
        name: "Tom",
        postId,
        reason: "csam",
        now,
        store: deps.store,
      });
      assert.equal(removed.ok, true);
      const holds = await db.query<{ id: string; media_count: number }>(
        `select id, media_count from board_csam_hold where post_id = $1`,
        [postId],
      );
      assert.equal(Number(holds[0]?.media_count), 1);
      const sealed = deps.store.objects.get(sealedObjectKey(holds[0]?.id ?? "", id))?.bytes;
      assert.ok(sealed);
      assert.deepEqual(Array.from(openBytes(sealed)), [1, 2, 3, 4]);
      assert.equal(await deps.store.head(fileKey), null);
      assert.equal((await readMedia(db, id))?.deleted_at, null);
      await assertGone(deps, ann, id);
    } finally {
      await close();
    }
  });
});

const noTools = {
  processImage: async () => {
    throw new Error("no");
  },
  processVideo: async () => {
    throw new Error("no");
  },
};
