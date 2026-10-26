import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createPost } from "./store.ts";
import { fileReport, listReports } from "./reports.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.com`, now],
  );
}

async function grant(db: Db, userId: string, name: string, role: "member" | "steward" | "admin", roomId = "") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

test("migration 0029 is the member report queue and does not touch production moderation", () => {
  const sql = readFileSync(new URL("../../migrations/0029_member_reports.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0029/);
  assert.match(sql, /create table if not exists member_report/);
  assert.match(sql, /subject_kind in \('post', 'chat'\)/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(sql.includes("cloudflare"), false);
  assert.equal(/0010_moderation/.test(sql), false);
});

test("a member report reaches that room's stewards and admins, severity first, with no CSAM text", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    const steward = randomUUID();
    const other = randomUUID();
    const admin = randomUUID();
    const stranger = randomUUID();
    await user(db, maria, "Maria");
    await user(db, ruth, "Ruth");
    await user(db, steward, "Helen");
    await user(db, other, "Adam");
    await user(db, admin, "Josh");
    await user(db, stranger, "Ned");
    await grant(db, maria, "Maria", "member");
    await grant(db, ruth, "Ruth", "member");
    await grant(db, steward, "Helen", "member");
    await grant(db, steward, "Helen", "steward", "shop");
    await grant(db, other, "Adam", "member");
    await grant(db, other, "Adam", "steward", "county");
    await grant(db, admin, "Josh", "member");
    await grant(db, admin, "Josh", "admin");

    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim: "Sharpened the chisels in the shop.",
        reason: "Tom checked it.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;

    const refused = await fileReport(db, {
      userId: stranger,
      name: "Ned",
      roomId: "shop",
      subjectKind: "post",
      subjectId: posted.value.id,
      reason: "threat",
      note: "",
      now,
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);

    const own = await fileReport(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      subjectKind: "post",
      subjectId: posted.value.id,
      reason: "porn",
      note: "",
      now,
    });
    assert.equal(own.ok, false);

    const missing = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "post",
      subjectId: posted.value.id,
      reason: "other",
      note: "",
      now,
    });
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.match(missing.error, /reason/);

    const blasphemy = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "post",
      subjectId: posted.value.id,
      reason: "blasphemy",
      note: "This denies the faith.",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(blasphemy.ok, true);

    const again = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "post",
      subjectId: posted.value.id,
      reason: "threat",
      note: "",
      now: new Date(now.getTime() + 2_000),
    });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.status, 409);

    const second = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "did",
        claim: "The secret claim must not ride along with a CSAM report.",
        reason: "Still sharp.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const csam = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "post",
      subjectId: second.value.id,
      reason: "csam",
      note: "Hold this.",
      now: new Date(now.getTime() + 3_000),
    });
    assert.equal(csam.ok, true);
    if (!csam.ok) return;
    assert.equal(csam.value.excerpt, "");

    const third = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "asked",
        claim: "Where is the spare plane?",
        reason: "The bench is short one.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(third.ok, true);
    if (!third.ok) return;
    const threat = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "post",
      subjectId: third.value.id,
      reason: "threat",
      note: "",
      now: new Date(now.getTime() + 4_000),
    });
    assert.equal(threat.ok, true);

    const queue = await listReports(db, { userId: steward, roomId: "shop", now });
    assert.equal(queue.ok, true);
    if (!queue.ok) return;
    assert.deepEqual(
      queue.value.map((row) => row.reason),
      ["csam", "threat", "blasphemy"],
    );
    assert.equal(queue.value[0]?.excerpt, "");
    assert.equal(JSON.stringify(queue.value).includes("secret claim"), false);
    assert.match(queue.value[2]?.note ?? "", /denies the faith/);
    assert.match(queue.value[2]?.excerpt ?? "", /chisels/);

    const county = await listReports(db, { userId: other, roomId: "shop", now });
    assert.equal(county.ok, false);
    if (county.ok) return;
    assert.equal(county.status, 403);

    const site = await listReports(db, { userId: admin, roomId: "shop", now });
    assert.equal(site.ok, true);
    if (!site.ok) return;
    assert.equal(site.value.length, 3);

    await db.query(
      `insert into room_member (room_id, user_id) values ('shop', $1), ('shop', $2)
       on conflict do nothing`,
      [maria, ruth],
    );
    const line = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The mill road is open again.",
      now,
    });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const chat = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "chat",
      subjectId: line.value.id,
      reason: "doxxing",
      note: "",
      now: new Date(now.getTime() + 5_000),
    });
    assert.equal(chat.ok, true);
    if (!chat.ok) return;
    assert.match(chat.value.excerpt, /mill road/);

    const longNote = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "chat",
      subjectId: line.value.id,
      reason: "doxxing",
      note: "x".repeat(501),
      now,
    });
    assert.equal(longNote.ok, false);
  } finally {
    await close();
  }
});
