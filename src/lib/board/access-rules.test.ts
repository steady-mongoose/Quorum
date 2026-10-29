import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ADMIN_NOTE,
  FIRST_STEWARD_NOTE,
  STEWARD_NOTE,
  isLiveAdminLog,
  isRoomSteward,
  planAdminGrant,
  planMemberGrant,
  planRevoke,
  planStewardGrant,
  liveStewards,
  roomHasSteward,
  soleStewardRooms,
  withoutSteward,
  isReplacementError,
  replacementBarredError,
  replacementNotMemberError,
  type LogRow,
} from "./access-rules.ts";

const member = (id: string, userId: string, at: number): LogRow => ({
  id,
  userId,
  role: "member",
  roomId: "shop",
  action: "grant",
  at,
});

test("a steward is the inviter plus the room's steward, and the first one is the chair", () => {
  const log = [
    member("m-josh", "josh", 1),
    member("m-maria", "maria", 2),
    member("m-tom", "tom", 3),
  ];
  const self = planStewardGrant(log, {
    approverId: "josh",
    approverIsAdmin: true,
    approverIsChair: true,
    inviterId: "josh",
    targetId: "tom",
    roomId: "shop",
  });
  assert.equal(self.ok, false);

  const stranger = planStewardGrant(log, {
    approverId: "maria",
    approverIsAdmin: false,
    approverIsChair: false,
    inviterId: "josh",
    targetId: "tom",
    roomId: "shop",
  });
  assert.equal(stranger.ok, false);

  const first = planStewardGrant(log, {
    approverId: "josh",
    approverIsAdmin: true,
    approverIsChair: true,
    inviterId: "maria",
    targetId: "tom",
    roomId: "shop",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.plan.note, FIRST_STEWARD_NOTE);
  assert.equal(first.plan.vouchedByUserId, "maria");
  assert.equal(first.plan.approvedByUserId, "josh");

  const withTom: LogRow[] = [
    ...log,
    { id: "s-tom", userId: "tom", role: "steward", roomId: "shop", action: "grant", at: 4 },
  ];
  const chairAgain = planStewardGrant(withTom, {
    approverId: "josh",
    approverIsAdmin: true,
    approverIsChair: true,
    inviterId: "tom",
    targetId: "maria",
    roomId: "shop",
  });
  assert.equal(chairAgain.ok, false);
  const second = planStewardGrant(withTom, {
    approverId: "tom",
    approverIsAdmin: false,
    approverIsChair: false,
    inviterId: "josh",
    targetId: "maria",
    roomId: "shop",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.plan.note, STEWARD_NOTE);
  assert.equal(
    isRoomSteward(
      [...withTom, { ...second.plan, id: "s-maria", userId: "maria", action: "grant", at: 5 }],
      "maria",
      "shop",
    ),
    true,
  );
});

test("an admin is a steward plus the role owner's sign-off", () => {
  const log: LogRow[] = [
    member("m-josh", "josh", 1),
    member("m-maria", "maria", 2),
    member("m-tom", "tom", 3),
    { id: "s-tom", userId: "tom", role: "steward", roomId: "shop", action: "grant", at: 4 },
    { id: "s-maria", userId: "maria", role: "steward", roomId: "county", action: "grant", at: 5 },
    { id: "a-josh", userId: "josh", role: "admin", roomId: "", action: "grant", at: 1 },
  ];
  assert.equal(
    planAdminGrant(log, {
      ownerId: "tom",
      ownerIsAdmin: false,
      stewardId: "maria",
      targetId: "tom",
      targetIsAdmin: false,
    }).ok,
    false,
  );
  assert.equal(
    planAdminGrant(log, {
      ownerId: "josh",
      ownerIsAdmin: true,
      stewardId: "tom",
      targetId: "tom",
      targetIsAdmin: false,
    }).ok,
    false,
  );
  const granted = planAdminGrant(log, {
    ownerId: "josh",
    ownerIsAdmin: true,
    stewardId: "maria",
    targetId: "tom",
    targetIsAdmin: false,
  });
  assert.equal(granted.ok, true);
  if (!granted.ok) return;
  assert.equal(granted.plan.note, ADMIN_NOTE);
  assert.equal(granted.plan.roomId, "");
  const withAdmin: LogRow[] = [
    ...log,
    { id: "a-tom", userId: "tom", role: "admin", roomId: "", action: "grant", at: 6 },
  ];
  assert.equal(isLiveAdminLog(withAdmin, "tom"), true);
  const revoked = planRevoke(withAdmin, {
    actorId: "josh",
    actorIsAdmin: true,
    targetId: "tom",
    targetIsFounder: false,
    role: "admin",
    roomId: "",
  });
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  const after: LogRow[] = [
    ...withAdmin,
    { id: "r-tom", userId: "tom", role: "admin", roomId: "", action: "revoke", at: 7 },
  ];
  assert.equal(isLiveAdminLog(after, "tom"), false);
  assert.equal(
    planRevoke(log, {
      actorId: "josh",
      actorIsAdmin: true,
      targetId: "josh",
      targetIsFounder: true,
      role: "admin",
      roomId: "",
    }).ok,
    false,
  );
});

test("a member grant is one inviter and is refused twice", () => {
  const log = [member("m-josh", "josh", 1)];
  const maria = planMemberGrant(log, { inviterId: "josh", targetId: "maria", roomId: "shop" });
  assert.equal(maria.ok, true);
  if (!maria.ok) return;
  assert.equal(maria.plan.approvedByUserId, "");
  const next = [member("m-josh", "josh", 1), member("m-maria", "maria", 2)];
  assert.equal(
    planMemberGrant(next, { inviterId: "josh", targetId: "maria", roomId: "county" }).ok,
    false,
  );
});

test("revoking one room does not revoke another", () => {
  const log: LogRow[] = [
    member("m-tom", "tom", 1),
    { id: "s1", userId: "tom", role: "steward", roomId: "shop", action: "grant", at: 2 },
    { id: "s2", userId: "tom", role: "steward", roomId: "county", action: "grant", at: 3 },
  ];
  const revoked = planRevoke(log, {
    actorId: "josh",
    actorIsAdmin: true,
    targetId: "tom",
    targetIsFounder: false,
    role: "steward",
    roomId: "shop",
  });
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  const after: LogRow[] = [
    ...log,
    { id: "r1", userId: "tom", role: "steward", roomId: "shop", action: "revoke", at: 4 },
  ];
  assert.equal(isRoomSteward(after, "tom", "shop"), false);
  assert.equal(isRoomSteward(after, "tom", "county"), true);
});

test("the only steward of a room is found, and a second steward clears it", () => {
  const steward = (id: string, userId: string, roomId: string, at: number): LogRow => ({
    id,
    userId,
    role: "steward",
    roomId,
    action: "grant",
    at,
  });
  const log: LogRow[] = [steward("s1", "tom", "shop", 1), steward("s2", "tom", "choir", 2)];
  assert.deepEqual(soleStewardRooms(log, "tom"), ["choir", "shop"]);
  const two = [...log, steward("s3", "ann", "shop", 3)];
  assert.deepEqual(soleStewardRooms(two, "tom"), ["choir"]);
  assert.deepEqual(liveStewards(two, "shop"), ["ann", "tom"]);
  const after = withoutSteward(log, "tom", "shop", 9);
  assert.equal(roomHasSteward(after, "shop"), false);
  assert.equal(roomHasSteward(after, "choir"), true);
});

test("steward-replacement refusals use the exact copy and are recognised for focus", () => {
  assert.equal(
    replacementNotMemberError("Sam"),
    "Sam isn't a member of this room. Name a current member as the new steward.",
  );
  assert.equal(
    replacementBarredError("Sam"),
    "Sam is barred from this room or from Avouch Social, so they can't be the new steward. Name someone else.",
  );
  assert.equal(isReplacementError(replacementNotMemberError("Ann Lee")), true);
  assert.equal(isReplacementError(replacementBarredError("Ann Lee")), true);
  assert.equal(isReplacementError("That role was not changed."), false);
  // A server still on the older wording is still recognized during a split deploy.
  assert.equal(
    isReplacementError(
      "Sam is barred from this room or from Avouch, so they can't be the new steward. Name someone else.",
    ),
    true,
  );
});

test("a steward-replacement error focuses and marks the new steward field, as the door does", () => {
  const about = readFileSync(
    new URL("../../components/board/about-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(about, /isReplacementError\(message\)/);
  assert.match(about, /replacementRef\.current\?\.focus\(\)/);
  assert.match(about, /stewardRef=\{replacementRef\}/);
  assert.match(about, /aria-invalid=\{stewardInvalid \? true : undefined\}/);
  assert.match(about, /aria-describedby=\{stewardInvalid \? stewardErrorId : undefined\}/);
  assert.match(about, /stewardLabel="New steward email, if needed"/);
});
