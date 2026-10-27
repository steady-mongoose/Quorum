import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createMemoryStore } from "../media/memory-store.ts";
import { MAX_CUSTODIANS, isCustodian, releaseHold, setCustodian, setLegalHold } from "./csam-custody.ts";
import { fileCsamReport, purgeExpiredHolds } from "./csam.ts";
import { listBoard } from "./store.ts";

process.env.CSAM_HOLD_KEY = "test-hold-key-value";
const now = new Date("2026-10-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.test`, now],
  );
}

async function grant(db: Db, userId: string, role: "member" | "admin") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, 'n', $3, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), userId, role, now],
  );
}

async function hold(db: Db, author: string, id = randomUUID()) {
  await db.query(
    `insert into board_csam_hold (id, post_id, post_ids, room_id, author_user_id, author_name,
       sealed, media_count, byte_size, created_at, retain_until)
     values ($1, $2, array[$2], 'shop', $3, 'Maria', 'x', 0, 0, $4, $5)`,
    [id, randomUUID(), author, now, new Date(now.getTime() + 365 * DAY)],
  );
  return id;
}

async function log(db: Db) {
  return db.query<{ action: string; actor_user_id: string | null; hold_id: string }>(
    `select action, actor_user_id, hold_id from csam_access_log order by created_at, action`,
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  const ids = { owner: "owner", ann: "ann", bo: "bo", cy: "cy", di: "di", maria: "maria" };
  for (const id of Object.values(ids)) await user(db, id, id);
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', 'owner')`);
  for (const id of [ids.ann, ids.bo, ids.cy, ids.di]) await grant(db, id, "admin");
  await grant(db, ids.maria, "member");
  return { ...opened, ids };
}

test("only the owner and named admins are custodians, capped at three", async () => {
  const { db, close, ids } = await setup();
  try {
    assert.equal(await isCustodian(db, ids.owner), true);
    assert.equal(await isCustodian(db, ids.ann), false);
    assert.equal(await isCustodian(db, ids.maria), false);

    const byAdmin = await setCustodian(db, { userId: ids.ann, targetUserId: ids.ann, grant: true, now });
    assert.equal(byAdmin.ok, false);
    const member = await setCustodian(db, { userId: ids.owner, targetUserId: ids.maria, grant: true, now });
    assert.equal(member.ok, false);

    for (const id of [ids.ann, ids.bo, ids.cy]) {
      const r = await setCustodian(db, { userId: ids.owner, targetUserId: id, grant: true, now });
      assert.equal(r.ok, true);
    }
    const fourth = await setCustodian(db, { userId: ids.owner, targetUserId: ids.di, grant: true, now });
    assert.equal(fourth.ok, false);
    if (!fourth.ok) assert.equal(fourth.status, 409);
    assert.equal(MAX_CUSTODIANS, 3);
    assert.equal(await isCustodian(db, ids.ann), true);

    const revoked = await setCustodian(db, { userId: ids.owner, targetUserId: ids.ann, grant: false, now });
    assert.equal(revoked.ok, true);
    assert.equal(await isCustodian(db, ids.ann), false);

    const actions = (await log(db)).map((row) => row.action);
    assert.ok(actions.includes("denied"));
    assert.equal(actions.filter((a) => a === "grant_custodian").length, 3);
    assert.ok(actions.includes("revoke_custodian"));
  } finally {
    await close();
  }
});

test("a non-custodian admin cannot see the queue or file a report, and the refusal is logged", async () => {
  const { db, close, ids } = await setup();
  try {
    const holdId = await hold(db, ids.maria);
    const admin = await listBoard(db, ids.di, now);
    assert.equal(admin.ok, true);
    if (admin.ok) assert.equal(admin.value.csamReports.length, 0);
    const refused = await fileCsamReport(db, { userId: ids.di, name: "Di", holdId, reportId: "77", now });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 403);
    const rows = await log(db);
    assert.deepEqual(
      rows.map((r) => [r.action, r.actor_user_id, r.hold_id]),
      [["denied", ids.di, holdId]],
    );
  } finally {
    await close();
  }
});

test("a custodian's queue read and CyberTipline filing are logged with number, date and filer", async () => {
  const { db, close, ids } = await setup();
  try {
    await setCustodian(db, { userId: ids.owner, targetUserId: ids.ann, grant: true, now });
    const holdId = await hold(db, ids.maria);
    const board = await listBoard(db, ids.ann, now);
    assert.equal(board.ok, true);
    if (board.ok) assert.equal(board.value.csamReports.length, 1);
    const filed = await fileCsamReport(db, { userId: ids.ann, name: "Ann", holdId, reportId: "123456", now });
    assert.equal(filed.ok, true);
    const row = await db.query<{ report_id: string; filed_at: Date; filed_by_user_id: string }>(
      `select report_id, filed_at, filed_by_user_id from board_csam_hold where id = $1`,
      [holdId],
    );
    assert.equal(row[0]?.report_id, "123456");
    assert.equal(new Date(row[0]?.filed_at ?? 0).getTime(), now.getTime());
    assert.equal(row[0]?.filed_by_user_id, ids.ann);
    const actions = (await log(db)).map((r) => r.action);
    assert.ok(actions.includes("list"));
    assert.ok(actions.includes("file_report"));
  } finally {
    await close();
  }
});

