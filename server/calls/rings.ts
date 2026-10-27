import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";

export const RING_TTL_MS = 60_000;
export const MAX_RINGS_PER_TARGET = 5;
/** One host or steward can ring at most this many times in RINGER_WINDOW_MS. */
export const MAX_RINGS_PER_RINGER = 10;
export const RINGER_WINDOW_MS = 10 * 60_000;

export type Ring = {
  id: string;
  roomId: string;
  from: string;
  fromName: string;
  to: string;
  at: number;
};

/**
 * Pending "come to the call" rings, in memory only, like the calls
 * themselves. A ring lasts a minute. Nothing is written to the database.
 */
export function createRingStore() {
  const rings = new Map<string, Ring>();
  const sent = new Map<string, number[]>();
  let next = 1;
  const sweep = (at: number) => {
    for (const [id, ring] of rings) if (at - ring.at > RING_TTL_MS) rings.delete(id);
  };
  return {
    /** Null when the ringer is over the per-ringer cap. */
    ring(input: Omit<Ring, "id" | "at">, at: number): Ring | null {
      sweep(at);
      const recent = (sent.get(input.from) ?? []).filter((stamp) => at - stamp < RINGER_WINDOW_MS);
      if (recent.length >= MAX_RINGS_PER_RINGER) {
        sent.set(input.from, recent);
        return null;
      }
      recent.push(at);
      sent.set(input.from, recent);
      for (const [id, ring] of rings) {
        if (ring.to === input.to && ring.roomId === input.roomId) rings.delete(id);
      }
      const mine = [...rings.values()].filter((ring) => ring.to === input.to);
      if (mine.length >= MAX_RINGS_PER_TARGET && mine[0]) rings.delete(mine[0].id);
      const ring: Ring = { ...input, id: `r${next++}`, at };
      rings.set(ring.id, ring);
      return ring;
    },
    pending(userId: string, at: number): Ring[] {
      sweep(at);
      return [...rings.values()].filter((ring) => ring.to === userId);
    },
    dismiss(userId: string, id: string): boolean {
      const ring = rings.get(id);
      if (!ring || ring.to !== userId) return false;
      rings.delete(id);
      return true;
    },
    /** Joining the room's call answers every ring for it. */
    answer(userId: string, roomId: string): void {
      for (const [id, ring] of rings) {
        if (ring.to === userId && ring.roomId === roomId) rings.delete(id);
      }
    },
    evict(userId: string): void {
      for (const [id, ring] of rings)
        if (ring.to === userId || ring.from === userId) rings.delete(id);
    },
  };
}

export type RingStore = ReturnType<typeof createRingStore>;

/** The room's host, a steward of the room, or an admin may ring members. */
export async function canRing(db: Db, userId: string, roomId: string): Promise<boolean> {
  try {
    const actor = await actorRole(db, userId);
    if (actor.admin || actor.stewardRooms.includes(roomId)) return true;
    const rows = await db.query<{ host_user_id: string | null }>(
      `select host_user_id from room where id = $1`,
      [roomId],
    );
    return Boolean(rows[0]?.host_user_id) && rows[0]?.host_user_id === userId;
  } catch {
    return false;
  }
}
