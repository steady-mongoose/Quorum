import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { UPLOAD_LIMIT } from "../rate-limit.ts";
import type { MediaConfig } from "./config.ts";
import { createMemoryStore } from "./memory-store.ts";

const now = new Date("2026-10-19T12:00:00Z");

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

function handler(db: Db, media: AppDeps["media"]) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Josh", email: "josh@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
    media,
  });
}

test("status stays off and does not advertise credentials", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await handler(
      db,
      undefined,
    )(new Request("http://127.0.0.1:8787/api/media/status"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { enabled: boolean; video: boolean };
    assert.equal(body.enabled, false);
    assert.equal(body.video, false);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  } finally {
    await close();
  }
});

test("an upload needs a signed-in member, and storage that is off refuses it", async () => {
  const { db, close } = await openTestDb();
  try {
    const app = handler(db, undefined);
    const anon = await app(
      new Request("http://127.0.0.1:8787/api/media/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "image" }),
      }),
    );
    assert.equal(anon.status, 401);
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    const off = await app(
      new Request("http://127.0.0.1:8787/api/media/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh },
        body: JSON.stringify({
          kind: "image",
          contentType: "image/jpeg",
          byteSize: 10,
          scope: "room",
          roomId: "shop",
          postId: "post-1",
        }),
      }),
    );
    assert.equal(off.status, 503);
  } finally {
    await close();
  }
});

test("video is refused while pictures are accepted, and uploads are rate limited", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    await stand(db, josh, "shop", "post-1");
    await stand(db, josh, "shop", "post-video");
    const app = handler(db, { config: enabled, store: createMemoryStore(), now: () => now });
    const video = await app(
      new Request("http://127.0.0.1:8787/api/media/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh },
        body: JSON.stringify({
          kind: "video",
          contentType: "video/mp4",
          byteSize: 100,
          durationMs: 1000,
          scope: "room",
          roomId: "shop",
          postId: "post-video",
        }),
      }),
    );
    assert.equal(video.status, 403);
    const body = {
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 10,
      scope: "room",
      roomId: "shop",
      postId: "post-1",
    };
    let last = 0;
    for (let i = 0; i < UPLOAD_LIMIT.max + 1; i += 1) {
      const response = await app(
        new Request("http://127.0.0.1:8787/api/media/uploads", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": josh },
          body: JSON.stringify(body),
        }),
      );
      last = response.status;
    }
    assert.equal(last, 429);
  } finally {
    await close();
  }
});

test("a stranger cannot read a room picture without a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh, "josh@example.com");
    await stand(db, josh, "shop", "post-9");
    const store = createMemoryStore();
    const app = handler(db, { config: enabled, store, now: () => now });
    const prepared = await app(
      new Request("http://127.0.0.1:8787/api/media/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": josh },
        body: JSON.stringify({
          kind: "image",
          contentType: "image/jpeg",
          byteSize: 2,
          scope: "room",
          roomId: "shop",
          postId: "post-9",
        }),
      }),
    );
    assert.equal(prepared.status, 201);
    const created = (await prepared.json()) as { id: string; upload: { url: string } };
    await store.put(
      created.upload.url.replace("https://media.test/", ""),
      Uint8Array.of(1, 2),
      "image/jpeg",
    );
    const anon = await app(new Request(`http://127.0.0.1:8787/api/media/${created.id}`));
    assert.equal(anon.status, 401);
  } finally {
    await close();
  }
});
