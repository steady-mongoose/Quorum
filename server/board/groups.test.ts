import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  appealGroupPost,
  createGroupPost,
  decideGroupAppeal,
  decideGroupRequest,
  joinGroup,
  leaveGroup,
  listGroup,
  listGroupAppeals,
  listGroupLog,
  listGroupRequests,
  listGroups,
  markGroupPost,
  removeGroupPost,
  requestGroup,
  setGroupAdmin,
} from "./groups.ts";

const now = new Date("2026-10-19T12:00:00Z");

function later(ms: number): Date {
  return new Date(now.getTime() + ms);
}

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
  await db.query(`insert into room_member (room_id, user_id) values ($1, $2)`, [roomId, userId]);
}

test("migration 0012 seeds the five theme groups and has no counts", async () => {
  const sql = readFileSync(
    new URL("../../migrations/0012_theme_groups.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /Numbered 0012/);
  assert.match(sql, /not applied/);
  assert.match(sql, /owner must approve/);
  for (const theme of ["carpentry", "gardening", "brewing", "distilling", "Literary society"]) {
    assert.match(sql, new RegExp(theme));
  }
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  for (const banned of ["like_count", "likes", "score", "reshare", "rank"]) {
    assert.equal(code.includes(banned), false, banned);
  }

  const { db, close } = await openTestDb();
  try {
    const listed = await listGroups(db, randomUUID(), now);
    assert.equal(listed.ok, false);

    const maria = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await grant(db, maria, "Maria", "member");
    const groups = await listGroups(db, maria, now);
    assert.equal(groups.ok, true);
    if (!groups.ok) return;
    assert.deepEqual(
      groups.value.groups.map((group) => group.name),
      ["Brewing", "Carpentry", "Distilling", "Gardening", "Literary society"],
    );
    assert.deepEqual(
      groups.value.groups.map((group) => group.id),
      ["brewing", "carpentry", "distilling", "gardening", "literary"],
    );
    assert.equal(
      groups.value.groups.every((group) => group.joined === false),
      true,
    );
    assert.equal("postCount" in groups.value.groups[0]!, false);
    await joinGroup(db, { userId: maria, name: "Maria", groupId: "distilling", now });
    await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "distilling",
      body: "The barrel is labeled and set aside.",
      on: "",
      now,
    });
    const busy = await listGroups(db, maria, now);
    assert.equal(busy.ok, true);
    if (!busy.ok) return;
    assert.equal(busy.value.groups[0]?.id, "brewing");
    assert.equal(busy.value.groups[3]?.id, "gardening");

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name like 'theme_group%'`,
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
    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where indexname in (
         'theme_group_post_page_idx',
         'theme_group_request_one_open',
         'theme_group_appeal_one_open',
         'theme_group_log_group_idx'
       )`,
    );
    assert.equal(indexes.length, 4);
  } finally {
    await close();
  }
});

