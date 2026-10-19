import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { insertPending, readMedia } from "./db.ts";
import type { MediaTools } from "./ffmpeg.ts";
import { createMemoryStore } from "./memory-store.ts";
import { recoverStuckJobs, runOneMediaJob, type WorkerDeps } from "./worker.ts";

const now = new Date("2026-10-19T12:00:00Z");

function jpegWithGps(): Uint8Array {
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude");
  const length = 2 + payload.length;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  ]);
}

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, id, `${id}@example.com`],
  );
}

test("the worker stores a stripped picture and a thumbnail, and deletes the original", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh);
    const store = createMemoryStore();
    const seen: Uint8Array[] = [];
    const tools: MediaTools = {
      async processImage(bytes, contentType) {
        seen.push(bytes);
        return {
          file: bytes,
          fileType: contentType,
          thumb: Uint8Array.of(7),
          thumbType: "image/jpeg",
        };
      },
      async processVideo() {
        throw new Error("video tool should not run");
      },
    };
    const id = randomUUID();
    const raw = jpegWithGps();
    await insertPending(
      db,
      id,
      josh,
      {
        kind: "image",
        contentType: "image/jpeg",
        byteSize: raw.byteLength,
        durationMs: null,
        scope: "room",
        roomId: "shop",
        postId: "post-1",
        peerUserId: "",
        keyEnvelope: "",
        encryption: "server-processed",
        uploadContentType: "image/jpeg",
      },
      `incoming/${id}`,
    );
    await db.query(`update media_object set status = 'processing' where id = $1`, [id]);
    await db.query(
      `insert into media_job (id, media_id, status, run_after) values ($1, $2, 'queued', $3)`,
      [`job-${id}`, id, now.toISOString()],
    );
    await store.put(`incoming/${id}`, raw, "image/jpeg");
    const deps: WorkerDeps = { db, store, tools, now: () => now };
    assert.equal(await runOneMediaJob(deps), "done");
    assert.equal(
      new TextDecoder().decode(seen[0] ?? new Uint8Array()).includes("GPSLatitude"),
      false,
    );
    assert.equal(await store.head(`incoming/${id}`), null);
    const file = await store.get(`ready/${id}/file`);
    assert.equal(file && new TextDecoder().decode(file).includes("GPSLatitude"), false);
    assert.deepEqual(await store.get(`ready/${id}/thumb`), Uint8Array.of(7));
    const row = await readMedia(db, id);
    assert.equal(row?.status, "ready");
  } finally {
    await close();
  }
});

test("a video longer than 60 seconds is rejected and removed", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh);
    const store = createMemoryStore();
    const tools: MediaTools = {
      async processImage() {
        throw new Error("no");
      },
      async processVideo() {
        return {
          file: Uint8Array.of(1),
          fileType: "video/mp4",
          thumb: Uint8Array.of(2),
          thumbType: "image/jpeg",
          durationMs: 90_000,
        };
      },
    };
    const id = randomUUID();
    await insertPending(
      db,
      id,
      josh,
      {
        kind: "video",
        contentType: "video/mp4",
        byteSize: 4,
        durationMs: 1000,
        scope: "room",
        roomId: "shop",
        postId: "post-v",
        peerUserId: "",
        keyEnvelope: "",
        encryption: "server-processed",
        uploadContentType: "video/mp4",
      },
      `incoming/${id}`,
    );
    await db.query(`update media_object set status = 'processing' where id = $1`, [id]);
    await db.query(
      `insert into media_job (id, media_id, status, run_after) values ($1, $2, 'queued', $3)`,
      [`job-${id}`, id, now.toISOString()],
    );
    await store.put(`incoming/${id}`, Uint8Array.of(1, 2, 3, 4), "video/mp4");
    const deps: WorkerDeps = { db, store, tools, now: () => now };
    assert.equal(await runOneMediaJob(deps), "failed");
    assert.equal(await store.head(`incoming/${id}`), null);
    assert.equal(await store.head(`ready/${id}/file`), null);
    const row = await readMedia(db, id);
    assert.equal(row?.status, "rejected");
    assert.match(row?.reject_reason ?? "", /60 seconds/);
  } finally {
    await close();
  }
});

test("a message job is not downloaded or transcoded", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    await user(db, josh);
    await user(db, maria);
    const store = createMemoryStore();
    let got = false;
    const guarded = {
      ...store,
      async get() {
        got = true;
        throw new Error("ciphertext was downloaded");
      },
    };
    const tools: MediaTools = {
      async processImage() {
        throw new Error("transcode");
      },
      async processVideo() {
        throw new Error("transcode");
      },
    };
    const id = randomUUID();
    await insertPending(
      db,
      id,
      josh,
      {
        kind: "image",
        contentType: "image/jpeg",
        byteSize: 4,
        durationMs: null,
        scope: "dm",
        roomId: "",
        postId: "",
        peerUserId: maria,
        keyEnvelope: "wrapped",
        encryption: "client-e2e",
        uploadContentType: "application/octet-stream",
      },
      `dm/${id}/cipher`,
    );
    await db.query(
      `insert into media_job (id, media_id, status, run_after) values ($1, $2, 'queued', $3)`,
      [`job-${id}`, id, now.toISOString()],
    );
    await store.put(`dm/${id}/cipher`, Uint8Array.of(9, 9, 9, 9), "application/octet-stream");
    const deps: WorkerDeps = { db, store: guarded, tools, now: () => now };
    assert.equal(await runOneMediaJob(deps), "done");
    assert.equal(got, false);
    const row = await readMedia(db, id);
    assert.equal(row?.status, "ready");
    assert.equal(row?.file_key, `dm/${id}/cipher`);
  } finally {
    await close();
  }
});

test("a stuck running job is queued again", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    await user(db, josh);
    const id = randomUUID();
    await insertPending(
      db,
      id,
      josh,
      {
        kind: "image",
        contentType: "image/jpeg",
        byteSize: 1,
        durationMs: null,
        scope: "room",
        roomId: "shop",
        postId: "post-stuck",
        peerUserId: "",
        keyEnvelope: "",
        encryption: "server-processed",
        uploadContentType: "image/jpeg",
      },
      `incoming/${id}`,
    );
    await db.query(
      `insert into media_job (id, media_id, status, attempts, claimed_at, run_after)
       values ($1, $2, 'running', 1, $3, $3)`,
      [`job-${id}`, id, new Date(now.getTime() - 11 * 60 * 1000).toISOString()],
    );
    const store = createMemoryStore();
    const tools: MediaTools = {
      async processImage(bytes, contentType) {
        return { file: bytes, fileType: contentType, thumb: bytes, thumbType: contentType };
      },
      async processVideo() {
        throw new Error("no");
      },
    };
    const recovered = await recoverStuckJobs({ db, store, tools, now: () => now });
    assert.equal(recovered, 1);
    const jobs = await db.query<{ status: string }>(
      `select status from media_job where media_id = $1`,
      [id],
    );
    assert.equal(jobs[0]?.status, "queued");
  } finally {
    await close();
  }
});
