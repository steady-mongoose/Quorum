import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { roomCallMember } from "../calls/membership.ts";
import { listChat, sendChat } from "../chat/store.ts";
import {
  mintInvite,
  redeemInvite,
  type CreateAccount,
  type SignIn,
} from "../closed-test/store.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import type { GenderPolicy } from "../gender-policy.ts";
import { confirmMemberGender, guardRoomAudience, setMemberGender, setRoomAudience } from "./audience.ts";
import {
  createGroupPost,
  decideGroupRequest,
  joinGroup,
  listGroup,
  listGroups,
  requestGroup,
} from "./groups.ts";
import { joinRoom, listHome } from "./places-store.ts";
import { closeAsked, createPost, createRoom, listBoard, markPost, replyToPost, revisePost } from "./store.ts";

const now = new Date("2026-10-19T12:00:00Z");
const headers = new Headers();
const did = {
  type: "did",
  claim: "Sharpened the chisels in the shop.",
  reason: "Tom checked them on Thursday.",
  on: "2026-10-18",
};

const createAccount: CreateAccount = async (tx, input) => {
  const id = randomUUID();
  await tx.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, input.name, input.email, now],
  );
  return { id };
};

const signIn: SignIn = async (input) => ({
  ok: true,
  user: { id: input.userId, name: input.name, email: input.email },
});

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

