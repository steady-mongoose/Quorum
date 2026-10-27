import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { LAST_STEWARD_ERROR, NO_STEWARD_ERROR } from "../../src/lib/board/access-rules.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { grantAccess, joinRoom, readAccessLog } from "./places-store.ts";
import { banMember, createRoom } from "./store.ts";
import { liveStewards } from "../../src/lib/board/access-rules.ts";

// Charter decision, Oct 27, 2026: a room can't exist unless a steward manages it.

const now = new Date("2026-10-27T13:00:00Z");
const at = (s: number) => new Date(now.getTime() + s * 1000);

async function person(db: Db, name: string, roles: string[] = ["member"]) {
  const id = randomUUID();
  const email = `${name.toLowerCase()}@example.com`;
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
  for (const role of roles) {
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
      [randomUUID(), id, name, role, now],
    );
  }
  return { id, email };
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  const josh = await person(db, "Josh", ["member", "admin"]);
  await db.query(
    `insert into member_role (user_id, is_council, is_council_chair) values ($1, true, true)`,
    [josh.id],
  );
  const tom = await person(db, "Tom");
  const ann = await person(db, "Ann");
  const sam = await person(db, "Sam");
  return { ...opened, josh, tom, ann, sam };
}

const access = (
  userId: string,
  extra: Partial<Parameters<typeof grantAccess>[1]>,
): Parameters<typeof grantAccess>[1] => ({
  userId,
  action: "",
  email: "",
  roomId: "",
  inviterEmail: "",
  stewardEmail: "",
  role: "",
  now: at(10),
  ...extra,
});

test("a room is made with its steward, or not at all", async () => {
  const { db, close, josh, tom, ann } = await setup();
  try {
    const bare = await createRoom(db, {
      userId: josh.id,
      categoryIds: ["men"],
      id: "bench",
      name: "The bench",
      what: "Saturday bench work.",
      now,
    });
    assert.equal(bare.ok, false);
    if (!bare.ok) assert.equal(bare.error, NO_STEWARD_ERROR);

    const self = await createRoom(db, {
      userId: josh.id,
      categoryIds: ["men"],
      id: "bench",
      name: "The bench",
      what: "Saturday bench work.",
      stewardEmail: tom.email,
      inviterEmail: josh.email,
      now,
    });
    assert.equal(self.ok, false, "the approver cannot also vouch");
    const rooms = await db.query(`select id from room where id = 'bench'`);
    assert.equal(rooms.length, 0, "a refused steward rolls the room back");

    const made = await createRoom(db, {
      userId: josh.id,
      categoryIds: ["men"],
      id: "bench",
      name: "The bench",
      what: "Saturday bench work.",
      stewardEmail: tom.email,
      inviterEmail: ann.email,
      now,
    });
    assert.equal(made.ok, true);
    assert.deepEqual(liveStewards(await readAccessLog(db), "bench"), [tom.id]);
  } finally {
    await close();
  }
});

test("the last steward cannot be revoked, barred, or leave without a replacement", async () => {
  const { db, close, josh, tom, ann, sam } = await setup();
  try {
    const made = await createRoom(db, {
      userId: josh.id,
      categoryIds: ["men"],
      id: "bench",
      name: "The bench",
      what: "Saturday bench work.",
      stewardEmail: tom.email,
      inviterEmail: ann.email,
      now,
    });
    assert.equal(made.ok, true);

    const revoke = await grantAccess(
      db,
      access(josh.id, { action: "revoke", role: "steward", email: tom.email, roomId: "bench" }),
    );
    assert.equal(revoke.ok, false);
    if (!revoke.ok) assert.equal(revoke.error, LAST_STEWARD_ERROR);

    const demoteMember = await grantAccess(
      db,
      access(josh.id, { action: "revoke", role: "member", email: tom.email }),
    );
    assert.equal(demoteMember.ok, false, "removing the member removes the steward too");

    const ban = await banMember(db, {
      userId: josh.id,
      name: "Josh",
      email: tom.email,
      reason: "threat",
      now: at(20),
    });
    assert.equal(ban.ok, false);
    if (!ban.ok) assert.equal(ban.error, LAST_STEWARD_ERROR);

    const leave = await joinRoom(db, { userId: tom.id, roomId: "bench", now: at(30), leave: true });
    assert.equal(leave.ok, false);
    if (!leave.ok) assert.equal(leave.error, LAST_STEWARD_ERROR);

    const handOff = await joinRoom(db, {
      userId: tom.id,
      roomId: "bench",
      now: at(40),
      leave: true,
      replacementEmail: sam.email,
      inviterEmail: ann.email,
    });
    assert.equal(handOff.ok, true);
    assert.deepEqual(liveStewards(await readAccessLog(db), "bench"), [sam.id]);

    const swap = await grantAccess(
      db,
      access(josh.id, {
        action: "revoke",
        role: "steward",
        email: sam.email,
        roomId: "bench",
        replacementEmail: tom.email,
        inviterEmail: ann.email,
        now: at(50),
      }),
    );
    assert.equal(swap.ok, true);
    assert.deepEqual(liveStewards(await readAccessLog(db), "bench"), [tom.id]);
  } finally {
    await close();
  }
});
