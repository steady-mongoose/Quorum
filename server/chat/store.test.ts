import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listBoard, openBan, removePost, createPost } from "../board/store.ts";
import { bindCallEviction } from "../calls/evict.ts";
import { createCallStore } from "../calls/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { CHAT_UNAVAILABLE } from "./ready.ts";
import { listChat, removeChatMessage, sendChat } from "./store.ts";

const now = new Date("2026-10-21T15:00:00Z");
const root = fileURLToPath(new URL("../..", import.meta.url));

const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

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

async function stand(db: Db, userId: string, roomId: string) {
  await db.query(`insert into room_member (room_id, user_id) values ($1, $2)`, [roomId, userId]);
}

async function seatOwner(db: Db, id: string, name: string, email: string) {
  await user(db, id, name, email);
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair) values ($1, true, true, true)`,
    [id],
  );
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [id]);
}

test("migration 0013 is the room transcript and leaves the 1:1 mailbox alone", () => {
  const sql = readFileSync(`${root}/migrations/0013_room_chat.sql`, "utf8");
  assert.match(sql, /Numbered 0013/);
  assert.match(sql, /room_chat_message/);
  assert.match(sql, /room_chat_removal/);
  assert.match(sql, /0006 is reserved/);
  assert.match(sql, /function anonymize_room_chat_user/);
  assert.match(sql, /trigger anonymize_room_chat_user/);
  assert.equal(/function anonymize_board_user/.test(sql), false);
  assert.equal(/create table[^;]*\bdm_/i.test(sql), false);
  for (const banned of ["like", "likes", "reaction", "score", "reshare", "rank"]) {
    assert.equal(sql.toLowerCase().includes(banned), false, banned);
  }
});

test("chat is only for a room member, and reading it does not join the room", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    const stranger = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, stranger, "Stranger", "stranger@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await stand(db, maria, "shop");

    const outsider = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(outsider.ok, false);
    if (outsider.ok) return;
    assert.equal(outsider.status, 403);
    assert.equal(outsider.error, "You are not in this room.");

    const unread = await db.query<{ user_id: string }>(
      `select user_id from room_member where user_id = $1`,
      [josh],
    );
    assert.equal(unread.length, 0);

    const refused = await sendChat(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      text: "Is the bench free tonight?",
      now,
    });
    assert.equal(refused.ok, false);

    const notAMember = await listChat(db, { userId: stranger, roomId: "shop", now });
    assert.equal(notAMember.ok, false);
    if (notAMember.ok) return;
    assert.equal(notAMember.status, 403);

    const otherRoom = await listChat(db, { userId: maria, roomId: "county", now });
    assert.equal(otherRoom.ok, false);
    if (otherRoom.ok) return;
    assert.equal(otherRoom.error, "You are not in this room.");

    const sent = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The bench is free after seven.",
      now,
    });
    assert.equal(sent.ok, true);
    const seen = await listChat(db, { userId: maria, roomId: "shop", now });
    assert.equal(seen.ok, true);
    if (!seen.ok) return;
    assert.equal(seen.value.messages.length, 1);
    assert.equal(seen.value.messages[0]?.author, "Maria");
  } finally {
    await close();
  }
});

test("messages stay in time order even when the clock steps back", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await stand(db, maria, "shop");
    await stand(db, josh, "shop");

    const lines = [
      {
        userId: maria,
        name: "Maria",
        text: "First, the chisels.",
        at: new Date(now.getTime() + 5_000),
      },
      {
        userId: josh,
        name: "Josh",
        text: "Second, the bench.",
        at: new Date(now.getTime() + 1_000),
      },
      {
        userId: maria,
        name: "Maria",
        text: "Third, the oil.",
        at: new Date(now.getTime() + 1_000),
      },
    ];
    for (const line of lines) {
      const sent = await sendChat(db, { ...line, roomId: "shop", now: line.at, text: line.text });
      assert.equal(sent.ok, true, line.text);
    }
    const page = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.deepEqual(
      page.value.messages.map((message) => message.text),
      ["First, the chisels.", "Second, the bench.", "Third, the oil."],
    );
    const times = page.value.messages.map((message) => message.at);
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
    );
    const seqs = page.value.messages.map((message) => message.seq);
    assert.deepEqual(
      seqs,
      [...seqs].sort((a, b) => a - b),
    );

    const latest = page.value.messages.at(-1);
    assert.ok(latest);
    const newer = await listChat(db, {
      userId: maria,
      roomId: "shop",
      now,
      after: latest.seq,
    });
    assert.equal(newer.ok, true);
    if (!newer.ok) return;
    assert.equal(newer.value.messages.length, 0);

    const follow = await sendChat(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      text: "Fourth, we stop.",
      now: new Date(now.getTime() + 9_000),
    });
    assert.equal(follow.ok, true);
    const polled = await listChat(db, {
      userId: maria,
      roomId: "shop",
      now,
      after: latest.seq,
    });
    assert.equal(polled.ok, true);
    if (!polled.ok) return;
    assert.deepEqual(
      polled.value.messages.map((message) => message.text),
      ["Fourth, we stop."],
    );
    assert.equal(polled.value.messages[0]!.seq > latest.seq, true);
  } finally {
    await close();
  }
});

test("a removed or banned member loses the room on the next request", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await stand(db, maria, "shop");
    await stand(db, josh, "shop");
    const sent = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "I left the square on the bench.",
      now,
    });
    assert.equal(sent.ok, true);

    await db.query(`delete from room_member where room_id = 'shop' and user_id = $1`, [josh]);
    const removed = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(removed.ok, false);
    if (removed.ok) return;
    assert.equal(removed.error, "You are not in this room.");
    const removedSend = await sendChat(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      text: "Still here.",
      now,
    });
    assert.equal(removedSend.ok, false);

    const still = await listChat(db, { userId: maria, roomId: "shop", now });
    assert.equal(still.ok, true);
    if (!still.ok) return;
    assert.equal(still.value.messages.length, 1);

    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Maria', 'threat', 'Tom', 1, $3, $4)`,
      [randomUUID(), maria, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), now],
    );
    const barred = await listChat(db, { userId: maria, roomId: "shop", now });
    assert.equal(barred.ok, false);
    if (barred.ok) return;
    assert.equal(barred.status, 403);
    assert.equal(barred.error, "banned");
    assert.equal(barred.ban?.reason, "threat");
    const barredSend = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "One more line.",
      now,
    });
    assert.equal(barredSend.ok, false);
    if (barredSend.ok) return;
    assert.equal(barredSend.error, "banned");
  } finally {
    await close();
  }
});

