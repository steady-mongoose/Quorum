// Charter rule 9. Josh is seated once, as founding admin and council chair.
// Everyone after him is added in layers, and every grant and revocation stays
// in the log. The newest row for a person and role decides.

export const FOUNDING_ADMIN = "Josh";

export type AccessRole = "member" | "steward" | "admin";

export type AccessRow = {
  id: string;
  name: string;
  role: AccessRole;
  /** Room for a member voucher or a steward. Empty for an admin. */
  roomId: string;
  action: "grant" | "revoke";
  vouchedBy: string;
  approvedBy: string;
  by: string;
  at: number;
  note: string;
};

export type AccessResult<T> = { ok: true; row: T } | { ok: false; error: string };

export type FoundingSeat = {
  name: typeof FOUNDING_ADMIN;
  at: number;
  admin: true;
  council: true;
  councilChair: true;
  rows: [AccessRow, AccessRow];
};

/** `1`, `true`, and `Josh` all name Josh. Anything else is not the founding seat. */
export function founderNameFromEnv(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return "";
  if (raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "josh") return FOUNDING_ADMIN;
  return raw;
}

export function seatFounder(input: {
  bootstrapped: boolean;
  currentMember: string;
  /** Set when the env var is what asked. The door command passes "". */
  envName: string;
  command: boolean;
  now: number;
  memberId: string;
  adminId: string;
}): AccessResult<FoundingSeat> {
  if (input.bootstrapped) return { ok: false, error: "The founding admin is already seated. This runs once." };
  const named = input.command ? FOUNDING_ADMIN : founderNameFromEnv(input.envName);
  if (!named) return { ok: false, error: "Set VITE_BOOTSTRAP_OWNER=Josh to seat the founding admin." };
  if (named !== FOUNDING_ADMIN) return { ok: false, error: "The founding admin is Josh." };
  const current = input.currentMember.trim();
  if (current && current !== FOUNDING_ADMIN) return { ok: false, error: "The founding seat runs before anyone else is added." };
  const at = input.now;
  return {
    ok: true,
    row: {
      name: FOUNDING_ADMIN,
      at,
      admin: true,
      council: true,
      councilChair: true,
      rows: [
        {
          id: input.memberId,
          name: FOUNDING_ADMIN,
          role: "member",
          roomId: "",
          action: "grant",
          vouchedBy: "bootstrap",
          approvedBy: "",
          by: "bootstrap",
          at,
          note: "Founding member.",
        },
        {
          id: input.adminId,
          name: FOUNDING_ADMIN,
          role: "admin",
          roomId: "",
          action: "grant",
          vouchedBy: "bootstrap",
          approvedBy: "bootstrap",
          by: "bootstrap",
          at,
          note: "Founding admin and council chair.",
        },
      ],
    },
  };
}

