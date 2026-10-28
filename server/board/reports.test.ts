import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { removeChatMessage, sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { banMember, removePost } from "./store.ts";
import { createPost } from "./test-posting.ts";
import { closeReport, fileReport, listReports } from "./reports.ts";

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

async function postIn(db: Db, userId: string, name: string, claim: string) {
  const posted = await createPost(db, {
    userId,
    name,
    roomId: "shop",
    body: { type: "did", claim, reason: "Tom checked it.", on: "2026-10-18" },
    now,
  });
  assert.equal(posted.ok, true);
  if (!posted.ok) throw new Error("post refused");
  return posted.value.id;
}

async function logRows(db: Db, reportId: string) {
  return db.query<{ action: string; resolution: string; actor_user_id: string; note: string }>(
    `select action, resolution, actor_user_id, note from member_report_log where report_id = $1`,
    [reportId],
  );
}

test("stewards and admins close reports with a log row; removal auto-closes; barred or unroled stewards are kept out", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    const helen = randomUUID();
    const adam = randomUUID();
    const josh = randomUUID();
    const sam = randomUUID();
    const lena = randomUUID();
    await user(db, lena, "Lena");
    await user(db, maria, "Maria");
    await user(db, ruth, "Ruth");
    await user(db, helen, "Helen");
    await user(db, adam, "Adam");
    await user(db, josh, "Josh");
    await user(db, sam, "Sam");
    for (const [id, name] of [
      [maria, "Maria"],
      [ruth, "Ruth"],
      [helen, "Helen"],
      [adam, "Adam"],
      [josh, "Josh"],
      [lena, "Lena"],
    ] as const) {
      await grant(db, id, name, "member");
    }
    await grant(db, helen, "Helen", "steward", "shop");
    await grant(db, adam, "Adam", "steward", "shop");
    await grant(db, sam, "Sam", "steward", "shop");
    await grant(db, josh, "Josh", "admin");

    const first = await postIn(db, maria, "Maria", "Sharpened the chisels.");
    const second = await postIn(db, maria, "Maria", "Oiled the plane.");
    const report = async (subjectKind: "post" | "chat", subjectId: string, at: number) => {
      const filed = await fileReport(db, {
        userId: ruth,
        name: "Ruth",
        roomId: "shop",
        subjectKind,
        subjectId,
        reason: "threat",
        note: "",
        now: new Date(now.getTime() + at),
      });
      assert.equal(filed.ok, true);
      if (!filed.ok) throw new Error("report refused");
      return filed.value.id;
    };
    const r1 = await report("post", first, 1_000);
    const r2 = await report("post", second, 2_000);

    // Reporter names go to admins only.
    const stewardView = await listReports(db, { userId: helen, roomId: "shop", now });
    assert.equal(stewardView.ok, true);
    if (!stewardView.ok) return;
    assert.ok(stewardView.value.every((row) => row.reporterName === ""));
    assert.equal(JSON.stringify(stewardView.value).includes("Ruth"), false);
    const adminView = await listReports(db, { userId: josh, roomId: "shop", now });
    assert.equal(adminView.ok, true);
    if (!adminView.ok) return;
    assert.ok(adminView.value.every((row) => row.reporterName === "Ruth"));

    // A plain member cannot close; a bad resolution is refused.
    const notSteward = await closeReport(db, { userId: ruth, reportId: r1, resolution: "resolved", note: "", now });
    assert.equal(notSteward.ok, false);
    if (!notSteward.ok) assert.equal(notSteward.status, 403);
    const badResolution = await closeReport(db, { userId: helen, reportId: r1, resolution: "removed", note: "", now });
    assert.equal(badResolution.ok, false);

    // A steward closes one, with a log row.
    const closed = await closeReport(db, {
      userId: helen,
      reportId: r1,
      resolution: "dismissed",
      note: "Not a threat.",
      now,
    });
    assert.equal(closed.ok, true);
    assert.deepEqual(
      (await logRows(db, r1)).map((row) => [row.action, row.resolution, row.actor_user_id, row.note]),
      [["close", "dismissed", helen, "Not a threat."]],
    );
    const twice = await closeReport(db, { userId: josh, reportId: r1, resolution: "resolved", note: "", now });
    assert.equal(twice.ok, false);
    if (!twice.ok) assert.equal(twice.status, 409);

    // Removing a post closes its open reports and logs an auto-close.
    const removed = await removePost(db, { userId: josh, name: "Josh", postId: second, reason: "threat", now });
    assert.equal(removed.ok, true);
    const status = await db.query<{ status: string; resolution: string }>(
      `select status, resolution from member_report where id = $1`,
      [r2],
    );
    assert.deepEqual(status[0], { status: "closed", resolution: "removed" });
    assert.deepEqual(
      (await logRows(db, r2)).map((row) => [row.action, row.resolution, row.actor_user_id]),
      [["auto-close", "removed", josh]],
    );

    // Removing a chat line closes its open reports too.
    await db.query(
      `insert into room_member (room_id, user_id) values ('shop', $1), ('shop', $2), ('shop', $3)
       on conflict do nothing`,
      [lena, ruth, helen],
    );
    const line = await sendChat(db, { userId: lena, name: "Lena", roomId: "shop", text: "The mill road is open.", now });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const r3 = await report("chat", line.value.id, 3_000);
    const gone = await removeChatMessage(db, {
      userId: helen,
      name: "Helen",
      roomId: "shop",
      messageId: line.value.id,
      reason: "threat",
      now: new Date(now.getTime() + 4_000),
    });
    assert.equal(gone.ok, true);
    assert.deepEqual((await logRows(db, r3)).map((row) => row.action), ["auto-close"]);

    // A steward with no live member role cannot read the queue or close.
    const third = await postIn(db, helen, "Helen", "Swept the floor.");
    const r4 = await report("post", third, 5_000);
    const unroled = await listReports(db, { userId: sam, roomId: "shop", now });
    assert.equal(unroled.ok, false);
    if (!unroled.ok) assert.equal(unroled.status, 403);
    const unroledClose = await closeReport(db, { userId: sam, reportId: r4, resolution: "resolved", note: "", now });
    assert.equal(unroledClose.ok, false);

    // A barred steward cannot read the queue or close.
    const barred = await banMember(db, {
      userId: josh,
      name: "Josh",
      email: "adam@example.com",
      reason: "threat",
      now,
    });
    assert.equal(barred.ok, true);
    const later = new Date(now.getTime() + 60_000);
    const barredList = await listReports(db, { userId: adam, roomId: "shop", now: later });
    assert.equal(barredList.ok, false);
    if (!barredList.ok) assert.equal(barredList.status, 403);
    const barredClose = await closeReport(db, { userId: adam, reportId: r4, resolution: "resolved", note: "", now: later });
    assert.equal(barredClose.ok, false);
    const admin = await closeReport(db, { userId: josh, reportId: r4, resolution: "resolved", note: "", now: later });
    assert.equal(admin.ok, true);
  } finally {
    await close();
  }
});
