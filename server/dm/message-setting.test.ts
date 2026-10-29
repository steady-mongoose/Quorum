import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  BLOCKED,
  blockMember,
  mayMessage,
  memberMessageStates,
  openThread,
} from "./store.ts";
import { readMessageFrom, saveMessageFrom } from "./message-setting.ts";
import { NOT_TAKING_MESSAGES } from "../../src/lib/e2ee/message-setting.ts";

const now = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const MIGRATION = new URL("../../migrations/0046_message_setting.sql", import.meta.url);

async function member(db: Db, name: string, joinedDaysAgo = 10): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, daysAgo(30)],
  );
  for (const room of ["", "shop"]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, 'member', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, room, daysAgo(30)],
    );
  }
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [
    id,
    daysAgo(joinedDaysAgo),
  ]);
  return id;
}

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => {
      throw new Error("unused");
    },
    signIn: async () => {
      throw new Error("unused");
    },
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      const rows = await db.query<{ id: string; name: string; email: string }>(
        `select id, name, email from "user" where id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },
    forwardAuth: async () => new Response(null, { status: 404 }),
  });
}

async function send(
  handler: (request: Request) => Promise<Response>,
  userId: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ status: number; text: string; type: string | null }> {
  const headers = new Headers({ origin: "http://localhost:8080", "x-user-id": userId });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handler(
    new Request(`http://127.0.0.1:8787${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    text: await response.text(),
    type: response.headers.get("content-type"),
  };
}

test("migration 0046 applies twice, defaults to rooms, and refuses other values", async () => {
  const { db, pg, close } = await openTestDb();
  try {
    const sql = readFileSync(MIGRATION, "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    const column = await pg.query<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
       where table_name = 'members' and column_name = 'message_from'`,
    );
    assert.equal(column.rows.length, 1);
    assert.match(column.rows[0]?.column_default ?? "", /'rooms'/);
    assert.equal(column.rows[0]?.is_nullable, "NO");
    const checks = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'members_message_from_check'`,
    );
    assert.equal(checks.rows.length, 1, "one check constraint after two runs");
    const anna = await member(db, "Anna");
    await db.query(`insert into members (user_id, display_name) values ($1, 'Anna')`, [anna]);
    assert.equal(await readMessageFrom(db, anna), "rooms");
    await assert.rejects(
      db.query(`update members set message_from = 'everyone' where user_id = $1`, [anna]),
    );
    for (const value of ["rooms", "conversations", "none"]) {
      await db.query(`update members set message_from = $2 where user_id = $1`, [anna, value]);
    }
  } finally {
    await close();
  }
});

test("each Messages choice decides who can reach you, and a block reads the same", async () => {
  const { db, close } = await openTestDb();
  try {
    assert.equal(BLOCKED, NOT_TAKING_MESSAGES);
    assert.equal(NOT_TAKING_MESSAGES, "This member isn't taking messages right now.");
    const anna = await member(db, "Anna");
    const ben = await member(db, "Ben");
    const cal = await member(db, "Cal");
    const refused = { ok: false, status: 403, error: NOT_TAKING_MESSAGES };

    // No members row: the default, which is today's rule.
    assert.equal(await readMessageFrom(db, anna), "rooms");
    assert.deepEqual(await mayMessage(db, ben, anna, now, { starting: true }), {
      ok: true,
      via: "room",
    });

    // Ben and Anna already have a conversation; Cal does not.
    assert.equal((await openThread(db, ben, anna, now)).ok, true);
    assert.deepEqual(await saveMessageFrom(db, anna, "conversations"), {
      ok: true,
      value: "conversations",
    });
    assert.equal(await readMessageFrom(db, anna), "conversations");
    assert.equal((await mayMessage(db, ben, anna, now)).ok, true);
    assert.equal((await openThread(db, ben, anna, now)).ok, true);
    assert.deepEqual(await mayMessage(db, cal, anna, now, { starting: true }), refused);
    const calOpen = await openThread(db, cal, anna, now);
    assert.deepEqual(calOpen.ok ? null : [calOpen.status, calOpen.error], [403, NOT_TAKING_MESSAGES]);

    // Your own setting does not stop you writing to others.
    assert.equal((await mayMessage(db, anna, cal, now, { starting: true })).ok, true);

    await saveMessageFrom(db, anna, "none");
    assert.deepEqual(await mayMessage(db, ben, anna, now), refused);
    assert.deepEqual(await mayMessage(db, cal, anna, now), refused);

    await saveMessageFrom(db, anna, "rooms");
    assert.equal((await mayMessage(db, cal, anna, now, { starting: true })).ok, true);

    // A block refuses with the same words and status.
    await blockMember(db, anna, cal, now);
    assert.deepEqual(await mayMessage(db, cal, anna, now), refused);
    assert.deepEqual(await mayMessage(db, anna, cal, now), refused);

    const bad = await saveMessageFrom(db, anna, "everyone");
    assert.deepEqual(bad.ok ? null : bad.status, 400);
    assert.equal(await readMessageFrom(db, anna), "rooms");
  } finally {
    await close();
  }
});

