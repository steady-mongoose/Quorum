import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { bindCallEviction } from "../calls/evict.ts";
import { roomCallMember } from "../calls/membership.ts";
import { createCallStore } from "../calls/store.ts";
import { removeChatMessage, sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { withHoldKey } from "./csam.ts";
import { ruleId } from "./rule.ts";
import {
  banMember,
  closeAsked,
  createPost,
  createRoom,
  decideAppeal,
  fileAppeal,
  listBoard,
  listOwnAppeals,
  markPost,
  removePost,
  replyToPost,
  revisePost,
  setSteward,
} from "./store.ts";

const now = new Date("2026-10-19T12:00:00Z");

async function user(db: Db, id: string, name: string, email: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
}

async function grant(
  db: Db,
  userId: string,
  name: string,
  role: "member" | "steward" | "admin",
  roomId = "",
) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), userId, name, role, roomId, now],
  );
}

test("doxxing and blasphemy stay their own rule ids", () => {
  assert.equal(ruleId("doxxing"), "doxxing");
  assert.equal(ruleId("blasphemy"), "blasphemy");
  assert.equal(ruleId("csam"), "csam");
  assert.equal(ruleId("porn"), "porn");
  assert.equal(ruleId("threat"), "threat");
  assert.equal(ruleId("other"), "threat");
});

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

test("the seeded rooms match the board, and a member sees another member's post", async () => {
  const { db, close } = await openTestDb();
  try {
    const rooms = await db.query<{ id: string; name: string; takes: string[] | string }>(
      `select id, name, takes from room order by sort_order asc`,
    );
    assert.deepEqual(rooms.map((room) => room.id).slice(0, 10), [
      "county",
      "question",
      "shop",
      "shelf",
      "coop",
      "baptist",
      "presbyterian",
      "latin",
      "orthodox",
      "dispatch",
    ]);
    assert.equal(rooms[0]?.name, "The County");
    assert.equal(rooms[9]?.name, "Dispatch");
    assert.equal(
      rooms.some((room) => room.id === "rv-town"),
      true,
    );
    assert.equal(
      rooms.some((room) => room.id === "region-hillsborough"),
      true,
    );

    const stranger = randomUUID();
    await user(db, stranger, "Stranger", "stranger@example.com");
    const refused = await listBoard(db, stranger, now);
    assert.equal(refused.ok, false);

    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");

    const older = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: { ...did, type: "did" },
      now,
    });
    assert.equal(older.ok, true);
    const newer = await createPost(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      body: {
        type: "asked",
        claim: "Can someone lend a carboy?",
        reason: "I already asked Luis.",
        on: "",
        likeCount: 40,
        score: 99,
      },
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(newer.ok, true);
    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    const shop = board.value.posts.filter((post) => post.room === "shop");
    assert.deepEqual(
      shop.map((post) => post.author),
      ["Josh", "Maria"],
    );
    assert.equal("score" in shop[0], false);
    assert.equal(
      shop.every((post) => post.removed === false),
      true,
    );

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name in ('board_post', 'board_mark', 'board_removal', 'board_ban', 'room')`,
    );
    const names = columns.map((row) => row.column_name);
    for (const banned of [
      "like",
      "likes",
      "like_count",
      "score",
      "reshare",
      "reshares",
      "rank",
      "boost",
    ]) {
      assert.equal(names.includes(banned), false, banned);
    }
  } finally {
    await close();
  }
});

test("a steward mark keeps the post up, and a hard removal bars the account", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const memberMark = await markPost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "The proof does not say who was there.",
      now,
    });
    assert.equal(memberMark.ok, false);
    if (memberMark.ok) return;
    assert.equal(memberMark.status, 403);

    await grant(db, tom, "Tom", "steward", "shop");
    const marked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "unsupported",
      reason: "The notice does not say where that came from.",
      now,
    });
    assert.equal(marked.ok, true);
    if (!marked.ok) return;
    assert.equal(marked.value.post.removed, false);
    assert.equal(marked.value.post.mark, "unsupported");
    assert.equal(marked.value.row.reason, "The notice does not say where that came from.");
    const short = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "No.",
      now,
    });
    assert.equal(short.ok, false);

    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.removal.reason, "threat");
    assert.equal(removed.value.ban.strikes, 1);
    const hidden = await listBoard(db, tom, now);
    assert.equal(hidden.ok, true);
    if (!hidden.ok) return;
    assert.equal(
      hidden.value.posts.some((post) => post.id === posted.value.id),
      false,
    );
    assert.equal(hidden.value.removals[0]?.reason, "threat");

    const blocked = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(blocked.ok, false);
    const countyDuring = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(countyDuring.ok, true);
    const later = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const again = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now: later,
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    const second = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: again.value.id,
      reason: "porn",
      now: later,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.ban.strikes >= 2, true);
    const still = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now: new Date(later.getTime() + 40 * 24 * 60 * 60 * 1000),
    });
    assert.equal(still.ok, false);
    const countyAfter = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now: new Date(later.getTime() + 40 * 24 * 60 * 60 * 1000),
    });
    assert.equal(countyAfter.ok, true);
  } finally {
    await close();
  }
});

test("room creation is admin only, and a one-step steward appointment is refused", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");
    const denied = await createRoom(db, {
      userId: maria,
      id: "woodshop",
      name: "Woodshop",
      what: "A second bench night for people who already come to the shop.",
      categoryId: "business-trades",
      now,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.status, 403);
    const created = await createRoom(db, {
      userId: josh,
      id: "woodshop",
      name: "Woodshop",
      what: "A second bench night for people who already come to the shop.",
      categoryId: "business-trades",
      now,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.takes.includes("did"), true);
    const russian = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "woodshop",
      body: {
        type: "did",
        claim: "Сегодня строгал доски в мастерской.",
        reason: "Том это видел.",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(russian.ok, false);

    const appointed = await setSteward(db, {
      userId: josh,
      name: "Josh",
      email: "maria@example.com",
      action: "grant",
      note: "Appointed by the founder.",
      now,
    });
    assert.equal(appointed.ok, false);
    if (appointed.ok) return;
    assert.match(appointed.error, /inviter/);
    const log = await db.query<{ action: string }>(
      `select action from access_log where user_id = $1 and role = 'steward'`,
      [maria],
    );
    assert.equal(log.length, 0);
    const after = await listBoard(db, maria, now);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.me.steward, false);
    assert.equal(
      after.value.rooms.some((room) => room.id === "woodshop"),
      true,
    );

    const direct = await banMember(db, {
      userId: josh,
      name: "Josh",
      email: "maria@example.com",
      reason: "csam",
      now,
    });
    assert.equal(direct.ok, true);
    if (!direct.ok) return;
    assert.equal(direct.value.reason, "csam");
    const barred = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(barred.ok, false);
  } finally {
    await close();
  }
});

test("a barred member cannot revise or close, and a revision keeps the mark", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const marked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "unsupported",
      reason: "The notice does not say where that came from.",
      now,
    });
    assert.equal(marked.ok, true);
    const revised = await revisePost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      claim: "Sharpened the chisels and put them back.",
      reason: "Tom checked them on Thursday.",
      now,
    });
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    assert.equal(revised.value.post.mark, "unsupported");
    assert.equal(revised.value.mark, null);
    const marks = await db.query<{ mark: string | null }>(
      `select mark from board_mark where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(marks.length, 1);
    assert.equal(marks[0]?.mark, "unsupported");

    const asked = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: {
        type: "asked",
        claim: "Can someone lend a carboy?",
        reason: "I already asked Luis.",
      },
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    await banMember(db, {
      userId: tom,
      name: "Tom",
      email: "maria@example.com",
      reason: "threat",
      roomId: "shop",
      now,
    });
    const blockedRevise = await revisePost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      claim: "Sharpened the chisels again.",
      reason: "Tom checked them on Thursday.",
      now,
    });
    assert.equal(blockedRevise.ok, false);
    if (blockedRevise.ok) return;
    assert.equal(blockedRevise.status, 403);
    const blockedClose = await closeAsked(db, {
      userId: maria,
      postId: asked.value.id,
      now,
    });
    assert.equal(blockedClose.ok, false);
    if (blockedClose.ok) return;
    assert.equal(blockedClose.status, 403);
  } finally {
    await close();
  }
});

