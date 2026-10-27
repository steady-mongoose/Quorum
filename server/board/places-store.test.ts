import assert from "node:assert/strict";
import { firstSteward } from "./test-stewards.ts";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { REVIEW_CHECKLIST } from "../../src/lib/board/council.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { createPost, listBoard } from "./store.ts";
import {
  correctZip,
  decideRoom,
  grantAccess,
  joinRoom,
  listHome,
  requestRoom,
  savePlace,
  setCouncil,
} from "./places-store.ts";

const now = new Date("2026-10-20T12:00:00Z");

function later(seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

async function user(db: Db, id: string, name: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
}

async function member(db: Db, id: string, name: string, at: Date) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', 'shop', 'grant', 'test', '', 'test', 'Member, one inviter.', $4)`,
    [randomUUID(), id, name, at],
  );
}

function keys(value: unknown, found: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) keys(item, found);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    found.push(key);
    keys(child, found);
  }
}

test("migration 0011 is present and the new tables have no score", async () => {
  const sql = readFileSync(new URL("../../migrations/0011_places.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0011/);
  const { db, close } = await openTestDb();
  try {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('town', 'congregation', 'zip_town', 'room_request', 'council_approval', 'room_join')`,
    );
    assert.equal(tables.length, 6);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name in ('town', 'zip_town', 'room_request', 'council_approval', 'board_post', 'room')
         and column_name in ('score', 'like_count', 'likes', 'rank')`,
    );
    assert.equal(columns.length, 0);
    const subject = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'board_post' and column_name = 'subject'`,
    );
    assert.equal(subject.length, 1);
    const checklist = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'council_approval' and column_name = 'checklist'`,
    );
    assert.equal(checklist.length, 1);
  } finally {
    await close();
  }
});

test("steward and admin grants are tiered and logged in access_log", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const maria = randomUUID();
    const tom = randomUUID();
    const ruth = randomUUID();
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await user(db, ruth, "Ruth", "ruth@example.com");
    await member(db, josh, "Josh", later(1));
    await member(db, maria, "Maria", later(2));
    await member(db, tom, "Tom", later(3));
    await member(db, ruth, "Ruth", later(4));
    await db.query(
      `insert into member_role (user_id, is_admin, is_council, is_council_chair)
       values ($1, true, true, true)`,
      [josh],
    );

    const bare = await grantAccess(db, {
      userId: josh,
      action: "grant",
      email: "maria@example.com",
      roomId: "shop",
      inviterEmail: "",
      stewardEmail: "",
      role: "",
      now: later(5),
    });
    assert.equal(bare.ok, false);

    const first = await grantAccess(db, {
      userId: josh,
      action: "grant-steward",
      email: "tom@example.com",
      roomId: "shop",
      inviterEmail: "maria@example.com",
      stewardEmail: "",
      role: "",
      now: later(6),
    });
    assert.equal(first.ok, true);
    const chairAgain = await grantAccess(db, {
      userId: josh,
      action: "grant-steward",
      email: "ruth@example.com",
      roomId: "shop",
      inviterEmail: "maria@example.com",
      stewardEmail: "",
      role: "",
      now: later(7),
    });
    assert.equal(chairAgain.ok, false);
    const second = await grantAccess(db, {
      userId: tom,
      action: "grant-steward",
      email: "ruth@example.com",
      roomId: "shop",
      inviterEmail: "josh@example.com",
      stewardEmail: "",
      role: "",
      now: later(8),
    });
    assert.equal(second.ok, true);

    const county = await grantAccess(db, {
      userId: josh,
      action: "grant-steward",
      email: "maria@example.com",
      roomId: "county",
      inviterEmail: "tom@example.com",
      stewardEmail: "",
      role: "",
      now: later(9),
    });
    assert.equal(county.ok, true);

    const notOwner = await grantAccess(db, {
      userId: tom,
      action: "grant-admin",
      email: "ruth@example.com",
      roomId: "",
      inviterEmail: "",
      stewardEmail: "maria@example.com",
      role: "",
      now: later(10),
    });
    assert.equal(notOwner.ok, false);
    const admin = await grantAccess(db, {
      userId: josh,
      action: "grant-admin",
      email: "tom@example.com",
      roomId: "",
      inviterEmail: "",
      stewardEmail: "maria@example.com",
      role: "",
      now: later(11),
    });
    assert.equal(admin.ok, true);

    const log = await db.query<{
      role: string;
      room_id: string;
      action: string;
      vouched_by: string;
      approved_by: string;
      note: string;
    }>(
      `select role, room_id, action, vouched_by, approved_by, note
       from access_log where role in ('steward', 'admin') order by at asc`,
    );
    assert.equal(log[0]?.vouched_by, "Maria");
    assert.equal(log[0]?.approved_by, "Josh");
    assert.equal(log[0]?.room_id, "shop");
    assert.match(log[0]?.note ?? "", /council chair/);
    assert.equal(log.some((row) => row.role === "admin" && row.vouched_by === "Maria" && row.approved_by === "Josh"), true);

    const dropped = await grantAccess(db, {
      userId: josh,
      action: "revoke",
      email: "tom@example.com",
      roomId: "shop",
      inviterEmail: "",
      stewardEmail: "",
      role: "steward",
      now: later(12),
    });
    assert.equal(dropped.ok, true);
    const board = await listBoard(db, tom, later(13));
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(board.value.me.steward, true);
    assert.equal(board.value.me.admin, true);
    const mariaBoard = await listBoard(db, maria, later(13));
    assert.equal(mariaBoard.ok, true);
    if (!mariaBoard.ok) return;
    assert.equal(mariaBoard.value.me.steward, true);

    await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [josh]);
    const founder = await grantAccess(db, {
      userId: tom,
      action: "revoke",
      email: "josh@example.com",
      roomId: "",
      inviterEmail: "",
      stewardEmail: "",
      role: "admin",
      now: later(14),
    });
    assert.equal(founder.ok, false);
    if (founder.ok) return;
    assert.match(founder.error, /founding/);
  } finally {
    await close();
  }
});

