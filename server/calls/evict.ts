import type { CallStore } from "./store.ts";

let bound: CallStore | null = null;

/**
 * Bind the in-memory call store for this process. `startHost` does this
 * once. Room calls need that one API process; a second replica would not
 * see this store.
 */
export function bindCallEviction(store: CallStore): void {
  bound = store;
}

type TurnRelease = (userId: string, sessionPrefix?: string) => void;
let releaseTurn: TurnRelease | null = null;

/** The calls routes bind this so a ban also revokes minted TURN credentials. */
export function bindTurnRelease(release: TurnRelease | null): void {
  releaseTurn = release;
}

/**
 * Drop a person from live calls on this API process.
 *
 * `banMember` and `removePost` call this after the ban is saved.
 * `removePost` evicts before the admin alert email, and that email does not
 * block the response. An admin bar passes no rooms and drops every call.
 * A room steward passes the rooms the bar covers, and each of those calls
 * `store.leave(roomId, userId)`.
 *
 * If the store is not bound, this returns 0 and the ban still stands. The
 * next join, leave, signal, or poll from someone who is no longer in
 * `room_member` also drops their slot. Other browsers close that peer
 * connection when the id disappears from the roster.
 */
export function evictCallMember(userId: string, roomIds?: readonly string[]): number {
  if (!userId) return 0;
  if (roomIds) for (const roomId of roomIds) releaseTurn?.(userId, `${roomId}#`);
  else releaseTurn?.(userId);
  if (!bound) return 0;
  if (roomIds) {
    for (const roomId of roomIds) bound.leave(roomId, userId);
    return roomIds.length;
  }
  return bound.evict(userId);
}
