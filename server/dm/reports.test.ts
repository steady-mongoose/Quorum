import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Db } from "../db.ts";
import { createApp } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { closeDmReport, fileDmReport, listDmReports } from "./reports.ts";
import { sweepExpired } from "./store.ts";

const now = new Date("2026-10-20T12:00:00Z");

async function user(db: Db, id: string, name: string, role: "member" | "admin" | null = "member") {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
  const roles = role === "admin" ? ["member", "admin"] : role ? [role] : [];
  for (const item of roles) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, item, now],
    );
  }
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  const ann = randomUUID();
  const ben = randomUUID();
  const cal = randomUUID();
  const josh = randomUUID();
  await user(db, ann, "Ann");
  await user(db, ben, "Ben");
  await user(db, cal, "Cal");
  await user(db, josh, "Josh", "admin");
  const [a, b] = ann < ben ? [ann, ben] : [ben, ann];
  const thread = randomUUID();
  await db.query(
    `insert into dm_thread (id, user_a, user_b, user_a_name, user_b_name) values ($1, $2, $3, $4, $5)`,
    [thread, a, b, a === ann ? "Ann" : "Ben", a === ann ? "Ben" : "Ann"],
  );
  const message = async (sender: string, at: Date, expires: Date) => {
    const id = randomUUID();
    await db.query(
      `insert into dm_message (id, thread_id, sender_user_id, body_nonce, body_ciphertext, body_sig, created_at, expires_at)
       values ($1, $2, $3, 'n', 'c', 's', $4, $5)`,
      [id, thread, sender, at, expires],
    );
    return id;
  };
  return { ...opened, ann, ben, cal, josh, thread, message };
}