test("a block and the Messages setting return the same status and byte-identical body", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const blocker = await member(db, "Blocker");
    const quiet = await member(db, "Quiet");
    const caller = await member(db, "Caller");
    assert.equal((await blockMember(db, blocker, caller, now)).ok, true);
    const set = await send(handler, quiet, "/api/dm/settings", "POST", { messageFrom: "none" });
    assert.equal(set.status, 200);
    assert.deepEqual(JSON.parse(set.text), { messageFrom: "none" });

    const byBlock = await send(handler, caller, "/api/dm/threads", "POST", { userId: blocker });
    const bySetting = await send(handler, caller, "/api/dm/threads", "POST", { userId: quiet });
    assert.equal(byBlock.status, 403);
    assert.equal(bySetting.status, byBlock.status);
    assert.equal(bySetting.text, byBlock.text);
    assert.equal(bySetting.type, byBlock.type);
    assert.deepEqual(JSON.parse(byBlock.text), { error: NOT_TAKING_MESSAGES });

    const keysBlock = await send(handler, caller, `/api/dm/keys?userId=${blocker}`, "GET");
    const keysSetting = await send(handler, caller, `/api/dm/keys?userId=${quiet}`, "GET");
    assert.equal(keysSetting.status, keysBlock.status);
    assert.equal(keysSetting.text, keysBlock.text);

    // "Only people I've messaged before" refuses a newcomer the same way.
    await send(handler, quiet, "/api/dm/settings", "POST", { messageFrom: "conversations" });
    const byConversations = await send(handler, caller, "/api/dm/threads", "POST", {
      userId: quiet,
    });
    assert.equal(byConversations.status, byBlock.status);
    assert.equal(byConversations.text, byBlock.text);
  } finally {
    await close();
  }
});

test("the settings route reads and writes only your own choice", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const anna = await member(db, "Anna");
    const ben = await member(db, "Ben");
    const first = await send(handler, anna, "/api/dm/settings", "GET");
    assert.equal(first.status, 200);
    assert.deepEqual(JSON.parse(first.text), { messageFrom: "rooms" });
    const bad = await send(handler, anna, "/api/dm/settings", "POST", { messageFrom: "all" });
    assert.equal(bad.status, 400);
    const saved = await send(handler, anna, "/api/dm/settings", "POST", {
      messageFrom: "conversations",
      userId: ben,
    });
    assert.equal(saved.status, 200);
    assert.equal(await readMessageFrom(db, anna), "conversations");
    assert.equal(await readMessageFrom(db, ben), "rooms");
    const signedOut = await send(handler, "", "/api/dm/settings", "GET");
    assert.equal(signedOut.status, 401);
  } finally {
    await close();
  }
});

test("the member list shows Message on rows the setting refuses, exactly like blocked rows", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await member(db, "Anna");
    const open = await member(db, "Open");
    const blockedMe = await member(db, "BlockedMe");
    const quiet = await member(db, "Quiet");
    const known = await member(db, "Known");
    await blockMember(db, blockedMe, anna, now);
    await saveMessageFrom(db, quiet, "none");
    await saveMessageFrom(db, known, "conversations");
    const ids = [open, blockedMe, quiet, known];
    const states = await memberMessageStates(db, anna, ids, now);
    for (const id of ids) assert.equal(states.get(id), "open");

    // The 3-day wait is unchanged and looks the same on every row.
    const newcomer = await member(db, "Newt", 1);
    const waiting = await memberMessageStates(db, newcomer, ids, now);
    for (const id of ids) assert.equal(waiting.get(id), "wait");

    // The daily cap is unchanged and looks the same on every row.
    for (let i = 0; i < 5; i += 1) {
      const other = await member(db, `Started${i}`);
      assert.equal((await openThread(db, anna, other, now)).ok, true);
    }
    const capped = await memberMessageStates(db, anna, ids, now);
    for (const id of ids) assert.equal(capped.get(id), "none");
  } finally {
    await close();
  }
});

test("before migration 0046 is applied, everyone has the default and messaging still works", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await member(db, "Anna");
    const ben = await member(db, "Ben");
    await db.query(`alter table members drop column message_from`);
    assert.equal(await readMessageFrom(db, anna), "rooms");
    assert.equal((await mayMessage(db, ben, anna, now, { starting: true })).ok, true);
  } finally {
    await close();
  }
});

test("the Messages setting sits in your own profile, with the three choices in plain words", () => {
  const profile = readFileSync(
    new URL("../../src/components/board/profile-view.tsx", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../../src/components/board/message-setting.tsx", import.meta.url),
    "utf8",
  );
  const words = readFileSync(
    new URL("../../src/lib/e2ee/message-setting.ts", import.meta.url),
    "utf8",
  );
  assert.match(profile, /mine && server\.mode === "live" \? <MessageSetting \/> : null/);
  assert.ok(profile.indexOf("<MessageSetting />") < profile.indexOf("<MfaSettings />"));
  for (const label of ["Anyone in my rooms", "Only people I've messaged before", "No one"]) {
    assert.ok(words.includes(`label: "${label}"`), label);
  }
  assert.match(view, /<legend[^>]*>Messages<\/legend>/);
  assert.match(view, /type="radio"/);
  assert.equal(/like|score|count/i.test(words.replace(/couldn't|can't/g, "")), false);
});
