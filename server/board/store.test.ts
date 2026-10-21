import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { bindCallEviction } from "../calls/evict.ts";
import { createCallStore } from "../calls/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  banMember,
  closeAsked,
  createPost,
  createRoom,
  listBoard,
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

async function grant(db: Db, userId: string, name: string, role: "member" | "steward" | "admin") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
    [randomUUID(), userId, name, role, now],
  );
}

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
    assert.deepEqual(
      rooms.map((room) => room.id).slice(0, 10),
      [
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
      ],
    );
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

    await grant(db, tom, "Tom", "steward");
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
    const later = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const again = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
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
    await grant(db, tom, "Tom", "steward");
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
    await grant(db, tom, "Tom", "steward");
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
    assert.equal(barred.ok, false);
    if (barred.ok) return;
    assert.equal(barred.status, 403);
    assert.equal(barred.error, "banned");
    assert.equal(barred.ban?.reason, "threat");
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
    await grant(db, tom, "Tom", "steward");
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
    const dispatch = await db.query<{ name: string }>(`select name from room where id = 'dispatch'`);
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
    await grant(db, tom, "Tom", "steward");
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
    assert.equal(first.value.posts.some((post) => post.room === "county"), false);
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
    await grant(db, steward, "Tom", "steward");
    await grant(db, peer, "Ruth", "member");
    await grant(db, peer, "Ruth", "steward");

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

    const adminRemovesSteward = await removePost(db, {
      userId: admin,
      name: "Ada",
      postId: peerPost.value.id,
      reason: "csam",
      now,
    });
    assert.equal(adminRemovesSteward.ok, true);
  } finally {
    await close();
  }
});

test("a ban and a removal drop that person from every live call", async () => {
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
    await grant(db, steward, "Tom", "steward");
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
    assert.equal(calls.poll("county", member, 0, at + 1).ok, false);
    assert.equal(calls.poll("shop", other, 0, at + 1).ok, true);

    const banned = await banMember(db, {
      userId: steward,
      name: "Tom",
      email: "ruth-call@example.com",
      reason: "porn",
      now,
    });
    assert.equal(banned.ok, true);
    assert.equal(calls.poll("shop", other, 0, at + 2).ok, false);
    assert.equal(calls.poll("county", other, 0, at + 2).ok, false);
    assert.equal(calls.poll("shop", owner, 0, at + 2).ok, true);
  } finally {
    bindCallEviction(createCallStore());
    await close();
  }
});