test("only a steward sees ban and removal logs", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const dale = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, dale, "Dale", "dale@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, dale, "Dale", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    const steward = await listBoard(db, tom, now);
    const member = await listBoard(db, dale, now);
    assert.equal(steward.ok, true);
    assert.equal(member.ok, true);
    if (!steward.ok || !member.ok) return;
    assert.equal(steward.value.removals[0]?.reason, "threat");
    assert.equal(steward.value.bans[0]?.author, "Maria");
    assert.deepEqual(member.value.removals, []);
    assert.deepEqual(member.value.bans, []);
    assert.equal(member.value.me.ban, null);
    const barred = await listBoard(db, maria, now);
    assert.equal(barred.ok, true);
    if (!barred.ok) return;
    assert.equal(barred.value.me.ban, null);
    assert.equal(
      barred.value.rooms.some((room) => room.id === "shop"),
      false,
    );
    assert.equal(
      barred.value.posts.some((post) => post.room === "shop"),
      false,
    );
    const shopPage = await listBoard(db, maria, now, { room: "shop" });
    assert.equal(shopPage.ok, false);
    if (shopPage.ok) return;
    assert.equal(shopPage.status, 403);
    assert.equal(shopPage.error, "banned");
    assert.equal(shopPage.ban?.reason, "threat");
    const shopAgain = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(shopAgain.ok, false);
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(county.ok, true);
  } finally {
    await close();
  }
});

