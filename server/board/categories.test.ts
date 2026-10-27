import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { CATEGORY_LIST, ROOM_CATEGORY } from "../../src/lib/board/categories.ts";
import { trustAuthenticator } from "../mfa/test-trust.ts";

/**
 * These tests check category roles, not the second step, so each user acts
 * through a session that has already passed MFA (admin pages need it).
 */
const trusted = new WeakMap<Db, Map<string, Promise<string>>>();
function trustedSession(db: Db, userId: string): Promise<string> {
  const sessions = trusted.get(db) ?? new Map<string, Promise<string>>();
  trusted.set(db, sessions);
  let session = sessions.get(userId);
  if (!session) {
    session = trustAuthenticator(db, userId);
    sessions.set(userId, session);
  }
  return session;
}

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
        sessionId: await trustedSession(db, id),
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
    const categories = await db.query<{
      slug: string;
      name: string;
      description: string;
      sort_order: number;
    }>(
      `select slug, name, description, sort_order from categories order by sort_order asc, slug asc`,
    );
    assert.deepEqual(
      categories.map((row) => row.slug),
      CATEGORY_LIST.map((category) => category.slug),
    );
    assert.deepEqual(
      categories.map((row) => row.name),
      CATEGORY_LIST.map((category) => category.name),
    );
    assert.deepEqual(
      categories.map((row) => row.description),
      CATEGORY_LIST.map((category) => category.description),
    );
    const links = await db.query<{ room_id: string; category_id: string }>(
      `select room_id, category_id from room_categories`,
    );
    const byRoom = new Map<string, string[]>();
    for (const link of links) {
      const list = byRoom.get(link.room_id) ?? [];
      list.push(link.category_id);
      byRoom.set(link.room_id, list);
    }
    const rooms = await db.query<{ id: string }>(`select id from room`);
    for (const room of rooms) {
      assert.deepEqual(byRoom.get(room.id) ?? [], [ROOM_CATEGORY[room.id] ?? "uncategorized"]);
    }
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
       values ('mill', 'Mill', 'A mill night.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 90)`,
    );
    const mill = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'mill'`,
    );
    assert.equal(mill.length, 0);
    const dropped = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'room' and column_name = 'category_id'`,
    );
    assert.equal(dropped.length, 0);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'categories'`,
    );
    assert.deepEqual(columns.map((row) => row.column_name).sort(), [
      "description",
      "name",
      "slug",
      "sort_order",
    ]);
    const pin = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'room' and column_name = 'pin_order'`,
    );
    assert.equal(pin.length, 1);
    const audience = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'room'
         and column_name in ('audience', 'sex')`,
    );
    assert.deepEqual(
      audience.map((row) => row.column_name),
      ["audience"],
    );
    const labeled = await db.query<{ id: string }>(
      `select room_id as id from room_categories where category_id in ('men', 'women')`,
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
    const admin = randomUUID();
    await user(db, member, "Maria", "maria@example.com");
    await user(db, stranger, "Pete", "pete@example.com");
    await user(db, barred, "Luis", "luis@example.com");
    await user(db, roomBarred, "Ruth", "ruth@example.com");
    await user(db, steward, "Tom", "tom@example.com");
    await user(db, admin, "Ada", "ada@example.com");
    await grant(db, member, "Maria", "member");
    await grant(db, barred, "Luis", "member");
    await grant(db, roomBarred, "Ruth", "member");
    await grant(db, steward, "Tom", "member");
    await grant(db, steward, "Tom", "steward", "shop");
    await grant(db, admin, "Ada", "member");
    await grant(db, admin, "Ada", "admin");
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
    await db.query(`insert into room_join (user_id, room_id) values ($1, 'shop')`, [member]);
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
      rooms: { id: string; nextGathering: string | null; joined?: boolean }[];
    };
    assert.deepEqual(
      tradeBody.rooms.map((room) => room.id),
      ["rv-shop", "shop"],
    );
    const shop = tradeBody.rooms.find((room) => room.id === "shop");
    assert.equal(shop?.nextGathering, "2026-10-25");
    assert.equal(shop?.joined, true);
    assert.equal(tradeBody.rooms.find((room) => room.id === "rv-shop")?.joined, false);
    assert.equal(keysOf(tradeBody).has("count"), false);
    assert.equal(keysOf(tradeBody).has("members"), false);

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
      false,
    );
    await db.query(`delete from room_categories where room_id = 'shop'`);
    await db.query(
      `insert into room_categories (room_id, category_id) values ('shop', 'uncategorized')`,
    );
    const ownParked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(ownParked.status, 200);
    const ownBody = (await ownParked.json()) as { rooms: { id: string }[] };
    assert.deepEqual(
      ownBody.rooms.map((room) => room.id),
      ["shop"],
    );
    const adminParked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        headers: { "x-user-id": admin },
      }),
    );
    assert.equal(adminParked.status, 200);
    const adminBody = (await adminParked.json()) as { rooms: { id: string }[] };
    assert.equal(
      adminBody.rooms.some((room) => room.id === "mill"),
      true,
    );
    assert.equal(
      adminBody.rooms.some((room) => room.id === "shop"),
      true,
    );
    await db.query(`delete from room_categories where room_id = 'shop'`);
    await db.query(
      `insert into room_categories (room_id, category_id) values ('shop', 'business-trades')`,
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

test("only an admin manages categories, and a room steward cannot edit another room", async () => {
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
    const stewardCreate = await handler(
      new Request("http://127.0.0.1:8787/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ slug: "pwn", name: "Pwn" }),
      }),
    );
    assert.equal(stewardCreate.status, 403);
    const stewardCreateBody = (await stewardCreate.json()) as { error?: string };
    assert.equal(stewardCreateBody.error, "Only an admin can manage categories.");
    const stewardRename = await handler(
      new Request("http://127.0.0.1:8787/api/categories/churches", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ name: "Heretics" }),
      }),
    );
    assert.equal(stewardRename.status, 403);
    const stewardOrder = await handler(
      new Request("http://127.0.0.1:8787/api/categories/civic", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ sortOrder: 9 }),
      }),
    );
    assert.equal(stewardOrder.status, 403);
    const stewardDelete = await handler(
      new Request("http://127.0.0.1:8787/api/categories/men", {
        method: "DELETE",
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(stewardDelete.status, 403);

    const created = await handler(
      new Request("http://127.0.0.1:8787/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": admin },
        body: JSON.stringify({ slug: "youth", name: "Youth" }),
      }),
    );
    assert.equal(created.status, 201);
    const renamed = await handler(
      new Request("http://127.0.0.1:8787/api/categories/youth", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": admin },
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
        headers: { "x-user-id": admin },
      }),
    );
    assert.equal(removed.status, 200);
    const keepParked = await handler(
      new Request("http://127.0.0.1:8787/api/categories/uncategorized", {
        method: "DELETE",
        headers: { "x-user-id": admin },
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
    const movedBody = (await moved.json()) as { categoryIds?: string[]; name?: string };
    assert.deepEqual(movedBody.categoryIds, ["discussion"]);
    const both = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryIds: ["discussion", "civic"] }),
      }),
    );
    assert.equal(both.status, 200);
    const bothBody = (await both.json()) as { categoryIds?: string[] };
    assert.deepEqual(bothBody.categoryIds, ["discussion", "civic"]);
    const cleared = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryIds: [] }),
      }),
    );
    assert.equal(cleared.status, 400);
    const clearedBody = (await cleared.json()) as { error?: string };
    assert.equal(clearedBody.error, "Choose a category.");
    const kept = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'shop' order by category_id`,
    );
    assert.deepEqual(
      kept.map((row) => row.category_id),
      ["civic", "discussion"],
    );
    const discussionPage = await handler(
      new Request("http://127.0.0.1:8787/api/categories/discussion", {
        headers: { "x-user-id": steward },
      }),
    );
    const civicPage = await handler(
      new Request("http://127.0.0.1:8787/api/categories/civic", {
        headers: { "x-user-id": steward },
      }),
    );
    const discussionRooms = ((await discussionPage.json()) as { rooms: { id: string; categoryIds?: string[] }[] }).rooms;
    const civicRooms = ((await civicPage.json()) as { rooms: { id: string; categoryIds?: string[] }[] }).rooms;
    assert.deepEqual(
      discussionRooms.find((room) => room.id === "shop")?.categoryIds,
      ["discussion", "civic"],
    );
    assert.deepEqual(
      civicRooms.find((room) => room.id === "shop")?.categoryIds,
      ["discussion", "civic"],
    );
    const board = await handler(
      new Request("http://127.0.0.1:8787/api/board", { headers: { "x-user-id": steward } }),
    );
    const boardRooms = ((await board.json()) as { rooms: { id: string; categoryIds?: string[] }[] }).rooms;
    assert.deepEqual(
      boardRooms.find((room) => room.id === "shop")?.categoryIds,
      ["discussion", "civic"],
    );
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
    const renamedRoomBody = (await renamedRoom.json()) as { name?: string; categoryIds?: string[] };
    assert.equal(renamedRoomBody.name, "New Shop");
    assert.deepEqual(renamedRoomBody.categoryIds, ["business-trades"]);
    const memberMove = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": member },
        body: JSON.stringify({ categoryId: "civic" }),
      }),
    );
    assert.equal(memberMove.status, 404);
    const memberBody = (await memberMove.json()) as { error?: string };
    assert.equal(memberBody.error, "That room is not here.");
    const otherRoom = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/baptist", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryId: "uncategorized" }),
      }),
    );
    assert.equal(otherRoom.status, 404);
    const otherBody = (await otherRoom.json()) as { error?: string };
    assert.equal(otherBody.error, "That room is not here.");
    const missingRoom = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/no-such-room", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryId: "civic" }),
      }),
    );
    assert.equal(missingRoom.status, 404);
    const missingBody = (await missingRoom.json()) as { error?: string };
    assert.equal(missingBody.error, otherBody.error);
    const pinned = await handler(
      new Request("http://127.0.0.1:8787/api/rooms/shop", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": steward },
        body: JSON.stringify({ categoryId: "business-trades", pinOrder: 0 }),
      }),
    );
    assert.equal(pinned.status, 200);
    const pinnedBody = (await pinned.json()) as { pinOrder?: number };
    assert.equal(pinnedBody.pinOrder, 0);
  } finally {
    await close();
  }
});

