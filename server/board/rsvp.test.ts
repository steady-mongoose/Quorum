import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trustAuthenticator } from "../mfa/test-trust.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { moveEntries, RSVP_BATCH_MAX } from "./rsvp.ts";

const GATHERING = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "7c2a3b4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e";
const BASE = "http://127.0.0.1:8787";

async function user(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`],
  );
  return id;
}

async function grant(db: Db, userId: string, name: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name],
  );
}

async function makeAdmin(db: Db, userId: string) {
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair)
     values ($1, true, false, false)
     on conflict (user_id) do update set is_admin = true`,
    [userId],
  );
}

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => new Date("2026-10-29T12:00:00Z"),
    createAccount: async () => ({ id: randomUUID() }),
    signIn: async (input) => ({
      ok: true,
      user: { id: input.userId, name: input.name, email: input.email },
    }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "x", email: "x@example.com", sessionId: headers.get("x-session-id") ?? undefined };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

type Handler = (request: Request) => Promise<Response>;
type As = { id: string; session?: string };

function call(handler: Handler, as: As | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers["x-user-id"] = as.id;
  if (as?.session) headers["x-session-id"] = as.session;
  return handler(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  const dale = await user(db, "Dale");
  const maria = await user(db, "Maria");
  const tom = await user(db, "Tom");
  const josh = await user(db, "Josh");
  for (const [id, name] of [
    [dale, "Dale"],
    [maria, "Maria"],
    [tom, "Tom"],
    [josh, "Josh"],
  ] as const) {
    await grant(db, id, name);
  }
  await makeAdmin(db, josh);
  const joshSession = await trustAuthenticator(db, josh);
  const handler = app(db);
  for (const id of [GATHERING, OTHER]) {
    const saved = await call(handler, { id: dale }, "POST", "/api/gatherings", {
      id,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-31",
      time: "7 a.m.",
      place: "Dale's garage, Riverview",
    });
    assert.equal(saved.status, 200, await saved.clone().text());
  }
  return {
    ...opened,
    handler,
    dale: { id: dale },
    maria: { id: maria },
    tom: { id: tom },
    josh: { id: josh, session: joshSession },
  };
}

test("a member sees only their own RSVP: no other names, no counts", async () => {
  const t = await setup();
  try {
    for (const who of [t.maria, t.tom]) {
      const set = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
      assert.equal(set.status, 200);
      assert.deepEqual(await set.json(), { mine: { going: true, attended: false } });
    }

    const one = await call(t.handler, t.maria, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(one.status, 200);
    const oneBody = await one.json();
    assert.deepEqual(oneBody, { mine: { going: true, attended: false } });

    const all = await call(t.handler, t.maria, "GET", "/api/rsvps");
    const body = (await all.json()) as { viewer: string; admin: boolean; rsvps: { userId: string; name: string }[] };
    assert.equal(body.admin, false);
    assert.equal(body.viewer, t.maria.id);
    assert.equal(body.rsvps.length, 1);
    assert.equal(body.rsvps[0]?.userId, t.maria.id);
    const text = JSON.stringify(body) + JSON.stringify(oneBody);
    assert.equal(text.includes("Tom"), false);
    assert.equal(text.includes(t.tom.id), false);
    assert.equal(/count|total|score|like/i.test(text), false);

    // The host is not an admin: the host also sees only their own.
    const host = await call(t.handler, t.dale, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await host.json(), { mine: { going: false, attended: false } });
    const hostAll = (await (await call(t.handler, t.dale, "GET", "/api/rsvps")).json()) as { rsvps: unknown[] };
    assert.deepEqual(hostAll.rsvps, []);

    // Clearing my RSVP removes it.
    const cleared = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    assert.deepEqual(await cleared.json(), { mine: { going: false, attended: false } });
  } finally {
    await t.close();
  }
});

test("an admin sees everyone who is going and who has been", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
    const one = await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(one.status, 200);
    const body = (await one.json()) as { people: { name: string; going: boolean; attended: boolean }[] };
    assert.deepEqual(
      body.people.map((row) => [row.name, row.going, row.attended]),
      [
        ["Maria", true, false],
        ["Tom", false, true],
      ],
    );
    const all = (await (await call(t.handler, t.josh, "GET", "/api/rsvps")).json()) as {
      admin: boolean;
      rsvps: { name: string }[];
    };
    assert.equal(all.admin, true);
    assert.deepEqual(all.rsvps.map((row) => row.name).sort(), ["Maria", "Tom"]);
  } finally {
    await t.close();
  }
});

