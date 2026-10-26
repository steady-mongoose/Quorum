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
import {
  confirmMemberGender,
  guardRoomAudience,
  setGroupAudience,
  setMemberGender,
  setRoomAudience,
} from "./audience.ts";
import {
  listGatheringsFor,
  loadSharedGathering,
  readGatheringFor,
  saveGathering,
  setGatheringShared,
} from "./gathering-record.ts";
import { createApp, type AppDeps } from "../http.ts";
import { recordAttendance } from "../dm/store.ts";
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
  assert.match(sql, /create or replace function anonymize_gender_user/i);
  assert.match(sql, /does not replace/i);
  assert.equal(/create or replace function anonymize_board_user/i.test(sql), false);
  assert.equal(/create or replace function anonymize_dm_user/i.test(sql), false);

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
    assert.equal(adamList.value.genderPolicy.changeBy, "admin");

    const mariaList = await listBoard(db, maria, now);
    assert.equal(mariaList.ok, true);
    if (!mariaList.ok) return;
    assert.equal(mariaList.value.rooms.some((room) => room.id === "bench"), false);

    const ruthList = await listBoard(db, ruth, now);
    assert.equal(ruthList.ok, true);
    if (!ruthList.ok) return;
    assert.equal(ruthList.value.rooms.some((room) => room.id === "bench"), true);
    assert.equal(ruthList.value.posts.some((post) => post.room === "bench"), false);
    assert.equal(ruthList.value.rooms.some((room) => room.id === "shop"), true);
    assert.equal(ruthList.value.me.gender, null);

    const mariaRead = refusal(await listBoard(db, maria, now, { room: "bench" }));
    assert.equal(mariaRead.status, 404);
    assert.equal(mariaRead.code, undefined);
    assert.equal(mariaRead.error, "That room is not here.");
    const missingRoom = refusal(await listBoard(db, maria, now, { room: "no-such-room" }));
    assert.equal(missingRoom.status, mariaRead.status);
    assert.equal(missingRoom.error, mariaRead.error);
    assert.equal(missingRoom.code, undefined);
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
    assert.equal(listed.length, 0);

    const mariaJoin = refusal(await joinRoom(db, { userId: maria, roomId: "bench", now }));
    assert.equal(mariaJoin.status, 404);
    assert.equal(mariaJoin.code, undefined);
    assert.equal(mariaJoin.error, "That room is not here.");
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
    assert.equal(mariaPost.status, 404);
    assert.equal(mariaPost.code, undefined);
    assert.equal(mariaPost.error, "That room is not here.");
    const posted = await createPost(db, { userId: adam, name: "Adam", roomId: "bench", body: did, now });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const reply = refusal(
      await replyToPost(db, { userId: maria, name: "Maria", postId: posted.value.id, claim: "The edge is keen.", now }),
    );
    assert.equal(reply.status, 404);
    assert.equal(reply.code, undefined);
    const closed = refusal(await closeAsked(db, { userId: maria, postId: posted.value.id, now }));
    assert.equal(closed.status, 404);
    assert.equal(closed.code, undefined);

    await stand(db, "bench", maria);
    await stand(db, "bench", helen);
    const mariaCall = await roomCallMember(db, maria, "bench", now);
    assert.equal(mariaCall.kind, "hidden");
    assert.equal((await roomCallMember(db, adam, "bench", now)).kind, "member");

    const outsider = refusal(await listChat(db, { userId: pete, roomId: "bench", now }));
    assert.equal(outsider.error, "You are not in this room.");
    const mariaChat = refusal(await listChat(db, { userId: maria, roomId: "bench", now }));
    assert.equal(mariaChat.status, 404);
    assert.equal(mariaChat.code, undefined);
    assert.equal(mariaChat.error, "That room is not here.");
    const mariaSend = refusal(
      await sendChat(db, { userId: maria, name: "Maria", roomId: "bench", text: "The vise is tight.", now }),
    );
    assert.equal(mariaSend.status, 404);
    assert.equal(mariaSend.code, undefined);
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
    assert.equal(helenSend.status, 404);
    assert.equal(helenSend.code, undefined);
    const chatAudit = await db.query<{ detail: string }>(
      `select detail from gender_audit
       where actor_user_id = $1 and action = 'audience-override' and path = 'chat'`,
      [helen],
    );
    assert.deepEqual(
      chatAudit.map((row) => row.detail),
      [],
    );

    const mariaInvite = refusal(
      await mintInvite(db, { userId: maria, maxUses: 1, expiresInDays: 7, roomId: "bench" }, now),
    );
    assert.equal(mariaInvite.status, 404);
    assert.equal(mariaInvite.code, undefined);
    const helenInvite = refusal(
      await mintInvite(db, { userId: helen, maxUses: 1, expiresInDays: 7, roomId: "bench" }, now),
    );
    assert.equal(helenInvite.status, 404);
    assert.equal(helenInvite.code, undefined);
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
    assert.equal(mariaAsk.status, 404);
    assert.equal(mariaAsk.code, undefined);
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
    assert.equal(mariaGroup.status, 404);
    assert.equal(mariaGroup.code, undefined);
    assert.equal(mariaGroup.error, "That group is not here.");
    const mariaGroupJoin = refusal(
      await joinGroup(db, { userId: maria, name: "Maria", groupId: "bench-work", now }),
    );
    assert.equal(mariaGroupJoin.status, 404);
    assert.equal(mariaGroupJoin.code, undefined);
    assert.equal(mariaGroupJoin.error, "That group is not here.");
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
    assert.equal(mariaGroupPost.status, 404);
    assert.equal(mariaGroupPost.code, undefined);
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
    assert.equal(helenPost.status, 404);
    assert.equal(helenPost.code, undefined);
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
    assert.equal(second.error, "You cannot change this yourself.");
    const stewardChange = refusal(
      await setMemberGender(db, { actorUserId: helen, subjectUserId: adam, gender: "woman", now }),
    );
    assert.equal(stewardChange.status, 403);
    assert.equal(stewardChange.error, "An admin changes this after it is set.");
    const stewardSelf = refusal(
      await setMemberGender(db, { actorUserId: helen, subjectUserId: helen, gender: "man", now }),
    );
    assert.equal(stewardSelf.status, 403);
    assert.equal(stewardSelf.error, "You cannot change this yourself.");
    const adminSelf = refusal(
      await setMemberGender(db, { actorUserId: josh, subjectUserId: josh, gender: "woman", now }),
    );
    assert.equal(adminSelf.status, 403);
    assert.equal(adminSelf.error, "You cannot change this yourself.");
    const changed = await setMemberGender(db, {
      actorUserId: josh,
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
    assert.equal(revised.status, 404);
    assert.equal(revised.code, undefined);

    const notHost = refusal(await setRoomAudience(db, { userId: maria, roomId: "bench", audience: "women", now }));
    assert.equal(notHost.error, "The host sets who the room is for.");
    const otherAdmin = refusal(await setRoomAudience(db, { userId: ida, roomId: "bench", audience: "women", now }));
    assert.equal(otherAdmin.status, 403);
    const hosted = await setRoomAudience(db, { userId: josh, roomId: "bench", audience: "women", now });
    assert.equal(hosted.ok, true);
    const women = await listBoard(db, adam, now, { room: "bench" });
    assert.equal(women.ok, true);
    const luisRead = refusal(await listBoard(db, luis, now, { room: "bench" }));
    assert.equal(luisRead.status, 404);
    assert.equal(luisRead.code, undefined);
    assert.equal(luisRead.error, "That room is not here.");
    const followed = await listGroups(db, adam, now);
    assert.equal(followed.ok, true);
    if (!followed.ok) return;
    assert.equal(
      followed.value.groups.some((group) => group.id === "bench-work" && group.audience === "women"),
      true,
    );
    const luisGroups = await listGroups(db, luis, now);
    assert.equal(luisGroups.ok, true);
    if (!luisGroups.ok) return;
    assert.equal(luisGroups.value.groups.some((group) => group.id === "bench-work"), false);
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
      GENDER_CHANGE_ALLOWS_SELF: false,
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
      GENDER_CHANGE_ALLOWS_SELF: false,
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

test("naming an email is the same refusal when the caller cannot change a gender", async () => {
  const { db, close } = await openTestDb();
  try {
    const member = randomUUID();
    const other = randomUUID();
    const admin = randomUUID();
    await user(db, member, "Member", "member@example.com");
    await user(db, other, "Other", "other@example.com");
    await user(db, admin, "Admin", "admin@example.com");
    await grant(db, member, "Member", "member");
    await grant(db, other, "Other", "member");
    await grant(db, admin, "Admin", "member");
    await grant(db, admin, "Admin", "admin");
    const handler = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => now,
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) return null;
        return { id, name: "Member", email: "member@example.com" };
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
    } satisfies AppDeps);
    const post = (userId: string, email: string) =>
      handler(
        new Request("http://127.0.0.1:8787/api/gender", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": userId },
          body: JSON.stringify({ gender: "woman", email }),
        }),
      );
    const known = await post(member, "other@example.com");
    const unknown = await post(member, "nobody@example.com");
    assert.equal(known.status, 403);
    assert.equal(unknown.status, 403);
    assert.deepEqual(await known.json(), await unknown.json());
    const missing = await post(admin, "nobody@example.com");
    assert.equal(missing.status, 404);
    const body = (await missing.json()) as { error?: string };
    assert.equal(body.error, "No member has that email.");
  } finally {
    await close();
  }
});