test("admins approve room requests, and home is nearest first", async () => {
  const { db, close } = await openTestDb();
  try {
    const before = await db.query<{ id: string }>(`select id from room`);
    const josh = randomUUID();
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await member(db, josh, "Josh", later(1));
    await member(db, maria, "Maria", later(2));
    await member(db, tom, "Tom", later(3));
    await db.query(
      `insert into member_role (user_id, is_admin, is_council, is_council_chair)
       values ($1, true, true, true)`,
      [josh],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Tom', 'steward', 'shop', 'grant', 'Maria', 'Josh', 'Josh', 'Steward, inviter plus a steward of that room.', $3)`,
      [randomUUID(), tom, later(4)],
    );

    const place = await savePlace(db, {
      userId: maria,
      zip: "33578-0000",
      congregationId: "grace",
      now: later(5),
    });
    assert.equal(place.ok, true);
    const afterPlace = await db.query<{ id: string }>(`select id from room`);
    assert.equal(afterPlace.length, before.length);

    const russian = await requestRoom(db, {
      userId: maria,
      kind: "town",
      name: "Город",
      state: "FL",
      now: later(6),
    });
    assert.equal(russian.ok, false);
    const riverview = await requestRoom(db, {
      userId: maria,
      kind: "town",
      name: "Riverview",
      state: "FL",
      now: later(6),
    });
    assert.equal(riverview.ok, false);
    const asked = await requestRoom(db, {
      userId: maria,
      kind: "town",
      name: "Seffner",
      state: "FL",
      now: later(6),
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;

    const steward = await decideRoom(db, {
      userId: tom,
      requestId: asked.value.id,
      decision: "approved",
      note: "Seffner has people asking.",
      now: later(7),
    });
    assert.equal(steward.ok, false);
    const own = await decideRoom(db, {
      userId: maria,
      requestId: asked.value.id,
      decision: "approved",
      note: "Seffner has people asking.",
      now: later(7),
    });
    assert.equal(own.ok, false);
    const approved = await decideRoom(db, {
      ...(await firstSteward(db, josh, new Date("2026-10-01T00:00:00Z"))),
      userId: josh,
      requestId: asked.value.id,
      decision: "approved",
      note: "Seffner has people asking.",
      now: later(8),
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.value.roomId, "town-seffner-fl");
    const kept = await db.query<{ status: string; note: string }>(
      `select status, note from room_request where id = $1`,
      [asked.value.id],
    );
    assert.equal(kept[0]?.status, "approved");
    assert.equal(kept[0]?.note, "Seffner has people asking.");

    await joinRoom(db, { userId: maria, roomId: "rv-shop", now: later(9) });
    const older = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: {
        type: "did",
        claim: "I filed the notice for Jane Doe for county commission.",
        reason: "The notice is on the county site.",
        on: "2026-10-18",
        subject: "candidate",
        likeCount: 12,
        score: 40,
      },
      now: later(10),
    });
    assert.equal(older.ok, true);
    if (!older.ok) return;
    const newer = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "county",
      body: {
        type: "did",
        claim: "I called the county clerk about the hearing.",
        reason: "The clerk wrote the date down.",
        on: "2026-10-19",
      },
      now: later(11),
    });
    assert.equal(newer.ok, true);

    const refused = await setCouncil(db, {
      userId: tom,
      postId: older.value.id,
      action: "approve",
      reason: "The post names the office.",
      checklist: [...REVIEW_CHECKLIST.candidate],
      now: later(12),
    });
    assert.equal(refused.ok, false);
    const blank = await setCouncil(db, {
      userId: josh,
      postId: older.value.id,
      action: "approve",
      reason: "The post names the office.",
      checklist: [],
      now: later(12),
    });
    assert.equal(blank.ok, false);
    const approvedPost = await setCouncil(db, {
      userId: josh,
      postId: older.value.id,
      action: "approve",
      reason: "The post names the office.",
      checklist: [...REVIEW_CHECKLIST.candidate],
      now: later(13),
    });
    assert.equal(approvedPost.ok, true);
    if (!approvedPost.ok) return;
    assert.equal(approvedPost.value && "label" in approvedPost.value && approvedPost.value.label, "Council-approved");
    const again = await setCouncil(db, {
      userId: josh,
      postId: older.value.id,
      action: "approve",
      reason: "The post names the office.",
      checklist: [...REVIEW_CHECKLIST.candidate],
      now: later(14),
    });
    assert.equal(again.ok, false);

    const board = await listBoard(db, maria, later(15));
    assert.equal(board.ok, true);
    if (!board.ok) return;
    const county = board.value.posts.filter((post) => post.room === "county");
    assert.deepEqual(
      county.map((post) => post.author),
      ["Tom", "Maria"],
    );
    const labeled = county.find((post) => post.author === "Maria");
    assert.equal(labeled?.council?.label, "Council-approved");
    assert.equal(labeled?.council?.reason, "The post names the office.");
    assert.equal(labeled?.mark, null);
    assert.equal("score" in (labeled ?? {}), false);

    const home = await listHome(db, maria, later(15));
    assert.equal(home.ok, true);
    if (!home.ok) return;
    assert.deepEqual(
      home.value.sections.map((section) => section.tier),
      ["council", "joined", "town", "congregation", "region"],
    );
    const council = home.value.sections[0];
    assert.equal(council?.tier, "council");
    if (council?.tier !== "council") return;
    assert.equal(council.posts[0]?.label, "Council-approved");
    assert.equal(council.posts[0]?.id, older.value.id);
    const joined = home.value.sections[1];
    const town = home.value.sections[2];
    const congregation = home.value.sections[3];
    const region = home.value.sections[4];
    if (joined?.tier !== "joined" || town?.tier !== "town" || congregation?.tier !== "congregation" || region?.tier !== "region") {
      return;
    }
    assert.deepEqual(joined.rooms.map((room) => room.id), ["rv-shop"]);
    assert.equal(town.rooms.some((room) => room.id === "rv-town"), true);
    assert.equal(town.rooms.some((room) => room.id === "rv-shop"), false);
    assert.equal(town.rooms.some((room) => room.id === "brandon-town"), false);
    assert.deepEqual(congregation.rooms.map((room) => room.id), ["cong-grace"]);
    assert.deepEqual(region.rooms.map((room) => room.id), ["region-hillsborough"]);
    const found: string[] = [];
    keys(home.value, found);
    assert.equal(found.includes("score"), false);
    assert.equal(found.includes("likeCount"), false);

    const cleared = await correctZip(db, {
      userId: josh,
      zip: "33578",
      name: "",
      state: "",
      clear: true,
      now: later(16),
    });
    assert.equal(cleared.ok, true);
    const shifted = await listHome(db, maria, later(17));
    assert.equal(shifted.ok, true);
    if (!shifted.ok) return;
    assert.equal(shifted.value.sections.some((section) => section.tier === "town"), false);

    const revoked = await setCouncil(db, {
      userId: josh,
      postId: older.value.id,
      action: "revoke",
      reason: "",
      checklist: [],
      now: later(18),
    });
    assert.equal(revoked.ok, true);
    const rows = await db.query<{ action: string; reason: string }>(
      `select action, reason from council_approval where post_id = $1 order by at asc`,
      [older.value.id],
    );
    assert.deepEqual(
      rows.map((row) => row.action),
      ["approve", "revoke"],
    );
    assert.equal(rows[0]?.reason, "The post names the office.");
    const quiet = await listBoard(db, maria, later(19));
    assert.equal(quiet.ok, true);
    if (!quiet.ok) return;
    const still = quiet.value.posts.find((post) => post.id === older.value.id);
    assert.equal(still?.council, undefined);
    assert.equal(still && quiet.value.posts[0] && quiet.value.posts.filter((post) => post.room === "county")[0]?.author, "Tom");
  } finally {
    await close();
  }
});

