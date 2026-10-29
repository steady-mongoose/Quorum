import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  BLOCKED,
  NOT_REACHABLE,
  blockMember,
  mayMessage,
  memberMessageStates,
  openThread,
  postMessage,
} from "./store.ts";
import {
  SETTING_NOT_READY,
  markWrote,
  missingColumn,
  readMessageFrom,
  saveMessageFrom,
} from "./message-setting.ts";
import { DM_FAILED } from "./routes.ts";
import { dmCallMember } from "../calls/dm-membership.ts";
import { MESSAGES_OFF, NOT_TAKING_MESSAGES } from "../../src/lib/e2ee/message-setting.ts";

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
    const validated = await pg.query<{ convalidated: boolean }>(
      `select convalidated from pg_constraint where conname = 'members_message_from_check'`,
    );
    assert.equal(validated.rows[0]?.convalidated, true, "added NOT VALID, then validated");
    assert.match(sql, /set local lock_timeout/);
    assert.match(sql, /not valid;\s*alter table members validate constraint/);
    const markers = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'dm_thread' and column_name like 'user\\__\\_wrote_at'
       order by column_name`,
    );
    assert.deepEqual(
      markers.rows.map((row) => row.column_name),
      ["user_a_wrote_at", "user_b_wrote_at"],
    );
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

    // Ben and Anna have a conversation that only Ben has written in; Cal has none.
    const thread = await openThread(db, ben, anna, now);
    assert.equal(thread.ok, true);
    if (!thread.ok) return;
    await written(db, thread.value.id, ben);
    assert.deepEqual(await saveMessageFrom(db, anna, "conversations"), {
      ok: true,
      value: "conversations",
    });
    assert.equal(await readMessageFrom(db, anna), "conversations");
    // Only the sender has written: Anna never replied, so Ben is turned away.
    assert.deepEqual(await mayMessage(db, ben, anna, now), refused);
    const benOpen = await openThread(db, ben, anna, now);
    assert.deepEqual(benOpen.ok ? null : [benOpen.status, benOpen.error], [
      403,
      NOT_TAKING_MESSAGES,
    ]);
    // Anna has replied: Ben can keep the conversation going.
    await written(db, thread.value.id, anna);
    assert.equal((await mayMessage(db, ben, anna, now)).ok, true);
    assert.equal((await openThread(db, ben, anna, now)).ok, true);
    assert.deepEqual(await mayMessage(db, cal, anna, now, { starting: true }), refused);
    const calOpen = await openThread(db, cal, anna, now);
    assert.deepEqual(calOpen.ok ? null : [calOpen.status, calOpen.error], [
      403,
      NOT_TAKING_MESSAGES,
    ]);

    // "Only people I've messaged before" does not stop you writing to others.
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
    await db.query(`alter table dm_thread drop column user_a_wrote_at`);
    await db.query(`alter table dm_thread drop column user_b_wrote_at`);
    assert.equal(await readMessageFrom(db, anna), "rooms");
    assert.equal((await mayMessage(db, ben, anna, now, { starting: true })).ok, true);
    // Sending still works: there is just no marker to keep yet.
    const thread = await openThread(db, ben, anna, now);
    assert.equal(thread.ok, true);
    if (thread.ok) await markWroteOrSkip(db, thread.value.id, ben);

    // The route reads the default and says plainly that saving must wait.
    const handler = app(db);
    const read = await send(handler, anna, "/api/dm/settings", "GET");
    assert.deepEqual([read.status, JSON.parse(read.text)], [200, { messageFrom: "rooms" }]);
    const save = await send(handler, anna, "/api/dm/settings", "POST", { messageFrom: "none" });
    assert.equal(save.status, 503);
    assert.deepEqual(JSON.parse(save.text), { error: SETTING_NOT_READY });
    assert.equal(SETTING_NOT_READY, "Can't save this setting yet. Try again later.");
    assert.doesNotMatch(save.text, /column|relation|members/);
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
  for (const label of [
    "People in my rooms or meetings",
    "Only people I've messaged before",
    "No one",
  ]) {
    assert.ok(words.includes(`label: "${label}"`), label);
  }
  assert.match(view, /<legend[^>]*>\{MESSAGE_SETTING_LEGEND\}<\/legend>/);
  assert.match(words, /MESSAGE_SETTING_LEGEND = "Who can message you"/);
  assert.ok(words.includes("This member isn't taking messages right now."));
  assert.match(view, /aria-disabled=/);
  assert.match(view, /aria-describedby=\{hintId\}/);
  assert.match(view, /<p id=\{hintId\}/);
  assert.match(view, /role="alert" className="[^"]*text-danger/);
  assert.match(view, /SETTLE_MS/);
  assert.match(words, /saved: "Saved\. No one can message you\."/);
  const mailbox = readFileSync(
    new URL("../../src/components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    mailbox,
    /messagesOff \? \(\s*<p className="text-sm text-muted">\{MESSAGES_OFF\}<\/p>/,
  );
  assert.match(view, /type="radio"/);
  assert.equal(/like|score|count/i.test(words.replace(/couldn't|can't/g, "")), false);
});

test("No one closes your own writing too, and your conversations stay readable", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const anna = await member(db, "Anna");
    const ben = await member(db, "Ben");
    const cal = await member(db, "Cal");
    assert.equal(
      MESSAGES_OFF,
      "You've turned off messages. To write here, change Who can message you in your profile.",
    );
    const opened = await openThread(db, ben, anna, now);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await saveMessageFrom(db, anna, "none");

    // Anna cannot write to Ben, nor start with Cal: the note names her own choice.
    const off = { ok: false, status: 403, error: MESSAGES_OFF };
    assert.deepEqual(await mayMessage(db, anna, ben, now), off);
    assert.deepEqual(await mayMessage(db, anna, cal, now, { starting: true }), off);
    const fresh = await openThread(db, anna, cal, now);
    assert.deepEqual(fresh.ok ? null : [fresh.status, fresh.error], [403, MESSAGES_OFF]);
    const posted = await postMessage(
      db,
      anna,
      opened.value.id,
      {
        messageId: randomUUID(),
        threadId: opened.value.id,
        senderDeviceId: randomUUID(),
        bodyNonce: "n",
        bodyCiphertext: "c",
        bodySig: "s",
        envelopes: [
          {
            recipientDeviceId: null,
            recipientUserBackup: null,
            nonce: "n",
            ciphertext: "c",
            ephemeralPublic: "e",
            prekeyId: null,
            signedPrekeyId: null,
          },
        ],
      } as never,
      now,
    );
    assert.deepEqual(posted.ok ? null : [posted.status, posted.error], [403, MESSAGES_OFF]);
    const keys = await sendRawGet(handler, anna, `/api/dm/keys?userId=${ben}`);
    assert.equal(keys.status, 403);

    // Ben sees exactly what a block shows him.
    assert.deepEqual(await mayMessage(db, ben, anna, now), {
      ok: false,
      status: 403,
      error: BLOCKED,
    });

    // The conversation stays: Anna can open it and read it.
    const again = await openThread(db, anna, ben, now);
    assert.equal(again.ok && again.value.id, opened.value.id);
    const read = await sendRawGet(handler, anna, `/api/dm/threads/${opened.value.id}/messages`);
    assert.equal(read.status, 200);

    // Nor can Anna start a DM call in it.
    assert.equal((await dmCallMember(db, anna, opened.value.id, now)).kind, "outsider");

    await saveMessageFrom(db, anna, "rooms");
    assert.equal((await mayMessage(db, anna, ben, now)).ok, true);
    assert.equal((await dmCallMember(db, anna, opened.value.id, now)).kind, "member");
  } finally {
    await close();
  }
});

function counting(db: Db): { db: Db; count: () => number; reset: () => void } {
  let n = 0;
  const wrapped: Db = {
    ...db,
    query: (text, params) => {
      n += 1;
      return db.query(text, params);
    },
  } as Db;
  return { db: wrapped, count: () => n, reset: () => (n = 0) };
}

test("a block and a setting refusal do the same work", async () => {
  const { db, close } = await openTestDb();
  try {
    const caller = await member(db, "Caller");
    const blocker = await member(db, "Blocker");
    const quiet = await member(db, "Quiet");
    const known = await member(db, "Known");
    const open = await member(db, "Open");
    await blockMember(db, blocker, caller, now);
    await saveMessageFrom(db, quiet, "none");
    await saveMessageFrom(db, known, "conversations");
    // Two more who chose "conversations": one never replied, one did.
    const unanswered = await member(db, "Unanswered");
    const replied = await member(db, "Replied");
    for (const [owner, ownerWrote] of [
      [unanswered, false],
      [replied, true],
    ] as const) {
      const thread = await openThread(db, caller, owner, now);
      assert.equal(thread.ok, true);
      if (!thread.ok) return;
      await written(db, thread.value.id, caller);
      if (ownerWrote) await written(db, thread.value.id, owner);
      await saveMessageFrom(db, owner, "conversations");
    }
    const probe = counting(db);
    const costs: Record<string, number[]> = {};
    for (const [name, id] of [
      ["blocked", blocker],
      ["none", quiet],
      ["conversations", known],
      ["unanswered", unanswered],
      ["open", open],
      ["replied", replied],
    ] as const) {
      for (const starting of [false, true]) {
        probe.reset();
        const gate = await mayMessage(probe.db, caller, id, now, { starting });
        assert.equal(gate.ok, name === "open" || name === "replied", name);
        (costs[name] ??= []).push(probe.count());
      }
    }
    assert.deepEqual(costs.none, costs.blocked);
    assert.deepEqual(costs.conversations, costs.blocked);
    assert.deepEqual(costs.unanswered, costs.blocked);
    assert.deepEqual(costs.replied, costs.blocked);
    // An allowed message reads the same things before deciding.
    assert.deepEqual(costs.open, costs.blocked);
  } finally {
    await close();
  }
});

test("someone who shares no room or meeting gets the usual note, whatever the block or setting", async () => {
  const { db, close } = await openTestDb();
  try {
    const stranger = await member(db, "Stranger");
    await db.query(`delete from room_join where user_id = $1`, [stranger]);
    await db.query(`delete from access_log where user_id = $1 and room_id = 'shop'`, [stranger]);
    const blocker = await member(db, "Blocker");
    const quiet = await member(db, "Quiet");
    const plain = await member(db, "Plain");
    await blockMember(db, blocker, stranger, now);
    await saveMessageFrom(db, quiet, "none");
    const usual = { ok: false, status: 403, error: NOT_REACHABLE };
    for (const id of [blocker, quiet, plain]) {
      assert.deepEqual(await mayMessage(db, stranger, id, now, { starting: true }), usual);
    }
  } finally {
    await close();
  }
});

async function sendRawGet(
  handler: (request: Request) => Promise<Response>,
  userId: string,
  path: string,
) {
  return send(handler, userId, path, "GET");
}

/** A message row in a conversation, written by `senderId`. */
async function written(db: Db, threadId: string, senderId: string) {
  await db.query(
    `insert into dm_message (
       id, thread_id, sender_user_id, body_nonce, body_ciphertext, body_sig, created_at, expires_at
     ) values ($1, $2, $3, 'n', 'c', 's', $4, $5)`,
    [randomUUID(), threadId, senderId, now, new Date(now.getTime() + 30 * 86_400_000)],
  );
  // postMessage keeps the lasting marker the same way.
  await markWrote(db, threadId, senderId, now);
}

/** markWrote, tolerating a database without migration 0046. */
async function markWroteOrSkip(db: Db, threadId: string, senderId: string) {
  try {
    await markWrote(db, threadId, senderId, now);
  } catch (error) {
    if (!missingColumn(error)) throw error;
  }
}

test("messaged before lasts after the messages expire, and the migration backfills it", async () => {
  const { db, pg, close } = await openTestDb();
  try {
    const anna = await member(db, "Anna");
    const ben = await member(db, "Ben");
    const cal = await member(db, "Cal");
    const withBen = await openThread(db, ben, anna, now);
    const withCal = await openThread(db, cal, anna, now);
    assert.ok(withBen.ok && withCal.ok);
    if (!withBen.ok || !withCal.ok) return;
    await written(db, withBen.value.id, ben);
    await written(db, withBen.value.id, anna);
    await written(db, withCal.value.id, cal);
    await saveMessageFrom(db, anna, "conversations");
    assert.equal((await mayMessage(db, ben, anna, now)).ok, true);

    // Every message expires and is swept: Anna wrote to Ben, and that still counts.
    await db.query(`delete from dm_message`);
    assert.equal((await mayMessage(db, ben, anna, now)).ok, true);
    assert.deepEqual(await mayMessage(db, cal, anna, now), {
      ok: false,
      status: 403,
      error: NOT_TAKING_MESSAGES,
    });

    // Backfill: messages that exist when 0046 runs set the markers.
    await db.query(`update dm_thread set user_a_wrote_at = null, user_b_wrote_at = null`);
    for (const [thread, sender] of [
      [withBen.value.id, ben],
      [withBen.value.id, anna],
      [withCal.value.id, cal],
    ] as const) {
      await db.query(
        `insert into dm_message (
           id, thread_id, sender_user_id, body_nonce, body_ciphertext, body_sig, created_at, expires_at
         ) values ($1, $2, $3, 'n', 'c', 's', $4, $5)`,
        [randomUUID(), thread, sender, daysAgo(2), new Date(now.getTime() + DAY)],
      );
    }
    const sql = readFileSync(MIGRATION, "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    assert.equal((await mayMessage(db, ben, anna, now)).ok, true);
    assert.equal((await mayMessage(db, cal, anna, now)).ok, false);
    const marks = await db.query<{ id: string; a: Date | null; b: Date | null }>(
      `select id, user_a_wrote_at as a, user_b_wrote_at as b from dm_thread where id = $1`,
      [withCal.value.id],
    );
    const calIsA = cal < anna;
    assert.equal((calIsA ? marks[0]?.a : marks[0]?.b) !== null, true, "Cal wrote");
    assert.equal(calIsA ? marks[0]?.b : marks[0]?.a, null, "Anna never wrote to Cal");
  } finally {
    await close();
  }
});

test("a DM route never shows a raw database error", async () => {
  const { db, close } = await openTestDb();
  try {
    const anna = await member(db, "Anna");
    const broken: Db = {
      ...db,
      query: (text, params) =>
        /from members/.test(text)
          ? Promise.reject(new Error('relation "members" secret detail'))
          : db.query(text, params),
    } as Db;
    const original = console.error;
    console.error = () => {};
    try {
      const response = await send(app(broken), anna, "/api/dm/settings", "GET");
      assert.equal(response.status, 500);
      assert.deepEqual(JSON.parse(response.text), { error: DM_FAILED });
      assert.doesNotMatch(response.text, /relation|secret/);
    } finally {
      console.error = original;
    }
  } finally {
    await close();
  }
});

test("key previews are rate-limited the same way for a block and the setting", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const blocker = await member(db, "Blocker");
    const quiet = await member(db, "Quiet");
    const toBlocker = await member(db, "CallerOne");
    const toQuiet = await member(db, "CallerTwo");
    await blockMember(db, blocker, toBlocker, now);
    await saveMessageFrom(db, quiet, "none");
    for (const [caller, target] of [
      [toBlocker, blocker],
      [toQuiet, quiet],
    ]) {
      const seen: number[] = [];
      for (let i = 0; i < 61; i += 1) {
        seen.push((await send(handler, caller, `/api/dm/keys?userId=${target}`, "GET")).status);
      }
      assert.ok(seen.slice(0, 60).every((status) => status === 403));
      assert.equal(seen[60], 429);
    }
  } finally {
    await close();
  }
});
