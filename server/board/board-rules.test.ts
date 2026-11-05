import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { bindCallEviction } from "../calls/evict.ts";
import { createCallStore } from "../calls/store.ts";
import { removeChatMessage, sendChat } from "../chat/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  banMember,
  decideAppeal,
  fileAppeal,
  listBoard,
  markPost,
  openBan,
  REPORTED_REVISE_ERROR,
  removePost,
  revisePost,
  updateRoom,
} from "./store.ts";
import { createPost } from "./test-posting.ts";
import { createPost as filePost } from "./store.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-30T12:00:00.000Z");
const later = new Date(now.getTime() + 1_000);
const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};
const written = (came: string[], named = "") => ({
  type: "hosted",
  claim: "The lathe night went well and the next one is set.",
  on: "2026-10-22",
  came,
  named,
  cardId: `s-${randomUUID().slice(0, 8)}`,
});

async function person(db: Db, name: string, roles: [string, string][] = []) {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`, now],
  );
  for (const [role, roomId] of [["member", ""] as [string, string], ...roles]) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
      [randomUUID(), id, name, role, roomId, new Date(now.getTime() - 30 * DAY)],
    );
  }
  return id;
}

async function join(db: Db, userId: string, ...rooms: string[]) {
  for (const roomId of rooms) {
    await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
      userId,
      roomId,
      now,
    ]);
  }
}

async function takeRoll(db: Db, adminId: string, roomId: string) {
  const options = ["roll_call", "members", "chat", "calls"];
  assert.equal((await updateRoom(db, { userId: adminId, id: roomId, options, now })).ok, true);
}

async function dropRoll(db: Db, adminId: string, roomId: string) {
  const options = ["members", "chat", "calls"];
  assert.equal((await updateRoom(db, { userId: adminId, id: roomId, options, now })).ok, true);
}

async function post(db: Db, userId: string, name: string, roomId: string, claim: string) {
  const filed = await createPost(db, {
    userId,
    name,
    roomId,
    body: { ...did, claim },
    now,
  });
  if (!filed.ok) throw new Error(filed.error);
  return filed.value.id;
}

async function remove(db: Db, by: string, name: string, postId: string, at = now, reason = "threat") {
  const removed = await removePost(db, { userId: by, name, postId, reason, now: at });
  if (!removed.ok) throw new Error(removed.error);
  return removed.value;
}

async function chatLine(db: Db, userId: string, name: string, roomId: string, text: string) {
  const sent = await sendChat(db, { userId, name, roomId, text, now });
  if (!sent.ok) throw new Error(sent.error);
  return sent.value.id;
}

async function lift(db: Db, author: string, name: string, postId: string, steward: string) {
  const filed = await fileAppeal(db, {
    userId: author,
    name,
    postId,
    kind: "removal",
    reason: "The post named no one and threatened no one.",
    now,
  });
  if (!filed.ok) throw new Error(filed.error);
  const decided = await decideAppeal(db, {
    userId: steward,
    name: "Steward",
    appealId: filed.value.id,
    decision: "lift",
    reason: "The post broke no rule after all.",
    now,
  });
  if (!decided.ok) throw new Error(decided.error);
  return decided.value;
}

/** Two stewards in two rooms and a member in both. */
async function twoRooms(db: Db) {
  const tom = await person(db, "Tom", [["steward", "shop"]]);
  const ada = await person(db, "Ada", [["steward", "county"]]);
  const maria = await person(db, "Maria");
  await join(db, tom, "shop");
  await join(db, ada, "county");
  await join(db, maria, "shop", "county");
  return { tom, ada, maria };
}

test("with roll off nobody gets who came from the board, and turning it back on shows it", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Josh", [["admin", ""]]);
    const steward = await person(db, "Tom", [["steward", "shop"]]);
    const hank = await person(db, "Hank");
    const iris = await person(db, "Iris");
    await join(db, admin, "shop");
    await join(db, steward, "shop");
    await join(db, hank, "shop");
    await join(db, iris, "shop");
    await takeRoll(db, admin, "shop");
    const filed = await createPost(db, {
      userId: hank,
      name: "Hank",
      roomId: "shop",
      body: written(["Hank", "Iris"], "Iris"),
      now,
    });
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;

    const shownTo = async (viewer: string) => {
      const board = await listBoard(db, viewer, now, { room: "shop" });
      assert.equal(board.ok, true);
      if (!board.ok) return null;
      const row = board.value.posts.find((item) => item.id === filed.value.id);
      return { came: row?.came, named: row?.named };
    };
    assert.deepEqual(await shownTo(iris), { came: ["Hank", "Iris"], named: "Iris" });

    await dropRoll(db, admin, "shop");
    for (const viewer of [iris, hank, steward, admin]) {
      assert.deepEqual(await shownTo(viewer), { came: [], named: "" });
    }
    const stored = await db.query<{ came: string[]; named: string }>(
      `select came, named from board_post where id = $1`,
      [filed.value.id],
    );
    assert.deepEqual(stored[0], { came: ["Hank", "Iris"], named: "Iris" });

    await takeRoll(db, admin, "shop");
    assert.deepEqual(await shownTo(iris), { came: ["Hank", "Iris"], named: "Iris" });
  } finally {
    await close();
  }
});

test("with roll off a mark, a revision and a lifted appeal do not hand back who came", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Josh", [["admin", ""]]);
    const steward = await person(db, "Tom", [["steward", "shop"]]);
    const hank = await person(db, "Hank");
    const iris = await person(db, "Iris");
    await join(db, admin, "shop");
    await join(db, hank, "shop");
    await join(db, iris, "shop");
    await takeRoll(db, admin, "shop");
    const filed = await createPost(db, {
      userId: hank,
      name: "Hank",
      roomId: "shop",
      body: written(["Hank", "Iris"], "Iris"),
      now,
    });
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    if (!filed.ok) return;
    await dropRoll(db, admin, "shop");

    const marked = await markPost(db, {
      userId: steward,
      name: "Tom",
      postId: filed.value.id,
      mark: "sloppy",
      reason: "The write-up does not say where it met.",
      now,
    });
    assert.equal(marked.ok, true, marked.ok ? "" : marked.error);
    if (marked.ok) assert.deepEqual(marked.value.post.came, []);

    // A past write-up can still be revised, though roll is off and names are stored.
    const revised = await revisePost(db, {
      userId: hank,
      name: "Hank",
      postId: filed.value.id,
      claim: "The lathe night went well at the shop and the next one is set.",
      reason: "",
      now,
    });
    assert.equal(revised.ok, true, revised.ok ? "" : revised.error);
    if (revised.ok) {
      assert.deepEqual(revised.value.post.came, []);
      assert.equal(revised.value.post.named, "");
    }
    const stored = await db.query<{ came: string[] }>(`select came from board_post where id = $1`, [
      filed.value.id,
    ]);
    assert.deepEqual(stored[0]?.came, ["Hank", "Iris"]);

    await remove(db, steward, "Tom", filed.value.id);
    const lifted = await lift(db, hank, "Hank", filed.value.id, steward);
    assert.deepEqual(lifted.posts[0]?.came, []);
    assert.equal(lifted.posts[0]?.named, "");
  } finally {
    await close();
  }
});

test("a reported post cannot be revised until the report closes, the same as delete", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = await person(db, "Maria");
    await join(db, maria, "shop");
    const postId = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    await db.query(
      `insert into member_report
         (id, room_id, subject_kind, subject_id, reporter_user_id, reason, status, created_at)
       values ('r1', 'shop', 'post', $1, $2, 'threat', 'open', $3)`,
      [postId, maria, now],
    );
    const edit = {
      userId: maria,
      name: "Maria",
      postId,
      claim: "A harmless version of the post.",
      reason: "Nothing to see here at all.",
      now,
    };
    assert.deepEqual(await revisePost(db, edit), {
      ok: false,
      status: 409,
      error: REPORTED_REVISE_ERROR,
    });
    const rows = await db.query<{ claim: string }>(`select claim from board_post where id = $1`, [
      postId,
    ]);
    assert.equal(rows[0]?.claim, "Sharpened the chisels in the shop.");

    await db.query(`update member_report set status = 'closed' where id = 'r1'`);
    assert.equal((await revisePost(db, edit)).ok, true);
  } finally {
    await close();
  }
});

test("a second removal in another room closes the account; the first bars one room", async () => {
  const { db, close } = await openTestDb();
  const calls = createCallStore();
  bindCallEviction(calls);
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");

    const first = await remove(db, tom, "Tom", shopPost);
    assert.equal(first.ban.strikes, 1);
    assert.equal(await openBan(db, maria, now), null, "a first removal is a room bar");
    assert.equal((await openBan(db, maria, now, "shop"))?.strikes, 1);

    calls.join("pantry", { id: maria, name: "Maria" }, now.getTime());
    const second = await remove(db, ada, "Ada", countyPost, later);
    assert.equal(second.ban.strikes, 2);
    assert.equal(
      calls.poll("pantry", maria, 0, now.getTime() + 1).ok,
      false,
      "a closed account leaves every call",
    );

    const years = 90 * 365 * DAY;
    const closed = await openBan(db, maria, new Date(now.getTime() + years));
    assert.equal(closed?.strikes, 2);
    const board = await listBoard(db, maria, later);
    assert.equal(board.ok ? "" : board.error, "banned");
  } finally {
    bindCallEviction(createCallStore());
    await close();
  }
});

test("a room chat removal and a post removal in different rooms count together", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const line = await chatLine(db, maria, "Maria", "shop", "The spare blade is in the drawer.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    const chat = await removeChatMessage(db, {
      userId: tom,
      name: "Tom",
      roomId: "shop",
      messageId: line,
      reason: "threat",
      now,
    });
    assert.equal(chat.ok, true);
    assert.equal(await openBan(db, maria, now), null);

    await remove(db, ada, "Ada", countyPost, later);
    assert.equal((await openBan(db, maria, later))?.strikes, 2);
  } finally {
    await close();
  }
});

test("a second room chat removal closes the account too", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const line = await chatLine(db, maria, "Maria", "county", "The agenda is on the county site.");
    await remove(db, tom, "Tom", shopPost);
    const chat = await removeChatMessage(db, {
      userId: ada,
      name: "Ada",
      roomId: "county",
      messageId: line,
      reason: "threat",
      now: later,
    });
    assert.equal(chat.ok, true, chat.ok ? "" : chat.error);
    if (chat.ok) assert.equal(chat.value.ban?.strikes, 2);
    assert.equal((await openBan(db, maria, later))?.strikes, 2);

    // Lifting the post removal leaves the chat line's removal: a room bar, not a closure.
    await lift(db, maria, "Maria", shopPost, tom);
    assert.equal(await openBan(db, maria, later), null);
    assert.equal((await openBan(db, maria, later, "county"))?.strikes, 1);
    assert.equal(await openBan(db, maria, new Date(now.getTime() + 31 * DAY), "county"), null);
  } finally {
    await close();
  }
});

test("a removal lifted on appeal does not count toward closing the account", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    await remove(db, tom, "Tom", shopPost);
    await lift(db, maria, "Maria", shopPost, tom);

    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    const again = await remove(db, ada, "Ada", countyPost, later);
    assert.equal(again.ban.strikes, 1);
    assert.equal(await openBan(db, maria, later), null);
    assert.equal((await openBan(db, maria, later, "county"))?.strikes, 1);

    // In the same room too: the lifted strike is not carried on the old bar.
    const shopAgain = await post(db, maria, "Maria", "shop", "Oiled the plane irons this week.");
    await lift(db, maria, "Maria", countyPost, ada);
    const third = await remove(db, tom, "Tom", shopAgain, later);
    assert.equal(third.ban.strikes, 1);
    assert.equal(await openBan(db, maria, later), null);
  } finally {
    await close();
  }
});

test("lifting the removal that closed the account reopens it; the first room bar stands", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    await remove(db, tom, "Tom", shopPost);
    await remove(db, ada, "Ada", countyPost, later);
    assert.equal((await openBan(db, maria, later))?.strikes, 2);

    await lift(db, maria, "Maria", countyPost, ada);
    assert.equal(await openBan(db, maria, later), null);
    assert.equal(await openBan(db, maria, later, "county"), null);
    assert.equal((await openBan(db, maria, later, "shop"))?.strikes, 1);
  } finally {
    await close();
  }
});

test("lifting the first removal turns the closure into the second one's room bar", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    await remove(db, tom, "Tom", shopPost);
    await remove(db, ada, "Ada", countyPost, later);

    await lift(db, maria, "Maria", shopPost, tom);
    assert.equal(await openBan(db, maria, later), null);
    assert.equal(await openBan(db, maria, later, "shop"), null);
    assert.equal((await openBan(db, maria, later, "county"))?.strikes, 1);
    assert.equal(await openBan(db, maria, new Date(later.getTime() + 31 * DAY), "county"), null);
  } finally {
    await close();
  }
});

test("a lift does not reopen a CSAM closure", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const shopPost = await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    await remove(db, tom, "Tom", shopPost);
    await remove(db, ada, "Ada", countyPost, later, "csam");

    await lift(db, maria, "Maria", shopPost, tom);
    assert.equal((await openBan(db, maria, later))?.reason, "csam");
  } finally {
    await close();
  }
});

test("a manual steward bar with no removal stays in its room", async () => {
  const { db, close } = await openTestDb();
  try {
    const { tom, ada, maria } = await twoRooms(db);
    const email = await db.query<{ email: string }>(`select email from "user" where id = $1`, [
      maria,
    ]);
    await post(db, maria, "Maria", "shop", "Sharpened the chisels in the shop.");
    const countyPost = await post(db, maria, "Maria", "county", "Called the county clerk today.");
    await remove(db, ada, "Ada", countyPost);

    const barred = await banMember(db, {
      userId: tom,
      name: "Tom",
      email: email[0]?.email ?? "",
      reason: "threat",
      roomId: "shop",
      now,
    });
    assert.equal(barred.ok, true, barred.ok ? "" : barred.error);
    if (barred.ok) assert.equal(barred.value.strikes, 1);
    assert.equal(await openBan(db, maria, now), null);
    assert.equal((await openBan(db, maria, now, "shop"))?.strikes, 1);
  } finally {
    await close();
  }
});

test("a non-admin host names members of the room and nobody else", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Josh", [["admin", ""]]);
    const hank = await person(db, "Hank");
    const iris = await person(db, "Iris");
    await person(db, "Otto");
    await join(db, admin, "shop");
    await join(db, hank, "shop");
    await join(db, iris, "shop");
    await takeRoll(db, admin, "shop");

    const kept = await filePost(db, {
      userId: hank,
      name: "Hank",
      roomId: "shop",
      body: written(["Hank", "Iris"], "Iris"),
      now,
    });
    assert.equal(kept.ok, true, kept.ok ? "" : kept.error);
    if (kept.ok) assert.deepEqual(kept.value.came, ["Hank", "Iris"]);

    for (const stranger of ["Otto", "Nobody At All"]) {
      const refused = await filePost(db, {
        userId: hank,
        name: "Hank",
        roomId: "shop",
        body: written(["Iris", stranger]),
        now,
      });
      assert.deepEqual(refused.ok ? null : [refused.status, refused.error], [
        400,
        `${stranger} is not a member of this room.`,
      ]);
    }
  } finally {
    await close();
  }
});
