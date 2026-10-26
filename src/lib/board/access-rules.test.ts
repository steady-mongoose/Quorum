import assert from "node:assert/strict";
import test from "node:test";
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
  const log = [member("m-josh", "josh", 1), member("m-maria", "maria", 2), member("m-tom", "tom", 3)];
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
  assert.equal(isRoomSteward([...withTom, { ...second.plan, id: "s-maria", userId: "maria", action: "grant", at: 5 }], "maria", "shop"), true);
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
  assert.equal(planMemberGrant(next, { inviterId: "josh", targetId: "maria", roomId: "county" }).ok, false);
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
