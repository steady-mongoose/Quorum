import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { CATEGORY_LIST, ROOM_CATEGORY } from "../../src/lib/board/categories.ts";

const now = new Date("2026-10-19T12:00:00Z");

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
      return {
        id,
        name: headers.get("x-user-name") ?? "Josh",
        email: headers.get("x-user-email") ?? "josh@example.com",
      };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function user(db: Db, id: string, name: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
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
}

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    keysOf(child, found);
  }
  return found;
}

test("migration 0021 backfills the config mapping and parks the rest", async () => {
  const { db, close } = await openTestDb();
  try {
    const categories = await db.query<{ slug: string; name: string; sort_order: number }>(
      `select slug, name, sort_order from categories order by sort_order asc, slug asc`,
    );
    assert.deepEqual(
      categories.map((row) => row.slug),
      CATEGORY_LIST.map((category) => category.slug),
    );
    assert.deepEqual(
      categories.map((row) => row.name),
      CATEGORY_LIST.map((category) => category.name),
    );
    const rooms = await db.query<{ id: string; category_id: string }>(
      `select id, category_id from room`,
    );
    for (const room of rooms) {
      assert.equal(room.category_id, ROOM_CATEGORY[room.id] ?? "uncategorized");
    }
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
       values ('mill', 'Mill', 'A mill night.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 90)`,
    );
    const mill = await db.query<{ category_id: string }>(
      `select category_id from room where id = 'mill'`,
    );
    assert.equal(mill[0]?.category_id, "uncategorized");
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'categories'`,
    );
    assert.deepEqual(columns.map((row) => row.column_name).sort(), ["name", "slug", "sort_order"]);
    const audience = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'room'
         and column_name in ('audience', 'sex')`,
    );
    assert.equal(audience.length, 0);
    const labeled = await db.query<{ id: string }>(
      `select id from room where category_id in ('men', 'women')`,
    );
    assert.equal(labeled.length, 0);
  } finally {
    await close();
  }
});

test("category pages require a member and hide a site ban and a room ban", async () => {
  const { db, close } = await openTestDb();
  try {
    const member = randomUUID();
    const stranger = randomUUID();
    const barred = randomUUID();
    const roomBarred = randomUUID();
    const steward = randomUUID();
    await user(db, member, "Maria", "maria@example.com");
    await user(db, stranger, "Pete", "pete@example.com");
    await user(db, barred, "Luis", "luis@example.com");
    await user(db, roomBarred, "Ruth", "ruth@example.com");
    await user(db, steward, "Tom", "tom@example.com");
    await grant(db, member, "Maria", "member");
    await grant(db, barred, "Luis", "member");
    await grant(db, roomBarred, "Ruth", "member");
    await grant(db, steward, "Tom", "member");
    await grant(db, steward, "Tom", "steward", "shop");
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ($1, $2, 'Luis', 'threat', $3, 'Tom', 1, '2027-01-01T00:00:00Z', '')`,
      [randomUUID(), barred, steward],
    );
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ($1, $2, 'Ruth', 'threat', $3, 'Tom', 1, '2027-01-01T00:00:00Z', 'shop')`,
      [randomUUID(), roomBarred, steward],
    );
    await db.query(
      `insert into public_gathering (id, title, gather_on, room_id, host_user_id)
       values ($1, 'Bench night', '2026-10-25', 'shop', $2)`,
      [randomUUID(), member],
    );
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
       values ('mill', 'Mill', 'A mill night.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 90)`,
    );
    const handler = app(db);
    const anonymous = await handler(new Request("http://127.0.0.1:8787/api/categories"));
    assert.equal(anonymous.status, 401);
    const outsider = await handler(
      new Request("http://127.0.0.1:8787/api/categories", { headers: { "x-user-id": stranger } }),
    );
    assert.equal(outsider.status, 403);
    const site = await handler(
      new Request("http://127.0.0.1:8787/api/categories", { headers: { "x-user-id": barred } }),
    );
    assert.equal(site.status, 403);
    const siteBody = (await site.json()) as { error?: string; ban?: { reason?: string } };
    assert.equal(siteBody.error, "banned");
    assert.equal(siteBody.ban?.reason, "threat");

    const listed = await handler(
      new Request("http://127.0.0.1:8787/api/categories", { headers: { "x-user-id": member } }),
    );
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { categories: { slug: string }[] };
    assert.equal(
      listBody.categories.some((category) => category.slug === "uncategorized"),
      false,
    );
    assert.equal(keysOf(listBody).has("count"), false);
    assert.equal(keysOf(listBody).has("likes"), false);
    assert.equal(keysOf(listBody).has("rank"), false);
    assert.equal(keysOf(listBody).has("trending"), false);

    const trades = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": member },
      }),
    );
    assert.equal(trades.status, 200);
    const tradeBody = (await trades.json()) as {
      rooms: { id: string; nextGathering: string | null }[];
    };
    assert.deepEqual(
      tradeBody.rooms.map((room) => room.id),
      ["shop", "rv-shop"],
    );
    assert.equal(tradeBody.rooms[0]?.nextGathering, "2026-10-25");
    assert.equal(keysOf(tradeBody).has("count"), false);

    const hiddenShop = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": roomBarred },
      }),
    );
    assert.equal(hiddenShop.status, 200);
    const hiddenBody = (await hiddenShop.json()) as { rooms: { id: string }[] };
    assert.equal(
      hiddenBody.rooms.some((room) => room.id === "shop"),
      false,
    );
    assert.equal(
      hiddenBody.rooms.some((room) => room.id === "rv-shop"),
      true,
    );

    const parked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        headers: { "x-user-id": member },
      }),
    );
    assert.equal(parked.status, 404);
    const stewardParked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(stewardParked.status, 200);
    const parkedBody = (await stewardParked.json()) as { rooms: { id: string }[] };
    assert.equal(
      parkedBody.rooms.some((room) => room.id === "mill"),
      true,
    );
    const stewardList = await handler(
      new Request("http://127.0.0.1:8787/api/categories", { headers: { "x-user-id": steward } }),
    );
    const stewardCategories = (await stewardList.json()) as { categories: { slug: string }[] };
    assert.equal(
      stewardCategories.categories.some((category) => category.slug === "uncategorized"),
      true,
    );
  } finally {
    await close();
  }
});

