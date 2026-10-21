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
 * PR #17 (`server/board/store.ts` on `cursor/server-board-ffcd`) is not on
 * this branch, so nothing here calls into it. When that code lands, call
 * `evictCallMember` after the ban is saved:
 * - `banMember`, with the banned user's id
 * - `removePost`, with the author's id (that path writes a ban)
 * A path that deletes one `room_member` row calls `store.leave(roomId, userId)`
 * for that room instead.
 *
 * Until those paths call this, the next join, leave, signal, or poll from
 * someone who is no longer in `room_member` drops their slot. Other browsers
 * close that peer connection when the id disappears from the roster.
 */
export function evictCallMember(userId: string): number {
  if (!userId || !bound) return 0;
  return bound.evict(userId);
}