test("a group follows its room live, and a group with no source room can be set by an admin", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    const man = randomUUID();
    const woman = randomUUID();
    const steward = randomUUID();
    for (const [id, name, email] of [
      [admin, "Admin", "admin-group@example.com"],
      [man, "Man", "man-group@example.com"],
      [woman, "Woman", "woman-group@example.com"],
      [steward, "Steward", "steward-group@example.com"],
    ] as const) {
      await user(db, id, name, email);
      await grant(db, id, name, "member");
    }
    await grant(db, admin, "Admin", "admin");
    await grant(db, steward, "Steward", "steward", "shop");
    for (const [id, gender] of [
      [admin, "man"],
      [man, "man"],
      [woman, "woman"],
      [steward, "woman"],
    ] as const) {
      assert.equal((await setMemberGender(db, { actorUserId: id, subjectUserId: id, gender, now })).ok, true);
    }
    const before = await listGroups(db, woman, now);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.value.groups.some((group) => group.id === "carpentry"), true);
    const set = await setGroupAudience(db, { userId: admin, groupId: "carpentry", audience: "men", now });
    assert.equal(set.ok, true);
    const refused = refusal(
      await setGroupAudience(db, { userId: steward, groupId: "carpentry", audience: "women", now }),
    );
    assert.equal(refused.status, 403);
    const women = await listGroups(db, woman, now);
    assert.equal(women.ok, true);
    if (!women.ok) return;
    assert.equal(women.value.groups.some((group) => group.id === "carpentry"), false);
    const men = await listGroups(db, man, now);
    assert.equal(men.ok, true);
    if (!men.ok) return;
    assert.equal(men.value.groups.some((group) => group.id === "carpentry" && group.audience === "men"), true);
    const opened = refusal(await listGroup(db, woman, "carpentry", now));
    assert.equal(opened.status, 404);
    assert.equal(opened.error, "That group is not here.");
    assert.equal(opened.code, undefined);

    const room = await createRoom(db, {
      userId: admin,
      id: "brothers",
      name: "Brothers",
      what: "A room for the men.",
      audience: "men",
      now,
    });
    assert.equal(room.ok, true);
    await stand(db, "brothers", man);
    const asked = await requestGroup(db, {
      userId: man,
      name: "Man",
      roomId: "brothers",
      groupName: "Bench brothers",
      about: "Men who meet from that room.",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    await grant(db, steward, "Steward", "steward", "brothers");
    const decided = await decideGroupRequest(db, {
      userId: steward,
      name: "Steward",
      requestId: asked.value.id,
      decision: "approved",
      note: "The shop already uses this bench.",
      now,
    });
    assert.equal(decided.ok, true);
    const follows = refusal(
      await setGroupAudience(db, { userId: admin, groupId: "bench-brothers", audience: "all", now }),
    );
    assert.equal(follows.status, 403);
    assert.equal(follows.error, "That group follows its room.");
    await setRoomAudience(db, { userId: admin, roomId: "brothers", audience: "women", now });
    const manAfter = await listGroups(db, man, now);
    assert.equal(manAfter.ok, true);
    if (!manAfter.ok) return;
    assert.equal(manAfter.value.groups.some((group) => group.id === "bench-brothers"), false);
    const womanAfter = await listGroup(db, woman, "bench-brothers", now);
    assert.equal(womanAfter.ok, true);
  } finally {
    await close();
  }
});