test("a banned member cannot vouch anyone in", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const pat = randomUUID();
    await user(db, maria, "Maria", "maria-ban@example.com");
    await user(db, pat, "Pat", "pat@example.com");
    await member(db, maria, "Maria", later(1));
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Maria', 'threat', 'Josh', 1, $3, $4)`,
      [randomUUID(), maria, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), later(2)],
    );
    const vouched = await grantAccess(db, {
      userId: maria,
      action: "grant-member",
      email: "pat@example.com",
      roomId: "shop",
      inviterEmail: "",
      stewardEmail: "",
      role: "",
      now: later(3),
    });
    assert.equal(vouched.ok, false);
    if (vouched.ok) return;
    assert.equal(vouched.status, 403);
    assert.equal(vouched.error, "banned");
    const log = await db.query<{ id: string }>(
      `select id from access_log where user_id = $1`,
      [pat],
    );
    assert.equal(log.length, 0);
  } finally {
    await close();
  }
});

test("a room bar does not block Home or a vouch", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const pat = randomUUID();
    await user(db, maria, "Maria", "maria-room-ban@example.com");
    await user(db, pat, "Pat", "pat-room@example.com");
    await member(db, maria, "Maria", later(1));
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Maria', 'threat', 'Tom', 1, $3, 'shop', $4)`,
      [randomUUID(), maria, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), later(2)],
    );
    const home = await listHome(db, maria, later(3));
    assert.equal(home.ok, true);
    const vouched = await grantAccess(db, {
      userId: maria,
      action: "grant-member",
      email: "pat-room@example.com",
      roomId: "shop",
      inviterEmail: "",
      stewardEmail: "",
      role: "",
      now: later(4),
    });
    if (!vouched.ok) assert.notEqual(vouched.error, "banned");
  } finally {
    await close();
  }
});

