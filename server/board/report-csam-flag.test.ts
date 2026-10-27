import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { listCsamFlags, mediaIsBlocked, removeFlagged } from "./csam-flag.ts";
import { withHoldKey, openHold, REDACTED_CLAIM } from "./csam.ts";
import { CSAM_FLAG_OPEN, closeReport, fileReport } from "./reports.ts";
import { createPost, removePost } from "./store.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function member(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
}

async function post(db: Db, userId: string, claim: string) {
  const posted = await createPost(db, {
    userId,
    name: "Maria",
    roomId: "shop",
    body: { type: "did", claim, reason: "Tom checked it.", on: "2026-10-18" },
    now,
  });
  assert.equal(posted.ok, true);
  if (!posted.ok) throw new Error("post failed");
  return posted.value.id;
}

test("a CSAM report on a post flags it for the custodian and blocks its media; other reasons do not", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    await member(db, maria, "Maria");
    await member(db, ruth, "Ruth");
    const bad = await post(db, maria, "A post with a file.");
    const rude = await post(db, maria, "A rude post.");
    const file = { id: randomUUID(), post_id: bad };
    assert.equal(await mediaIsBlocked(db, file), false);

    const base = { userId: ruth, name: "Ruth", roomId: "shop", subjectKind: "post", note: "Hold this." };
    const threat = await fileReport(db, { ...base, subjectId: rude, reason: "threat", now });
    assert.equal(threat.ok, true);
    assert.equal((await db.query(`select id from csam_flag`)).length, 0, "only CSAM flags");

    const csam = await fileReport(db, { ...base, subjectId: bad, reason: "csam", now });
    assert.equal(csam.ok, true);
    if (!csam.ok) return;
    const flags = await db.query<{ post_id: string; source: string; reporter_user_id: string; reason: string }>(
      `select post_id, source, reporter_user_id, reason from csam_flag`,
    );
    assert.equal(flags.length, 1);
    assert.equal(flags[0]?.post_id, bad);
    assert.equal(flags[0]?.source, "report");
    assert.equal(flags[0]?.reporter_user_id, ruth);
    assert.equal(flags[0]?.reason, `Member report ${csam.value.id}`);
    assert.equal(flags[0]?.reason.includes("Hold this."), false, "the member's note is not copied");
    assert.equal(await mediaIsBlocked(db, file), true, "the media is hidden at once");
    const logged = await db.query(`select 1 from csam_access_log where action = 'flag'`);
    assert.equal(logged.length, 1);

    const again = await fileReport(db, { ...base, subjectId: bad, reason: "csam", now });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.status, 409);
    assert.equal((await db.query(`select id from csam_flag`)).length, 1, "a duplicate report adds no flag");
  } finally {
    await close();
  }
});

test("a CSAM report on a chat line flags it for the custodian too", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    await member(db, maria, "Maria");
    await member(db, ruth, "Ruth");
    await post(db, maria, "Opens the room.");
    const sent = await sendChat(db, { userId: maria, name: "Maria", roomId: "shop", text: "hello", now });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    const line = sent.value.id;
    const filed = await fileReport(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      subjectKind: "chat",
      subjectId: line,
      reason: "csam",
      note: "",
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    const flags = await db.query<{ chat_message_id: string; post_id: string; reason: string }>(
      `select chat_message_id, post_id, reason from csam_flag`,
    );
    assert.deepEqual(flags, [{ chat_message_id: line, post_id: "", reason: `Member report ${filed.value.id}` }]);
    assert.equal((await db.query(`select 1 from csam_access_log where action = 'flag'`)).length, 1);
  } finally {
    await close();
  }
});