test("category backfill fills only a room with no links, then room type", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(`delete from room_categories where room_id = 'shop'`);
    await db.query(
      `insert into room_categories (room_id, category_id) values ('shop', 'discussion')`,
    );
    const sql = readFileSync(new URL("../../migrations/0021_categories.sql", import.meta.url), "utf8");
    const inserts = sql.match(/insert into room_categories \(room_id, category_id\)[\s\S]*?;/gi) ?? [];
    assert.ok(inserts.length >= 8);
    for (const insert of inserts) {
      assert.match(insert, /not exists/);
      await db.query(insert);
    }
    const shop = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'shop'`,
    );
    assert.deepEqual(
      shop.map((row) => row.category_id),
      ["discussion"],
    );
    await db.query(
      `insert into room (
         id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
         sort_order, scope_kind, town_id, congregation_id, region_id
       ) values
       ('plant-city-town', 'Plant City', 'A town room.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 80, 'town', 'plant-city', '', ''),
       ('cong-new', 'New congregation', 'A parish room.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 81, 'congregation', '', 'cong-new', ''),
       ('region-new', 'New region', 'A region room.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 82, 'region', '', '', 'region-new'),
       ('mens-study', 'Study', 'A topic room.', array[]::text[], array[]::text[], array[]::text[], 'Meeting', false, false, 83, 'topic', '', '', '')`,
    );
    for (const insert of inserts) await db.query(insert);
    const placed = await db.query<{ room_id: string; category_id: string }>(
      `select room_id, category_id from room_categories
       where room_id in ('plant-city-town', 'cong-new', 'region-new', 'mens-study', 'shop')
       order by room_id asc`,
    );
    assert.deepEqual(
      placed.map((row) => [row.room_id, row.category_id]),
      [
        ["cong-new", "churches"],
        ["mens-study", "uncategorized"],
        ["plant-city-town", "civic"],
        ["region-new", "county"],
        ["shop", "discussion"],
      ],
    );
  } finally {
    await close();
  }
});

test("a category list hides a room the member does not match", async () => {
  const { db, close } = await openTestDb();
  try {
    const woman = randomUUID();
    const man = randomUUID();
    const steward = randomUUID();
    await user(db, woman, "Ada", "ada-rooms@example.com");
    await user(db, man, "Ben", "ben-rooms@example.com");
    await user(db, steward, "Cora", "cora-rooms@example.com");
    await grant(db, woman, "Ada", "member");
    await grant(db, man, "Ben", "member");
    await grant(db, steward, "Cora", "member");
    await grant(db, steward, "Cora", "steward", "shop");
    await db.query(`insert into members (user_id, display_name, gender) values ($1, 'Ann', 'woman'), ($2, 'Bo', 'man'), ($3, 'Cy', 'woman')`, [
      woman,
      man,
      steward,
    ]);
    await db.query(`update room set audience = 'men' where id = 'shop'`);
    const handler = app(db);
    const hidden = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": woman },
      }),
    );
    assert.equal(hidden.status, 200);
    const hiddenBody = (await hidden.json()) as { rooms: { id: string; name?: string }[] };
    assert.equal(
      hiddenBody.rooms.some((room) => room.id === "shop"),
      false,
    );
    assert.equal(
      hiddenBody.rooms.some((room) => room.id === "rv-shop"),
      true,
    );
    const board = await handler(
      new Request("http://127.0.0.1:8787/api/board?room=shop", { headers: { "x-user-id": woman } }),
    );
    assert.equal(board.status, 404);
    assert.deepEqual(await board.json(), { error: "That room is not here." });
    const shown = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": man },
      }),
    );
    const shownBody = (await shown.json()) as { rooms: { id: string }[] };
    assert.equal(
      shownBody.rooms.some((room) => room.id === "shop"),
      true,
    );
    const hers = await handler(
      new Request("http://127.0.0.1:8787/api/categories/business-trades", {
        headers: { "x-user-id": steward },
      }),
    );
    const hersBody = (await hers.json()) as { rooms: { id: string }[] };
    assert.equal(
      hersBody.rooms.some((room) => room.id === "shop"),
      true,
    );
  } finally {
    await close();
  }
});
