import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";

const now = new Date("2026-10-27T15:00:00Z");

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: headers.get("x-user-name") ?? "Ada", email: "ada@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
}

async function grant(
  db: Db,
  userId: string,
  name: string,
  role: "member" | "steward" | "admin",
  roomId = "",
  action: "grant" | "revoke" = "grant",
  at = now,
) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, $6, 'test', 'test', 'test', 'For the test.', $7)`,
    [randomUUID(), userId, name, role, roomId, action, at],
  );
}

async function people(db: Db) {
  const admin = randomUUID();
  const steward = randomUUID();
  const member = randomUUID();
  await user(db, admin, "Ada");
  await user(db, steward, "Tom");
  await user(db, member, "Maria");
  await grant(db, admin, "Ada", "member");
  await grant(db, admin, "Ada", "admin");
  await grant(db, steward, "Tom", "member");
  await grant(db, steward, "Tom", "steward", "shop");
  await grant(db, member, "Maria", "member");
  return { admin, steward, member };
}

function move(id: string, userId: string, categoryIds: string[]) {
  return new Request(`http://127.0.0.1:8787/api/admin/rooms/${id}/categories`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ categoryIds }),
  });
}

type Row = {
  id: string;
  name: string;
  categoryIds: string[];
  stewards: string[];
  audience: string;
};

test("only an admin can list rooms for the Rooms manager", async () => {
  const { db, close } = await openTestDb();
  try {
    const { admin, steward, member } = await people(db);
    const handler = app(db);
    const list = (id?: string) =>
      handler(
        new Request("http://127.0.0.1:8787/api/admin/rooms", {
          headers: id ? { "x-user-id": id } : {},
        }),
      );
    assert.equal((await list()).status, 401);
    assert.equal((await list(member)).status, 403);
    assert.equal((await list(steward)).status, 403);
    const ok = await list(admin);
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { rooms: Row[]; logReady: boolean };
    const total = await db.query<{ n: number }>(`select count(*)::int as n from room`);
    assert.equal(body.rooms.length, total[0]?.n);
    const shop = body.rooms.find((room) => room.id === "shop");
    assert.deepEqual(shop?.stewards, ["Tom"]);
    assert.deepEqual(shop?.categoryIds, ["business-trades"]);
    assert.equal(shop?.audience, "all");
    assert.equal(body.logReady, false);
  } finally {
    await close();
  }
});

test("a revoked steward is not listed", async () => {
  const { db, close } = await openTestDb();
  try {
    const { admin, steward } = await people(db);
    await grant(db, steward, "Tom", "steward", "shop", "revoke", new Date(now.getTime() + 1000));
    const response = await app(db)(
      new Request("http://127.0.0.1:8787/api/admin/rooms", { headers: { "x-user-id": admin } }),
    );
    const body = (await response.json()) as { rooms: Row[] };
    assert.deepEqual(body.rooms.find((room) => room.id === "shop")?.stewards, []);
  } finally {
    await close();
  }
});

test("an admin moves a room between categories; others cannot", async () => {
  const { db, close } = await openTestDb();
  try {
    const { admin, steward, member } = await people(db);
    const handler = app(db);
    assert.equal((await handler(move("shop", member, ["civic"]))).status, 403);
    assert.equal((await handler(move("shop", steward, ["civic"]))).status, 403);
    assert.equal((await handler(move("shop", admin, []))).status, 400);
    assert.equal((await handler(move("shop", admin, ["nope"]))).status, 400);
    assert.equal((await handler(move("no-such-room", admin, ["civic"]))).status, 404);
    const logged: string[] = [];
    const original = console.info;
    console.info = (line: unknown) => logged.push(String(line));
    let moved: Response;
    try {
      moved = await handler(move("shop", admin, ["civic", "county"]));
    } finally {
      console.info = original;
    }
    assert.equal(moved.status, 200);
    const row = (await moved.json()) as Row;
    assert.deepEqual(row.categoryIds, ["civic", "county"]);
    const links = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'shop' order by category_id`,
    );
    assert.deepEqual(
      links.map((link) => link.category_id),
      ["civic", "county"],
    );
    assert.equal(logged.length, 1);
    const entry = JSON.parse(logged[0] ?? "{}") as {
      action: string;
      roomId: string;
      detail: string;
    };
    assert.equal(entry.action, "move");
    assert.equal(entry.roomId, "shop");
    assert.match(entry.detail, /business-trades → civic, county/);
  } finally {
    await close();
  }
});

test("a move writes room_admin_log once migration 0039 is applied", async () => {
  const { db, close } = await openTestDb();
  try {
    const { admin } = await people(db);
    // The proposed 0039 table, created here only for this test.
    await db.query(
      `create table room_admin_log (
         id text primary key,
         room_id text not null,
         actor_user_id text references "user" (id) on delete set null,
         actor_name text not null,
         action text not null,
         detail text not null default '',
         at timestamptz not null default now()
       )`,
    );
    const moved = await app(db)(move("shop", admin, ["civic"]));
    assert.equal(moved.status, 200);
    const rows = await db.query<{ action: string; actor_name: string; detail: string }>(
      `select action, actor_name, detail from room_admin_log where room_id = 'shop'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, "move");
    assert.equal(rows[0]?.actor_name, "Ada");
    assert.equal(rows[0]?.detail, "Categories business-trades → civic.");
  } finally {
    await close();
  }
});