test("a reply follows the room's posting rules", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "dispatch");
    const notice = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "dispatch",
      body: {
        type: "saw",
        claim: "One lane closed on Bloomingdale at Lithia Pinecrest.",
        reason: "4:40pm, Bloomingdale and Lithia Pinecrest, eastbound.",
        on: "2026-10-19",
        attested: true,
      },
      now,
    });
    assert.equal(notice.ok, true);
    if (!notice.ok) return;
    const memberReply = await replyToPost(db, {
      userId: maria,
      name: "Maria",
      postId: notice.value.id,
      claim: "I saw the same crew on the way home.",
      now,
    });
    assert.equal(memberReply.ok, false);
    if (memberReply.ok) return;
    assert.equal(memberReply.status, 403);
    assert.equal(memberReply.error, "Only a steward can post that.");
    const stewardReply = await replyToPost(db, {
      userId: tom,
      name: "Tom",
      postId: notice.value.id,
      claim: "The lane opened again before five.",
      now,
    });
    assert.equal(stewardReply.ok, true);

    const shop = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(shop.ok, true);
    if (!shop.ok) return;
    const shopReply = await replyToPost(db, {
      userId: tom,
      name: "Tom",
      postId: shop.value.id,
      claim: "They cut cleanly. I tried one.",
      now,
    });
    assert.equal(shopReply.ok, true);
  } finally {
    await close();
  }
});

test("seeds do not overwrite a named room, and deleting a member keeps the log", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(`update room set name = 'Edited Shop' where id = 'shop'`);
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
       values ('shop', 'The Shop', 'Replacement copy.', array['did'], array['noted'], array['meeting'], 'Meeting', true, false, 2)
       on conflict (id) do update set name = excluded.name, what = excluded.what
       where room.name = ''`,
    );
    const shop = await db.query<{ name: string }>(`select name from room where id = 'shop'`);
    assert.equal(shop[0]?.name, "Edited Shop");

    await db.query(`delete from room_member where room_id = 'dispatch'`);
    await db.query(`delete from room where id = 'dispatch'`);
    await db.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
       values ('dispatch', 'Dispatch', 'Notices from the stewards.', array[]::text[], array['saw'], array[]::text[], 'Meeting', false, false, 9)
       on conflict (id) do update set name = excluded.name where room.name = ''`,
    );
    const dispatch = await db.query<{ name: string }>(
      `select name from room where id = 'dispatch'`,
    );
    assert.equal(dispatch[0]?.name, "Dispatch");

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname in (
         'board_post_parent_idx', 'board_mark_post_idx', 'board_removal_post_idx', 'board_post_room_page_idx'
       )`,
    );
    assert.equal(indexes.length, 4);

    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "The notice does not say where that came from.",
      now,
    });
    await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    await db.query(`delete from "user" where id = $1`, [maria]);
    const post = await db.query<{ author_name: string; author_user_id: string | null }>(
      `select author_name, author_user_id from board_post where id = $1`,
      [posted.value.id],
    );
    assert.equal(post[0]?.author_name, "Removed member");
    assert.equal(post[0]?.author_user_id, null);
    const mark = await db.query<{ author_name: string; by_name: string }>(
      `select author_name, by_name from board_mark where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(mark[0]?.author_name, "Removed member");
    assert.equal(mark[0]?.by_name, "Tom");
    const removal = await db.query<{ author_name: string; author_user_id: string | null }>(
      `select author_name, author_user_id from board_removal where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(removal[0]?.author_name, "Removed member");
    assert.equal(removal[0]?.author_user_id, null);
    const ban = await db.query<{ name: string; user_id: string | null }>(
      `select name, user_id from board_ban where name = 'Removed member' or user_id = $1`,
      [maria],
    );
    assert.equal(ban[0]?.name, "Removed member");
    assert.equal(ban[0]?.user_id, null);
  } finally {
    await close();
  }
});

test("room pages walk backward from the newest post", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await grant(db, maria, "Maria", "member");
    const claims = ["First chisel.", "Second chisel.", "Third chisel."];
    for (const [index, claim] of claims.entries()) {
      const posted = await createPost(db, {
        userId: maria,
        name: "Maria",
        roomId: "shop",
        body: { ...did, claim, reason: "Tom checked them on Thursday." },
        now: new Date(now.getTime() + index * 1000),
      });
      assert.equal(posted.ok, true);
    }
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: { ...did, claim: "Called the county office." },
      now: new Date(now.getTime() + 5000),
    });
    assert.equal(county.ok, true);
    const first = await listBoard(db, maria, now, { room: "shop", limit: 2 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(
      first.value.posts.map((post) => post.claim),
      ["Third chisel.", "Second chisel."],
    );
    assert.equal(
      first.value.posts.some((post) => post.room === "county"),
      false,
    );
    const next = first.value.pages.find((page) => page.room === "shop")?.next;
    assert.equal(typeof next, "string");
    if (!next) return;
    const second = await listBoard(db, maria, now, { room: "shop", cursor: next, limit: 2 });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(
      second.value.posts.map((post) => post.claim),
      ["First chisel."],
    );
    assert.equal(second.value.pages.find((page) => page.room === "shop")?.next, null);
    const bad = await listBoard(db, maria, now, { room: "shop", cursor: "not-a-page" });
    assert.equal(bad.ok, false);
  } finally {
    await close();
  }
});

async function seatOwner(db: Db, id: string, name: string, email: string) {
  await user(db, id, name, email);
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair) values ($1, true, true, true)`,
    [id],
  );
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [id]);
}