test("a steward hard removal hides the line, bars the account, and shares the strike ladder", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const owner = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await seatOwner(db, owner, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    for (const id of [maria, tom, owner]) await stand(db, id, "shop");

    const english = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "道路が閉まっている。",
      now,
    });
    assert.equal(english.ok, false);
    if (english.ok) return;
    assert.equal(english.error, "Write the message in English.");

    const liked = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The road past the mill is closed.",
      now,
    });
    assert.equal(liked.ok, true);
    if (!liked.ok) return;
    assert.equal("score" in liked.value, false);
    assert.equal("like" in liked.value, false);

    const memberRemove = await removeChatMessage(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      messageId: liked.value.id,
      reason: "threat",
      now,
    });
    assert.equal(memberRemove.ok, false);
    if (memberRemove.ok) return;
    assert.equal(memberRemove.status, 403);

    const ownerLine = await sendChat(db, {
      userId: owner,
      name: "Josh",
      roomId: "shop",
      text: "The hearing moved to Thursday.",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(ownerLine.ok, true);
    if (!ownerLine.ok) return;
    const blocked = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: ownerLine.value.id,
      reason: "threat",
      now,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error, "The owner cannot be barred.");

    const second = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "Bring the spare blade.",
      now: new Date(now.getTime() + 2_000),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now: new Date(now.getTime() - 60_000),
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;

    const removed = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: liked.value.id,
      reason: "threat",
      now: new Date(now.getTime() + 3_000),
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.removal.roomChat, true);
    assert.equal(removed.value.ban?.strikes, 1);

    const after = await listChat(db, {
      userId: tom,
      roomId: "shop",
      now: new Date(now.getTime() + 3_000),
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(
      after.value.messages.some((message) => message.id === liked.value.id),
      false,
    );
    assert.equal(after.value.hidden.includes(liked.value.id), true);
    assert.equal(
      after.value.messages.some((message) => message.text === "The hearing moved to Thursday."),
      true,
    );

    const mariaBan = await openBan(db, maria, new Date(now.getTime() + 3_000), "shop");
    assert.equal(mariaBan?.strikes, 1);
    const mariaRead = await listChat(db, {
      userId: maria,
      roomId: "shop",
      now: new Date(now.getTime() + 3_000),
    });
    assert.equal(mariaRead.ok, false);
    if (mariaRead.ok) return;
    assert.equal(mariaRead.error, "banned");

    const secondStrike = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "porn",
      now: new Date(now.getTime() + 4_000),
    });
    assert.equal(secondStrike.ok, true);
    if (!secondStrike.ok) return;
    assert.equal(secondStrike.value.ban.strikes, 2);

    const log = await listBoard(db, tom, new Date(now.getTime() + 4_000));
    assert.equal(log.ok, true);
    if (!log.ok) return;
    assert.equal(
      log.value.removals.some((row) => row.roomChat === true && row.author === "Maria"),
      true,
    );
    const ada = randomUUID();
    await user(db, ada, "Ada", "ada@example.com");
    await grant(db, ada, "Ada", "member");
    const memberLog = await listBoard(db, ada, new Date(now.getTime() + 4_000));
    assert.equal(memberLog.ok, true);
    if (!memberLog.ok) return;
    assert.equal(memberLog.value.removals.length, 0);

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('room_chat_message', 'room_chat_removal')`,
    );
    const names = columns.map((row) => row.column_name);
    for (const banned of ["like", "likes", "reaction", "score", "reshare", "rank"]) {
      assert.equal(names.includes(banned), false, banned);
    }
  } finally {
    await close();
  }
});

test("a chat removal and a later post removal are the second strike, in either order", async () => {
  const { db, close } = await openTestDb();
  try {
    const ruth = randomUUID();
    const tom = randomUUID();
    await user(db, ruth, "Ruth", "ruth@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await grant(db, ruth, "Ruth", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "county");
    await stand(db, ruth, "county");
    await stand(db, tom, "county");
    const line = await sendChat(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "county",
      text: "The hearing is still on the calendar.",
      now,
    });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const posted = await createPost(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "county",
      body: { ...did, claim: "Called the county clerk." },
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const first = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.ban.strikes, 1);
    const second = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "county",
      messageId: line.value.id,
      reason: "csam",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.ban?.strikes, 2);
    assert.equal(second.value.ban?.pendingReview, true, "a steward's second strike suspends and flags for an admin");
    const flagged = await db.query<{ strikes: number; status: string }>(
      `select strikes, status from ban_review where user_id = $1`,
      [ruth],
    );
    assert.deepEqual(flagged, [{ strikes: 2, status: "open" }]);
    const suspended = await openBan(db, ruth, new Date(now.getTime() + 1_000));
    assert.equal(suspended?.strikes, 2, "suspended site-wide at once, pending an admin");
  } finally {
    await close();
  }
});

test("removing a room line drops that member from that room's call", async () => {
  const { db, close } = await openTestDb();
  const calls = createCallStore();
  bindCallEviction(calls);
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const ruth = randomUUID();
    await user(db, maria, "Maria", "maria-call@example.com");
    await user(db, tom, "Tom", "tom-call@example.com");
    await user(db, ruth, "Ruth", "ruth-call@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    await grant(db, ruth, "Ruth", "member");
    for (const id of [maria, tom, ruth]) {
      await stand(db, id, "shop");
      await stand(db, id, "county");
    }
    const at = now.getTime();
    calls.join("shop", { id: maria, name: "Maria" }, at);
    calls.join("county", { id: maria, name: "Maria" }, at);
    calls.join("shop", { id: ruth, name: "Ruth" }, at);
    const line = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The spare blade is in the drawer.",
      now,
    });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const removed = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: line.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    assert.equal(calls.poll("shop", maria, 0, at + 1).ok, false);
    assert.equal(calls.poll("county", maria, 0, at + 1).ok, true);
    const shopBan = await openBan(db, maria, now, "shop");
    assert.equal(shopBan?.strikes, 1);
    assert.equal(await openBan(db, maria, now), null);
    const shopChat = await listChat(db, { userId: maria, roomId: "shop", now });
    assert.equal(shopChat.ok, false);
    if (shopChat.ok) return;
    assert.equal(shopChat.error, "banned");
    const shopSend = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "One more line in the shop.",
      now,
    });
    assert.equal(shopSend.ok, false);
    if (shopSend.ok) return;
    assert.equal(shopSend.error, "banned");
    const countyChat = await listChat(db, { userId: maria, roomId: "county", now });
    assert.equal(countyChat.ok, true);
    const countyLine = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "county",
      text: "The county line is still open.",
      now,
    });
    assert.equal(countyLine.ok, true);
    assert.equal(calls.poll("shop", ruth, 0, at + 1).ok, true);
  } finally {
    bindCallEviction(createCallStore());
    await close();
  }
});

test("a roomless steward grant cannot remove a line, and a steward acts only in that room", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria-room@example.com");
    await user(db, tom, "Tom", "tom-room@example.com");
    await user(db, josh, "Josh", "josh-room@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "admin");
    await grant(db, tom, "Tom", "steward", "");
    await stand(db, maria, "shop");
    await stand(db, tom, "shop");
    await stand(db, josh, "shop");
    await stand(db, tom, "county");
    const line = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The spare blade is in the drawer.",
      now,
    });
    assert.equal(line.ok, true);
    if (!line.ok) return;
    const second = await sendChat(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      text: "The oil is on the top shelf.",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const blank = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: line.value.id,
      reason: "threat",
      now,
    });
    assert.equal(blank.ok, false);
    if (blank.ok) return;
    assert.equal(blank.error, "Only a steward can remove a message.");

    await grant(db, tom, "Tom", "steward", "county");
    const otherRoom = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: line.value.id,
      reason: "threat",
      now,
    });
    assert.equal(otherRoom.ok, false);
    if (otherRoom.ok) return;
    assert.equal(otherRoom.error, "A steward can remove a message only in a room they steward.");
    const board = await listBoard(db, tom, now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.deepEqual(board.value.me.stewardRooms, ["county"]);

    await grant(db, tom, "Tom", "steward", "shop");
    const removed = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: line.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    const byAdmin = await removeChatMessage(db, {
      userId: josh,
      name: "Josh",
      roomId: "shop",
      messageId: second.value.id,
      reason: "porn",
      now: new Date(now.getTime() + 2_000),
    });
    assert.equal(byAdmin.ok, true);
  } finally {
    await close();
  }
});

test("deleting an account keeps the line and drops the name", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria-gone@example.com");
    await user(db, josh, "Josh", "josh-gone@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await stand(db, maria, "shop");
    await stand(db, josh, "shop");
    const sent = await sendChat(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      text: "The oil is on the top shelf.",
      now,
    });
    assert.equal(sent.ok, true);
    await db.query(`delete from "user" where id = $1`, [maria]);
    const page = await listChat(db, { userId: josh, roomId: "shop", now });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.equal(page.value.messages[0]?.author, "Removed member");
    assert.equal(page.value.messages[0]?.text, "The oil is on the top shelf.");
    const row = await db.query<{ author_user_id: string | null }>(
      `select author_user_id from room_chat_message where room_id = 'shop'`,
    );
    assert.equal(row[0]?.author_user_id, null);
    const functions = await db.query<{ proname: string; def: string }>(
      `select p.proname, pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('anonymize_board_user', 'anonymize_room_chat_user')`,
    );
    assert.deepEqual(functions.map((row) => row.proname).sort(), [
      "anonymize_board_user",
      "anonymize_room_chat_user",
    ]);
    const boardFn = functions.find((row) => row.proname === "anonymize_board_user");
    assert.equal(boardFn?.def.includes("room_chat"), false);
    const triggers = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger
       where tgrelid = '"user"'::regclass and not tgisinternal
         and tgname in ('anonymize_board_user', 'anonymize_room_chat_user')`,
    );
    assert.deepEqual(triggers.map((row) => row.tgname).sort(), [
      "anonymize_board_user",
      "anonymize_room_chat_user",
    ]);
  } finally {
    await close();
  }
});