test("migration 0032 adds dm_report and changes nothing on production", () => {
  const sql = readFileSync(new URL("../../migrations/0032_dm_report.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0032/);
  assert.match(sql, /create table if not exists dm_report/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/alter table/i.test(sql), false);
});

test("only the recipient reports a message, CSAM keeps no text, and admins alone read the queue", async () => {
  const { db, close, ann, ben, cal, josh, message } = await setup();
  try {
    const fromBen = await message(ben, now, new Date(now.getTime() + 86400000));
    const fromAnn = await message(ann, now, new Date(now.getTime() + 86400000));
    const base = { note: "", sharedText: "", now };

    const own = await fileDmReport(db, { ...base, userId: ann, messageId: fromAnn, reason: "threat" });
    assert.equal(own.ok, false);
    if (!own.ok) assert.equal(own.status, 400);
    const outsider = await fileDmReport(db, { ...base, userId: cal, messageId: fromBen, reason: "threat" });
    assert.equal(outsider.ok, false);
    if (!outsider.ok) assert.equal(outsider.status, 404, "an outsider learns nothing about the message");
    const noReason = await fileDmReport(db, { ...base, userId: ann, messageId: fromBen, reason: "spam" });
    assert.equal(noReason.ok, false);

    const threat = await fileDmReport(db, {
      ...base,
      userId: ann,
      messageId: fromBen,
      reason: "threat",
      note: "He means it.",
      sharedText: "I know where you live.",
    });
    assert.equal(threat.ok, true);
    const again = await fileDmReport(db, { ...base, userId: ann, messageId: fromBen, reason: "threat" });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 409);

    const fromBen2 = await message(ben, new Date(now.getTime() + 1000), new Date(now.getTime() + 86400000));
    const csam = await fileDmReport(db, {
      ...base,
      userId: ann,
      messageId: fromBen2,
      reason: "csam",
      sharedText: "must not be stored",
    });
    assert.equal(csam.ok, true);
    const stored = await db.query<{ shared_text: string }>(`select shared_text from dm_report where reason = 'csam'`);
    assert.equal(stored[0]?.shared_text, "");

    const member = await listDmReports(db, { userId: ann });
    assert.equal(member.ok, false);
    const queue = await listDmReports(db, { userId: josh });
    assert.equal(queue.ok, true);
    if (!queue.ok) return;
    assert.deepEqual(
      queue.value.map((row) => row.reason),
      ["csam", "threat"],
      "CSAM comes first",
    );
    const threatRow = queue.value[1]!;
    assert.equal(threatRow.sharedText, "I know where you live.");
    assert.equal(threatRow.reporterName, "Ann");
    assert.equal(threatRow.reportedName, "Ben");
    assert.equal(threatRow.messageKept, true);
    for (const row of queue.value) {
      for (const key of Object.keys(row)) assert.equal(/count|score|like/i.test(key), false);
    }

    const notAdmin = await closeDmReport(db, { userId: ann, reportId: threatRow.id, resolution: "resolved", now });
    assert.equal(notAdmin.ok, false);
    const bad = await closeDmReport(db, { userId: josh, reportId: threatRow.id, resolution: "maybe", now });
    assert.equal(bad.ok, false);
    const closed = await closeDmReport(db, { userId: josh, reportId: threatRow.id, resolution: "resolved", now });
    assert.equal(closed.ok, true);
    const after = await listDmReports(db, { userId: josh });
    assert.equal(after.ok && after.value.length, 1);
  } finally {
    await close();
  }
});

test("a reported message survives the 30-day sweep until the report closes", async () => {
  const { db, close, ann, ben, josh, message } = await setup();
  try {
    const old = new Date(now.getTime() - 31 * 86400000);
    const expired = new Date(now.getTime() - 86400000);
    const reported = await message(ben, old, expired);
    const plain = await message(ben, old, expired);
    const filed = await fileDmReport(db, {
      userId: ann,
      messageId: reported,
      reason: "doxxing",
      note: "",
      sharedText: "",
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    await sweepExpired(db, now);
    const left = await db.query<{ id: string }>(`select id from dm_message`);
    assert.deepEqual(left.map((row) => row.id), [reported]);
    assert.equal(left.some((row) => row.id === plain), false);

    await closeDmReport(db, { userId: josh, reportId: filed.value.id, resolution: "dismissed", now });
    await sweepExpired(db, now);
    assert.equal((await db.query(`select id from dm_message`)).length, 0);
    const queue = await db.query<{ message_id: string | null; status: string }>(
      `select message_id, status from dm_report`,
    );
    assert.equal(queue[0]?.message_id, null, "the closed report stays, without the message");
  } finally {
    await close();
  }
});

test("the sweep still runs on a database without migration 0032", async () => {
  const { db, close, ben, message } = await setup();
  try {
    await db.query(`drop table dm_report`);
    await message(ben, new Date(now.getTime() - 31 * 86400000), new Date(now.getTime() - 1000));
    assert.equal(await sweepExpired(db, now), 1);
  } finally {
    await close();
  }
});

test("the routes file, list, and close DM reports", async () => {
  const { db, close, ann, ben, josh, message } = await setup();
  try {
    const id = await message(ben, now, new Date(now.getTime() + 86400000));
    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: async () => ({ id: "" }),
      signIn: async () => ({ ok: false, status: 500, error: "no" }) as never,
      readSession: async (headers) => {
        const userId = headers.get("x-user-id");
        return userId ? { id: userId, name: "", email: "" } : null;
      },
      forwardAuth: async () => new Response("no", { status: 500 }),
    });
    const call = (userId: string, path: string, method: string, body?: unknown) =>
      handler(
        new Request(`http://127.0.0.1:8787${path}`, {
          method,
          headers: { "content-type": "application/json", "x-user-id": userId, origin: "http://localhost:8080" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    const filed = await call(ann, `/api/dm/messages/${id}/report`, "POST", { reason: "porn", sharedText: "x" });
    assert.equal(filed.status, 201);
    const { id: reportId } = (await filed.json()) as { id: string };
    assert.equal((await call(ann, "/api/dm/reports", "GET")).status, 403);
    const listed = await call(josh, "/api/dm/reports", "GET");
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as { reports: unknown[] }).reports.length, 1);
    const closed = await call(josh, `/api/dm/reports/${reportId}/close`, "POST", { resolution: "resolved" });
    assert.equal(closed.status, 200);
  } finally {
    await close();
  }
});