/** Newest row wins. Steward and member grants are per room; admin is per person. */
export function liveGrant(log: readonly AccessRow[], name: string, role: AccessRole, roomId = ""): AccessRow | null {
  const who = name.trim();
  let latest: AccessRow | null = null;
  for (const row of log) {
    if (row.name !== who || row.role !== role) continue;
    if (role !== "admin" && row.roomId !== roomId) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  return latest?.action === "grant" ? latest : null;
}

export function isLiveMember(log: readonly AccessRow[], name: string): boolean {
  const who = name.trim();
  let latest: AccessRow | null = null;
  for (const row of log) {
    if (row.name !== who || row.role !== "member") continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  return latest?.action === "grant";
}

export function isRoomSteward(log: readonly AccessRow[], name: string, roomId: string): boolean {
  return liveGrant(log, name, "steward", roomId) != null;
}

export function stewardRooms(log: readonly AccessRow[], name: string): string[] {
  const rooms = new Set<string>();
  for (const row of log) {
    if (row.role === "steward" && row.roomId) rooms.add(row.roomId);
  }
  return [...rooms].filter((roomId) => isRoomSteward(log, name, roomId));
}

export function isLiveAdmin(log: readonly AccessRow[], name: string): boolean {
  return liveGrant(log, name, "admin") != null;
}

/** Rule 9, first layer: one inviter, who is already a member. */
export function grantMember(
  log: readonly AccessRow[],
  inviter: string,
  draft: { name: string; roomId: string },
  now: number,
  id: string,
): AccessResult<AccessRow> {
  const by = inviter.trim();
  const name = draft.name.trim();
  const roomId = draft.roomId.trim();
  if (!isLiveMember(log, by)) return { ok: false, error: "Only a member can vouch for someone." };
  if (!name) return { ok: false, error: "Name the person." };
  if (name === by) return { ok: false, error: "You cannot vouch for yourself." };
  if (!roomId) return { ok: false, error: "Name the room this invitation is for." };
  if (isLiveMember(log, name)) return { ok: false, error: "That person is already a member." };
  return {
    ok: true,
    row: { id, name, role: "member", roomId, action: "grant", vouchedBy: by, approvedBy: "", by, at: now, note: "Member, one inviter." },
  };
}

/**
 * Rule 9, second layer. The inviter and the approver are two people.
 * A room with no steward yet is approved by the council chair. After that,
 * an existing steward of that room approves.
 */
export function grantSteward(
  log: readonly AccessRow[],
  approver: string,
  approverIsChair: boolean,
  draft: { name: string; roomId: string; inviter: string },
  now: number,
  id: string,
): AccessResult<AccessRow> {
  const by = approver.trim();
  const name = draft.name.trim();
  const roomId = draft.roomId.trim();
  const inviter = draft.inviter.trim();
  if (!name || !roomId || !inviter) return { ok: false, error: "Name the person, the room, and the inviter." };
  if (!isLiveMember(log, inviter)) return { ok: false, error: "The inviter has to be a member." };
  if (!isLiveMember(log, name)) return { ok: false, error: "A steward is already a member." };
  if (inviter === by) return { ok: false, error: "The inviter and the approver are two people." };
  if (name === by || name === inviter) return { ok: false, error: "Someone else vouches, and someone else approves." };
  const roomHasSteward = log.some((row) => row.role === "steward" && row.roomId === roomId && isRoomSteward(log, row.name, roomId));
  if (roomHasSteward) {
    if (!isRoomSteward(log, by, roomId)) return { ok: false, error: "An existing steward of that room approves the next one." };
  } else if (!approverIsChair || !isLiveAdmin(log, by)) {
    return { ok: false, error: "The first steward of a room is approved by the council chair." };
  }
  if (isRoomSteward(log, name, roomId)) return { ok: false, error: "That person is already a steward of that room." };
  return {
    ok: true,
    row: {
      id,
      name,
      role: "steward",
      roomId,
      action: "grant",
      vouchedBy: inviter,
      approvedBy: by,
      by,
      at: now,
      note: roomHasSteward ? "Steward, inviter plus a steward of that room." : "First steward of that room, inviter plus the council chair.",
    },
  };
}

/** Rule 9, third layer: a steward's approval, then the role owner signs off. */
export function grantAdmin(
  log: readonly AccessRow[],
  roleOwner: string,
  draft: { name: string; stewardApprover: string },
  now: number,
  id: string,
): AccessResult<AccessRow> {
  const by = roleOwner.trim();
  const name = draft.name.trim();
  const stewardApprover = draft.stewardApprover.trim();
  if (!isLiveAdmin(log, by)) return { ok: false, error: "A role owner signs off on an admin." };
  if (!name || !stewardApprover) return { ok: false, error: "Name the person and the steward who approved." };
  if (stewardApprover === by || name === by || name === stewardApprover) return { ok: false, error: "The steward and the role owner are two people, and neither is the candidate." };
  if (stewardRooms(log, stewardApprover).length === 0) return { ok: false, error: "A steward has to approve an admin." };
  if (stewardRooms(log, name).length === 0) return { ok: false, error: "An admin is already a steward." };
  if (isLiveAdmin(log, name)) return { ok: false, error: "That person is already an admin." };
  return {
    ok: true,
    row: {
      id,
      name,
      role: "admin",
      roomId: "",
      action: "grant",
      vouchedBy: stewardApprover,
      approvedBy: by,
      by,
      at: now,
      note: "Admin, steward approval plus the role owner.",
    },
  };
}

/** Revocation stays in the log. The founding admin's own seat is not revoked here. */
export function revokeAccess(
  log: readonly AccessRow[],
  actor: string,
  draft: { name: string; role: AccessRole; roomId?: string },
  now: number,
  id: string,
): AccessResult<AccessRow> {
  const by = actor.trim();
  const name = draft.name.trim();
  const roomId = draft.role === "admin" ? "" : (draft.roomId ?? "").trim();
  if (!isLiveAdmin(log, by)) return { ok: false, error: "A role owner revokes access." };
  if (name === FOUNDING_ADMIN && (draft.role === "admin" || draft.role === "member")) {
    return { ok: false, error: "The founding admin stays seated." };
  }
  let live: AccessRow | null = null;
  for (const row of log) {
    if (row.name !== name || row.role !== draft.role) continue;
    if (draft.role === "steward" && row.roomId !== roomId) continue;
    if (!live || row.at > live.at || (row.at === live.at && row.id > live.id)) live = row;
  }
  if (!live || live.action !== "grant") return { ok: false, error: "That access is not live." };
  return {
    ok: true,
    row: {
      id,
      name,
      role: draft.role,
      roomId: draft.role === "admin" ? "" : live.roomId,
      action: "revoke",
      vouchedBy: live.vouchedBy,
      approvedBy: by,
      by,
      at: now,
      note: "Revoked.",
    },
  };
}
