import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  createGroupPost,
  GROUP_INVITE_ONLY,
  inviteToGroup,
  joinGroup,
  listGroup,
  listGroupInvites,
  revokeGroupInvite,
} from "./groups.ts";
import { GROUP_INVITE_ONLY as CLIENT_COPY } from "../../src/lib/board/group-client.ts";

const now = new Date("2026-10-29T12:00:00Z");
const COPY =
  "Only members of this group can post here. Ask a group admin or steward for an invite.";

async function member(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${name.toLowerCase()}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
  return id;
}

async function groupAdmin(db: Db, groupId: string, userId: string, name: string) {
  await db.query(`insert into theme_group_member (group_id, user_id) values ($1, $2)`, [
    groupId,
    userId,
  ]);
  await db.query(
    `insert into theme_group_admin (group_id, user_id, granted_by_user_id, granted_by_name)
     values ($1, $2, $2, $3)`,
    [groupId, userId, name],
  );
}

test("the non-member copy is plain and the same on server and client", () => {
  assert.equal(GROUP_INVITE_ONLY, COPY);
  assert.equal(CLIENT_COPY, COPY);
  const view = readFileSync(
    new URL("../../src/components/board/groups-view.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(view.includes('<p className="text-sm text-muted">{GROUP_INVITE_ONLY}</p>'));
  assert.equal(view.includes('"Join"'), false, "the open Join button is gone");
  assert.equal(view.includes("Join the group before you post."), false);
});

test("a join without an invite is refused, and posting shows the invite copy", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await member(db, "Ada");
    const joined = await joinGroup(db, { userId: ada, name: "Ada", groupId: "carpentry", now });
    assert.equal(joined.ok, false);
    if (!joined.ok) {
      assert.equal(joined.status, 403);
      assert.equal(joined.error, COPY);
    }
    const posted = await createGroupPost(db, {
      userId: ada,
      name: "Ada",
      groupId: "carpentry",
      body: "A bench for the porch.",
      on: "",
      now,
    });
    assert.equal(posted.ok, false);
    if (!posted.ok) assert.equal(posted.error, COPY);
  } finally {
    await close();
  }
});

test("a non-admin cannot invite or revoke; an admin invites and the member joins", async () => {
  const { db, close } = await openTestDb();
  try {
    const owner = await member(db, "Owen");
    const ada = await member(db, "Ada");
    const bo = await member(db, "Bo");
    await groupAdmin(db, "carpentry", owner, "Owen");

    const refused = await inviteToGroup(db, {
      userId: ada,
      name: "Ada",
      groupId: "carpentry",
      email: "bo@example.com",
      now,
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 403);
    const listRefused = await listGroupInvites(db, ada, "carpentry", now);
    assert.equal(listRefused.ok, false);

    const sent = await inviteToGroup(db, {
      userId: owner,
      name: "Owen",
      groupId: "carpentry",
      email: "ada@example.com",
      now,
    });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    const noRevoke = await revokeGroupInvite(db, {
      userId: bo,
      name: "Bo",
      groupId: "carpentry",
      inviteId: sent.value.id,
      now,
    });
    assert.equal(noRevoke.ok, false);
    if (!noRevoke.ok) assert.equal(noRevoke.status, 403);

    const page = await listGroup(db, ada, "carpentry", now);
    assert.equal(page.ok, true);
    if (page.ok) {
      assert.equal(page.value.group.invited, true);
      assert.equal(page.value.group.canInvite, false);
    }
    const joined = await joinGroup(db, { userId: ada, name: "Ada", groupId: "carpentry", now });
    assert.equal(joined.ok, true);
    const used = await db.query<{ used_at: Date | null }>(
      `select used_at from theme_group_invite where id = $1`,
      [sent.value.id],
    );
    assert.ok(used[0]?.used_at);
    const log = await db.query<{ action: string }>(
      `select action from theme_group_log where group_id = 'carpentry' order by created_at, action`,
    );
    assert.ok(log.some((row) => row.action === "invite"));
  } finally {
    await close();
  }
});

test("a revoked invite does not let the member join", async () => {
  const { db, close } = await openTestDb();
  try {
    const owner = await member(db, "Owen");
    const ada = await member(db, "Ada");
    await groupAdmin(db, "gardening", owner, "Owen");
    const sent = await inviteToGroup(db, {
      userId: owner,
      name: "Owen",
      groupId: "gardening",
      email: "ada@example.com",
      now,
    });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    const revoked = await revokeGroupInvite(db, {
      userId: owner,
      name: "Owen",
      groupId: "gardening",
      inviteId: sent.value.id,
      now,
    });
    assert.equal(revoked.ok, true);
    const joined = await joinGroup(db, { userId: ada, name: "Ada", groupId: "gardening", now });
    assert.equal(joined.ok, false);
    if (!joined.ok) {
      assert.equal(joined.status, 403);
      assert.equal(joined.error, COPY);
    }
    const again = await revokeGroupInvite(db, {
      userId: owner,
      name: "Owen",
      groupId: "gardening",
      inviteId: sent.value.id,
      now,
    });
    assert.equal(again.ok, false);
  } finally {
    await close();
  }
});

test("a group steward can invite", async () => {
  const { db, close } = await openTestDb();
  try {
    const sue = await member(db, "Sue");
    await member(db, "Ada");
    await db.query(
      `insert into theme_group_steward (group_id, user_id, granted_by_user_id, granted_by_name)
       values ('brewing', $1, $1, 'Sue')`,
      [sue],
    );
    const sent = await inviteToGroup(db, {
      userId: sue,
      name: "Sue",
      groupId: "brewing",
      email: "ada@example.com",
      now,
    });
    assert.equal(sent.ok, true);
    const listed = await listGroupInvites(db, sue, "brewing", now);
    assert.equal(listed.ok, true);
    if (listed.ok)
      assert.deepEqual(
        listed.value.invites.map((row) => row.name),
        ["Ada"],
      );
  } finally {
    await close();
  }
});