test("a steward cannot bar the owner, an admin, or another steward", async () => {
  const { db, close } = await openTestDb();
  try {
    const owner = randomUUID();
    const admin = randomUUID();
    const steward = randomUUID();
    const peer = randomUUID();
    await seatOwner(db, owner, "Josh", "josh@example.com");
    await user(db, admin, "Ada", "ada@example.com");
    await user(db, steward, "Tom", "tom@example.com");
    await user(db, peer, "Ruth", "ruth@example.com");
    await grant(db, admin, "Ada", "member");
    await grant(db, admin, "Ada", "admin");
    await grant(db, steward, "Tom", "member");
    await grant(db, steward, "Tom", "steward", "shop");
    await grant(db, peer, "Ruth", "member");
    await grant(db, peer, "Ruth", "steward", "shop");

    const againstOwner = await banMember(db, {
      userId: admin,
      name: "Ada",
      email: "josh@example.com",
      reason: "threat",
      now,
    });
    assert.equal(againstOwner.ok, false);
    if (againstOwner.ok) return;
    assert.equal(againstOwner.status, 403);
    assert.equal(againstOwner.error, "The owner cannot be barred.");

    const stewardOnAdmin = await banMember(db, {
      userId: steward,
      name: "Tom",
      email: "ada@example.com",
      reason: "threat",
      now,
    });
    assert.equal(stewardOnAdmin.ok, false);
    if (stewardOnAdmin.ok) return;
    assert.equal(stewardOnAdmin.error, "A steward cannot bar an admin.");

    const ownerPost = await createPost(db, {
      userId: owner,
      name: "Josh",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(ownerPost.ok, true);
    if (!ownerPost.ok) return;
    const removedOwner = await removePost(db, {
      userId: steward,
      name: "Tom",
      postId: ownerPost.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removedOwner.ok, false);
    if (removedOwner.ok) return;
    assert.equal(removedOwner.error, "The owner cannot be barred.");

    const peerPost = await createPost(db, {
      userId: peer,
      name: "Ruth",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(peerPost.ok, true);
    if (!peerPost.ok) return;
    const removedPeer = await removePost(db, {
      userId: steward,
      name: "Tom",
      postId: peerPost.value.id,
      reason: "porn",
      now,
    });
    assert.equal(removedPeer.ok, false);
    if (removedPeer.ok) return;
    assert.equal(removedPeer.error, "A steward cannot bar another steward.");

    const adminPost = await createPost(db, {
      userId: admin,
      name: "Ada",
      roomId: "shop",
      body: did,
      now: new Date(now.getTime() + 1000),
    });
    assert.equal(adminPost.ok, true);
    if (!adminPost.ok) return;
    const ownerRemovesAdmin = await removePost(db, {
      userId: owner,
      name: "Josh",
      postId: adminPost.value.id,
      reason: "threat",
      now,
    });
    assert.equal(ownerRemovesAdmin.ok, true);

    const adminRemovesSteward = await withHoldKey("test-hold-key-value", () =>
      removePost(db, {
        userId: admin,
        name: "Ada",
        postId: peerPost.value.id,
        reason: "csam",
        now,
      }),
    );
    assert.equal(adminRemovesSteward.ok, true);
  } finally {
    await close();
  }
});

test("a room bar drops that room's call, and an admin bar drops every live call", async () => {
  const { db, close } = await openTestDb();
  const calls = createCallStore();
  bindCallEviction(calls);
  try {
    const steward = randomUUID();
    const member = randomUUID();
    const other = randomUUID();
    const owner = randomUUID();
    await user(db, steward, "Tom", "tom-call@example.com");
    await grant(db, steward, "Tom", "member");
    await grant(db, steward, "Tom", "steward", "shop");
    await user(db, member, "Maria", "maria-call@example.com");
    await grant(db, member, "Maria", "member");
    await user(db, other, "Ruth", "ruth-call@example.com");
    await grant(db, other, "Ruth", "member");
    await seatOwner(db, owner, "Josh", "josh-call@example.com");

    const at = now.getTime();
    calls.join("shop", { id: member, name: "Maria" }, at);
    calls.join("county", { id: member, name: "Maria" }, at);
    calls.join("shop", { id: other, name: "Ruth" }, at);
    calls.join("county", { id: other, name: "Ruth" }, at);
    calls.join("shop", { id: owner, name: "Josh" }, at);

    const refused = await banMember(db, {
      userId: steward,
      name: "Tom",
      email: "josh-call@example.com",
      reason: "threat",
      now,
    });
    assert.equal(refused.ok, false);
    assert.equal(calls.poll("shop", owner, 0, at + 1).ok, true);

    const posted = await createPost(db, {
      userId: member,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await removePost(db, {
      userId: steward,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    assert.equal(calls.poll("shop", member, 0, at + 1).ok, false);
    assert.equal(calls.poll("county", member, 0, at + 1).ok, true);
    assert.equal(calls.poll("shop", other, 0, at + 1).ok, true);

    const ruthPost = await createPost(db, {
      userId: other,
      name: "Ruth",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(ruthPost.ok, true);
    const banned = await banMember(db, {
      userId: steward,
      name: "Tom",
      email: "ruth-call@example.com",
      reason: "porn",
      roomId: "shop",
      now,
    });
    assert.equal(banned.ok, true);
    assert.equal(calls.poll("shop", other, 0, at + 2).ok, false);
    assert.equal(calls.poll("county", other, 0, at + 2).ok, true);
    assert.equal(calls.poll("shop", owner, 0, at + 2).ok, true);

    const site = await banMember(db, {
      userId: owner,
      name: "Josh",
      email: "ruth-call@example.com",
      reason: "csam",
      now,
    });
    assert.equal(site.ok, true);
    assert.equal(calls.poll("county", other, 0, at + 3).ok, false);
    assert.equal(calls.poll("shop", owner, 0, at + 3).ok, true);
  } finally {
    bindCallEviction(createCallStore());
    await close();
  }
});

test("a steward of one room cannot mark, remove, or bar in another", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const dale = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria-room@example.com");
    await user(db, tom, "Tom", "tom-room@example.com");
    await user(db, dale, "Dale", "dale-room@example.com");
    await user(db, josh, "Josh", "josh-room@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, dale, "Dale", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");
    await grant(db, tom, "Tom", "steward", "");
    const shopPost = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(shopPost.ok, true);
    if (!shopPost.ok) return;
    const blank = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: shopPost.value.id,
      mark: "sloppy",
      reason: "The proof does not say who was there.",
      now,
    });
    assert.equal(blank.ok, false);
    if (blank.ok) return;
    assert.equal(blank.error, "Only a steward can mark a post.");

    await grant(db, tom, "Tom", "steward", "shop");
    const countyPost = await createPost(db, {
      userId: dale,
      name: "Dale",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(countyPost.ok, true);
    if (!countyPost.ok) return;
    const marked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: countyPost.value.id,
      mark: "unsupported",
      reason: "The notice does not say where that came from.",
      now,
    });
    assert.equal(marked.ok, false);
    if (marked.ok) return;
    assert.equal(marked.error, "A steward can mark a post only in a room they steward.");
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: countyPost.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, false);
    if (removed.ok) return;
    assert.equal(removed.error, "A steward can remove a post only in a room they steward.");
    const barred = await banMember(db, {
      userId: tom,
      name: "Tom",
      email: "dale-room@example.com",
      reason: "threat",
      roomId: "shop",
      now,
    });
    assert.equal(barred.ok, false);
    if (barred.ok) return;
    assert.equal(
      barred.error,
      "A steward can bar a member only for a post in a room they steward.",
    );

    const shopMark = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: shopPost.value.id,
      mark: "sloppy",
      reason: "The proof does not say who was there.",
      now,
    });
    assert.equal(shopMark.ok, true);
    const adminRemoved = await removePost(db, {
      userId: josh,
      name: "Josh",
      postId: countyPost.value.id,
      reason: "threat",
      now,
    });
    assert.equal(adminRemoved.ok, true);
    const scope = await db.query<{ room_id: string }>(
      `select room_id from board_ban where user_id = $1`,
      [dale],
    );
    assert.deepEqual(
      scope.map((row) => row.room_id),
      [""],
    );
  } finally {
    await close();
  }
});

const noted = {
  type: "noted",
  claim: "The county posts the agenda packet the Friday before.",
  reason: "It is on the county site, and I read it in March.",
};

test("a shop steward cannot file a steward post in the county or in dispatch", async () => {
  const { db, close } = await openTestDb();
  try {
    const tom = randomUUID();
    const luis = randomUUID();
    await user(db, tom, "Tom", "tom-noted@example.com");
    await user(db, luis, "Luis", "luis-noted@example.com");
    await grant(db, tom, "Tom", "member");
    await grant(db, luis, "Luis", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, luis, "Luis", "steward", "dispatch");

    const countyNoted = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "county",
      body: noted,
      now,
    });
    assert.equal(countyNoted.ok, false);
    if (countyNoted.ok) return;
    assert.equal(countyNoted.error, "Only a steward can post that.");

    const dispatchSaw = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "dispatch",
      body: {
        type: "saw",
        claim: "One lane closed on Bloomingdale at Lithia Pinecrest.",
        reason: "4:40pm, Bloomingdale and Lithia Pinecrest, eastbound.",
        on: "2026-10-19",
        attested: true,
      },
      now,
    });
    assert.equal(dispatchSaw.ok, false);
    if (dispatchSaw.ok) return;
    assert.equal(dispatchSaw.error, "Only a steward can post that.");

    const shopNoted = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      body: noted,
      now,
    });
    assert.equal(shopNoted.ok, true);
    if (!shopNoted.ok) return;
    const revised = await revisePost(db, {
      userId: tom,
      name: "Tom",
      postId: shopNoted.value.id,
      claim: "The shop posts the agenda packet the Friday before.",
      reason: "It is on the shop board, and I read it in March.",
      now,
    });
    assert.equal(revised.ok, true);

    await grant(db, tom, "Tom", "steward", "county");
    const filed = await createPost(db, {
      userId: tom,
      name: "Tom",
      roomId: "county",
      body: noted,
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Tom', 'steward', 'county', 'revoke', 'test', 'test', 'test', 'Revoked for the test.', $3)`,
      [randomUUID(), tom, new Date(now.getTime() + 1000)],
    );
    const countyRevise = await revisePost(db, {
      userId: tom,
      name: "Tom",
      postId: filed.value.id,
      claim: "The county posts the full packet the Friday before.",
      reason: "It is on the county site, and I read it in March.",
      now: new Date(now.getTime() + 2000),
    });
    assert.equal(countyRevise.ok, false);
    if (countyRevise.ok) return;
    assert.equal(countyRevise.error, "Only a steward can post that.");

    const notice = await createPost(db, {
      userId: luis,
      name: "Luis",
      roomId: "dispatch",
      body: {
        type: "saw",
        claim: "One lane closed on Bloomingdale at Lithia Pinecrest.",
        reason: "4:40pm, Bloomingdale and Lithia Pinecrest, eastbound.",
        on: "2026-10-19",
        attested: true,
      },
      now,
    });
    assert.equal(notice.ok, true);
    if (!notice.ok) return;
    const reply = await replyToPost(db, {
      userId: tom,
      name: "Tom",
      postId: notice.value.id,
      claim: "The lane was still closed at five.",
      now,
    });
    assert.equal(reply.ok, false);
    if (reply.ok) return;
    assert.equal(reply.status, 403);
    assert.equal(reply.error, "Only a steward can post that.");
    const stewardReply = await replyToPost(db, {
      userId: luis,
      name: "Luis",
      postId: notice.value.id,
      claim: "The lane opened again before five.",
      now,
    });
    assert.equal(stewardReply.ok, true);
  } finally {
    await close();
  }
});