test("a CSAM report cannot be closed in any way while its flag is open", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    const sam = randomUUID();
    await member(db, maria, "Maria");
    await member(db, ruth, "Ruth");
    await member(db, sam, "Sam");
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Sam', 'admin', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
      [randomUUID(), sam, now],
    );
    const bad = await post(db, maria, "A post with a file.");
    const filed = await fileReport(db, {
      userId: ruth, name: "Ruth", roomId: "shop", subjectKind: "post", subjectId: bad, reason: "csam", note: "", now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    const dismissed = await closeReport(db, { userId: sam, reportId: filed.value.id, resolution: "dismissed", note: "", now });
    assert.deepEqual(dismissed, { ok: false, status: 409, error: CSAM_FLAG_OPEN });
    const resolved = await closeReport(db, { userId: sam, reportId: filed.value.id, resolution: "resolved", note: "", now });
    assert.deepEqual(resolved, { ok: false, status: 409, error: CSAM_FLAG_OPEN });
    const removed = await withHoldKey("test-hold-key-value", () =>
      removePost(db, { userId: sam, name: "Sam", postId: bad, reason: "csam", now }),
    );
    assert.equal(removed.ok, true, JSON.stringify(removed));
    const [still] = await db.query<{ status: string }>(`select status from member_report where id = $1`, [filed.value.id]);
    assert.equal(still?.status, "open", "a removal does not auto-close a report whose CSAM flag is open");
    await db.query(`update csam_flag set resolved_at = $1`, [now]);
    const later = await closeReport(db, { userId: sam, reportId: filed.value.id, resolution: "dismissed", note: "", now });
    assert.equal(later.ok, true);
  } finally {
    await close();
  }
});

test("a chat flag shows the line by id, room and time only, and Preserve and remove hides, holds and preserves it", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const ruth = randomUUID();
    const sam = randomUUID();
    await member(db, maria, "Maria");
    await member(db, ruth, "Ruth");
    await member(db, sam, "Sam");
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Sam', 'admin', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $3)`,
      [randomUUID(), sam, now],
    );
    await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [sam]);
    await post(db, maria, "Opens the room.");
    const secret = "chat text nobody should see in the queue";
    const sent = await sendChat(db, { userId: maria, name: "Maria", roomId: "shop", text: secret, now });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    const line = sent.value.id;
    const filed = await fileReport(db, {
      userId: ruth, name: "Ruth", roomId: "shop", subjectKind: "chat", subjectId: line, reason: "csam", note: "", now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;

    const flags = await listCsamFlags(db);
    assert.equal(flags.length, 1);
    assert.equal(flags[0]?.chatMessageId, line);
    assert.equal(flags[0]?.chatRoomId, "shop");
    assert.equal(flags[0]?.chatAt, now.getTime());
    assert.equal(flags[0]?.uploader, "", "a chat flag never names the sender");
    assert.equal(JSON.stringify(flags).includes("Maria"), false);
    assert.equal(JSON.stringify(flags).includes(secret), false, "metadata only, never the text");

    const removed = await withHoldKey("test-hold-key-value", () =>
      removeFlagged(db, { userId: sam, name: "Sam", flagId: flags[0]!.id, now }),
    );
    assert.equal(removed.ok, true, JSON.stringify(removed));
    if (!removed.ok) return;
    assert.ok(removed.value.holdId);
    const [row] = await db.query<{ removed: boolean; body: string }>(
      `select removed, body from room_chat_message where id = $1`,
      [line],
    );
    assert.deepEqual(row, { removed: true, body: REDACTED_CLAIM }, "hidden and redacted");
    const [hold] = await db.query<{ sealed: string; chat_message_id: string; retain_until: Date }>(
      `select sealed, chat_message_id, retain_until from board_csam_hold where id = $1`,
      [removed.value.holdId],
    );
    assert.equal(hold?.chat_message_id, line);
    assert.equal(hold?.sealed.includes(secret), false, "sealed, not stored in the clear");
    const opened = await withHoldKey("test-hold-key-value", async () => openHold(hold!.sealed));
    assert.equal(opened.claim, secret, "the line is preserved for NCMEC");
    assert.ok(new Date(hold!.retain_until).getTime() - now.getTime() >= 365 * 24 * 3600 * 1000);
    const [flag] = await db.query<{ resolved_at: Date | null; resolution: string }>(
      `select resolved_at, resolution from csam_flag where chat_message_id = $1`,
      [line],
    );
    assert.equal(flag?.resolution, "removed");
    const [report] = await db.query<{ status: string }>(`select status from member_report where id = $1`, [filed.value.id]);
    assert.equal(report?.status, "closed", "the custodian's removal closes the report");
    const removal = await db.query(`select 1 from room_chat_removal where message_id = $1 and reason = 'csam'`, [line]);
    assert.equal(removal.length, 1);
  } finally {
    await close();
  }
});