test("a steward of that room approves a group, and the requester becomes an admin", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    const tom = randomUUID();
    const pete = randomUUID();
    const ada = randomUUID();
    const ruth = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, tom, "Tom", "tom@example.com");
    await user(db, pete, "Pete", "pete@example.com");
    await user(db, ada, "Ada", "ada@example.com");
    await user(db, ruth, "Ruth", "ruth@example.com");
    for (const [id, name] of [
      [maria, "Maria"],
      [josh, "Josh"],
      [tom, "Tom"],
      [pete, "Pete"],
      [ada, "Ada"],
      [ruth, "Ruth"],
    ] as const) {
      await grant(db, id, name, "member");
    }
    await grant(db, josh, "Josh", "steward", "shop");
    await grant(db, tom, "Tom", "steward", "county");
    await grant(db, ada, "Ada", "steward", "");
    await stand(db, "shop", maria);
    await stand(db, "shop", ruth);

    const kanji = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "木工",
      about: "木工の夜",
      now,
    });
    assert.equal(kanji.ok, false);
    if (kanji.ok) return;
    assert.equal(kanji.error, "Write it in English.");

    const unjoined = await requestGroup(db, {
      userId: pete,
      name: "Pete",
      roomId: "shop",
      groupName: "Beekeeping",
      about: "Hives and the first spring check.",
      now,
    });
    assert.equal(unjoined.ok, false);

    const duplicate = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Carpentry",
      about: "Another bench night.",
      now,
    });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.equal(duplicate.status, 409);

    const asked = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Beekeeping",
      about: "Hives and the first spring check.",
      now: later(1),
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    assert.equal(asked.value.groupId, "beekeeping");
    const before = await listGroups(db, pete, now);
    assert.equal(
      before.ok && before.value.groups.some((group) => group.id === "beekeeping"),
      false,
    );

    const second = await requestGroup(db, {
      userId: ruth,
      name: "Ruth",
      roomId: "shop",
      groupName: "Beekeeping",
      about: "Also hives.",
      now: later(2),
    });
    assert.equal(second.ok, false);

    assert.equal(
      (
        await decideGroupRequest(db, {
          userId: tom,
          name: "Tom",
          requestId: asked.value.id,
          decision: "approved",
          note: "Members asked for this group.",
          now: later(3),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await decideGroupRequest(db, {
          userId: maria,
          name: "Maria",
          requestId: asked.value.id,
          decision: "approved",
          note: "Members asked for this group.",
          now: later(3),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await decideGroupRequest(db, {
          userId: pete,
          name: "Pete",
          requestId: asked.value.id,
          decision: "approved",
          note: "Members asked for this group.",
          now: later(3),
        })
      ).ok,
      false,
    );
    const blank = await decideGroupRequest(db, {
      userId: josh,
      name: "Josh",
      requestId: asked.value.id,
      decision: "approved",
      note: "Fine.",
      now: later(3),
    });
    assert.equal(blank.ok, false);

    const approved = await decideGroupRequest(db, {
      userId: josh,
      name: "Josh",
      requestId: asked.value.id,
      decision: "approved",
      note: "Members asked for this group.",
      now: later(4),
    });
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.value.groupId, "beekeeping");
    assert.equal(approved.value.request.note, "Members asked for this group.");

    const directory = await listGroups(db, maria, now);
    assert.equal(directory.ok, true);
    if (!directory.ok) return;
    assert.deepEqual(
      directory.value.groups.map((group) => group.name),
      ["Beekeeping", "Brewing", "Carpentry", "Distilling", "Gardening", "Literary society"],
    );
    const bees = directory.value.groups[0];
    assert.equal(bees?.admin, true);
    assert.equal(bees?.joined, true);

    const weaving = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Knifemaking",
      about: "Blades and handles, not a shop voucher.",
      now: later(5),
    });
    assert.equal(weaving.ok, true);
    if (!weaving.ok) return;
    const refused = await decideGroupRequest(db, {
      userId: josh,
      name: "Josh",
      requestId: weaving.value.id,
      decision: "refused",
      note: "Not for this season.",
      now: later(6),
    });
    assert.equal(refused.ok, true);
    if (!refused.ok) return;
    assert.equal(refused.value.groupId, null);
    const afterRefuse = await listGroups(db, maria, now);
    assert.equal(
      afterRefuse.ok && afterRefuse.value.groups.some((group) => group.id === "knifemaking"),
      false,
    );

    const needle = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Needlework",
      about: "Mending and the evening circle.",
      now: later(7),
    });
    assert.equal(needle.ok, true);
    if (!needle.ok) return;
    const global = await decideGroupRequest(db, {
      userId: ada,
      name: "Ada",
      requestId: needle.value.id,
      decision: "approved",
      note: "A global steward can decide this.",
      now: later(8),
    });
    assert.equal(global.ok, true);

    const mine = await listGroupRequests(db, ruth, now);
    assert.equal(mine.ok, true);
    if (!mine.ok) return;
    assert.equal(mine.value.requests.length, 0);
    const stewardList = await listGroupRequests(db, josh, now);
    assert.equal(stewardList.ok, true);
    if (!stewardList.ok) return;
    assert.equal(
      stewardList.value.requests.some((row) => row.groupId === "beekeeping"),
      true,
    );

    const log = await listGroupLog(db, maria, "beekeeping", now);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    assert.deepEqual(log.value.entries.map((entry) => entry.action).sort(), ["approve", "request"]);
    const hidden = await listGroupLog(db, pete, "beekeeping", now);
    assert.equal(hidden.ok, false);
    if (hidden.ok) return;
    assert.equal(hidden.status, 403);
  } finally {
    await close();
  }
});

