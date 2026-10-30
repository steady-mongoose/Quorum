import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isSkipEmbedded, pendingMigrations } from "../../scripts/migration-plan.mjs";
import { openTestDb } from "../closed-test/test-db.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { trustAuthenticator } from "../mfa/test-trust.ts";
import { parseChurchPlace } from "./store.ts";

const MIGRATION = "0048_church_place.sql";
const now = new Date("2026-10-29T23:00:00Z");
const dir = new URL("../../migrations/", import.meta.url);

async function freshPg(skip: string[] = []): Promise<PGlite> {
  const pg = new PGlite();
  await pg.waitReady;
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (skip.includes(name)) continue;
    const sql = await readFile(new URL(name, dir), "utf8");
    if (isSkipEmbedded(sql)) continue;
    await pg.exec(sql);
  }
  return pg;
}

function asDb(pg: PGlite): Db {
  const adapter = (queryable: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    transaction?: PGlite["transaction"];
  }): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      return (await queryable.query(text, params)).rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!queryable.transaction) throw new Error("no transaction");
      return queryable.transaction(async (tx) => fn(adapter(tx)));
    },
    async session<T>(fn: (db: Db) => Promise<T>) {
      return fn(adapter(queryable));
    },
  });
  return adapter(pg);
}

function app(db: Db) {
  const sessions = new Map<string, Promise<string>>();
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      let session = sessions.get(id);
      if (!session) {
        session = trustAuthenticator(db, id);
        sessions.set(id, session);
      }
      return { id, name: "Ann", email: "ann@example.com", sessionId: await session };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function member(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Ann Vale', $2, true, $3, $3)`,
    [id, `${id}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'Ann Vale', 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
    [randomUUID(), id, now],
  );
  await db.query(
    `insert into members (user_id, display_name, gender) values ($1, 'Ann Vale', 'woman')`,
    [id],
  );
}

function patch(handler: (request: Request) => Promise<Response>, id: string, body: unknown) {
  return handler(
    new Request("http://127.0.0.1:8787/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": id },
      body: JSON.stringify(body),
    }),
  );
}

test("0048 is the last pending migration and applies twice", async () => {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql"));
  const plan = pendingMigrations(
    names,
    names.filter((name) => name !== MIGRATION),
  );
  assert.deepEqual(
    plan.map((row) => row.name),
    [MIGRATION],
  );
  const sql = await readFile(new URL(MIGRATION, dir), "utf8");
  assert.match(sql, /must approve this file before it is applied/);
  assert.equal(isSkipEmbedded(sql), false);
  const pg = await freshPg();
  try {
    await pg.exec(sql);
    const columns = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'members' and column_name in ('church_osm_ref', 'church_address')
       order by column_name`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["church_address", "church_osm_ref"],
    );
  } finally {
    await pg.close();
  }
});

test("0048 refuses a bad reference and an address with no reference", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann");
    await db.query(
      `update members set church = 'Grace', church_osm_ref = 'way/42', church_address = 'Brandon' where user_id = 'ann'`,
    );
    await assert.rejects(
      db.query(`update members set church_osm_ref = 'node/abc' where user_id = 'ann'`),
    );
    await assert.rejects(
      db.query(
        `update members set church_osm_ref = null, church_address = 'Brandon' where user_id = 'ann'`,
      ),
    );
  } finally {
    await close();
  }
});

test("a picked church saves its reference and reads back verified; a typed one clears it", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann");
    const handler = app(db);
    const picked = await patch(handler, "ann", {
      church: "Epiphany of Our Lord",
      churchPlace: { ref: "node/358757062", address: "Jackson Road, Florida 33592" },
    });
    const pickedText = await picked.text();
    assert.equal(picked.status, 200, pickedText);
    assert.deepEqual(JSON.parse(pickedText).profile.churchPlace, {
      ref: "node/358757062",
      address: "Jackson Road, Florida 33592",
      verified: true,
    });
    const typed = await patch(handler, "ann", { church: "My home church" });
    const typedBody = JSON.parse(await typed.text()) as {
      profile: { church: string; churchPlace?: unknown };
    };
    assert.equal(typedBody.profile.church, "My home church");
    assert.equal(typedBody.profile.churchPlace, undefined);
    const bad = await patch(handler, "ann", { church: "X Church", churchPlace: { ref: "node/0" } });
    assert.equal(bad.status, 400);
  } finally {
    await close();
  }
});

test("before 0048 is applied, profiles still read and typed churches still save", async () => {
  const pg = await freshPg([MIGRATION]);
  try {
    const db = asDb(pg);
    await member(db, "ann");
    const handler = app(db);
    const typed = await patch(handler, "ann", { church: "My home church" });
    assert.equal(typed.status, 200, await typed.text());
    const picked = await patch(handler, "ann", {
      church: "Epiphany of Our Lord",
      churchPlace: { ref: "node/1", address: "" },
    });
    assert.equal(picked.status, 503);
    const read = await handler(
      new Request("http://127.0.0.1:8787/api/profile", { headers: { "x-user-id": "ann" } }),
    );
    assert.equal(read.status, 200);
    assert.equal(
      ((await read.json()) as { profile: { church: string } }).profile.church,
      "My home church",
    );
  } finally {
    await pg.close();
  }
});

test("churchPlace parsing", () => {
  assert.deepEqual(parseChurchPlace(null), { ok: true, value: null });
  assert.equal(parseChurchPlace({ ref: "relation/7", address: "  a  b " }).ok, true);
  assert.equal(parseChurchPlace({ ref: "node/01" }).ok, false);
  assert.equal(parseChurchPlace({ ref: "shop/1" }).ok, false);
  assert.equal(parseChurchPlace("node/1").ok, false);
});