test("a room steward's bar covers that room, and an admin's bar covers the site", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria-scope@example.com");
    await user(db, tom, "Tom", "tom-scope@example.com");
    await user(db, josh, "Josh", "josh-scope@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, tom, "Tom", "steward", "county");
    const shop = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(shop.ok, true);
    assert.equal(county.ok, true);
    const unnamed = await banMember(db, {
      userId: tom,
      name: "Tom",
      email: "maria-scope@example.com",
      reason: "threat",
      now,
    });
    assert.equal(unnamed.ok, false);
    if (unnamed.ok) return;
    assert.equal(unnamed.error, "Name the room this bar is for.");
    const barred = await banMember(db, {
      userId: tom,
      name: "Tom",
      email: "maria-scope@example.com",
      reason: "threat",
      roomId: "shop",
      now,
    });
    assert.equal(barred.ok, true);
    if (!barred.ok) return;
    assert.equal(barred.value.strikes, 1);
    const rows = await db.query<{ room_id: string }>(
      `select room_id from board_ban where user_id = $1 order by room_id`,
      [maria],
    );
    assert.deepEqual(
      rows.map((row) => row.room_id),
      ["shop"],
    );
    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, true);
    const shopPost = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(shopPost.ok, false);
    const countyPost = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(countyPost.ok, true);
    const shopCall = await roomCallMember(db, maria, "shop", now);
    const countyCall = await roomCallMember(db, maria, "county", now);
    assert.equal(shopCall.kind, "banned");
    assert.equal(countyCall.kind, "member");

    const site = await banMember(db, {
      userId: josh,
      name: "Josh",
      email: "maria-scope@example.com",
      reason: "csam",
      now,
    });
    assert.equal(site.ok, true);
    const siteRows = await db.query<{ room_id: string }>(
      `select room_id from board_ban where user_id = $1 and by_user_id = $2`,
      [maria, josh],
    );
    assert.deepEqual(
      siteRows.map((row) => row.room_id),
      [""],
    );
    const hidden = await listBoard(db, maria, now);
    assert.equal(hidden.ok, false);
    if (hidden.ok) return;
    assert.equal(hidden.error, "banned");
    const countyBlocked = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(countyBlocked.ok, false);
    const countyCallAfter = await roomCallMember(db, maria, "county", now);
    assert.equal(countyCallAfter.kind, "banned");
  } finally {
    await close();
  }
});