test("deleting an account anonymizes council, room request, and ZIP rows", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await user(db, maria, "Maria", "maria-gone@example.com");
    await member(db, maria, "Maria", later(1));
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: {
        type: "did",
        claim: "The hearing named the candidate and the office.",
        reason: "The agenda is on the county site.",
        on: "2026-10-18",
        subject: "candidate",
      },
      now: later(2),
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const requestId = randomUUID();
    await db.query(
      `insert into room_request
       (id, kind, name, state, by_user_id, by_name, status, decided_by_user_id, decided_by_name, note, at)
       values ($1, 'town', 'Dover', 'FL', $2, 'Maria', 'refused', $2, 'Maria', 'Dover already has a notice.', $3)`,
      [requestId, maria, later(3)],
    );
    await db.query(
      `insert into zip_correction (id, zip, town_id, name, state, by_user_id, by_name, at)
       values ($1, '33527', 'dover-fl', 'Dover', 'FL', $2, 'Maria', $3)`,
      [randomUUID(), maria, later(4)],
    );
    await db.query(
      `insert into council_approval (id, post_id, reason, checklist, by_user_id, by_name, action, at)
       values ($1, $2, 'The post names the office.', $3, $4, 'Maria', 'approve', $5)`,
      [randomUUID(), posted.value.id, ["The post names the candidate and the office."], maria, later(5)],
    );
    await db.query(`delete from "user" where id = $1`, [maria]);
    const request = await db.query<{ by_name: string; decided_by_name: string; by_user_id: string | null }>(
      `select by_name, decided_by_name, by_user_id from room_request where id = $1`,
      [requestId],
    );
    assert.equal(request[0]?.by_name, "Removed member");
    assert.equal(request[0]?.decided_by_name, "Removed member");
    assert.equal(request[0]?.by_user_id, null);
    const zip = await db.query<{ by_name: string; name: string }>(
      `select by_name, name from zip_correction where zip = '33527'`,
    );
    assert.equal(zip[0]?.by_name, "Removed member");
    assert.equal(zip[0]?.name, "Dover");
    const approval = await db.query<{ by_name: string }>(
      `select by_name from council_approval where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(approval[0]?.by_name, "Removed member");
    const functions = await db.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc where proname in ('anonymize_board_user', 'anonymize_places_user')`,
    );
    const boardFn = functions.find((row) => row.proname === "anonymize_board_user");
    const placesFn = functions.find((row) => row.proname === "anonymize_places_user");
    assert.ok(boardFn);
    assert.ok(placesFn);
    assert.equal(boardFn.prosrc.includes("council_approval"), false);
    assert.equal(placesFn.prosrc.includes("council_approval"), true);
    assert.equal(placesFn.prosrc.includes("room_request"), true);
    assert.equal(placesFn.prosrc.includes("zip_correction"), true);
  } finally {
    await close();
  }
});
