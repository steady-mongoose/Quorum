import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { roomCallMember } from "../calls/membership.ts";
import { listChat, sendChat } from "../chat/store.ts";
import { listRoomMembers } from "./members.ts";
import { parseRoomOptions, roomOptions } from "./room-options.ts";
import { createRoom, listBoard, updateRoom } from "./store.ts";
import { createPost } from "./test-posting.ts";
import { ROOM_OPTION_OFF } from "../../src/lib/board/room-options.ts";

const now = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

async function person(db: Db, name: string, roles: [string, string][] = []): Promise<string> {
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

async function join(db: Db, userId: string, roomId: string, daysAgo: number): Promise<void> {
  await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, $3)`, [
    userId,
    roomId,
    new Date(now.getTime() - daysAgo * DAY),
  ]);
}

const hosted = (came: string[]) => ({
  type: "hosted",
  claim: "The lathe night went well and the next one is set.",
  on: "2026-10-22",
  came,
  cardId: `s-${randomUUID().slice(0, 8)}`,
});

test("every room starts without roll call; the other options stay on", async () => {
  const { db, close } = await openTestDb();
  try {
    const rows = await db.query<{ id: string; options: string[] }>(`select id, options from room`);
    assert.ok(rows.length > 0);
    for (const row of rows) assert.deepEqual(row.options, ["members", "chat", "calls"], row.id);
    assert.deepEqual(await roomOptions(db, "shop"), ["members", "chat", "calls"]);
    // A group is not a room row and keeps all four.
    assert.deepEqual(await roomOptions(db, "beekeeping"), ["roll_call", "members", "chat", "calls"]);
  } finally {
    await close();
  }
});

test("only an admin changes what a room includes, and only to known options", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Ada", [["admin", ""]]);
    const steward = await person(db, "Tom", [["steward", "shop"]]);
    const byAdmin = await updateRoom(db, {
      userId: admin,
      id: "shop",
      options: ["roll_call", "members", "chat", "calls"],
      now,
    });
    assert.equal(byAdmin.ok, true);
    if (!byAdmin.ok) return;
    assert.deepEqual(byAdmin.value.options, ["roll_call", "members", "chat", "calls"]);

    const bySteward = await updateRoom(db, { userId: steward, id: "shop", options: [], now });
    assert.deepEqual(bySteward.ok ? null : [bySteward.status, bySteward.error], [
      403,
      "Only an admin can change what a room includes.",
    ]);
    // A steward saving the room unchanged is fine.
    const unchanged = await updateRoom(db, {
      userId: steward,
      id: "shop",
      options: ["calls", "chat", "members", "roll_call"],
      now,
    });
    assert.equal(unchanged.ok, true);

    const unknown = await updateRoom(db, { userId: admin, id: "shop", options: ["likes"], now });
    assert.equal(unknown.ok ? 0 : unknown.status, 400);
    const badNew = await createRoom(db, {
      userId: admin,
      id: "lathe",
      name: "Lathe Night",
      what: "Turning wood on Thursdays.",
      categoryIds: [],
      options: ["streaks"],
      now,
    });
    assert.equal(badNew.ok ? 0 : badNew.status, 400);
    assert.deepEqual(parseRoomOptions(["calls", "roll_call", "calls"]), ["roll_call", "calls"]);
    assert.equal(parseRoomOptions("roll_call"), null);
  } finally {
    await close();
  }
});

test("a room without roll call refuses a roll; with it, the roll is kept", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Ada", [["admin", ""]]);
    const host = await person(db, "Hank");
    await person(db, "Iris");
    const refused = await createPost(db, {
      userId: host,
      name: "Hank",
      roomId: "shop",
      body: hosted(["Hank", "Iris"]),
      now,
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(JSON.stringify(refused), /does not take roll/);

    const noRoll = await createPost(db, {
      userId: host,
      name: "Hank",
      roomId: "shop",
      body: hosted([]),
      now,
    });
    assert.equal(noRoll.ok, true, "a write-up without a roll still posts");

    await updateRoom(db, { userId: admin, id: "shop", options: ["roll_call", "members"], now });
    const kept = await createPost(db, {
      userId: host,
      name: "Hank",
      roomId: "shop",
      body: hosted(["Hank", "Iris"]),
      now,
    });
    assert.equal(kept.ok, true);
  } finally {
    await close();
  }
});

test("chat and calls switch off for the room", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Ada", [["admin", ""]]);
    const ruth = await person(db, "Ruth");
    await join(db, ruth, "shop", 10);
    await updateRoom(db, { userId: admin, id: "shop", options: ["members"], now });
    const listed = await listChat(db, { userId: ruth, roomId: "shop", now });
    assert.deepEqual(listed.ok ? null : [listed.status, listed.error], [404, ROOM_OPTION_OFF.chat]);
    const sent = await sendChat(db, { userId: ruth, name: "Ruth", roomId: "shop", text: "Hello.", now });
    assert.deepEqual(sent.ok ? null : [sent.status, sent.error], [404, ROOM_OPTION_OFF.chat]);
    assert.equal((await roomCallMember(db, ruth, "shop", now)).kind, "hidden");

    await updateRoom(db, { userId: admin, id: "shop", options: ["members", "calls"], now });
    assert.equal((await roomCallMember(db, ruth, "shop", now)).kind, "member");
  } finally {
    await close();
  }
});

test("members see each other in name order; attendance only in a room that takes roll", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Ada", [["admin", ""]]);
    const zeb = await person(db, "Zeb", [["steward", "shop"]]);
    const amos = await person(db, "Amos");
    const outsider = await person(db, "Otto");
    await join(db, zeb, "shop", 20);
    await join(db, amos, "shop", 5);

    const before = await listRoomMembers(db, amos, "shop", now);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.value.rollCall, false);
    assert.deepEqual(
      before.value.members.map((row) => [row.name, row.steward, row.joinedOn, row.attended.length]),
      [
        ["Amos", false, "2026-10-24", 0],
        ["Zeb", true, "2026-10-09", 0],
      ],
    );

    await updateRoom(db, { userId: admin, id: "shop", options: ["roll_call", "members"], now });
    const posted = await createPost(db, {
      userId: zeb,
      name: "Zeb",
      roomId: "shop",
      body: hosted(["Zeb", "Amos"]),
      now,
    });
    assert.equal(posted.ok, true);
    const after = await listRoomMembers(db, amos, "shop", now);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value.rollCall, true);
    const byName = new Map(after.value.members.map((row) => [row.name, row]));
    assert.deepEqual(byName.get("Amos")?.attended, [{ on: "2026-10-22", host: "Zeb", hosted: false }]);
    // Who came is private (Josh, 10:06 PM ET): Amos sees only his own.
    assert.deepEqual(byName.get("Zeb")?.attended, []);
    assert.equal(byName.get("Zeb")?.lastPostedOn, "2026-10-29");
    assert.deepEqual(Object.keys(byName.get("Amos") ?? {}).sort(), [
      "attended",
      "id",
      "joinedOn",
      "lastPostedOn",
      "message",
      "name",
      "steward",
    ]);
    // Amos has been in the room five days: he may write to Zeb, and not to himself.
    assert.equal(byName.get("Zeb")?.message, "open");
    assert.equal(byName.get("Amos")?.message, "none");

    const notIn = await listRoomMembers(db, outsider, "shop", now);
    assert.equal(notIn.ok, false);

    await updateRoom(db, { userId: admin, id: "shop", options: ["roll_call"], now });
    const off = await listRoomMembers(db, amos, "shop", now);
    assert.deepEqual(off.ok ? null : [off.status, off.error], [404, ROOM_OPTION_OFF.members]);
  } finally {
    await close();
  }
});

test("who came is private: host and the room's stewards see it; an admin as an admin and a member see only their own", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = await person(db, "Ada", [["admin", ""]]);
    const sue = await person(db, "Sue", [["steward", "shop"]]);
    const hal = await person(db, "Hal");
    const ann = await person(db, "Ann");
    const ben = await person(db, "Ben");
    const cal = await person(db, "Cal");
    for (const id of [admin, sue, hal, ann, ben, cal]) await join(db, id, "shop", 10);
    await updateRoom(db, { userId: admin, id: "shop", options: ["roll_call", "members"], now });
    const posted = await createPost(db, {
      userId: hal,
      name: "Hal",
      roomId: "shop",
      body: hosted(["Ann", "Ben"]),
      now,
    });
    assert.equal(posted.ok, true);
    if (posted.ok) assert.deepEqual(posted.value.came, ["Ann", "Ben"], "the host's own reply");

    const hostedFor = async (viewer: string) => {
      const board = await listBoard(db, viewer, now, { room: "shop" });
      assert.equal(board.ok, true);
      if (!board.ok) return null;
      return board.value.posts.find((item) => item.type === "hosted") ?? null;
    };
    const cameOnBoard = async (viewer: string) => (await hostedFor(viewer))?.came ?? null;
    const attendedOf = async (viewer: string) => {
      const list = await listRoomMembers(db, viewer, "shop", now);
      assert.equal(list.ok, true);
      if (!list.ok) return {};
      return Object.fromEntries(list.value.members.map((row) => [row.name, row.attended.length]));
    };

    // The host and the room's steward read the whole roll call (Oct 30).
    for (const viewer of [hal, sue]) {
      assert.deepEqual(await cameOnBoard(viewer), ["Ann", "Ben"]);
      const seen = await attendedOf(viewer);
      assert.equal(seen.Ann, 1);
      assert.equal(seen.Ben, 1);
    }
    // An admin, as an admin, gets no names (counts are in the admin summary).
    assert.deepEqual(await cameOnBoard(admin), []);
    const adminSees = await attendedOf(admin);
    for (const name of ["Ann", "Ben", "Hal"]) assert.equal(adminSees[name], 0, name);
    // A member who came gets no names, only youCame, matched on account id.
    assert.deepEqual(await cameOnBoard(ann), []);
    assert.equal((await hostedFor(ann))?.youCame, true);
    assert.equal((await hostedFor(cal))?.youCame, false);
    const annSees = await attendedOf(ann);
    assert.equal(annSees.Ann, 1);
    assert.equal(annSees.Ben, 0);
    assert.equal(annSees.Hal, 0);
    // A member who did not come sees nobody's attendance.
    assert.deepEqual(await cameOnBoard(cal), []);
    const calSees = await attendedOf(cal);
    for (const name of ["Ann", "Ben", "Hal", "Cal"]) assert.equal(calSees[name], 0, name);
    const raw = JSON.stringify(await listBoard(db, cal, now, { room: "shop" }));
    assert.doesNotMatch(raw, /"Ann"|"Ben"/);
  } finally {
    await close();
  }
});