test("a CSAM removal is never room-scoped", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria-csam@example.com");
    await user(db, tom, "Tom", "tom-csam@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "csam",
      now,
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.ban.reason, "csam");
    const rows = await db.query<{ room_id: string; reason: string }>(
      `select room_id, reason from board_ban where user_id = $1`,
      [maria],
    );
    assert.deepEqual(rows, [{ room_id: "", reason: "csam" }]);
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: did,
      now,
    });
    assert.equal(county.ok, false);
    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, false);
    if (board.ok) return;
    assert.equal(board.error, "banned");
    assert.equal(board.ban?.reason, "csam");
  } finally {
    await close();
  }
});

test("reading the board does not add the member to every room", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    await user(db, maria, "Maria", "maria-rooms@example.com");
    await grant(db, maria, "Maria", "member");
    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, true);
    const stood = await db.query<{ room_id: string }>(
      `select room_id from room_member where user_id = $1`,
      [maria],
    );
    assert.deepEqual(stood, []);

    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    const again = await listBoard(db, maria, now);
    assert.equal(again.ok, true);
    const after = await db.query<{ room_id: string }>(
      `select room_id from room_member where user_id = $1 order by room_id`,
      [maria],
    );
    assert.deepEqual(
      after.map((row) => row.room_id),
      ["shop"],
    );
  } finally {
    await close();
  }
});

