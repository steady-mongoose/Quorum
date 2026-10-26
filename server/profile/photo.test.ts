import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { MediaConfig } from "../media/config.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { completeUpload, prepareUpload, readForMember } from "../media/service.ts";

const now = new Date("2026-10-19T15:00:00Z");

const enabled: MediaConfig = {
  enabled: true,
  video: false,
  endpoint: "http://127.0.0.1:9000",
  bucket: "avouch",
  region: "us-east-1",
  accessKeyId: "access-key",
  secretAccessKey: "super-secret-value",
  forcePathStyle: true,
};

async function person(
  db: Db,
  id: string,
  name: string,
  role: "member" | "steward" | "admin" = "member",
  gender?: "man" | "woman",
) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
  await db.query(`insert into members (user_id, display_name, gender) values ($1, $2, $3)`, [
    id,
    name,
    gender ?? null,
  ]);
  if (role === "admin") {
    await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [id]);
  }
  if (role === "steward") {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, 'steward', 'shop', 'grant', 'test', 'test', 'test', 'Steward for the test.', $4)`,
      [randomUUID(), id, name, now],
    );
  }
}

function app(db: Db, store: ReturnType<typeof createMemoryStore>) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Member", email: `${id}@example.com` };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
    media: { config: enabled, store, now: () => now },
  } satisfies AppDeps);
}

function send(
  handler: (request: Request) => Promise<Response>,
  id: string,
  path: string,
  method: string,
  body?: unknown,
) {
  return handler(
    new Request(`http://127.0.0.1:8787${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user-id": id },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function readyPhoto(db: Db, store: ReturnType<typeof createMemoryStore>, userId: string) {
  const media = { db, store, now: () => now, videoEnabled: false };
  const prepared = await prepareUpload(media, userId, {
    kind: "image",
    contentType: "image/jpeg",
    byteSize: 4,
    scope: "profile",
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error(prepared.error);
  const key = prepared.body.upload.url.replace("https://media.test/", "");
  await store.put(key, Uint8Array.of(1, 2, 3, 4), "image/jpeg");
  const done = await completeUpload(media, userId, prepared.body.id);
  assert.equal(done.ok, true, done.ok ? "" : done.error);
  await db.query(
    `update media_object
     set status = 'ready', content_type = 'image/webp', file_key = $2, thumb_key = $2
     where id = $1`,
    [prepared.body.id, key],
  );
  return { id: prepared.body.id, key };
}

test("a profile upload is members only, and a bar blocks it", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ('stranger', 'Stranger', 'stranger@example.com', true, $1, $1)`,
      [now],
    );
    const store = createMemoryStore();
    const media = { db, store, now: () => now, videoEnabled: false };
    const stranger = await prepareUpload(media, "stranger", {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 4,
      scope: "profile",
    });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.error, "Only a member can do that.");

    await person(db, "ann", "Ann Vale");
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ('ban-ann', 'ann', 'Ann Vale', 'threat', 'ann', 'Ann Vale', 1, $1, '')`,
      [new Date("2026-12-01T00:00:00Z")],
    );
    const banned = await prepareUpload(media, "ann", {
      kind: "image",
      contentType: "image/png",
      byteSize: 4,
      scope: "profile",
    });
    assert.equal(banned.ok, false);
    if (!banned.ok) assert.equal(banned.error, "banned");
  } finally {
    await close();
  }
});