test("group posts stay newest first, and a mark or a date does not move one", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, josh, "Josh", "steward", "");
    await stand(db, "shop", maria);
    const asked = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Beekeeping",
      about: "Hives and the first spring check.",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    await decideGroupRequest(db, {
      userId: josh,
      name: "Josh",
      requestId: asked.value.id,
      decision: "approved",
      note: "Members asked for this group.",
      now: later(1),
    });

    const outsider = await createGroupPost(db, {
      userId: josh,
      name: "Josh",
      groupId: "beekeeping",
      body: "I have not joined.",
      on: "",
      now: later(2),
    });
    assert.equal(outsider.ok, false);

    const russian = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "beekeeping",
      body: "Сегодня смотрел ульи.",
      on: "",
      now: later(2),
    });
    assert.equal(russian.ok, false);
    const threat = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "beekeeping",
      body: "I will kill him if he moves the hive.",
      on: "",
      now: later(2),
    });
    assert.equal(threat.ok, false);

    const older = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "beekeeping",
      body: "Saturday bench, bring a hand plane.",
      on: "2026-12-01",
      now: later(3),
      id: "post-old",
    });
    assert.equal(older.ok, true);
    if (!older.ok) return;
    const before = await db.query<{ created_at: Date }>(
      `select created_at from theme_group_post where id = $1`,
      [older.value.id],
    );
    await joinGroup(db, { userId: josh, name: "Josh", groupId: "beekeeping", now: later(4) });
    const newer = await createGroupPost(db, {
      userId: josh,
      name: "Josh",
      groupId: "beekeeping",
      body: "The Saturday pour is at the hall.",
      on: "",
      now: later(5),
      id: "post-new",
    });
    assert.equal(newer.ok, true);
    const tiedOld = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "carpentry",
      body: "This post is not in beekeeping.",
      on: "",
      now: later(6),
    });
    assert.equal(tiedOld.ok, false);

    await db.query(
      `insert into theme_group_admin (group_id, user_id, granted_by_user_id, granted_by_name, created_at)
       values ('carpentry', $1, $1, 'Josh', $2)`,
      [josh, later(6)],
    );
    await joinGroup(db, { userId: maria, name: "Maria", groupId: "carpentry", now: later(6) });
    const tieA = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "carpentry",
      body: "First tied note about the bench.",
      on: "",
      now: later(7),
      id: "post-a",
    });
    const tieB = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "carpentry",
      body: "Second tied note about the bench.",
      on: "",
      now: later(7),
      id: "post-b",
    });
    assert.equal(tieA.ok && tieB.ok, true);

    const marked = await markGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: "post-old",
      mark: "sloppy",
      reason: "The note does not say which Saturday.",
      now: later(8),
    });
    assert.equal(marked.ok, false);

    await db.query(
      `insert into theme_group_admin (group_id, user_id, granted_by_user_id, granted_by_name, created_at)
       values ('beekeeping', $1, $1, 'Josh', $2)
       on conflict do nothing`,
      [josh, later(8)],
    );
    const stewardMark = await markGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: older.value.id,
      mark: "unsupported",
      reason: "The note does not say which Saturday.",
      now: later(9),
    });
    assert.equal(stewardMark.ok, true);
    if (!stewardMark.ok) return;
    assert.equal(stewardMark.value.post.mark, "unsupported");
    assert.equal("score" in stewardMark.value.post, false);
    const after = await db.query<{ created_at: Date }>(
      `select created_at from theme_group_post where id = $1`,
      [older.value.id],
    );
    assert.equal(
      new Date(after[0]!.created_at).getTime(),
      new Date(before[0]!.created_at).getTime(),
    );

    const page = await listGroup(db, maria, "beekeeping", now, { limit: 1 });
    assert.equal(page.ok, true);
    if (!page.ok) return;
    assert.deepEqual(
      page.value.posts.map((post) => post.id),
      ["post-new"],
    );
    assert.equal(page.value.posts[0]?.mark, null);
    assert.ok(page.value.next);
    const rest = await listGroup(db, maria, "beekeeping", now, {
      limit: 1,
      cursor: page.value.next,
    });
    assert.equal(rest.ok, true);
    if (!rest.ok) return;
    assert.deepEqual(
      rest.value.posts.map((post) => post.id),
      ["post-old"],
    );
    assert.equal(rest.value.posts[0]?.mark, "unsupported");
    assert.equal(rest.value.posts[0]?.on, "2026-12-01");

    const ties = await listGroup(db, maria, "carpentry", now);
    assert.equal(ties.ok, true);
    if (!ties.ok) return;
    assert.deepEqual(
      ties.value.posts.map((post) => post.id),
      ["post-b", "post-a"],
    );

    const badPage = await listGroup(db, maria, "carpentry", now, { cursor: "nope" });
    assert.equal(badPage.ok, false);
  } finally {
    await close();
  }
});

