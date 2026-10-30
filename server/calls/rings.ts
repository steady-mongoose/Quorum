import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";

export const RING_TTL_MS = 60_000;
export const MAX_RINGS_PER_TARGET = 5;
/** One host or steward can ring at most this many times in RINGER_WINDOW_MS. */
export const MAX_RINGS_PER_RINGER = 10;
export const RINGER_WINDOW_MS = 10 * 60_000;
/** How long a caller's "declined" or "no answer" note waits for their next poll. */
export const OUTCOME_TTL_MS = 2 * 60_000;
const MAX_OUTCOMES_PER_CALLER = 20;

export type RingKind = "room" | "dm";

export type Ring = {
  id: string;
  kind: RingKind;
  /** The call it rings into: the room id, or `dm:{threadId}`. */
  key: string;
  /** A room id for a room ring, a thread id for a DM ring. */
  roomId: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  at: number;
};

export type RingInput = {
  kind?: RingKind;
  key?: string;
  roomId: string;
  from: string;
  fromName: string;
  to: string;
  toName?: string;
};

/** What the caller is told: the person declined, or the ring ran out. */
export type RingOutcome = { kind: "declined" | "missed"; to: string; name: string };

type StoredOutcome = RingOutcome & { from: string; key: string; at: number };

/**
 * Pending "come to the call" rings, in memory only, like the calls
 * themselves. A ring lasts a minute. Nothing is written to the database.
 */
export function createRingStore() {
  const rings = new Map<string, Ring>();
  const sent = new Map<string, number[]>();
  let outcomes: StoredOutcome[] = [];
  let next = 1;
  const tell = (ring: Ring, kind: RingOutcome["kind"], at: number) => {
    outcomes.push({ from: ring.from, key: ring.key, kind, to: ring.to, name: ring.toName, at });
    const mine = outcomes.filter((o) => o.from === ring.from);
    if (mine.length > MAX_OUTCOMES_PER_CALLER) {
      const drop = mine[0];
      outcomes = outcomes.filter((o) => o !== drop);
    }
  };
  const sweep = (at: number) => {
    for (const [id, ring] of rings) {
      if (at - ring.at > RING_TTL_MS) {
        rings.delete(id);
        tell(ring, "missed", at);
      }
    }
    outcomes = outcomes.filter((o) => at - o.at <= OUTCOME_TTL_MS);
    // Idle ringers drop out once their last ring leaves the window.
    for (const [from, stamps] of sent) {
      if (!stamps.some((stamp) => at - stamp < RINGER_WINDOW_MS)) sent.delete(from);
    }
  };
  return {
    /** Null when the ringer is over the per-ringer cap. */
    ring(input: RingInput, at: number): Ring | null {
      sweep(at);
      const recent = (sent.get(input.from) ?? []).filter((stamp) => at - stamp < RINGER_WINDOW_MS);
      if (recent.length >= MAX_RINGS_PER_RINGER) {
        sent.set(input.from, recent);
        return null;
      }
      recent.push(at);
      sent.set(input.from, recent);
      const kind = input.kind ?? "room";
      const key = input.key ?? input.roomId;
      for (const [id, ring] of rings) {
        if (ring.to === input.to && ring.key === key) rings.delete(id);
      }
      const mine = [...rings.values()].filter((ring) => ring.to === input.to);
      if (mine.length >= MAX_RINGS_PER_TARGET && mine[0]) rings.delete(mine[0].id);
      const ring: Ring = {
        id: `r${next++}`,
        kind,
        key,
        roomId: input.roomId,
        from: input.from,
        fromName: input.fromName,
        to: input.to,
        toName: input.toName || "Member",
        at,
      };
      rings.set(ring.id, ring);
      return ring;
    },
    /** Ringers with history still tracked (for tests). */
    ringerCount(): number {
      return sent.size;
    },
    pending(userId: string, at: number): Ring[] {
      sweep(at);
      return [...rings.values()].filter((ring) => ring.to === userId);
    },
    /** Hide a ring without telling the caller (it then runs out as "no answer"). */
    dismiss(userId: string, id: string): boolean {
      const ring = rings.get(id);
      if (!ring || ring.to !== userId) return false;
      rings.delete(id);
      return true;
    },
    /** The person rung says no. The caller hears it on their next poll. */
    decline(userId: string, id: string, at: number): boolean {
      sweep(at);
      const ring = rings.get(id);
      if (!ring || ring.to !== userId) return false;
      rings.delete(id);
      tell(ring, "declined", at);
      return true;
    },
    /** Joining the call answers every ring for it. */
    answer(userId: string, key: string): void {
      for (const [id, ring] of rings) {
        if (ring.to === userId && ring.key === key) rings.delete(id);
      }
    },
    /** The call is over (nobody left in it): its rings go quietly. */
    cancel(key: string): void {
      for (const [id, ring] of rings) if (ring.key === key) rings.delete(id);
      outcomes = outcomes.filter((o) => o.key !== key);
    },
    /** Declines and missed rings for this caller in this call, each told once. */
    outcomes(userId: string, key: string, at: number): RingOutcome[] {
      sweep(at);
      const mine = outcomes.filter((o) => o.from === userId && o.key === key);
      if (mine.length === 0) return [];
      outcomes = outcomes.filter((o) => !mine.includes(o));
      return mine.map(({ kind, to, name }) => ({ kind, to, name }));
    },
    evict(userId: string): void {
      for (const [id, ring] of rings)
        if (ring.to === userId || ring.from === userId) rings.delete(id);
      outcomes = outcomes.filter((o) => o.from !== userId);
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

/** Read-only: the display name rung, so the caller's "declined" note can name them. */
export async function memberName(db: Db, userId: string): Promise<string> {
  try {
    const rows = await db.query<{ name: string | null }>(`select name from "user" where id = $1`, [
      userId,
    ]);
    return rows[0]?.name ?? "";
  } catch {
    return "";
  }
}

/** Read-only: the other person in a DM thread, for the ring. */
export async function dmOther(
  db: Db,
  userId: string,
  threadId: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const rows = await db.query<{ id: string; name: string | null }>(
      `select u.id, u.name from dm_thread t
         join "user" u on u.id = case when t.user_a = $2 then t.user_b else t.user_a end
        where t.id = $1 and (t.user_a = $2 or t.user_b = $2)`,
      [threadId, userId],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.name ?? "" } : null;
  } catch {
    return null;
  }
}
