// Town rooms are not created from a ZIP. A member asks, and an admin or a
// steward decides. The request row keeps both the ask and the decision.

import type { LocalRoom } from "./places.ts";
import { townSlug } from "./zcta.ts";

export type TownRoomRequest = {
  id: string;
  townId: string;
  name: string;
  state: string;
  by: string;
  at: number;
  status: "open" | "approved" | "refused";
  decidedBy: string;
  decidedAt: number | null;
  note: string;
};

export type TownRoomResult<T> = { ok: true; value: T } | { ok: false; error: string };

function townTaken(townId: string, rooms: readonly LocalRoom[]): boolean {
  return rooms.some((room) => room.scope.kind === "town" && room.scope.townId === townId);
}

export function requestTownRoom(
  actor: string,
  rooms: readonly LocalRoom[],
  requests: readonly TownRoomRequest[],
  draft: { name: string; state: string },
  now: number,
  id: string,
): TownRoomResult<TownRoomRequest> {
  const by = actor.trim();
  if (!by) return { ok: false, error: "A member asks for a town room." };
  const name = draft.name.trim();
  const state = draft.state.trim().toUpperCase();
  if (!name) return { ok: false, error: "Name the town." };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Enter a two-letter state." };
  const townId = townSlug(name, state);
  if (!townId) return { ok: false, error: "Name the town." };
  if (townTaken(townId, rooms)) return { ok: false, error: "That town already has a room." };
  if (requests.some((row) => row.townId === townId && row.status === "open")) return { ok: false, error: "That town already has an open request." };
  return {
    ok: true,
    value: { id, townId, name, state, by, at: now, status: "open", decidedBy: "", decidedAt: null, note: "" },
  };
}

export function townRoomFromRequest(request: TownRoomRequest): LocalRoom {
  return { id: `town-${request.townId}`, name: `${request.name} town room`, scope: { kind: "town", townId: request.townId } };
}

/** Approve creates the room. Refuse leaves the directory as it was. Either way the row stays. */
export function decideTownRoom(
  actor: string,
  powers: { admin: boolean; steward: boolean },
  rooms: readonly LocalRoom[],
  request: TownRoomRequest | undefined,
  decision: "approved" | "refused",
  note: string,
  now: number,
): TownRoomResult<{ request: TownRoomRequest; room: LocalRoom | null }> {
  const by = actor.trim();
  if (!powers.admin && !powers.steward) return { ok: false, error: "An admin or a steward decides a town room." };
  if (!request || request.status !== "open") return { ok: false, error: "That request is not open." };
  if (by === request.by) return { ok: false, error: "Someone else decides a town room." };
  const reason = note.trim();
  if (!reason) return { ok: false, error: "Write the decision down." };
  if (decision === "refused") {
    return { ok: true, value: { request: { ...request, status: "refused", decidedBy: by, decidedAt: now, note: reason }, room: null } };
  }
  if (townTaken(request.townId, rooms)) return { ok: false, error: "That town already has a room." };
  const room = townRoomFromRequest(request);
  return {
    ok: true,
    value: { request: { ...request, status: "approved", decidedBy: by, decidedAt: now, note: reason }, room },
  };
}