test("a gathering in a restricted room is not created, read, shared, or attended", async () => {
  const { db, close } = await openTestDb();
  try {
    const man = randomUUID();
    const woman = randomUUID();
    await user(db, man, "Man", "man-meet@example.com");
    await user(db, woman, "Woman", "woman-meet@example.com");
    await grant(db, man, "Man", "member");
    await grant(db, woman, "Woman", "member");
    await grant(db, man, "Man", "admin");
    assert.equal((await setMemberGender(db, { actorUserId: man, subjectUserId: man, gender: "man", now })).ok, true);
    assert.equal(
      (await setMemberGender(db, { actorUserId: woman, subjectUserId: woman, gender: "woman", now })).ok,
      true,
    );
    const room = await createRoom(db, {
      userId: man,
      id: "sisters",
      name: "Sisters",
      what: "A room for the women.",
      audience: "women",
      now,
    });
    assert.equal(room.ok, true);
    const id = randomUUID();
    const fields = {
      id,
      title: "Saturday lifts",
      date: "2026-10-24",
      time: "7 a.m.",
      place: "Dale's garage, 1010 E Brandon Blvd, Riverview",
    };
    const blocked = await saveGathering(db, { userId: man, roomId: "sisters", ...fields, now });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.status, 404);
    assert.equal(blocked.error, "Not found.");
    const saved = await saveGathering(db, { userId: woman, roomId: "sisters", ...fields, now });
    assert.equal(saved.ok, true);
    const shared = await setGatheringShared(db, { userId: woman, id, shared: true, now });
    assert.equal(shared.ok, false);
    if (shared.ok) return;
    assert.equal(shared.error, "A public page is only for a room everyone can join.");
    assert.equal(await loadSharedGathering(db, id, now), null);
    const manRead = await readGatheringFor(db, { userId: man, id, now });
    assert.equal(manRead.ok, false);
    if (manRead.ok) return;
    assert.equal(manRead.status, 404);
    const listed = await listGatheringsFor(db, { userId: man, now });
    assert.equal(listed.some((row) => row.id === id), false);
    const womanRead = await readGatheringFor(db, { userId: woman, id, now });
    assert.equal(womanRead.ok, true);

    const cardId = randomUUID();
    await db.query(
      `insert into board_post
       (id, room_id, author_user_id, author_name, type, claim, reason, on_date, card_id, created_at)
       values ($1, 'sisters', $2, 'Woman', 'hosted', 'The lift happened.', 'She ran it.', '2026-10-18', $3, $4)`,
      [randomUUID(), woman, cardId, now],
    );
    const attended = await recordAttendance(db, man, now, [cardId]);
    assert.equal(attended.ok, false);
    if (attended.ok) return;
    assert.equal(attended.status, 404);
    const rows = await db.query<{ user_id: string }>(`select user_id from dm_attendance where user_id = $1`, [man]);
    assert.equal(rows.length, 0);
    const hers = await recordAttendance(db, woman, now, [cardId]);
    assert.equal(hers.ok, true);

    await setRoomAudience(db, { userId: man, roomId: "sisters", audience: "all", now });
    const opened = await setGatheringShared(db, { userId: woman, id, shared: true, now });
    assert.equal(opened.ok, true);
    assert.equal((await loadSharedGathering(db, id, now))?.title, "Saturday lifts");
    await setRoomAudience(db, { userId: man, roomId: "sisters", audience: "women", now });
    assert.equal(await loadSharedGathering(db, id, now), null);
  } finally {
    await close();
  }
});