test("a member attaches a ready photo, and others see it only through profileView", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale", "member", "woman");
    await person(db, "bo", "Bo Hale", "member", "man");
    await person(db, "josh", "Josh Hale", "admin", "man");
    const store = createMemoryStore();
    const handler = app(db, store);
    const first = await readyPhoto(db, store, "ann");
    const pending = await prepareUpload({ db, store, now: () => now, videoEnabled: false }, "ann", {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 4,
      scope: "profile",
    });
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    const early = await send(handler, "ann", "/api/profile/photo", "POST", {
      mediaId: pending.body.id,
    });
    assert.equal(early.status, 409);
    const still = await db.query<{ photo_media_id: string | null }>(
      `select photo_media_id from members where user_id = 'ann'`,
    );
    assert.equal(still[0]?.photo_media_id, null);
    const unattached = await readForMember(
      { db, store, now: () => now, videoEnabled: false },
      "bo",
      pending.body.id,
    );
    assert.equal(unattached.ok, false);
    const ownerPoll = await readForMember(
      { db, store, now: () => now, videoEnabled: false },
      "ann",
      pending.body.id,
    );
    assert.equal(ownerPoll.ok, true);
    if (ownerPoll.ok) assert.equal(ownerPoll.body.url, undefined);

    const attached = await send(handler, "ann", "/api/profile/photo", "POST", {
      mediaId: first.id,
    });
    const attachedText = await attached.text();
    assert.equal(attached.status, 200, attachedText);
    const attachedBody = JSON.parse(attachedText) as { profile: { photo: { id: string } } };
    assert.equal(attachedBody.profile.photo.id, first.id);
    assert.equal(Object.hasOwn(attachedBody.profile, "birthdate"), false);

    const media = { db, store, now: () => now, videoEnabled: false };
    const bo = await readForMember(media, "bo", first.id);
    assert.equal(bo.ok, true);
    if (!bo.ok) return;
    assert.match(bo.body.url ?? "", /photo\.webp/);
    assert.match(bo.body.url ?? "", /image%2Fwebp|image\/webp/);
    assert.match(bo.body.thumbUrl ?? "", /thumb\.webp/);

    await db.query(
      `insert into profile_visibility (user_id, field, level) values ('ann', 'photo', 'private')`,
    );
    const hidden = await readForMember(media, "bo", first.id);
    assert.equal(hidden.ok, false);
    if (!hidden.ok) assert.equal(hidden.status, 404);
    const own = await readForMember(media, "ann", first.id);
    assert.equal(own.ok, true);

    await db.query(`update profile_visibility set level = 'admins' where user_id = 'ann'`);
    const memberMiss = await readForMember(media, "bo", first.id);
    assert.equal(memberMiss.ok, false);
    const adminSee = await readForMember(media, "josh", first.id);
    assert.equal(adminSee.ok, true);

    await db.query(`update profile_visibility set level = 'shared' where user_id = 'ann'`);
    const noRoom = await readForMember(media, "bo", first.id);
    assert.equal(noRoom.ok, false);
    await db.query(
      `insert into dm_thread (id, user_a, user_b, user_a_name, user_b_name)
       values ('dm-1', 'ann', 'bo', 'Ann Vale', 'Bo Hale')`,
    );
    const byMessage = await readForMember(media, "bo", first.id);
    assert.equal(byMessage.ok, false);
    await db.query(`update room set audience = 'men' where id = 'shop'`);
    await db.query(
      `insert into room_member (room_id, user_id) values ('shop', 'ann'), ('shop', 'bo')`,
    );
    const menOnly = await readForMember(media, "ann", first.id);
    assert.equal(menOnly.ok, true);
    const womanMiss = await readForMember(media, "bo", first.id);
    // Bo is a man, so the men's room does count for him.
    assert.equal(womanMiss.ok, true);
    await person(db, "mae", "Mae Cole", "member", "woman");
    await db.query(`insert into room_member (room_id, user_id) values ('shop', 'mae')`);
    const mae = await readForMember(media, "mae", first.id);
    assert.equal(mae.ok, false);
    await db.query(`update room set audience = 'all' where id = 'county'`);
    await db.query(
      `insert into room_member (room_id, user_id) values ('county', 'ann'), ('county', 'mae')`,
    );
    const county = await readForMember(media, "mae", first.id);
    assert.equal(county.ok, true);

    await db.query(`update profile_visibility set level = 'members' where user_id = 'ann'`);
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ('ban-bo', 'bo', 'Bo Hale', 'threat', 'josh', 'Josh Hale', 1, $1, '')`,
      [new Date("2026-12-01T00:00:00Z")],
    );
    const barred = await readForMember(media, "bo", first.id);
    assert.equal(barred.ok, false);
    if (!barred.ok) assert.equal(barred.status, 403);

    const second = await readyPhoto(db, store, "ann");
    const replaced = await send(handler, "ann", "/api/profile/photo", "POST", {
      mediaId: second.id,
    });
    assert.equal(replaced.status, 200);
    const old = await db.query<{ deleted_at: Date | null }>(
      `select deleted_at from media_object where id = $1`,
      [first.id],
    );
    assert.ok(old[0]?.deleted_at);
    assert.notEqual(await store.head(first.key), null);
  } finally {
    await close();
  }
});

test("an admin seals a profile photo and a steward cannot", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale");
    await person(db, "sam", "Sam Cole", "steward");
    await person(db, "josh", "Josh Hale", "admin");
    const store = createMemoryStore();
    const handler = app(db, store);
    const photo = await readyPhoto(db, store, "ann");
    const attached = await send(handler, "ann", "/api/profile/photo", "POST", {
      mediaId: photo.id,
    });
    assert.equal(attached.status, 200);

    const wrong = await send(handler, "josh", "/api/profile/ann/photo/remove", "POST", {
      reason: "threat",
    });
    assert.equal(wrong.status, 400);
    const steward = await send(handler, "sam", "/api/profile/ann/photo/remove", "POST", {
      reason: "csam",
    });
    assert.equal(steward.status, 403);
    const member = await send(handler, "ann", "/api/profile/ann/photo/remove", "POST", {
      reason: "csam",
    });
    assert.equal(member.status, 403);

    const removed = await send(handler, "josh", "/api/profile/ann/photo/remove", "POST", {
      reason: "csam",
    });
    const removedText = await removed.text();
    assert.equal(removed.status, 200, removedText);
    assert.equal(JSON.parse(removedText).removed, true);
    assert.equal(removedText.includes("birthdate"), false);

    const pointer = await db.query<{ photo_media_id: string | null }>(
      `select photo_media_id from members where user_id = 'ann'`,
    );
    assert.equal(pointer[0]?.photo_media_id, null);
    const row = await db.query<{ upload_key: string; file_key: string }>(
      `select upload_key, file_key from media_object where id = $1`,
      [photo.id],
    );
    assert.match(row[0]?.upload_key ?? "", /^csam-held:/);
    assert.equal(row[0]?.file_key, "");
    assert.equal(await store.head(photo.key), null);
    const held = [...store.objects.keys()].filter((key) => key.startsWith("csam-hold/"));
    assert.equal(held.length, 1);
    const hold = await db.query<{ post_id: string; room_id: string; media_count: number }>(
      `select post_id, room_id, media_count from board_csam_hold`,
    );
    assert.equal(hold[0]?.post_id, photo.id);
    assert.equal(hold[0]?.room_id, "");
    assert.equal(Number(hold[0]?.media_count), 1);

    const gone = await readForMember(
      { db, store, now: () => now, videoEnabled: false },
      "ann",
      photo.id,
    );
    assert.equal(gone.ok, false);
    if (!gone.ok) assert.equal(gone.status, 404);
  } finally {
    await close();
  }
});
