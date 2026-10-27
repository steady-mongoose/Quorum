import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { PENDING_MS } from "../../src/lib/media/limits.ts";
import { countJobs } from "./db.ts";
import { createMemoryStore } from "./memory-store.ts";
import { markOnboarded } from "../profile/gate.ts";
import { completeUpload, prepareUpload, readForMember, type MediaServiceDeps } from "./service.ts";
import { expireStaleUploads } from "./worker.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function user(db: Db, id: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, id, email],
  );
}

async function stand(db: Db, userId: string, roomId: string, postId: string) {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
  await db.query(`insert into room_post (id, room_id, author_user_id) values ($1, $2, $3)`, [
    postId,
    roomId,
    userId,
  ]);
}

function deps(
  db: Db,
  store = createMemoryStore(),
): MediaServiceDeps & { store: ReturnType<typeof createMemoryStore> } {
  return { db, store, now: () => now, videoEnabled: true };
}

test("a member prepares a room picture and the server queues it after the bytes arrive", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    await stand(db, josh, "shop", "post-1");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 4,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.match(prepared.body.upload.url, /^https:\/\/media\.test\/incoming\//);
    assert.equal(prepared.body.upload.headers["content-type"], "image/jpeg");
    assert.equal(prepared.body.upload.headers["content-length"], "4");
    const key = prepared.body.upload.url.replace("https://media.test/", "");
    await media.store.put(key, Uint8Array.of(1, 2, 3, 4), "image/jpeg");
    const done = await completeUpload(media, josh, prepared.body.id);
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.body.status, "processing");
    assert.equal(await countJobs(db, prepared.body.id), 1);
    const reading = await readForMember(media, josh, prepared.body.id);
    assert.equal(reading.ok, true);
    if (!reading.ok) return;
    assert.equal(reading.body.status, "processing");
    assert.equal(reading.body.url, undefined);
  } finally {
    await close();
  }
});

test("a larger upload than declared is refused and removed", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    await stand(db, josh, "shop", "post-2");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/png",
      byteSize: 2,
      scope: "room",
      roomId: "shop",
      postId: "post-2",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const key = prepared.body.upload.url.replace("https://media.test/", "");
    await media.store.put(key, Uint8Array.of(1, 2, 3), "image/png");
    const done = await completeUpload(media, josh, prepared.body.id);
    assert.equal(done.ok, false);
    if (done.ok) return;
    assert.equal(done.error, "That file is larger than you said.");
    assert.equal(await media.store.head(key), null);
  } finally {
    await close();
  }
});

test("only the owner can finish an upload", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    await user(db, josh, "josh@example.com");
    await user(db, maria, "maria@example.com");
    await stand(db, josh, "county", "post-3");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/gif",
      byteSize: 1,
      scope: "room",
      roomId: "county",
      postId: "post-3",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const done = await completeUpload(media, maria, prepared.body.id);
    assert.equal(done.ok, false);
    if (done.ok) return;
    assert.equal(done.status, 404);
  } finally {
    await close();
  }
});

test("a message picture is stored sealed and is not queued for transcoding", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    const pete = randomUUID();
    await user(db, josh, "josh@example.com");
    await user(db, maria, "maria@example.com");
    await user(db, pete, "pete@example.com");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 3,
      scope: "dm",
      peerUserId: maria,
      keyEnvelope: "wrapped-for-maria",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.body.upload.headers["content-type"], "application/octet-stream");
    const key = prepared.body.upload.url.replace("https://media.test/", "");
    await media.store.put(key, Uint8Array.of(9, 9, 9), "application/octet-stream");
    const done = await completeUpload(media, josh, prepared.body.id);
    assert.equal(done.ok, true);
    if (!done.ok) return;
    assert.equal(done.body.status, "ready");
    assert.equal(await countJobs(db, prepared.body.id), 0);

    const stranger = await readForMember(media, pete, prepared.body.id);
    assert.equal(stranger.ok, false);

    const peer = await readForMember(media, maria, prepared.body.id);
    assert.equal(peer.ok, true);
    if (!peer.ok) return;
    assert.equal(peer.body.keyEnvelope, "wrapped-for-maria");
    assert.match(peer.body.url ?? "", /^https:\/\/media\.test\//);
    assert.match(peer.body.url ?? "", /response-content-disposition=attachment/);
    assert.match(peer.body.url ?? "", /response-cache-control=private/);
    assert.equal(peer.body.expiresIn, 120);
  } finally {
    await close();
  }
});