test("each group admin moderates only that group, and the removal is logged", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const luis = randomUUID();
    const ruth = randomUUID();
    const josh = randomUUID();
    const pete = randomUUID();
    const owner = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, luis, "Luis", "luis@example.com");
    await user(db, ruth, "Ruth", "ruth@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, pete, "Pete", "pete@example.com");
    await user(db, owner, "Owner", "owner@example.com");
    for (const [id, name] of [
      [maria, "Maria"],
      [luis, "Luis"],
      [ruth, "Ruth"],
      [josh, "Josh"],
      [pete, "Pete"],
    ] as const) {
      await grant(db, id, name, "member");
    }
    await grant(db, josh, "Josh", "steward", "");
    await db.query(
      `insert into member_role (user_id, is_admin, is_council, is_council_chair) values ($1, true, true, true)`,
      [owner],
    );
    await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1)`, [owner]);

    await joinGroup(db, { userId: maria, name: "Maria", groupId: "carpentry", now });
    await joinGroup(db, { userId: maria, name: "Maria", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: luis, name: "Luis", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: ruth, name: "Ruth", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: josh, name: "Josh", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: owner, name: "Owner", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: pete, name: "Pete", groupId: "carpentry", now: later(1) });
    await joinGroup(db, { userId: maria, name: "Maria", groupId: "gardening", now: later(1) });

    const appointed = await setGroupAdmin(db, {
      userId: josh,
      name: "Josh",
      groupId: "carpentry",
      email: "maria@example.com",
      action: "grant",
      now: later(2),
    });
    assert.equal(appointed.ok, true);
    const again = await setGroupAdmin(db, {
      userId: maria,
      name: "Maria",
      groupId: "carpentry",
      email: "luis@example.com",
      action: "grant",
      now: later(3),
    });
    assert.equal(again.ok, true);
    const stranger = await setGroupAdmin(db, {
      userId: ruth,
      name: "Ruth",
      groupId: "carpentry",
      email: "ruth@example.com",
      action: "grant",
      now: later(3),
    });
    assert.equal(stranger.ok, false);

    const memberPost = await createGroupPost(db, {
      userId: ruth,
      name: "Ruth",
      groupId: "carpentry",
      body: "The oak is checked and stacked.",
      on: "",
      now: later(4),
    });
    assert.equal(memberPost.ok, true);
    if (!memberPost.ok) return;
    const garden = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "gardening",
      body: "The beds are mulched for the week.",
      on: "",
      now: later(5),
    });
    assert.equal(garden.ok, true);
    if (!garden.ok) return;

    assert.equal(
      (
        await markGroupPost(db, {
          userId: ruth,
          name: "Ruth",
          postId: memberPost.value.id,
          mark: "sloppy",
          reason: "The note does not say which oak.",
          now: later(6),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await markGroupPost(db, {
          userId: maria,
          name: "Maria",
          postId: garden.value.id,
          mark: "sloppy",
          reason: "The note does not say which bed.",
          now: later(6),
        })
      ).ok,
      false,
    );
    const marked = await markGroupPost(db, {
      userId: luis,
      name: "Luis",
      postId: memberPost.value.id,
      mark: "sloppy",
      reason: "The note does not say which oak.",
      now: later(7),
    });
    assert.equal(marked.ok, true);
    if (!marked.ok) return;
    assert.equal(marked.value.row.by, "Luis");

    const ownerPost = await createGroupPost(db, {
      userId: owner,
      name: "Owner",
      groupId: "carpentry",
      body: "The owner left a note about the bench.",
      on: "",
      now: later(8),
    });
    const stewardPost = await createGroupPost(db, {
      userId: josh,
      name: "Josh",
      groupId: "carpentry",
      body: "The steward left a note about the bench.",
      on: "",
      now: later(9),
    });
    assert.equal(ownerPost.ok && stewardPost.ok, true);
    if (!ownerPost.ok || !stewardPost.ok) return;
    const blockedOwner = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: ownerPost.value.id,
      reason: "threat",
      now: later(10),
    });
    assert.equal(blockedOwner.ok, false);
    if (blockedOwner.ok) return;
    assert.equal(blockedOwner.error, "The owner cannot be barred.");
    const blockedSteward = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: stewardPost.value.id,
      reason: "threat",
      now: later(10),
    });
    assert.equal(blockedSteward.ok, false);
    if (blockedSteward.ok) return;
    assert.equal(blockedSteward.error, "A steward cannot bar another steward.");
    const badRule = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: memberPost.value.id,
      reason: "sloppy",
      now: later(10),
    });
    assert.equal(badRule.ok, false);

    const removed = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: memberPost.value.id,
      reason: "threat",
      now: later(11),
    });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.value.removal.reason, "threat");
    const bans = await db.query<{ id: string }>(`select id from board_ban`);
    assert.equal(bans.length, 0);

    const feed = await listGroup(db, pete, "carpentry", now);
    assert.equal(feed.ok, true);
    if (!feed.ok) return;
    assert.equal(
      feed.value.posts.some((post) => post.id === memberPost.value.id),
      false,
    );
    assert.equal(feed.value.removals.length, 0);
    const authorView = await listGroup(db, ruth, "carpentry", now);
    assert.equal(authorView.ok, true);
    if (!authorView.ok) return;
    assert.equal(authorView.value.removals[0]?.reason, "threat");
    const adminView = await listGroup(db, maria, "carpentry", now);
    assert.equal(adminView.ok, true);
    if (!adminView.ok) return;
    assert.equal(adminView.value.removals[0]?.reason, "threat");
    assert.deepEqual(adminView.value.group.admins, ["Luis", "Maria"]);

    const joins = await db.query<{ action: string }>(
      `select action from theme_group_log where group_id = 'carpentry' and action = 'join'`,
    );
    assert.equal(joins.length, 6);

    await leaveGroup(db, { userId: ruth, name: "Ruth", groupId: "carpentry", now: later(12) });
    const left = await createGroupPost(db, {
      userId: ruth,
      name: "Ruth",
      groupId: "carpentry",
      body: "I left and should not be able to post.",
      on: "",
      now: later(13),
    });
    assert.equal(left.ok, false);
    await leaveGroup(db, { userId: maria, name: "Maria", groupId: "carpentry", now: later(14) });
    const stillAdmin = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "carpentry",
      body: "An admin can still post after leaving.",
      on: "",
      now: later(15),
    });
    assert.equal(stillAdmin.ok, true);

    const revoked = await setGroupAdmin(db, {
      userId: josh,
      name: "Josh",
      groupId: "carpentry",
      email: "Luis@Example.com",
      action: "revoke",
      now: later(16),
    });
    assert.equal(revoked.ok, true);
    const luisMark = await markGroupPost(db, {
      userId: luis,
      name: "Luis",
      postId: stewardPost.value.id,
      mark: "unsupported",
      reason: "The note does not say where that came from.",
      now: later(17),
    });
    assert.equal(luisMark.ok, false);

    const log = await listGroupLog(db, josh, "carpentry", now);
    assert.equal(log.ok, true);
    if (!log.ok) return;
    for (const action of [
      "join",
      "grant-admin",
      "post",
      "mark",
      "remove",
      "leave",
      "revoke-admin",
    ]) {
      assert.equal(
        log.value.entries.some((entry) => entry.action === action),
        true,
        action,
      );
    }
    assert.equal(log.value.entries[0]?.action, "revoke-admin");
  } finally {
    await close();
  }
});

test("the author appeals to a steward, who can lift or uphold", async () => {
  const { db, close } = await openTestDb();
  try {
    const maria = randomUUID();
    const josh = randomUUID();
    const ada = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, ada, "Ada", "ada@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, ada, "Ada", "member");
    await grant(db, josh, "Josh", "steward", "");
    await grant(db, ada, "Ada", "steward", "");
    await joinGroup(db, { userId: maria, name: "Maria", groupId: "brewing", now });
    await joinGroup(db, { userId: josh, name: "Josh", groupId: "brewing", now });
    await setGroupAdmin(db, {
      userId: ada,
      name: "Ada",
      groupId: "brewing",
      email: "maria@example.com",
      action: "grant",
      now: later(1),
    });
    const posted = await createGroupPost(db, {
      userId: josh,
      name: "Josh",
      groupId: "brewing",
      body: "The porter finished in the barrel.",
      on: "",
      now: later(2),
      id: "brew-old",
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const newer = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "brewing",
      body: "The next brew day is Thursday.",
      on: "",
      now: later(3),
      id: "brew-new",
    });
    assert.equal(newer.ok, true);
    const marked = await markGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      mark: "unsupported",
      reason: "The note does not say which barrel.",
      now: later(4),
    });
    assert.equal(marked.ok, true);

    const foreign = await appealGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      text: "This was not my post to appeal.",
      now: later(5),
    });
    assert.equal(foreign.ok, false);
    const kanji = await appealGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: posted.value.id,
      text: "木工の夜",
      now: later(5),
    });
    assert.equal(kanji.ok, false);
    const appeal = await appealGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: posted.value.id,
      text: "The claim is sourced in the thread.",
      now: later(6),
    });
    assert.equal(appeal.ok, true);
    if (!appeal.ok) return;
    const again = await appealGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: posted.value.id,
      text: "The claim is sourced in the thread again.",
      now: later(7),
    });
    assert.equal(again.ok, false);

    const memberDecides = await decideGroupAppeal(db, {
      userId: maria,
      name: "Maria",
      appealId: appeal.value.id,
      decision: "lifted",
      now: later(8),
    });
    assert.equal(memberDecides.ok, false);
    const own = await decideGroupAppeal(db, {
      userId: josh,
      name: "Josh",
      appealId: appeal.value.id,
      decision: "lifted",
      now: later(8),
    });
    assert.equal(own.ok, false);
    const lifted = await decideGroupAppeal(db, {
      userId: ada,
      name: "Ada",
      appealId: appeal.value.id,
      decision: "lifted",
      now: later(9),
    });
    assert.equal(lifted.ok, true);
    if (!lifted.ok) return;
    assert.equal(lifted.value.post.mark, null);
    assert.equal(lifted.value.post.removed, false);
    assert.equal(lifted.value.appeal.decidedBy, "Ada");
    const order = await listGroup(db, maria, "brewing", now);
    assert.equal(order.ok, true);
    if (!order.ok) return;
    assert.deepEqual(
      order.value.posts.map((post) => post.id),
      ["brew-new", "brew-old"],
    );

    const gone = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: "brew-new",
      reason: "porn",
      now: later(10),
    });
    assert.equal(gone.ok, true);
    const removalAppeal = await appealGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: "brew-new",
      text: "This was a false removal.",
      now: later(11),
    });
    assert.equal(removalAppeal.ok, true);
    if (!removalAppeal.ok) return;
    const upheld = await decideGroupAppeal(db, {
      userId: ada,
      name: "Ada",
      appealId: removalAppeal.value.id,
      decision: "upheld",
      now: later(12),
    });
    assert.equal(upheld.ok, true);
    if (!upheld.ok) return;
    assert.equal(upheld.value.post.removed, true);
    const hidden = await listGroup(db, josh, "brewing", now);
    assert.equal(hidden.ok && hidden.value.posts.some((post) => post.id === "brew-new"), false);
    assert.equal(hidden.ok && hidden.value.posts.some((post) => post.id === "brew-old"), true);

    const back = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "brewing",
      body: "This note comes back when the appeal is lifted.",
      on: "",
      now: later(13),
      id: "brew-back",
    });
    assert.equal(back.ok, true);
    const removedBack = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: "brew-back",
      reason: "csam",
      now: later(14),
    });
    assert.equal(removedBack.ok, true);
    const backAppeal = await appealGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: "brew-back",
      text: "Put this note back where it was.",
      now: later(15),
    });
    assert.equal(backAppeal.ok, true);
    if (!backAppeal.ok) return;
    const liftedBack = await decideGroupAppeal(db, {
      userId: ada,
      name: "Ada",
      appealId: backAppeal.value.id,
      decision: "lifted",
      now: later(16),
    });
    assert.equal(liftedBack.ok, true);
    if (!liftedBack.ok) return;
    assert.equal(liftedBack.value.post.removed, false);
    const restored = await listGroup(db, josh, "brewing", now);
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.deepEqual(
      restored.value.posts.map((post) => post.id),
      ["brew-back", "brew-old"],
    );

    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, $2, 'Josh', 'threat', 'Ada', 1, $3, $4)`,
      [randomUUID(), josh, later(40 * 24 * 60 * 60 * 1000), later(20)],
    );
    const barredRead = await listGroups(db, josh, later(21));
    assert.equal(barredRead.ok, false);
    const secondPost = await createGroupPost(db, {
      userId: maria,
      name: "Maria",
      groupId: "brewing",
      body: "Another note for the barred author to appeal.",
      on: "",
      now: later(22),
    });
    assert.equal(secondPost.ok, true);
    if (!secondPost.ok) return;
    await markGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: secondPost.value.id,
      mark: "sloppy",
      reason: "The note does not say which week.",
      now: later(23),
    });
    await db.query(
      `update theme_group_post set author_user_id = $2, author_name = 'Josh' where id = $1`,
      [secondPost.value.id, josh],
    );
    const barredAppeal = await appealGroupPost(db, {
      userId: josh,
      name: "Josh",
      postId: secondPost.value.id,
      text: "I can still appeal while barred.",
      now: later(24),
    });
    assert.equal(barredAppeal.ok, true);
    const ownAppeals = await listGroupAppeals(db, josh, later(25));
    assert.equal(ownAppeals.ok, true);
    if (!ownAppeals.ok) return;
    assert.equal(
      ownAppeals.value.appeals.some((row) => row.text === "I can still appeal while barred."),
      true,
    );
  } finally {
    await close();
  }
});

