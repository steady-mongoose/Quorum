import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { profileView, type ProfileBody } from "./view.ts";

const now = new Date("2026-10-19T15:00:00Z");
const birth = "1990-04-02";

async function person(
  db: Db,
  id: string,
  name: string,
  role: "member" | "admin",
  gender: "man" | "woman" = "man",
) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $5)`,
    [randomUUID(), id, name, role, now],
  );
  await db.query(
    `insert into members (user_id, display_name, gender, bio, birthdate, church, interests)
     values ($1, $2, $3, 'Keeps bees.', $4::date, 'Grace', array['books']::text[])`,
    [id, name, gender, birth],
  );
}

async function stand(db: Db, roomId: string, userId: string) {
  await db.query(`insert into room_member (room_id, user_id) values ($1, $2)`, [roomId, userId]);
}

async function level(db: Db, userId: string, field: string, value: string) {
  await db.query(
    `insert into profile_visibility (user_id, field, level) values ($1, $2, $3)
     on conflict (user_id, field) do update set level = excluded.level`,
    [userId, field, value],
  );
}

function seen(result: { ok: true; profile: ProfileBody } | { ok: false }): ProfileBody {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected a profile");
  return result.profile;
}

test("profileView shows every visibility level, and never the birthdate", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale", "member", "woman");
    await person(db, "bo", "Bo Hale", "member");
    await person(db, "ada", "Ada Cole", "admin", "woman");
    await stand(db, "county", "ann");
    await stand(db, "county", "bo");
    await level(db, "ann", "bio", "members");

    const member = seen(await profileView(db, { id: "bo" }, { id: "ann" }, now));
    assert.equal(member.displayName, "Ann Vale");
    assert.equal(member.bio, "Keeps bees.");
    assert.equal(member.age, 36);
    assert.equal(member.gender, "woman");
    assert.equal(member.vouchedName, undefined);
    assert.equal(JSON.stringify(member).includes(birth), false);
    assert.equal("birthdate" in member, false);

    await level(db, "ann", "bio", "shared");
    const stranger = seen(await profileView(db, { id: "ada" }, { id: "ann" }, now));
    assert.equal(stranger.bio, undefined);
    assert.equal(stranger.displayName, "Ann Vale");
    const roommate = seen(await profileView(db, { id: "bo" }, { id: "ann" }, now));
    assert.equal(roommate.bio, "Keeps bees.");

    await level(db, "ann", "bio", "private");
    assert.equal(seen(await profileView(db, { id: "bo" }, { id: "ann" }, now)).bio, undefined);
    assert.equal(seen(await profileView(db, { id: "ada" }, { id: "ann" }, now)).bio, undefined);
    assert.equal(seen(await profileView(db, { id: "ann" }, { id: "ann" }, now)).bio, "Keeps bees.");

    await level(db, "ann", "bio", "admins");
    assert.equal(seen(await profileView(db, { id: "bo" }, { id: "ann" }, now)).bio, undefined);
    assert.equal(seen(await profileView(db, { id: "ada" }, { id: "ann" }, now)).bio, "Keeps bees.");
    assert.equal(
      seen(await profileView(db, { id: "ada" }, { id: "ann" }, now)).vouchedName,
      "Ann Vale",
    );
    const own = seen(await profileView(db, { id: "ann" }, { id: "ann" }, now));
    assert.equal(own.birthdateSet, true);
    assert.equal(own.age, 36);
    assert.equal(JSON.stringify(own).includes(birth), false);
  } finally {
    await close();
  }
});

test("a site-wide bar blocks the viewer, and a room bar drops only that room", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale", "member", "woman");
    await person(db, "bo", "Bo Hale", "member");
    await stand(db, "shop", "ann");
    await stand(db, "shop", "bo");
    await level(db, "ann", "bio", "shared");
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ('ban-site', 'bo', 'Bo Hale', 'threat', 'ann', 'Ann Vale', 1, $1, '')`,
      [new Date("2026-12-01T00:00:00Z")],
    );
    const banned = await profileView(db, { id: "bo" }, { id: "ann" }, now);
    assert.equal(banned.ok, false);
    if (banned.ok) return;
    assert.equal(banned.status, 403);
    assert.equal(banned.error, "banned");

    await db.query(`delete from board_ban where id = 'ban-site'`);
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ('ban-shop', 'bo', 'Bo Hale', 'threat', 'ann', 'Ann Vale', 1, $1, 'shop')`,
      [new Date("2026-12-01T00:00:00Z")],
    );
    const roomBanned = seen(await profileView(db, { id: "bo" }, { id: "ann" }, now));
    assert.equal(roomBanned.bio, undefined);
    assert.equal(roomBanned.displayName, "Ann Vale");
    assert.equal(roomBanned.gender, "woman");
    await stand(db, "county", "ann");
    await stand(db, "county", "bo");
    assert.equal(seen(await profileView(db, { id: "bo" }, { id: "ann" }, now)).bio, "Keeps bees.");
  } finally {
    await close();
  }
});

test("an audience room and a direct message do not count as shared", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale", "member", "woman");
    await person(db, "bo", "Bo Hale", "member", "man");
    await person(db, "cy", "Cy Poe", "member", "woman");
    await db.query(`update room set audience = 'men' where id = 'shop'`);
    await stand(db, "shop", "ann");
    await stand(db, "shop", "bo");
    await level(db, "bo", "bio", "shared");
    assert.equal(seen(await profileView(db, { id: "ann" }, { id: "bo" }, now)).bio, undefined);
    await stand(db, "county", "ann");
    await stand(db, "county", "bo");
    assert.equal(seen(await profileView(db, { id: "ann" }, { id: "bo" }, now)).bio, "Keeps bees.");

    await db.query(`update theme_group set audience = 'women' where id = 'literary'`);
    await db.query(
      `insert into theme_group_member (group_id, user_id) values ('literary', 'ann'), ('literary', 'cy')`,
    );
    await db.query(`delete from room_member where user_id in ('ann', 'cy')`);
    await level(db, "ann", "bio", "shared");
    assert.equal(seen(await profileView(db, { id: "cy" }, { id: "ann" }, now)).bio, "Keeps bees.");
    await db.query(`insert into theme_group_member (group_id, user_id) values ('literary', 'bo')`);
    assert.equal(seen(await profileView(db, { id: "bo" }, { id: "ann" }, now)).bio, undefined);

    await db.query(
      `update theme_group set audience = 'all', source_room_id = 'shop' where id = 'carpentry'`,
    );
    await db.query(
      `insert into theme_group_member (group_id, user_id) values ('carpentry', 'ann'), ('carpentry', 'bo')`,
    );
    await db.query(`delete from theme_group_member where group_id = 'literary'`);
    await db.query(
      `insert into board_ban
       (id, user_id, name, reason, by_user_id, by_name, strikes, until_at, room_id)
       values ('ban-source', 'bo', 'Bo Hale', 'threat', 'ann', 'Ann Vale', 1, $1, 'shop')`,
      [new Date("2026-12-01T00:00:00Z")],
    );
    assert.equal(seen(await profileView(db, { id: "bo" }, { id: "ann" }, now)).bio, undefined);

    await db.query(`delete from theme_group_member`);
    await db.query(`delete from room_member where user_id in ('ann', 'bo')`);
    await db.query(
      `insert into dm_thread (id, user_a, user_b, user_a_name, user_b_name)
       values ('thread-1', 'ann', 'bo', 'Ann Vale', 'Bo Hale')`,
    );
    const messaged = seen(await profileView(db, { id: "bo" }, { id: "ann" }, now));
    assert.equal(messaged.bio, undefined);
    assert.equal(messaged.displayName, "Ann Vale");
  } finally {
    await close();
  }
});

test("the anonymous flag does not hide a member until permissions 0025", async () => {
  const { db, close } = await openTestDb();
  try {
    await person(db, "ann", "Ann Vale", "member", "woman");
    await person(db, "bo", "Bo Hale", "member");
    await db.query(`update members set profile_anonymous = true where user_id = 'ann'`);
    const viewed = seen(await profileView(db, { id: "bo" }, { id: "ann" }, now));
    assert.equal(viewed.displayName, "Ann Vale");
  } finally {
    await close();
  }
});
