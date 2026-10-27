import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { mediaIsBlocked } from "./csam-flag.ts";
import { fileReport } from "./reports.ts";
import { createPost } from "./store.ts";

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

test("a CSAM report on a chat line stays a report and does not flag", async () => {
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
    assert.equal((await db.query(`select id from csam_flag`)).length, 0);
  } finally {
    await close();
  }
});
