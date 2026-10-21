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

/**
 * Drop a person from every live call on this API process.
 *
 * `banMember` calls this with the banned user's id, and `removePost` calls
 * it with the author's id, after the ban is saved. A path that deletes one
 * `room_member` row calls `store.leave(roomId, userId)` for that room instead.
 *
 * If the store is not bound, this returns 0 and the ban still stands. The
 * next join, leave, signal, or poll from someone who is no longer in
 * `room_member` also drops their slot. Other browsers close that peer
 * connection when the id disappears from the roster.
 */
export function evictCallMember(userId: string): number {
  if (!userId || !bound) return 0;
  return bound.evict(userId);
}