test("storage refuses a picture addressed to nobody on the box", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    const result = await prepareUpload(deps(db), josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 3,
      scope: "dm",
      peerUserId: randomUUID(),
      keyEnvelope: "wrapped",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "Choose the other person.");
  } finally {
    await close();
  }
});

test("an unfinished upload expires", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    await stand(db, josh, "shop", "post-old");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 2,
      scope: "room",
      roomId: "shop",
      postId: "post-old",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const key = prepared.body.upload.url.replace("https://media.test/", "");
    await media.store.put(key, Uint8Array.of(1, 2), "image/jpeg");
    await db.query(`update media_object set created_at = $2 where id = $1`, [
      prepared.body.id,
      new Date(now.getTime() - PENDING_MS - 1000).toISOString(),
    ]);
    const expired = await expireStaleUploads(
      {
        ...media,
        tools: {
          processImage: async () => {
            throw new Error("no");
          },
          processVideo: async () => {
            throw new Error("no");
          },
        },
      },
      PENDING_MS,
    );
    assert.equal(expired, 1);
    assert.equal(await media.store.head(key), null);
    const reading = await readForMember(media, josh, prepared.body.id);
    assert.equal(reading.ok, true);
    if (!reading.ok) return;
    assert.equal(reading.body.status, "rejected");
  } finally {
    await close();
  }
});

test("a room picture requires membership and the post, and another room cannot read it", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    const pete = randomUUID();
    await user(db, josh, "josh@example.com");
    await user(db, maria, "maria@example.com");
    await user(db, pete, "pete@example.com");
    await stand(db, josh, "shop", "post-room");
    await stand(db, maria, "shop", "maria-post");
    await stand(db, pete, "county", "pete-post");
    const media = deps(db);
    const outsider = await prepareUpload(media, pete, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 2,
      scope: "room",
      roomId: "shop",
      postId: "post-room",
    });
    assert.equal(outsider.ok, false);
    if (outsider.ok) return;
    assert.equal(outsider.status, 403);
    const missing = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 2,
      scope: "room",
      roomId: "shop",
      postId: "missing-post",
    });
    assert.equal(missing.ok, false);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 2,
      scope: "room",
      roomId: "shop",
      postId: "post-room",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const shop = await readForMember(media, maria, prepared.body.id);
    assert.equal(shop.ok, true);
    const other = await readForMember(media, pete, prepared.body.id);
    assert.equal(other.ok, false);
  } finally {
    await close();
  }
});

test("a barred member cannot read a room picture or start a room video", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    await user(db, josh, "josh@example.com");
    await user(db, maria, "maria@example.com");
    await stand(db, josh, "shop", "post-ban");
    await db.query(
      `insert into room_member (room_id, user_id) values ('shop', $1) on conflict do nothing`,
      [maria],
    );
    await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [josh]);
    await markOnboarded(db, josh, "Josh");
    const media = deps(db);
    const prepared = await prepareUpload(media, josh, {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 4,
      scope: "room",
      roomId: "shop",
      postId: "post-ban",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Josh', 'threat', 'Tom', 1, $3, $4)`,
      [randomUUID(), josh, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), now],
    );
    const reading = await readForMember(media, josh, prepared.body.id);
    assert.equal(reading.ok, false);
    if (reading.ok) return;
    assert.equal(reading.status, 403);
    assert.equal(reading.error, "banned");
    assert.equal(reading.ban?.reason, "threat");
    const video = await prepareUpload(media, josh, {
      kind: "video",
      contentType: "video/mp4",
      byteSize: 8,
      durationMs: 1000,
      scope: "room",
      roomId: "shop",
      postId: "post-ban",
    });
    assert.equal(video.ok, false);
    if (video.ok) return;
    assert.equal(video.status, 403);
    assert.equal(video.error, "banned");
    const still = await readForMember(media, maria, prepared.body.id);
    assert.equal(still.ok, true);
  } finally {
    await close();
  }
});