test("deleting an account clears that name from the group tables", async () => {
  const { db, close } = await openTestDb();
  try {
    const functions = await db.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc where proname like 'anonymize%' order by proname`,
    );
    assert.deepEqual(
      functions.map((row) => row.proname),
      ["anonymize_board_user", "anonymize_theme_group_user"],
    );
    const boardFn = functions.find((row) => row.proname === "anonymize_board_user");
    const groupFn = functions.find((row) => row.proname === "anonymize_theme_group_user");
    assert.equal(boardFn?.prosrc.includes("theme_group"), false);
    assert.equal(groupFn?.prosrc.includes("board_post"), false);
    assert.match(groupFn?.prosrc ?? "", /theme_group_post/);
    const triggers = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgrelid = '"user"'::regclass and not tgisinternal`,
    );
    const triggerNames = triggers.map((row) => row.tgname);
    assert.equal(triggerNames.includes("anonymize_board_user"), true);
    assert.equal(triggerNames.includes("anonymize_theme_group_user"), true);

    const maria = randomUUID();
    const josh = randomUUID();
    const luis = randomUUID();
    await user(db, maria, "Maria", "maria@example.com");
    await user(db, josh, "Josh", "josh@example.com");
    await user(db, luis, "Luis", "luis@example.com");
    await grant(db, maria, "Maria", "member");
    await grant(db, josh, "Josh", "member");
    await grant(db, luis, "Luis", "member");
    await grant(db, josh, "Josh", "steward", "shop");
    await stand(db, "shop", maria);
    const asked = await requestGroup(db, {
      userId: maria,
      name: "Maria",
      roomId: "shop",
      groupName: "Beekeeping",
      about: "Hives and the first spring check.",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    const approved = await decideGroupRequest(db, {
      userId: josh,
      name: "Josh",
      requestId: asked.value.id,
      decision: "approved",
      note: "Members asked for this group.",
      now: later(1),
    });
    assert.equal(approved.ok, true);
    await joinGroup(db, { userId: luis, name: "Luis", groupId: "beekeeping", now: later(2) });
    const appointed = await setGroupAdmin(db, {
      userId: maria,
      name: "Maria",
      groupId: "beekeeping",
      email: "luis@example.com",
      action: "grant",
      now: later(3),
    });
    assert.equal(appointed.ok, true);
    const posted = await createGroupPost(db, {
      userId: luis,
      name: "Luis",
      groupId: "beekeeping",
      body: "The Saturday hive check is at the hall.",
      on: "",
      now: later(4),
    });
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const marked = await markGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      mark: "sloppy",
      reason: "The note does not say which hall.",
      now: later(5),
    });
    assert.equal(marked.ok, true);
    const removed = await removeGroupPost(db, {
      userId: maria,
      name: "Maria",
      postId: posted.value.id,
      reason: "threat",
      now: later(6),
    });
    assert.equal(removed.ok, true);
    const appeal = await appealGroupPost(db, {
      userId: luis,
      name: "Luis",
      postId: posted.value.id,
      text: "This note should stay up.",
      now: later(7),
    });
    assert.equal(appeal.ok, true);
    if (!appeal.ok) return;
    const upheld = await decideGroupAppeal(db, {
      userId: josh,
      name: "Josh",
      appealId: appeal.value.id,
      decision: "upheld",
      now: later(8),
    });
    assert.equal(upheld.ok, true);
    await db.query(
      `insert into board_post
       (id, room_id, author_user_id, author_name, type, claim, reason, on_date, created_at)
       values ($1, 'shop', $2, 'Maria', 'did', 'Sharpened the chisels in the shop.', 'Tom checked them on Thursday.', '2026-10-18', $3)`,
      [randomUUID(), maria, now],
    );

    await db.query(`delete from "user" where id = $1`, [maria]);

    const post = await db.query<{ author_name: string; author_user_id: string | null }>(
      `select author_name, author_user_id from theme_group_post where id = $1`,
      [posted.value.id],
    );
    assert.equal(post[0]?.author_name, "Luis");
    assert.equal(post[0]?.author_user_id, luis);
    const mark = await db.query<{
      author_name: string;
      by_name: string;
      by_user_id: string | null;
    }>(`select author_name, by_name, by_user_id from theme_group_mark where post_id = $1`, [
      posted.value.id,
    ]);
    assert.equal(mark[0]?.author_name, "Luis");
    assert.equal(mark[0]?.by_name, "Removed member");
    assert.equal(mark[0]?.by_user_id, null);
    const removal = await db.query<{ author_name: string; by_name: string }>(
      `select author_name, by_name from theme_group_removal where post_id = $1`,
      [posted.value.id],
    );
    assert.equal(removal[0]?.author_name, "Luis");
    assert.equal(removal[0]?.by_name, "Removed member");
    const request = await db.query<{ by_name: string; decided_by_name: string }>(
      `select by_name, decided_by_name from theme_group_request where id = $1`,
      [asked.value.id],
    );
    assert.equal(request[0]?.by_name, "Removed member");
    assert.equal(request[0]?.decided_by_name, "Josh");
    const decided = await db.query<{ by_name: string; decided_by_name: string }>(
      `select by_name, decided_by_name from theme_group_appeal where id = $1`,
      [appeal.value.id],
    );
    assert.equal(decided[0]?.by_name, "Luis");
    assert.equal(decided[0]?.decided_by_name, "Josh");
    const admins = await db.query<{ user_id: string; granted_by_name: string }>(
      `select user_id, granted_by_name from theme_group_admin where group_id = 'beekeeping'`,
    );
    assert.deepEqual(
      admins.map((row) => row.user_id),
      [luis],
    );
    assert.equal(admins[0]?.granted_by_name, "Removed member");
    const actors = await db.query<{ actor_name: string }>(
      `select actor_name from theme_group_log where group_id = 'beekeeping'`,
    );
    assert.equal(
      actors.some((row) => row.actor_name === "Maria"),
      false,
    );
    assert.equal(
      actors.some((row) => row.actor_name === "Josh"),
      true,
    );
    assert.equal(
      actors.some((row) => row.actor_name === "Luis"),
      true,
    );
    const board = await db.query<{ author_name: string; author_user_id: string | null }>(
      `select author_name, author_user_id from board_post where author_name = 'Removed member' or author_user_id = $1`,
      [maria],
    );
    assert.equal(board[0]?.author_name, "Removed member");
    assert.equal(board[0]?.author_user_id, null);
  } finally {
    await close();
  }
});