test("a legal hold stops the purge; only a recorded lawyer sign-off on a filed hold releases it", async () => {
  const { db, close, ids } = await setup();
  try {
    const store = createMemoryStore();
    const holdId = await hold(db, ids.maria);
    const byAdmin = await setLegalHold(db, { userId: ids.di, holdId, on: true, note: "Subpoena 2026-11", now });
    assert.equal(byAdmin.ok, false);
    const noNote = await setLegalHold(db, { userId: ids.owner, holdId, on: true, note: "", now });
    assert.equal(noNote.ok, false);
    const set = await setLegalHold(db, { userId: ids.owner, holdId, on: true, note: "Subpoena 2026-11", now });
    assert.equal(set.ok, true);

    const due = new Date(now.getTime() + 366 * DAY);
    assert.equal(await purgeExpiredHolds(db, due, store), 0);
    const kept = await db.query<{ purged_at: Date | null }>(
      `select purged_at from board_csam_hold where id = $1`,
      [holdId],
    );
    assert.equal(kept[0]?.purged_at, null);

    const offSwitch = await setLegalHold(db, { userId: ids.owner, holdId, on: false, note: "", now: due });
    assert.equal(offSwitch.ok, false, "no custodian turns a legal hold off on their own judgement");
    assert.equal(await purgeExpiredHolds(db, due, store), 0);

    const unfiled = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "Dana Reyes", lawyerReference: "DR-114", now: due });
    assert.equal(unfiled.ok, false, "a hold not reported to NCMEC cannot be released");
    await db.query(`update board_csam_hold set filed_at = $2, report_id = '42' where id = $1`, [holdId, now]);
    const byNonCustodian = await releaseHold(db, { userId: ids.di, holdId, lawyerName: "Dana Reyes", lawyerReference: "DR-114", now: due });
    assert.equal(byNonCustodian.ok, false);
    const noLawyer = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "", lawyerReference: "DR-114", now: due });
    assert.equal(noLawyer.ok, false);
    const noRef = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "Dana Reyes", lawyerReference: " ", now: due });
    assert.equal(noRef.ok, false);
    const released = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "Dana Reyes", lawyerReference: "DR-114", now: due });
    assert.equal(released.ok, true, JSON.stringify(released));
    const [row] = await db.query<{ release_lawyer_name: string; release_lawyer_reference: string; legal_hold: boolean }>(
      `select release_lawyer_name, release_lawyer_reference, legal_hold from board_csam_hold where id = $1`,
      [holdId],
    );
    assert.deepEqual(row, { release_lawyer_name: "Dana Reyes", release_lawyer_reference: "DR-114", legal_hold: false });
    assert.equal(await purgeExpiredHolds(db, due, store), 1);
    const entries = await log(db);
    const actions = entries.map((r) => r.action);
    for (const a of ["denied", "legal_hold_on", "hold_released", "purge"]) assert.ok(actions.includes(a), a);
  } finally {
    await close();
  }
});

test("a hold set again after a release is released again only through a new lawyer sign-off", async () => {
  const { db, close, ids } = await setup();
  try {
    const store = createMemoryStore();
    const holdId = await hold(db, ids.maria);
    await db.query(`update board_csam_hold set filed_at = $2, report_id = '42' where id = $1`, [holdId, now]);
    assert.equal((await setLegalHold(db, { userId: ids.owner, holdId, on: true, note: "Subpoena 2026-11", now })).ok, true);
    const first = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "Dana Reyes", lawyerReference: "DR-114", now });
    assert.equal(first.ok, true, JSON.stringify(first));
    const again = await setLegalHold(db, { userId: ids.owner, holdId, on: true, note: "Second subpoena 2026-12", now });
    assert.equal(again.ok, true, JSON.stringify(again));
    const due = new Date(now.getTime() + 366 * DAY);
    assert.equal(await purgeExpiredHolds(db, due, store), 0, "held again: not purged");
    const noLawyer = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "", lawyerReference: "LK-9", now: due });
    assert.equal(noLawyer.ok, false, "the same sign-off path applies");
    const second = await releaseHold(db, { userId: ids.owner, holdId, lawyerName: "Lee Kim", lawyerReference: "LK-9", now: due });
    assert.equal(second.ok, true, JSON.stringify(second));
    const [row] = await db.query<{ release_lawyer_name: string; legal_hold: boolean }>(
      `select release_lawyer_name, legal_hold from board_csam_hold where id = $1`,
      [holdId],
    );
    assert.deepEqual(row, { release_lawyer_name: "Lee Kim", legal_hold: false });
    const releases = (await log(db)).filter((r) => r.action === "hold_released");
    assert.equal(releases.length, 2, "both releases are logged");
    assert.equal(await purgeExpiredHolds(db, due, store), 1);
  } finally {
    await close();
  }
});

test("0034 upgrades a database that ran the earlier draft without 'hold_released', and reruns cleanly", async () => {
  const { db, pg, close } = await openTestDb();
  try {
    // Recreate the earlier draft's check, which lacked 'hold_released'.
    await pg.exec(`alter table csam_access_log drop constraint csam_access_log_action_check;
      alter table csam_access_log add constraint csam_access_log_action_check check (
        action in ('list', 'file_report', 'legal_hold_on', 'legal_hold_off', 'purge',
                   'grant_custodian', 'revoke_custodian', 'denied', 'flag', 'remove_flagged'))`);
    const insert = () =>
      db.query(`insert into csam_access_log (id, hold_id, action) values ($1, 'h', 'hold_released')`, [randomUUID()]);
    await assert.rejects(insert);
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(new URL("../../migrations/0034_csam_custody.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    await insert();
    await assert.rejects(() =>
      db.query(`insert into csam_access_log (id, hold_id, action) values ($1, 'h', 'bogus')`, [randomUUID()]),
    );
  } finally {
    await close();
  }
});
