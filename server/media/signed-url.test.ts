import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "./memory-store.ts";
import { readMediaConfig } from "./config.ts";
import { EDGE_MAX_AGE_S, handleSignedMedia, signedCacheControl, type MediaRuntime } from "./routes.ts";
import { readForMember, type MediaServiceDeps } from "./service.ts";
import { createSigner, readMediaHostConfig, SIGNED_WINDOW_SECONDS } from "./signed-url.ts";

const now = new Date("2026-10-27T12:00:00Z");
const SECRET = "s".repeat(40);
const ORIGIN = "https://media.avouchsocial.com";
const signer = createSigner({ enabled: true, origin: ORIGIN, secret: SECRET });

test("the media host stays off until both settings are valid", () => {
  assert.equal(readMediaHostConfig({}).enabled, false);
  assert.deepEqual(readMediaHostConfig({ MEDIA_PUBLIC_ORIGIN: ORIGIN, MEDIA_URL_SECRET: "short" }), {
    enabled: false,
    reason: "short-secret",
  });
  assert.equal(
    readMediaHostConfig({ MEDIA_PUBLIC_ORIGIN: "http://media.avouchsocial.com", MEDIA_URL_SECRET: SECRET }).enabled,
    false,
  );
  const on = readMediaHostConfig({ MEDIA_PUBLIC_ORIGIN: `${ORIGIN}/`, MEDIA_URL_SECRET: SECRET });
  assert.equal(on.enabled && on.origin, ORIGIN);
});