test("deleting a member clears gender words from the audit", async () => {
  const { db, close } = await openTestDb();
  try {
    const admin = randomUUID();
    const member = randomUUID();
    await user(db, admin, "Admin", "admin-scrub@example.com");
    await user(db, member, "Member", "member-scrub@example.com");
    await grant(db, admin, "Admin", "member");
    await grant(db, member, "Member", "member");
    await grant(db, admin, "Admin", "admin");
    assert.equal((await setMemberGender(db, { actorUserId: member, subjectUserId: member, gender: "man", now })).ok, true);
    const changed = await setMemberGender(db, {
      actorUserId: admin,
      subjectUserId: member,
      gender: "woman",
      now,
    });
    assert.equal(changed.ok, true);
    await db.query(`delete from "user" where id = $1`, [member]);
    const rows = await db.query<{ detail: string }>(
      `select detail from gender_audit where subject_user_id is null or actor_user_id = $1`,
      [admin],
    );
    assert.equal(rows.length > 0, true);
    for (const row of rows) {
      assert.equal(row.detail.includes("man"), false);
      assert.equal(row.detail.includes("woman"), false);
    }
    const members = await db.query(`select user_id from members where user_id = $1`, [member]);
    assert.equal(members.length, 0);
    const board = await db.query<{ prosrc: string }>(
      `select prosrc from pg_proc where proname = 'anonymize_board_user'`,
    );
    assert.equal(board[0]?.prosrc.includes("gender_audit"), false);
  } finally {
    await close();
  }
});
