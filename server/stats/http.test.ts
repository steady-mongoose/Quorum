import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createApp, type AppDeps } from "../http.ts";
import { CLIENT_IP_HEADER } from "../proxy.ts";
import { rollStats } from "./rollup.ts";

const NOW = new Date("2026-10-26T12:00:00Z");

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => NOW,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Member", email: "member@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

test("stats are refused without a session and for anyone who is not an admin", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const anon = await handler(new Request("http://127.0.0.1:8787/api/admin/stats"));
    assert.equal(anon.status, 401);
    const anonBody = (await anon.json()) as { error?: string; tiles?: unknown };
    assert.equal(anonBody.error, "Sign in first.");
    assert.equal(anonBody.tiles, undefined);

    const member = randomUUID();
    await person(db, member, "member@example.com");
    await db.query(
      `insert into access_log
       (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, 'Member', 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), member],
    );
    const refused = await handler(
      new Request("http://127.0.0.1:8787/api/admin/stats", { headers: { "x-user-id": member } }),
    );
    assert.equal(refused.status, 403);
    const refusedBody = (await refused.json()) as { error?: string; tiles?: unknown };
    assert.equal(refusedBody.error, "This page is for an admin.");
    assert.equal(refusedBody.tiles, undefined);
    assert.equal(JSON.stringify(refusedBody).includes("<5"), false);

    const steward = randomUUID();
    await person(db, steward, "steward@example.com");
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, 'Steward', 'steward', 'shop', 'grant', 'test', 'test', 'test', 'Steward for the test.')`,
      [randomUUID(), steward],
    );
    const stewardResponse = await handler(
      new Request("http://127.0.0.1:8787/api/admin/stats.csv", {
        headers: { "x-user-id": steward },
      }),
    );
    assert.equal(stewardResponse.status, 403);
    const stewardBody = (await stewardResponse.json()) as { error?: string };
    assert.equal(stewardBody.error, "This page is for an admin.");

    const posted = await handler(
      new Request("http://127.0.0.1:8787/api/admin/stats", {
        method: "POST",
        headers: { "x-user-id": member },
      }),
    );
    assert.equal(posted.status, 405);
  } finally {
    await close();
  }
});

test("an admin can read the stats and the csv, with small counts hidden", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    const other = randomUUID();
    await person(db, admin, "admin@example.com");
    await person(db, other, "other@example.com");
    await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [admin]);
    await db.query(
      `insert into member_active_days (member_id, date) values ($1, '2026-10-25'::date), ($2, '2026-10-25'::date)`,
      [admin, other],
    );
    await rollStats(db, NOW, 90);
    const handler = app(db);
    const response = await handler(
      new Request("http://127.0.0.1:8787/api/admin/stats", { headers: { "x-user-id": admin } }),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = (await response.json()) as {
      tiles: { value: string | number | null }[];
    };
    const text = JSON.stringify(body);
    assert.equal(body.tiles[0]?.value, "<5");
    assert.equal(text.includes(admin), false);
    assert.equal(text.includes(other), false);
    const dau = await db.query<{ count: number }>(
      `select count from stats_daily where metric = 'dau' and date = '2026-10-25'::date`,
    );
    assert.equal(Number(dau[0]?.count), 2);

    const csv = await handler(
      new Request("http://127.0.0.1:8787/api/admin/stats.csv", { headers: { "x-user-id": admin } }),
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="stats.csv"/);
    const csvText = await csv.text();
    assert.match(csvText, /<5/);
    assert.equal(csvText.includes(admin), false);
  } finally {
    await close();
  }
});

test("the founding owner can read stats without a separate admin flag", async () => {
  const { db, close } = await openTestDb();
  try {
    const owner = randomUUID();
    await person(db, owner, "owner@example.com");
    await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [owner]);
    const response = await app(db)(
      new Request("http://127.0.0.1:8787/api/admin/stats", { headers: { "x-user-id": owner } }),
    );
    assert.equal(response.status, 200);
  } finally {
    await close();
  }
});

test("a site-banned admin cannot read stats", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    await person(db, admin, "banned-admin@example.com");
    await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [admin]);
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Member', 'threat', 'Tom', 1, $3, $4)`,
      [randomUUID(), admin, new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000), NOW],
    );
    const handler = app(db);
    const headers = { "x-user-id": admin };
    for (const path of ["/api/admin/stats", "/api/admin/stats.csv"]) {
      const response = await handler(new Request(`http://127.0.0.1:8787${path}`, { headers }));
      assert.equal(response.status, 403, path);
      const body = (await response.json()) as {
        error?: string;
        tiles?: unknown;
        ban?: { reason?: string };
      };
      assert.equal(body.error, "banned", path);
      assert.equal(body.ban?.reason, "threat", path);
      assert.equal(body.tiles, undefined, path);
      assert.equal(JSON.stringify(body).includes("<5"), false, path);
    }
  } finally {
    await close();
  }
});

test("a signed-in request records the day and never stores the client address", async () => {
  const { db, close } = await openTestDb();
  try {
    const member = randomUUID();
    await person(db, member, "active@example.com");
    const handler = app(db);
    const headers = {
      "x-user-id": member,
      [CLIENT_IP_HEADER]: "203.0.113.50",
    };
    const refused = await handler(new Request("http://127.0.0.1:8787/api/board", { headers }));
    assert.equal(refused.status, 403);
    const before = await db.query(`select member_id from member_active_days`);
    assert.equal(before.length, 0);
    await db.query(
      `insert into access_log
       (id, user_id, name, role, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, 'Member', 'member', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
      [randomUUID(), member],
    );
    const first = await handler(new Request("http://127.0.0.1:8787/api/board", { headers }));
    const second = await handler(new Request("http://127.0.0.1:8787/api/board", { headers }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const days = await db.query(
      `select member_id from member_active_days where member_id = $1 and date = '2026-10-26'::date`,
      [member],
    );
    assert.equal(days.length, 1);
    const feature = await db.query<{ count: number }>(
      `select count from stats_daily
       where metric = 'feature' and dimension = 'board' and date = '2026-10-26'::date`,
    );
    assert.equal(Number(feature[0]?.count), 1);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'member_active_days'`,
    );
    assert.equal(
      columns.some((column) => /ip/i.test(column.column_name)),
      false,
    );
    const stored = JSON.stringify(await db.query(`select * from member_active_days`));
    assert.equal(stored.includes("203.0.113.50"), false);

    const stranger = await handler(new Request("http://127.0.0.1:8787/api/board"));
    assert.equal(stranger.status, 401);
    const untouched = await db.query(`select member_id from member_active_days`);
    assert.equal(untouched.length, 1);

    const health = await handler(
      new Request("http://127.0.0.1:8787/api/health", { headers: { "x-user-id": member } }),
    );
    assert.equal(health.status, 200);
    const auth = await handler(
      new Request("http://127.0.0.1:8787/api/auth/get-session", {
        headers: { "x-user-id": member },
      }),
    );
    assert.equal(auth.status, 500);
    const features = await db.query(`select dimension from stats_daily where metric = 'feature'`);
    assert.deepEqual(
      features.map((row) => row.dimension),
      ["board"],
    );
  } finally {
    await close();
  }
});

async function person(db: Db, id: string, email: string): Promise<void> {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Member', $2, true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
    [id, email],
  );
}