test("out of scope stays visible, and only that room's steward decides the appeal", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const ada = randomUUID();
    await user(db, maria, "Maria", "maria-appeal@example.com");
    await user(db, tom, "Tom", "tom-appeal@example.com");
    await user(db, ada, "Ada", "ada-appeal@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, ada, "Ada", "member");
    await grant(db, tom, "Tom", "steward");
    await grant(db, ada, "Ada", "steward", "county");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const unmarked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "out_of_scope",
      reason: "This belongs in the county room.",
      now,
    });
    assert.equal(unmarked.ok, false);
    if (unmarked.ok) return;
    assert.match(unmarked.error, /room they steward|Only a steward/);
    await grant(db, tom, "Tom", "steward", "shop");
    const marked = await markPost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      mark: "out_of_scope",
      reason: "This belongs in the county room.",
      now,
    });
    assert.equal(marked.ok, true);
    if (!marked.ok) return;
    assert.equal(marked.value.post.mark, "out_of_scope");
    assert.equal(marked.value.post.removed, false);
    const filed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      kind: "mark",
      reason: "The post is about the shop night.",
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    const otherRoom = await decideAppeal(db, {
      userId: ada,
      name: "Ada",
      appealId: filed.value.id,
      decision: "lift",
      reason: "Ada stewards a different room.",
      now,
    });
    assert.equal(otherRoom.ok, false);
    if (otherRoom.ok) return;
    assert.match(otherRoom.error, /room they steward/);
    const lifted = await decideAppeal(db, {
      userId: tom,
      name: "Tom",
      appealId: filed.value.id,
      decision: "lift",
      reason: "The post stays in this room.",
      now,
    });
    assert.equal(lifted.ok, true);
    if (!lifted.ok) return;
    assert.equal(lifted.value.appeal.decision, "lift");
    assert.equal(lifted.value.posts[0]?.mark, null);
    const board = await listBoard(db, maria, now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(
      board.value.posts.some((post) => post.id === posted.value.id && post.removed === false),
      true,
    );
    assert.equal(board.value.appeals[0]?.decision, "lift");
  } finally {
    await close();
  }
});

test("a roomless steward cannot remove, and doxxing can be removed in that room", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria-dox@example.com");
    await user(db, tom, "Tom", "tom-dox@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward");
    const dox = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: { ...did, claim: "Her phone is 555-014-2291." },
      now,
    });
    assert.equal(dox.ok, false);
    const faith = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "baptist",
      body: {
        type: "hosted",
        claim: "God is good, and the meal is after the service.",
        reason: "",
        on: "2026-10-18",
      },
      now,
    });
    assert.equal(faith.ok, true);
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const blocked = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "doxxing",
      now,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /Only a steward/);
    await grant(db, tom, "Tom", "steward", "shop");
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "doxxing",
      now,
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.removal.reason, "doxxing");
  } finally {
    await close();
  }
});

test("a successful appeal lifts only that room's ban", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const ada = randomUUID();
    await user(db, maria, "Maria", "maria-lift@example.com");
    await user(db, tom, "Tom", "tom-lift@example.com");
    await user(db, ada, "Ada", "ada-lift@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, ada, "Ada", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, ada, "Ada", "steward", "county");
    const shop = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: { ...did, claim: "Called the county office about the agenda." },
      now,
    });
    assert.equal(shop.ok, true);
    assert.equal(county.ok, true);
    if (!shop.ok || !county.ok) return;
    const shopRemoved = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: shop.value.id,
      reason: "threat",
      now,
    });
    const countyRemoved = await removePost(db, {
      userId: ada,
      name: "Ada",
      postId: county.value.id,
      reason: "doxxing",
      now,
    });
    assert.equal(shopRemoved.ok, true);
    assert.equal(countyRemoved.ok, true);
    if (!shopRemoved.ok || !countyRemoved.ok) return;
    assert.equal(shopRemoved.value.ban.reason, "threat");
    assert.equal(countyRemoved.value.ban.reason, "doxxing");
    const filed = await fileAppeal(db, {
      userId: maria,
      name: "Maria",
      postId: shop.value.id,
      kind: "removal",
      reason: "The shop post did not threaten anyone.",
      now,
    });
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    const shopPage = await listBoard(db, maria, now, { room: "shop" });
    assert.equal(shopPage.ok, false);
    const ownBefore = await listOwnAppeals(db, maria);
    assert.equal(ownBefore.length, 1);
    assert.equal(ownBefore[0]?.decision, null);
    assert.equal((await listOwnAppeals(db, tom)).length, 0);
    const lifted = await decideAppeal(db, {
      userId: tom,
      name: "Tom",
      appealId: filed.value.id,
      decision: "lift",
      reason: "The shop bar ends and the county bar stays.",
      now,
    });
    assert.equal(lifted.ok, true);
    if (!lifted.ok) return;
    const ownAfter = await listOwnAppeals(db, maria);
    assert.equal(ownAfter[0]?.decision, "lift");
    assert.equal(
      lifted.value.posts.some((post) => post.id === shop.value.id && !post.removed),
      true,
    );
    const later = new Date(now.getTime() + 1000);
    const shopAgain = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: { ...did, claim: "Sharpened the chisels again after the appeal." },
      now: later,
    });
    assert.equal(shopAgain.ok, true);
    const countyAgain = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: { ...did, claim: "Called the county office a second time." },
      now: later,
    });
    assert.equal(countyAgain.ok, false);
    const bars = await db.query<{ room_id: string; until_at: Date | string; reason: string }>(
      `select room_id, until_at, reason from board_ban where user_id = $1 order by room_id`,
      [maria],
    );
    assert.deepEqual(
      bars.map((row) => row.room_id),
      ["county", "shop"],
    );
    const shopBar = bars.find((row) => row.room_id === "shop");
    const countyBar = bars.find((row) => row.room_id === "county");
    assert.equal(shopBar?.reason, "threat");
    assert.equal(countyBar?.reason, "doxxing");
    assert.ok(shopBar && new Date(shopBar.until_at).getTime() <= later.getTime());
    assert.ok(countyBar && new Date(countyBar.until_at).getTime() > later.getTime());
  } finally {
    await close();
  }
});