test("the routes check who is asking", async () => {
  const t = await setup();
  try {
    assert.equal((await call(t.handler, null, "GET", "/api/rsvps")).status, 401);
    assert.equal((await call(t.handler, null, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 401);

    // Not a member: the gathering does not exist for them.
    const stranger = { id: await user(t.db, "Stranger") };
    assert.equal(
      (await call(t.handler, stranger, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status,
      404,
    );
    assert.equal((await call(t.handler, stranger, "GET", `/api/gatherings/${GATHERING}/rsvps`)).status, 404);

    // A missing gathering is a 404 too.
    const missing = "8d3b4c5e-6f70-4c8d-8e9f-1a2b3c4d5e6f";
    assert.equal((await call(t.handler, t.maria, "POST", `/api/gatherings/${missing}/rsvp`, { going: true })).status, 404);

    // A member cannot mark anyone as having come, or set it through rsvp.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const sneak = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.tom.id],
    });
    assert.equal(sneak.status, 403);
    const fake = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: false });
    assert.equal(fake.status, 400);

    // The host marks who came, but the answer names nobody.
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.tom.id, t.maria.id],
      close: true,
    });
    assert.equal(marked.status, 200);
    assert.deepEqual(await marked.json(), { ok: true });
    const tomNow = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await tomNow.json(), { mine: { going: false, attended: true } });
    // Maria never said she would come, so she was not marked.
    const mariaNow = await call(t.handler, t.maria, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await mariaNow.json(), { mine: { going: false, attended: false } });

    // An admin may mark attendance too.
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const admin = await call(t.handler, t.josh, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.maria.id],
    });
    assert.equal(admin.status, 200);

    // Too many ids is refused.
    const many = Array.from({ length: RSVP_BATCH_MAX + 1 }, () => randomUUID());
    assert.equal(
      (await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, { userIds: many })).status,
      400,
    );
  } finally {
    await t.close();
  }
});

test("the one-time move only adds my own rows, and a second run changes nothing", async () => {
  const t = await setup();
  try {
    const entries = [
      { gatheringId: GATHERING, going: true, attended: false },
      { gatheringId: OTHER, going: false, attended: true },
      { gatheringId: "brief", going: true, attended: true },
      { gatheringId: "8d3b4c5e-6f70-4c8d-8e9f-1a2b3c4d5e6f", going: true, attended: false },
      { gatheringId: GATHERING, going: false, attended: false, userId: t.tom.id, name: "Tom" },
    ];
    const first = await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries });
    assert.equal(first.status, 200);
    assert.deepEqual(((await first.json()) as { saved: string[] }).saved.sort(), [GATHERING, OTHER].sort());

    const rows = () =>
      t.db.query<{ gathering_id: string; user_id: string; going: boolean; attended: boolean }>(
        `select gathering_id, user_id, going, attended from gathering_rsvp order by gathering_id, user_id`,
      );
    const before = await rows();
    assert.equal(before.length, 2);
    assert.ok(before.every((row) => row.user_id === t.maria.id));

    const second = await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries });
    assert.equal(second.status, 200);
    assert.deepEqual(await rows(), before);

    // A move never clears what the server already has.
    await call(t.handler, t.maria, "POST", "/api/rsvps/move", {
      entries: [{ gatheringId: GATHERING, going: false, attended: false }],
    });
    assert.deepEqual(await rows(), before);

    const tooMany = Array.from({ length: RSVP_BATCH_MAX + 1 }, () => ({ gatheringId: GATHERING, going: true }));
    assert.equal((await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries: tooMany })).status, 400);
  } finally {
    await t.close();
  }
});

test("move entries drop seed cards and merge duplicates", () => {
  assert.deepEqual(
    moveEntries([
      { gatheringId: "brief", going: true },
      { gatheringId: GATHERING.toUpperCase(), going: true },
      { gatheringId: GATHERING, attended: true },
      { gatheringId: OTHER, going: false, attended: false },
    ]),
    [{ gatheringId: GATHERING, going: true, attended: true }],
  );
  assert.equal(moveEntries("nope"), null);
});

test("migration 0049 is valid, owner-approved, idempotent, and has no counts", async () => {
  const sql = readFileSync(new URL("../../migrations/0049_gathering_rsvp.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0049/);
  assert.match(sql, /owner must approve/i);
  assert.match(sql, /Deploy order:/);
  assert.match(sql, /Rollback:/);
  assert.match(sql, /create table if not exists gathering_rsvp/);
  assert.match(sql, /primary key \(gathering_id, user_id\)/);
  assert.match(sql, /references public_gathering \(id\) on delete cascade/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/^\s*(drop table|delete from|update )/im.test(sql), false);
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  for (const banned of ["count", "likes", "score", "reshare", "rank"]) {
    assert.equal(code.includes(banned), false, banned);
  }

  // Applying it a second time is safe, and one row per gathering and member.
  const { db, pg, close } = await openTestDb();
  try {
    await pg.exec(sql);
    const u = await user(db, "Ann");
    await db.query(
      `insert into public_gathering (id, title, host_user_id, room_id) values ($1, 'T', $2, 'shop')`,
      [GATHERING, u],
    );
    await db.query(`insert into gathering_rsvp (gathering_id, user_id, going) values ($1, $2, true)`, [GATHERING, u]);
    await assert.rejects(
      db.query(`insert into gathering_rsvp (gathering_id, user_id, going) values ($1, $2, true)`, [GATHERING, u]),
    );
    await assert.rejects(
      db.query(`insert into gathering_rsvp (gathering_id, user_id) values ($1, $2)`, [OTHER, u]),
    );
    await db.query(`delete from "user" where id = $1`, [u]);
    assert.deepEqual(await db.query(`select 1 from gathering_rsvp`), []);
  } finally {
    await close();
  }
});
