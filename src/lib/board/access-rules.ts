// Charter rule 9, on the server. The newest access_log row for a person and
// role decides. Steward is per room. Admin is per person.
// A grant with an empty room does not count as steward of a room.

export type AccessRole = "member" | "steward" | "admin";

export type LogRow = {
  id: string;
  userId: string;
  role: AccessRole;
  roomId: string;
  action: "grant" | "revoke";
  at: number;
};

export const STEWARD_NOTE = "Steward, inviter plus a steward of that room.";
export const FIRST_STEWARD_NOTE = "First steward of that room, inviter plus the council chair.";
export const ADMIN_NOTE = "Admin, steward approval plus the role owner.";
export const REVOKE_NOTE = "Revoked.";

export type GrantPlan = {
  action: "grant" | "revoke";
  role: AccessRole;
  roomId: string;
  targetId: string;
  vouchedByUserId: string;
  approvedByUserId: string;
  note: string;
};

function newest(rows: readonly LogRow[], pred: (row: LogRow) => boolean): LogRow | null {
  let latest: LogRow | null = null;
  for (const row of rows) {
    if (!pred(row)) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  return latest;
}

export function isLiveMember(rows: readonly LogRow[], userId: string): boolean {
  return newest(rows, (row) => row.userId === userId && row.role === "member")?.action === "grant";
}

export function isLiveAdminLog(rows: readonly LogRow[], userId: string): boolean {
  return newest(rows, (row) => row.userId === userId && row.role === "admin")?.action === "grant";
}

/** Newest row for this person and this room. */
export function isRoomSteward(rows: readonly LogRow[], userId: string, roomId: string): boolean {
  if (!roomId) return false;
  return (
    newest(rows, (row) => row.userId === userId && row.role === "steward" && row.roomId === roomId)
      ?.action === "grant"
  );
}

/** Steward of at least one real room. A blank room id does not count. */
export function isStewardSomewhere(rows: readonly LogRow[], userId: string): boolean {
  const rooms = new Set<string>();
  for (const row of rows) {
    if (row.userId === userId && row.role === "steward" && row.roomId) rooms.add(row.roomId);
  }
  for (const roomId of rooms) {
    if (isRoomSteward(rows, userId, roomId)) return true;
  }
  return false;
}

export function roomHasSteward(rows: readonly LogRow[], roomId: string): boolean {
  if (!roomId) return false;
  const people = new Set<string>();
  for (const row of rows) {
    if (row.role === "steward" && row.roomId === roomId) people.add(row.userId);
  }
  for (const userId of people) {
    if (isRoomSteward(rows, userId, roomId)) return true;
  }
  return false;
}

function distinct(ids: string[]): boolean {
  return new Set(ids).size === ids.length && ids.every(Boolean);
}

export function planMemberGrant(
  rows: readonly LogRow[],
  input: { inviterId: string; targetId: string; roomId: string },
): { ok: true; plan: GrantPlan } | { ok: false; error: string } {
  const roomId = input.roomId.trim();
  if (!roomId) return { ok: false, error: "Name the room this invitation is for." };
  if (!distinct([input.inviterId, input.targetId])) {
    return { ok: false, error: "You cannot vouch for yourself." };
  }
  if (!isLiveMember(rows, input.inviterId)) {
    return { ok: false, error: "Only a member can vouch for someone." };
  }
  if (isLiveMember(rows, input.targetId)) {
    return { ok: false, error: "That person is already a member." };
  }
  return {
    ok: true,
    plan: {
      action: "grant",
      role: "member",
      roomId,
      targetId: input.targetId,
      vouchedByUserId: input.inviterId,
      approvedByUserId: "",
      note: "Member, one inviter.",
    },
  };
}

/**
 * The inviter and the approver are two people.
 * The first steward of a room is the inviter plus the council chair.
 * The next one is the inviter plus a steward of that room.
 */
export function planStewardGrant(
  rows: readonly LogRow[],
  input: {
    approverId: string;
    approverIsAdmin: boolean;
    approverIsChair: boolean;
    inviterId: string;
    targetId: string;
    roomId: string;
  },
): { ok: true; plan: GrantPlan } | { ok: false; error: string } {
  const roomId = input.roomId.trim();
  if (!roomId) return { ok: false, error: "Name the person, the room, and the inviter." };
  if (!distinct([input.approverId, input.inviterId, input.targetId])) {
    return {
      ok: false,
      error: "The inviter and the approver are two people, and neither is the candidate.",
    };
  }
  if (!isLiveMember(rows, input.inviterId)) {
    return { ok: false, error: "The inviter has to be a member." };
  }
  if (!isLiveMember(rows, input.targetId)) {
    return { ok: false, error: "A steward is already a member." };
  }
  if (isRoomSteward(rows, input.targetId, roomId)) {
    return { ok: false, error: "That person is already a steward of that room." };
  }
  const hasSteward = roomHasSteward(rows, roomId);
  if (hasSteward) {
    if (!isRoomSteward(rows, input.approverId, roomId)) {
      return { ok: false, error: "An existing steward of that room approves the next one." };
    }
  } else if (!input.approverIsChair || !input.approverIsAdmin) {
    return { ok: false, error: "The first steward of a room is approved by the council chair." };
  }
  return {
    ok: true,
    plan: {
      action: "grant",
      role: "steward",
      roomId,
      targetId: input.targetId,
      vouchedByUserId: input.inviterId,
      approvedByUserId: input.approverId,
      note: hasSteward ? STEWARD_NOTE : FIRST_STEWARD_NOTE,
    },
  };
}

/** A steward of some room, then the role owner's sign-off. Both are logged. */
export function planAdminGrant(
  rows: readonly LogRow[],
  input: {
    ownerId: string;
    ownerIsAdmin: boolean;
    stewardId: string;
    targetId: string;
    targetIsAdmin: boolean;
  },
): { ok: true; plan: GrantPlan } | { ok: false; error: string } {
  if (!input.ownerIsAdmin) return { ok: false, error: "A role owner signs off on an admin." };
  if (!distinct([input.ownerId, input.stewardId, input.targetId])) {
    return {
      ok: false,
      error: "The steward and the role owner are two people, and neither is the candidate.",
    };
  }
  if (!isStewardSomewhere(rows, input.stewardId)) {
    return { ok: false, error: "A steward has to approve an admin." };
  }
  if (!isStewardSomewhere(rows, input.targetId)) {
    return { ok: false, error: "An admin is already a steward." };
  }
  if (input.targetIsAdmin || isLiveAdminLog(rows, input.targetId)) {
    return { ok: false, error: "That person is already an admin." };
  }
  return {
    ok: true,
    plan: {
      action: "grant",
      role: "admin",
      roomId: "",
      targetId: input.targetId,
      vouchedByUserId: input.stewardId,
      approvedByUserId: input.ownerId,
      note: ADMIN_NOTE,
    },
  };
}

export function planRevoke(
  rows: readonly LogRow[],
  input: {
    actorId: string;
    actorIsAdmin: boolean;
    targetId: string;
    targetIsFounder: boolean;
    role: AccessRole;
    roomId: string;
  },
): { ok: true; plan: GrantPlan } | { ok: false; error: string } {
  if (!input.actorIsAdmin) return { ok: false, error: "A role owner revokes access." };
  if (input.targetIsFounder && (input.role === "admin" || input.role === "member")) {
    return { ok: false, error: "The founding admin stays seated." };
  }
  const roomId = input.role === "steward" ? input.roomId.trim() : "";
  if (input.role === "steward" && !roomId) return { ok: false, error: "Name the room." };
  const live = newest(rows, (row) => {
    if (row.userId !== input.targetId || row.role !== input.role) return false;
    if (input.role === "steward" && row.roomId !== roomId) return false;
    return true;
  });
  if (!live || live.action !== "grant") return { ok: false, error: "That access is not live." };
  return {
    ok: true,
    plan: {
      action: "revoke",
      role: input.role,
      roomId: input.role === "admin" ? "" : live.roomId,
      targetId: input.targetId,
      vouchedByUserId: "",
      approvedByUserId: input.actorId,
      note: REVOKE_NOTE,
    },
  };
}

// A room always has a steward. Charter decision, Oct 27, 2026: "A room can't
// exist unless a steward manages it." The steward is named when the room is
// made, and the last steward cannot be removed, barred, demoted, or leave
// unless a new steward is named in the same step.

export const NO_STEWARD_ERROR =
  "A room needs a steward. Name the steward and the member who vouches for them.";
export const LAST_STEWARD_ERROR =
  "This is the only steward of that room. Name a new steward in the same step, so the room is never left without one.";

export function liveStewards(rows: readonly LogRow[], roomId: string): string[] {
  if (!roomId) return [];
  const people = new Set<string>();
  for (const row of rows) {
    if (row.role === "steward" && row.roomId === roomId) people.add(row.userId);
  }
  return [...people].filter((userId) => isRoomSteward(rows, userId, roomId)).sort();
}

/** Rooms where this person is the only live steward. */
export function soleStewardRooms(rows: readonly LogRow[], userId: string): string[] {
  const rooms = new Set<string>();
  for (const row of rows) {
    if (row.userId === userId && row.role === "steward" && row.roomId) rooms.add(row.roomId);
  }
  return [...rooms]
    .filter((roomId) => {
      const live = liveStewards(rows, roomId);
      return live.length === 1 && live[0] === userId;
    })
    .sort();
}

/** The log as it would read once this person's steward seat in the room is closed. */
export function withoutSteward(
  rows: readonly LogRow[],
  userId: string,
  roomId: string,
  at: number,
): LogRow[] {
  return [
    ...rows,
    { id: `pending-${userId}-${roomId}`, userId, role: "steward", roomId, action: "revoke", at },
  ];
}

/** The new steward named in a revoke is not a current member of the room. */
export function replacementNotMemberError(name: string): string {
  return `${name} isn't a member of this room. Name a current member as the new steward.`;
}

/** The new steward named in a revoke is barred from the room or from Avouch. */
export function replacementBarredError(name: string): string {
  return `${name} is barred from this room or from Avouch, so they can't be the new steward. Name someone else.`;
}

/** True when a refusal is about the named new steward, so the form can point at that field. */
export function isReplacementError(error: string): boolean {
  return (
    / isn't a member of this room\. Name a current member as the new steward\.$/.test(error) ||
    / is barred from this room or from Avouch, so they can't be the new steward\. Name someone else\.$/.test(
      error,
    )
  );
}