test("links are shared within a window, expire, and fail when changed", () => {
  const a = signer.url("m1", "file", now, 120);
  const b = signer.url("m1", "file", new Date(now.getTime() + 30_000), 120);
  assert.equal(a, b, "one URL per window so the edge caches one copy");
  assert.match(a, /^https:\/\/media\.avouchsocial\.com\/m\/m1\/file\/\d+\/[A-Za-z0-9_-]{43}$/);
  const [, , , , exp, sig] = new URL(a).pathname.split("/");
  assert.ok(Number(exp) % SIGNED_WINDOW_SECONDS === 0);
  assert.equal(signer.verify("m1", "file", exp ?? "", sig ?? "", now).ok, true);
  assert.equal(signer.verify("m2", "file", exp ?? "", sig ?? "", now).ok, false);
  assert.equal(signer.verify("m1", "thumb", exp ?? "", sig ?? "", now).ok, false);
  assert.equal(signer.verify("m1", "file", String(Number(exp) + 600), sig ?? "", now).ok, false);
  assert.equal(signer.verify("m1", "file", exp ?? "", sig ?? "", new Date(Number(exp) * 1000)).ok, false);
  const other = createSigner({ enabled: true, origin: ORIGIN, secret: "t".repeat(40) });
  assert.equal(other.verify("m1", "file", exp ?? "", sig ?? "", now).ok, false);
});

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $1, $2, true, now(), now())`,
    [id, `${id}@example.test`],
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  for (const id of ["josh", "owner"]) await user(db, id);
  for (const id of ["josh", "owner"]) {
    await db.query(`insert into room_member (room_id, user_id) values ('shop', $1) on conflict do nothing`, [id]);
  }
  await db.query(`insert into room_post (id, room_id, author_user_id) values ('post-1', 'shop', 'josh')`);
  const store = createMemoryStore();
  const id = randomUUID();
  const bytes = Uint8Array.of(1, 2, 3, 4);
  await db.query(
    `insert into media_object (
      id, owner_user_id, scope, kind, status, content_type, byte_size,
      room_id, post_id, encryption, upload_key, file_key, thumb_key
    ) values ($1, 'josh', 'room', 'image', 'ready', 'image/jpeg', 4, 'shop', 'post-1', 'server-processed', $2, $3, $4)`,
    [id, `incoming/${id}`, `ready/${id}/file`, `ready/${id}/thumb`],
  );
  await store.put(`ready/${id}/file`, bytes, "image/jpeg");
  await store.put(`ready/${id}/thumb`, Uint8Array.of(5, 6), "image/jpeg");
  const runtime: MediaRuntime = {
    config: readMediaConfig({}),
    store,
    now: () => now,
    signer,
  };
  const deps: MediaServiceDeps = { db, store, now: () => now, videoEnabled: false, signer };
  return { ...opened, runtime, deps, id, bytes };
}

const get = (runtime: MediaRuntime, db: Db, link: string, host = "media.avouchsocial.com") => {
  const url = new URL(link);
  return handleSignedMedia(runtime, db, new Request(url, { headers: { host } }), url);
};

test("a member's read link points at the media host and serves cacheable bytes with no cookie", async () => {
  const { db, close, runtime, deps, id, bytes } = await setup();
  try {
    const read = await readForMember(deps, "josh", id);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.ok(read.body.url?.startsWith(`${ORIGIN}/m/${id}/file/`));
    assert.ok(read.body.thumbUrl?.startsWith(`${ORIGIN}/m/${id}/thumb/`));
    const response = await get(runtime, db, read.body.url ?? "");
    assert.equal(response?.status, 200);
    assert.deepEqual(new Uint8Array(await response!.arrayBuffer()), bytes);
    assert.match(response!.headers.get("cache-control") ?? "", /^public, max-age=\d+, s-maxage=\d+$/);
    const age = Number(/max-age=(\d+)/.exec(response!.headers.get("cache-control") ?? "")?.[1]);
    assert.ok(age > 0 && age <= EDGE_MAX_AGE_S, "a held or deleted file leaves the edge within a minute");
    assert.equal(response!.headers.get("set-cookie"), null);
    assert.equal(response!.headers.get("content-type"), "image/jpeg");
    assert.equal(response!.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response!.headers.get("vary"), null);
  } finally {
    await close();
  }
});

test("a link is refused on another host, after a change, or once expired", async () => {
  const { db, close, runtime, id } = await setup();
  try {
    const link = signer.url(id, "file", now, 120);
    assert.equal((await get(runtime, db, link, "api.avouchsocial.com"))?.status, 404);
    assert.equal((await get(runtime, db, link.replace(/.$/, (c) => (c === "A" ? "B" : "A"))))?.status, 403);
    const late = { ...runtime, now: () => new Date(now.getTime() + 2 * SIGNED_WINDOW_SECONDS * 1000) };
    assert.equal((await get(late, db, link))?.status, 403);
  } finally {
    await close();
  }
});

test("a held file is never served from the media host, even with a valid link", async () => {
  const { db, close, runtime, deps, id } = await setup();
  try {
    const link = signer.url(id, "file", now, 120);
    await db.query(
      `insert into board_csam_hold (id, post_id, post_ids, room_id, author_user_id, author_name,
         sealed, media_count, byte_size, created_at, retain_until)
       values ($1, 'post-1', array['post-1'], 'shop', 'josh', 'josh', 'x', 1, 4, $2, $3)`,
      [randomUUID(), now, new Date(now.getTime() + 365 * 86_400_000)],
    );
    const response = await get(runtime, db, link);
    assert.equal(response?.status, 404);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.equal((await get(runtime, db, signer.url(id, "thumb", now, 120)))?.status, 404);
    for (const who of ["josh", "owner"]) assert.equal((await readForMember(deps, who, id)).ok, false);
  } finally {
    await close();
  }
});

test("an open CSAM flag blocks the media host for everyone once the flag table exists", async () => {
  const { db, close, runtime, id } = await setup();
  try {
    await db.query(`create table if not exists csam_flag (
      id text primary key, post_id text not null default '', media_id text not null default '',
      source text not null default 'scanner',
      resolved_at timestamptz)`);
    await db.query(`insert into csam_flag (id, media_id, source) values ('f1', $1, 'scanner')`, [id]);
    assert.equal((await get(runtime, db, signer.url(id, "file", now, 120)))?.status, 404);
  } finally {
    await close();
  }
});

test("mediaIsBlocked runs right before signing, so a hold placed mid-check mints no link", async () => {
  const { db, close, deps, id } = await setup();
  try {
    let signed = 0;
    const spy = { ...signer, url: (...args: Parameters<typeof signer.url>) => (signed += 1, signer.url(...args)) };
    let placed = false;
    const racing: Db = Object.create(db);
    racing.query = (async (sql: string, params?: unknown[]) => {
      const result = await db.query(sql, params as never);
      if (!placed && /from room_post where id = \$1 and room_id = \$2/.test(sql)) {
        placed = true;
        await db.query(
          `insert into board_csam_hold (id, post_id, post_ids, room_id, author_user_id, author_name,
             sealed, media_count, byte_size, created_at, retain_until)
           values ($1, 'post-1', array['post-1'], 'shop', 'josh', 'josh', 'x', 1, 4, $2, $3)`,
          [randomUUID(), now, new Date(now.getTime() + 365 * 86_400_000)],
        );
      }
      return result;
    }) as Db["query"];
    const read = await readForMember({ ...deps, db: racing, signer: spy }, "josh", id);
    assert.equal(placed, true);
    assert.equal(read.ok, false);
    assert.equal(signed, 0);
  } finally {
    await close();
  }
});

test("the media service calls mediaIsBlocked before every signer.url", () => {
  const source = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  const read = source.slice(source.indexOf("export async function readForMember"), source.indexOf("export async function serveSigned"));
  const lastCheck = read.lastIndexOf("mediaIsBlocked(");
  assert.ok(lastCheck > 0);
  assert.ok(lastCheck < read.indexOf("signer.url("));
  assert.equal(source.includes("servingBlocked"), false);
});

test("signed media is edge-cached for at most a minute and never past the link", () => {
  assert.equal(EDGE_MAX_AGE_S, 60);
  assert.equal(signedCacheControl(600), "public, max-age=60, s-maxage=60");
  assert.equal(signedCacheControl(25), "public, max-age=25, s-maxage=25");
  assert.equal(signedCacheControl(-5), "public, max-age=0, s-maxage=0");
});