test("only a steward manages categories, and a room requires one", async () => {
  const { db, close } = await openTestDb();
  try {
    const member = randomUUID();
    const steward = randomUUID();
    const admin = randomUUID();
    await user(db, member, "Maria", "maria@example.com");
    await user(db, steward, "Tom", "tom@example.com");
    await user(db, admin, "Ada", "ada@example.com");
    await grant(db, member, "Maria", "member");
    await grant(db, steward, "Tom", "member");
    await grant(db, steward, "Tom", "steward", "shop");
    await grant(db, admin, "Ada", "member");
    await grant(db, admin, "Ada", "admin");
    const handler = app(db);
    const json = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": member },
      body: JSON.stringify(body),
    });
    const denied = await handler(
      new Request("http://127.0.0.1:8787/api/categories", json({ slug: "youth", name: "Youth" })),
    );
    assert.equal(denied.status, 403);

    const created = await handler(
      new Request("http://127.0.0.1:8787/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ slug: "youth", name: "Youth" }),
      }),
    );
    assert.equal(created.status, 201);
    const renamed = await handler(
      new Request("http://127.0.0.1:8787/api/categories/youth", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ name: "Youth hall", sortOrder: 8 }),
      }),
    );
    assert.equal(renamed.status, 200);
    const renamedBody = (await renamed.json()) as { category: { name: string; sortOrder: number } };
    assert.equal(renamedBody.category.name, "Youth hall");
    assert.equal(renamedBody.category.sortOrder, 8);
    const removed = await handler(
      new Request("http://127.0.0.1:8787/api/categories/youth", {
        method: "DELETE",
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(removed.status, 200);
    const keepParked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        method: "DELETE",
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(keepParked.status, 400);
    const keepUsed = await handler(
      new Request("http://127.0.0.1:8787/api/categories/churches", {
        method: "DELETE",
        headers: { "x-user-id": admin },
      }),
    );
    assert.equal(keepUsed.status, 400);

    const missing = await handler(
      new Request("http://127.0.0.1:8787/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": admin },
        body: JSON.stringify({ id: "woodshop", name: "Woodshop", what: "A bench night." }),
      }),
    );
    assert.equal(missing.status, 400);
    const unknown = await handler(
      new Request("http://127.0.0.1:8787/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": admin },
        body: JSON.stringify({
          id: "woodshop",
          name: "Woodshop",
          what: "A bench night.",
          categoryId: "no-such",
        }),
      }),
    );
    assert.equal(unknown.status, 400);
    const notAdmin = await handler(
      new Request("http://127.0.0.1:8787/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({
          id: "woodshop",
          name: "Woodshop",
          what: "A bench night.",
          categoryId: "business-trades",
        }),
      }),
    );
    assert.equal(notAdmin.status, 403);

    const moved = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryId: "discussion" }),
      }),
    );
    assert.equal(moved.status, 200);
    const movedBody = (await moved.json()) as { categoryId?: string; name?: string };
    assert.equal(movedBody.categoryId, "discussion");
    const renameDenied = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryId: "discussion", name: "New Shop" }),
      }),
    );
    assert.equal(renameDenied.status, 403);
    const renamedRoom = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": admin },
        body: JSON.stringify({
          categoryId: "business-trades",
          name: "New Shop",
          what: "A bench night.",
        }),
      }),
    );
    assert.equal(renamedRoom.status, 200);
    const renamedRoomBody = (await renamedRoom.json()) as { name?: string; categoryId?: string };
    assert.equal(renamedRoomBody.name, "New Shop");
    assert.equal(renamedRoomBody.categoryId, "business-trades");
    const memberMove = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": member },
        body: JSON.stringify({ categoryId: "civic" }),
      }),
    );
    assert.equal(memberMove.status, 403);
  } finally {
    await close();
  }
});
