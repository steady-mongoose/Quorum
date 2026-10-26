import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import type { MediaConfig } from "../media/config.ts";
import { createMemoryStore } from "../media/memory-store.ts";

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

function app(db: Db, media?: AppDeps["media"]) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Ann Vale", email: "ann@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
    media,
  } satisfies AppDeps);
}

async function user(db: Db, id: string, name: string, member: boolean) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
  if (!member) return;
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
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
      headers: {
        "content-type": "application/json",
        "x-user-id": id,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

test("a member cannot write until onboarding, and a read is open", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann Vale", true);
    await db.query(
      `insert into members (user_id, display_name, gender) values ('ann', 'Ann Vale', 'woman')`,
    );
    const handler = app(db);
    const board = await send(handler, "ann", "/api/board", "GET");
    assert.equal(board.status, 200, await board.clone().text());
    const own = await send(handler, "ann", "/api/profile", "GET");
    const ownText = await own.text();
    assert.equal(own.status, 200, ownText);
    assert.equal(ownText.includes("1990-04-02"), false);
    const ownBody = JSON.parse(ownText) as { profile: { onboarded: boolean; missing: string[] } };
    assert.equal(ownBody.profile.onboarded, false);
    assert.equal(ownBody.profile.missing.includes("birthdate"), true);
    assert.equal(ownBody.profile.missing.includes("gender"), false);

    const blocked = await send(handler, "ann", "/api/invites", "POST", {
      maxUses: 1,
      expiresInDays: 7,
    });
    const blockedBody = (await blocked.json()) as { error: string; code?: string };
    assert.equal(blocked.status, 403);
    assert.equal(blockedBody.code, "profile-required");

    const photo = await send(handler, "ann", "/api/profile/photo", "POST", { mediaId: "nope" });
    const photoBody = (await photo.json()) as { code?: string };
    assert.notEqual(photo.status, 403);
    assert.equal(photoBody.code, undefined);

    const patched = await send(handler, "ann", "/api/profile", "PATCH", { bio: "Keeps bees." });
    assert.equal(patched.status, 200, await patched.clone().text());

    const onboarded = await send(handler, "ann", "/api/profile/onboard", "POST", {
      birthdate: "1990-04-02",
    });
    const onboardedText = await onboarded.text();
    assert.equal(onboarded.status, 200, onboardedText);
    assert.equal(onboardedText.includes("1990-04-02"), false);
    assert.equal(Object.hasOwn(JSON.parse(onboardedText).profile, "birthdate"), false);

    const invite = await send(handler, "ann", "/api/invites", "POST", {
      maxUses: 1,
      expiresInDays: 7,
    });
    assert.equal(invite.status, 201, await invite.text());
  } finally {
    await close();
  }
});

test("someone who is not a member is not sent through the profile gate", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "guest", "Guest", false);
    const response = await send(app(db), "guest", "/api/invites", "POST", { maxUses: 1 });
    const body = (await response.json()) as { error: string; code?: string };
    assert.equal(response.status, 403);
    assert.equal(body.code, undefined);
    assert.match(body.error, /member/i);
  } finally {
    await close();
  }
});

test("a profile photo upload stays open and a room upload waits for onboarding", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann Vale", true);
    await db.query(
      `insert into members (user_id, display_name, gender) values ('ann', 'Ann', 'woman')`,
    );
    const store = createMemoryStore();
    const handler = app(db, { config: enabled, store, now: () => now });
    const profile = await send(handler, "ann", "/api/media/uploads", "POST", {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 32,
      scope: "profile",
    });
    const profileText = await profile.text();
    assert.equal(profile.status, 201, profileText);
    assert.equal(profileText.includes("profile-required"), false);

    const room = await send(handler, "ann", "/api/media/uploads", "POST", {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 32,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    });
    const roomBody = (await room.json()) as { code?: string };
    assert.equal(room.status, 403);
    assert.equal(roomBody.code, "profile-required");
  } finally {
    await close();
  }
});