test("a steward sees removals and bans only in rooms they steward", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const ada = randomUUID();
    const josh = randomUUID();
    const ruth = randomUUID();
    const sam = randomUUID();
    await user(db, maria, "Maria", "maria-log@example.com");
    await user(db, tom, "Tom", "tom-log@example.com");
    await user(db, ada, "Ada", "ada-log@example.com");
    await user(db, josh, "Josh", "josh-log@example.com");
    await user(db, ruth, "Ruth", "ruth-log@example.com");
    await user(db, sam, "Sam", "sam-log@example.com");
    for (const [id, name] of [
      [maria, "Maria"],
      [tom, "Tom"],
      [ada, "Ada"],
      [josh, "Josh"],
      [ruth, "Ruth"],
      [sam, "Sam"],
    ] as const) {
      await grant(db, id, name, "member");
    }
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, ada, "Ada", "steward", "county");
    await grant(db, josh, "Josh", "admin");
    const shop = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(shop.ok, true);
    if (!shop.ok) return;
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: shop.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    const county = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      body: { ...did, claim: "Called the county office about the agenda." },
      now,
    });
    assert.equal(county.ok, true);
    const stood = await createPost(db, {
      userId: ada,
      name: "Ada",
      roomId: "county",
      body: { ...did, claim: "Read the county agenda before the meeting." },
      now,
    });
    assert.equal(stood.ok, true);
    const line = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      text: "The agenda packet is on the county site.",
      now,
    });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const chatRemoved = await removeChatMessage(db, {
      userId: ada,
      name: "Ada",
      roomId: "county",
      messageId: line.value.id,
      reason: "doxxing",
      now,
    });
    assert.equal(chatRemoved.ok, true, chatRemoved.ok ? "" : chatRemoved.error);
    const shopLog = await listBoard(db, tom, now);
    const countyLog = await listBoard(db, ada, now);
    const adminLog = await listBoard(db, josh, now);
    const memberLog = await listBoard(db, sam, now);
    assert.equal(shopLog.ok, true);
    assert.equal(countyLog.ok, true);
    assert.equal(adminLog.ok, true);
    assert.equal(memberLog.ok, true);
    if (!shopLog.ok || !countyLog.ok || !adminLog.ok || !memberLog.ok) return;
    assert.deepEqual(
      shopLog.value.removals.map((row) => row.roomChat ?? false),
      [false],
    );
    assert.deepEqual(
      countyLog.value.removals.map((row) => row.roomChat ?? false),
      [true],
    );
    assert.equal(shopLog.value.removals[0]?.reason, "threat");
    assert.equal(countyLog.value.removals[0]?.reason, "doxxing");
    assert.equal(shopLog.value.bans.length, 1);
    assert.equal(countyLog.value.bans.length, 1);
    assert.equal(shopLog.value.bans[0]?.author, "Maria");
    assert.equal(countyLog.value.bans[0]?.reason, "doxxing");
    assert.equal(adminLog.value.removals.length, 2);
    assert.equal(adminLog.value.bans.length, 2);
    assert.deepEqual(memberLog.value.removals, []);
    assert.deepEqual(memberLog.value.bans, []);
    const site = await banMember(db, {
      userId: josh,
      name: "Josh",
      email: "ruth-log@example.com",
      reason: "threat",
      now,
    });
    assert.equal(site.ok, true);
    const shopAfter = await listBoard(db, tom, now);
    const adminAfter = await listBoard(db, josh, now);
    assert.equal(shopAfter.ok, true);
    assert.equal(adminAfter.ok, true);
    if (!shopAfter.ok || !adminAfter.ok) return;
    assert.equal(shopAfter.value.bans.length, 1);
    assert.equal(adminAfter.value.bans.length, 3);
  } finally {
    await close();
  }
});