test("the board still loads when the chat tables are missing", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const tom = randomUUID();
    await user(db, maria, "Maria", "maria-early@example.com");
    await user(db, tom, "Tom", "tom-early@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, tom, "Tom", "member");
    await grant(db, tom, "Tom", "steward", "shop");
    await stand(db, maria, "shop");
    await stand(db, tom, "shop");
    const posted = await createPost(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      body: did,
      now,
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    await db.query(`drop table room_chat_removal, room_chat_message cascade`);
    const board = await listBoard(db, tom, now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(
      board.value.posts.some((post) => post.id === posted.value.id),
      true,
    );
    const removed = await removePost(db, {
      userId: tom,
      name: "Tom",
      postId: posted.value.id,
      reason: "threat",
      now,
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.ban.strikes, 1);
    const chat = await listChat(db, { userId: tom, roomId: "shop", now });
    assert.equal(chat.ok, false);
    if (chat.ok) return;
    assert.equal(chat.status, 503);
    assert.equal(chat.error, CHAT_UNAVAILABLE);
    const sent = await sendChat(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      text: "The bench is clear.",
      now,
    });
    assert.equal(sent.ok, false);
    if (sent.ok) return;
    assert.equal(sent.status, 503);
    assert.equal(sent.error, CHAT_UNAVAILABLE);
  } finally {
    await close();
  }
});