async function stand(db: Db, roomId: string, userId: string) {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

function refusal(result: { ok: boolean; status?: number; error?: string; code?: string }) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

test("migration 0019 records gender and room audience without a score", async () => {
  const sql = readFileSync(new URL("../../migrations/0019_room_audience.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0019/);
  assert.match(sql, /0006 is reserved/);
  assert.match(sql, /owner must approve/);
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  for (const banned of ["like_count", "likes", "score", "reshare", "rank", "algorithm"]) {
    assert.equal(code.includes(banned), false, banned);
  }
  assert.equal(/create or replace function/.test(code), false);

  const { db, close } = await openTestDb();
  try {
    const columns = await db.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select table_name, column_name, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public'
         and (
           (table_name = 'members' and column_name in ('gender', 'gender_confirmed_by', 'gender_confirmed_at'))
           or (table_name = 'room' and column_name = 'audience')
           or (table_name = 'theme_group' and column_name in ('audience', 'source_room_id'))
         )`,
    );
    const key = (table: string, column: string) => `${table}.${column}`;
    const found = new Map(columns.map((row) => [key(row.table_name, row.column_name), row]));
    for (const column of ["gender", "gender_confirmed_by", "gender_confirmed_at"]) {
      assert.equal(found.get(key("members", column))?.is_nullable, "YES", column);
    }
    assert.match(found.get(key("room", "audience"))?.column_default ?? "", /all/);
    assert.match(found.get(key("theme_group", "audience"))?.column_default ?? "", /all/);
  } finally {
    await close();
  }
});

test("a restricted room is enforced on every path, and a steward override is logged", async () => {
  const { db, close } = await openTestDb();
  try {
    const josh = randomUUID();
    const adam = randomUUID();
    const maria = randomUUID();
    const ruth = randomUUID();
    const helen = randomUUID();
    const luis = randomUUID();
    const ida = randomUUID();
    const pete = randomUUID();
    const people = [
      [josh, "Josh", "josh@example.com"],
      [adam, "Adam", "adam@example.com"],
      [maria, "Maria", "maria@example.com"],
      [ruth, "Ruth", "ruth@example.com"],
      [helen, "Helen", "helen@example.com"],
      [luis, "Luis", "luis@example.com"],
      [ida, "Ida", "ida@example.com"],
      [pete, "Pete", "pete@example.com"],
    ] as const;
    for (const [id, name, email] of people) {
      await user(db, id, name, email);
      await grant(db, id, name, "member");
    }
    await grant(db, josh, "Josh", "admin");
    await grant(db, ida, "Ida", "admin");
    await grant(db, helen, "Helen", "steward", "bench");

    for (const [id, gender] of [
      [josh, "man"],
      [adam, "man"],
      [maria, "woman"],
      [helen, "woman"],
      [luis, "man"],
      [pete, "man"],
    ] as const) {
      const set = await setMemberGender(db, { actorUserId: id, subjectUserId: id, gender, now });
      assert.equal(set.ok, true, gender);
    }

    const created = await createRoom(db, {
      userId: josh,
      id: "bench",
      name: "The bench",
      what: "A room for the men who work the bench.",
      audience: "men",
      now,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.audience, "men");
    assert.equal(created.value.host, true);

    const adamList = await listBoard(db, adam, now);
    assert.equal(adamList.ok, true);
    if (!adamList.ok) return;
    assert.equal(adamList.value.rooms.some((room) => room.id === "bench"), true);
    assert.equal(adamList.value.me.gender, "man");
    assert.equal(adamList.value.genderPolicy.setBy, "self");
    assert.equal(adamList.value.genderPolicy.requiresConfirmation, false);
    assert.equal(adamList.value.genderPolicy.changeBy, "steward");

    const mariaList = await listBoard(db, maria, now);
    assert.equal(mariaList.ok, true);
    if (!mariaList.ok) return;
    assert.equal(mariaList.value.rooms.some((room) => room.id === "bench"), false);

    const ruthList = await listBoard(db, ruth, now);
    assert.equal(ruthList.ok, true);
    if (!ruthList.ok) return;
    assert.equal(ruthList.value.rooms.some((room) => room.id === "bench"), false);
    assert.equal(ruthList.value.rooms.some((room) => room.id === "shop"), true);
    assert.equal(ruthList.value.me.gender, null);

    const mariaRead = refusal(await listBoard(db, maria, now, { room: "bench" }));
    assert.equal(mariaRead.status, 403);
    assert.equal(mariaRead.code, "audience");
    assert.equal(mariaRead.error, "This room is for men.");
    const ruthRead = refusal(await listBoard(db, ruth, now, { room: "bench" }));
    assert.equal(ruthRead.code, "gender-unstated");
    const shop = await listBoard(db, ruth, now, { room: "shop" });
    assert.equal(shop.ok, true);

    const helenList = await listBoard(db, helen, now);
    assert.equal(helenList.ok, true);
    if (!helenList.ok) return;
    assert.equal(helenList.value.rooms.some((room) => room.id === "bench"), true);
    const listed = await db.query<{ path: string; action: string }>(
      `select path, action from gender_audit
       where actor_user_id = $1 and action = 'audience-override' and path = 'list'`,
      [helen],
    );
    assert.equal(listed.length, 1);

    const mariaJoin = refusal(await joinRoom(db, { userId: maria, roomId: "bench", now }));
    assert.equal(mariaJoin.status, 403);
    assert.equal(mariaJoin.code, "audience");
    await db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'bench', $2)`, [
      maria,
      now,
    ]);
    const left = await joinRoom(db, { userId: maria, roomId: "bench", now, leave: true });
    assert.equal(left.ok, true);
    if (!left.ok) return;
    assert.equal(left.value.joined, false);

    const adamJoin = await joinRoom(db, { userId: adam, roomId: "bench", now });
    assert.equal(adamJoin.ok, true);
    await db.query(
      `insert into room_join (user_id, room_id, joined_at) values ($1, 'bench', $2) on conflict do nothing`,
      [maria, now],
    );
    const adamHome = await listHome(db, adam, now);
    assert.equal(adamHome.ok, true);
    if (!adamHome.ok) return;
    const adamJoined = adamHome.value.sections.flatMap((section) =>
      section.tier === "joined" ? section.rooms : [],
    );
    assert.equal(adamJoined.some((room) => room.id === "bench" && room.audience === "men"), true);
    const mariaHome = await listHome(db, maria, now);
    assert.equal(mariaHome.ok, true);
    if (!mariaHome.ok) return;
    const mariaRooms = mariaHome.value.sections.flatMap((section) =>
      section.tier === "joined" ? section.rooms : [],
    );
    assert.equal(mariaRooms.some((room) => room.id === "bench"), false);

    const mariaPost = refusal(
      await createPost(db, { userId: maria, name: "Maria", roomId: "bench", body: did, now }),
    );
    assert.equal(mariaPost.code, "audience");
    const posted = await createPost(db, { userId: adam, name: "Adam", roomId: "bench", body: did, now });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const reply = refusal(
      await replyToPost(db, { userId: maria, name: "Maria", postId: posted.value.id, claim: "The edge is keen.", now }),
    );
    assert.equal(reply.code, "audience");
    const closed = refusal(await closeAsked(db, { userId: maria, postId: posted.value.id, now }));
    assert.equal(closed.code, "audience");

    await stand(db, "bench", maria);
    await stand(db, "bench", helen);
    const mariaCall = await roomCallMember(db, maria, "bench", now);
    assert.equal(mariaCall.kind, "audience");
    if (mariaCall.kind !== "audience") return;
    assert.equal(mariaCall.code, "audience");
    assert.equal((await roomCallMember(db, adam, "bench", now)).kind, "member");

    const outsider = refusal(await listChat(db, { userId: pete, roomId: "bench", now }));
    assert.equal(outsider.error, "You are not in this room.");
    const mariaChat = refusal(await listChat(db, { userId: maria, roomId: "bench", now }));
    assert.equal(mariaChat.code, "audience");
    const mariaSend = refusal(
      await sendChat(db, { userId: maria, name: "Maria", roomId: "bench", text: "The vise is tight.", now }),
    );
    assert.equal(mariaSend.code, "audience");
    const sent = await sendChat(db, {
      userId: adam,
      name: "Adam",
      roomId: "bench",
      text: "The vise is tight.",
      now,
    });
    assert.equal(sent.ok, true);
    const helenChat = await listChat(db, { userId: helen, roomId: "bench", now });
    assert.equal(helenChat.ok, true);
    const helenSend = refusal(
      await sendChat(db, { userId: helen, name: "Helen", roomId: "bench", text: "I am looking in.", now }),
    );
    assert.equal(helenSend.code, "audience");
    const chatAudit = await db.query<{ detail: string }>(
      `select detail from gender_audit
       where actor_user_id = $1 and action = 'audience-override' and path = 'chat'`,
      [helen],
    );
    assert.deepEqual(
      chatAudit.map((row) => row.detail),
      ["list"],
    );

    const mariaInvite = refusal(
      await mintInvite(db, { userId: maria, maxUses: 1, expiresInDays: 7, roomId: "bench" }, now),
    );
    assert.equal(mariaInvite.code, "audience");
    const helenInvite = refusal(
      await mintInvite(db, { userId: helen, maxUses: 1, expiresInDays: 7, roomId: "bench" }, now),
    );
    assert.equal(helenInvite.code, "audience");
    const shopInvite = await mintInvite(db, { userId: maria, maxUses: 1, expiresInDays: 7, roomId: "shop" }, now);
    assert.equal(shopInvite.ok, true);
    const benchInvite = await mintInvite(db, { userId: adam, maxUses: 1, expiresInDays: 7, roomId: "bench" }, now);
    assert.equal(benchInvite.ok, true);
    if (!benchInvite.ok) return;
    const redeemed = await redeemInvite(
      db,
      {
        name: "Ned",
        email: "ned@example.com",
        password: "correct-horse",
        code: benchInvite.value.code,
        headers,
      },
      createAccount,
      signIn,
      now,
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) return;
    const seated = await db.query<{ user_id: string }>(
      `select user_id from room_member where room_id = 'bench' and user_id = $1`,
      [redeemed.value.user.id],
    );
    assert.equal(seated.length, 0);
    const account = await db.query<{ id: string }>(`select id from "user" where email = 'ned@example.com'`);
    assert.equal(account.length, 1);

    const asked = await requestGroup(db, {
      userId: adam,
      name: "Adam",
      roomId: "bench",
      groupName: "Bench work",
      about: "Men who work wood at the bench.",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    const mariaAsk = refusal(
      await requestGroup(db, {
        userId: maria,
        name: "Maria",
        roomId: "bench",
        groupName: "Other work",
        about: "A group asked from the bench.",
        now,
      }),
    );
    assert.equal(mariaAsk.code, "audience");
    const decided = await decideGroupRequest(db, {
      userId: helen,
      name: "Helen",
      requestId: asked.value.id,
      decision: "approved",
      note: "The shop already uses this bench.",
      now,
    });
    assert.equal(decided.ok, true);
    if (!decided.ok) return;
    assert.equal(decided.value.groupId, "bench-work");
    const copied = await db.query<{ audience: string; source_room_id: string }>(
      `select audience, source_room_id from theme_group where id = 'bench-work'`,
    );
    assert.equal(copied[0]?.audience, "men");
    assert.equal(copied[0]?.source_room_id, "bench");
    const decidedAudit = await db.query<{ detail: string }>(
      `select detail from gender_audit
       where actor_user_id = $1 and action = 'audience-override' and path = 'group'`,
      [helen],
    );
    assert.deepEqual(
      decidedAudit.map((row) => row.detail),
      ["decide"],
    );

    const mariaGroups = await listGroups(db, maria, now);
    assert.equal(mariaGroups.ok, true);
    if (!mariaGroups.ok) return;
    const mariaNames = mariaGroups.value.groups.map((group) => group.id);
    assert.equal(mariaNames.includes("bench-work"), false);
    assert.equal(mariaNames.includes("carpentry"), true);
    const adamGroups = await listGroups(db, adam, now);
    assert.equal(adamGroups.ok, true);
    if (!adamGroups.ok) return;
    assert.equal(adamGroups.value.groups.some((group) => group.id === "bench-work" && group.audience === "men"), true);
    const mariaGroup = refusal(await listGroup(db, maria, "bench-work", now));
    assert.equal(mariaGroup.code, "audience");
    const mariaGroupJoin = refusal(
      await joinGroup(db, { userId: maria, name: "Maria", groupId: "bench-work", now }),
    );
    assert.equal(mariaGroupJoin.code, "audience");
    const mariaGroupPost = refusal(
      await createGroupPost(db, {
        userId: maria,
        name: "Maria",
        groupId: "bench-work",
        body: "The bench is cleared for the next job.",
        on: "",
        now,
      }),
    );
    assert.equal(mariaGroupPost.code, "audience");
    const adamGroup = await joinGroup(db, { userId: adam, name: "Adam", groupId: "bench-work", now });
    assert.equal(adamGroup.ok, true);
    const adamGroupPost = await createGroupPost(db, {
      userId: adam,
      name: "Adam",
      groupId: "bench-work",
      body: "The bench is cleared for the next job.",
      on: "",
      now,
    });
    assert.equal(adamGroupPost.ok, true);
    const readGroup = await listGroup(db, adam, "bench-work", now);
    assert.equal(readGroup.ok, true);

    const helenPost = refusal(
      await createPost(db, { userId: helen, name: "Helen", roomId: "bench", body: did, now }),
    );
    assert.equal(helenPost.code, "audience");
    const marked = await markPost(db, {
      userId: helen,
      name: "Helen",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "The claim names no date.",
      now,
    });
    assert.equal(marked.ok, true);
    const markAudit = await db.query<{ detail: string }>(
      `select detail from gender_audit
       where actor_user_id = $1 and action = 'audience-override' and path = 'post'`,
      [helen],
    );
    assert.deepEqual(
      markAudit.map((row) => row.detail),
      ["mark"],
    );

    const second = refusal(await setMemberGender(db, { actorUserId: adam, subjectUserId: adam, gender: "woman", now }));
    assert.equal(second.status, 403);
    assert.equal(second.error, "A steward changes this after it is set.");
    const changed = await setMemberGender(db, {
      actorUserId: helen,
      subjectUserId: adam,
      gender: "woman",
      now,
    });
    assert.equal(changed.ok, true);
    const changeAudit = await db.query<{ action: string; detail: string; subject_user_id: string }>(
      `select action, detail, subject_user_id from gender_audit where action = 'change-gender'`,
    );
    assert.equal(changeAudit.length, 1);
    assert.equal(changeAudit[0]?.subject_user_id, adam);
    assert.equal(changeAudit[0]?.detail, "man -> woman");
    const revised = refusal(
      await revisePost(db, {
        userId: adam,
        name: "Adam",
        postId: posted.value.id,
        claim: "Sharpened the chisels in the shop.",
        reason: "Tom checked them on Thursday.",
        now,
      }),
    );
    assert.equal(revised.code, "audience");

    const notHost = refusal(await setRoomAudience(db, { userId: maria, roomId: "bench", audience: "women", now }));
    assert.equal(notHost.error, "The host sets who the room is for.");
    const otherAdmin = refusal(await setRoomAudience(db, { userId: ida, roomId: "bench", audience: "women", now }));
    assert.equal(otherAdmin.status, 403);
    const hosted = await setRoomAudience(db, { userId: josh, roomId: "bench", audience: "women", now });
    assert.equal(hosted.ok, true);
    const women = await listBoard(db, adam, now, { room: "bench" });
    assert.equal(women.ok, true);
    const luisRead = refusal(await listBoard(db, luis, now, { room: "bench" }));
    assert.equal(luisRead.code, "audience");
    assert.equal(luisRead.error, "This room is for women.");
  } finally {
    await close();
  }
});

test("an inviter can set a gender, and confirmation is required only when the policy says so", async () => {
  const { db, close } = await openTestDb();
  try {
    const founder = randomUUID();
    const inviter = randomUUID();
    const invitee = randomUUID();
    const steward = randomUUID();
    const bystander = randomUUID();
    for (const [id, name, email] of [
      [founder, "Founder", "founder@example.com"],
      [inviter, "Inviter", "inviter@example.com"],
      [invitee, "Invitee", "invitee@example.com"],
      [steward, "Steward", "steward@example.com"],
      [bystander, "Bystander", "bystander@example.com"],
    ] as const) {
      await user(db, id, name, email);
      await grant(db, id, name, "member");
    }
    await grant(db, steward, "Steward", "steward", "shop");
    await grant(db, inviter, "Inviter", "admin");
    await db.query(
      `insert into invite_redemption
       (id, invited_user_id, invited_by_user_id, invited_name, invited_by_name)
       values ($1, $2, $3, 'Invitee', 'Inviter')`,
      [randomUUID(), invitee, inviter],
    );
    const room = await createRoom(db, {
      userId: inviter,
      id: "brothers",
      name: "Brothers",
      what: "A room that waits for a confirmed gender.",
      audience: "men",
      now,
    });
    assert.equal(room.ok, true);

    const confirming: GenderPolicy = {
      GENDER_SET_BY: "inviter",
      GENDER_REQUIRES_CONFIRMATION: true,
      GENDER_CHANGE_BY: "steward",
    };
    const self = refusal(
      await setMemberGender(db, {
        actorUserId: invitee,
        subjectUserId: invitee,
        gender: "man",
        now,
        policy: confirming,
      }),
    );
    assert.equal(self.error, "The person who invited you sets this.");
    const founded = await setMemberGender(db, {
      actorUserId: founder,
      subjectUserId: founder,
      gender: "woman",
      now,
      policy: confirming,
    });
    assert.equal(founded.ok, true);
    const set = await setMemberGender(db, {
      actorUserId: inviter,
      subjectUserId: invitee,
      gender: "man",
      now,
      policy: confirming,
    });
    assert.equal(set.ok, true);
    const waiting = refusal(
      await guardRoomAudience(db, {
        userId: invitee,
        roomId: "brothers",
        now,
        path: "read",
        policy: confirming,
      }),
    );
    assert.equal(waiting.code, "gender-unconfirmed");
    const own = refusal(
      await confirmMemberGender(db, {
        actorUserId: invitee,
        subjectUserId: invitee,
        now,
        policy: confirming,
      }),
    );
    assert.equal(own.error, "Someone else confirms it.");
    const plain = refusal(
      await confirmMemberGender(db, {
        actorUserId: bystander,
        subjectUserId: invitee,
        now,
        policy: confirming,
      }),
    );
    assert.equal(plain.error, "A steward confirms it.");
    const confirmed = await confirmMemberGender(db, {
      actorUserId: steward,
      subjectUserId: invitee,
      now,
      policy: confirming,
    });
    assert.equal(confirmed.ok, true);
    const open = await guardRoomAudience(db, {
      userId: invitee,
      roomId: "brothers",
      now,
      path: "read",
      policy: confirming,
    });
    assert.deepEqual(open, { ok: true });
    const unneeded = refusal(
      await confirmMemberGender(db, { actorUserId: steward, subjectUserId: invitee, now }),
    );
    assert.equal(unneeded.status, 400);
    assert.equal(unneeded.error, "That does not need confirmation.");

    const stewardSet: GenderPolicy = {
      GENDER_SET_BY: "steward",
      GENDER_REQUIRES_CONFIRMATION: false,
      GENDER_CHANGE_BY: "steward",
    };
    const refused = refusal(
      await setMemberGender(db, {
        actorUserId: bystander,
        subjectUserId: bystander,
        gender: "woman",
        now,
        policy: stewardSet,
      }),
    );
    assert.equal(refused.error, "A steward sets this.");
    const written = await setMemberGender(db, {
      actorUserId: steward,
      subjectUserId: bystander,
      gender: "woman",
      now,
      policy: stewardSet,
    });
    assert.equal(written.ok, true);
  } finally {
    await close();
  }
});
