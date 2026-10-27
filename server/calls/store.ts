export const MAX_PEERS = 6;
export const PEER_TTL_MS = 45_000;
export const SIGNAL_TTL_MS = 60_000;
/** Pending signals one sender may hold. Older ones from that sender are dropped. */
export const MAX_SIGNALS_PER_SENDER = 40;
export const MAX_SIGNALS = MAX_PEERS * MAX_SIGNALS_PER_SENDER;
export const SIGNAL_LIMIT = 120;
export const SIGNAL_WINDOW_MS = 10_000;

export type SignalKind = "offer" | "answer" | "ice";

export type CallPeer = { id: string; name: string; generation: number };

export type StoredSignal = {
  id: number;
  from: string;
  to: string;
  kind: SignalKind;
  payload: Record<string, unknown>;
  at: number;
};

type PeerSlot = {
  id: string;
  name: string;
  seenAt: number;
  /** Bumps on every join so the other browsers drop a stale peer connection. */
  generation: number;
  /** Signals at or below this id were already in the room when they joined. */
  minSince: number;
  attempts: number[];
};

type RoomState = {
  peers: Map<string, PeerSlot>;
  signals: StoredSignal[];
  nextId: number;
};

export type JoinResult =
  { ok: true; peers: CallPeer[]; cursor: number } | { ok: false; status: 409; error: string };

export type SignalResult =
  { ok: true } | { ok: false; status: 400 | 409 | 429; error: string; retryAfter?: number };

export type PollResult =
  | { ok: true; peers: CallPeer[]; signals: StoredSignal[]; cursor: number }
  | { ok: false; status: 409; error: string };

export function callDisplayName(name: string): string {
  let cleaned = "";
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) continue;
    cleaned += char;
  }
  cleaned = cleaned.trim();
  return (cleaned || "Member").slice(0, 80);
}

function normalizePayload(kind: SignalKind, payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (kind === "offer" || kind === "answer") {
    if (record.type !== kind) return null;
    if (typeof record.sdp !== "string") return null;
    const sdp = record.sdp;
    if (sdp.length < 4 || sdp.length > 10_000 || !sdp.startsWith("v=0")) return null;
    return { type: kind, sdp };
  }
  const candidate = record.candidate;
  if (candidate === null) return { candidate: null };
  if (typeof candidate === "string") {
    if (candidate.length > 2000) return null;
    return { candidate };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const row = candidate as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof row.candidate !== "string" || row.candidate.length > 2000) return null;
  if (row.sdpMid !== undefined && row.sdpMid !== null && typeof row.sdpMid !== "string")
    return null;
  if (typeof row.sdpMid === "string" && row.sdpMid.length > 32) return null;
  if (
    row.sdpMLineIndex !== undefined &&
    row.sdpMLineIndex !== null &&
    (typeof row.sdpMLineIndex !== "number" ||
      !Number.isInteger(row.sdpMLineIndex) ||
      row.sdpMLineIndex < 0 ||
      row.sdpMLineIndex > 64)
  ) {
    return null;
  }
  return {
    candidate: {
      candidate: row.candidate,
      sdpMid: typeof row.sdpMid === "string" ? row.sdpMid : null,
      sdpMLineIndex: typeof row.sdpMLineIndex === "number" ? row.sdpMLineIndex : null,
    },
  };
}

/**
 * One process holds the live calls. A second API process would split the
 * room and the six-person cap. Nothing is written to the database and
 * nothing is recorded. A restart drops the call, which is the point.
 */
export function createCallStore() {
  const rooms = new Map<string, RoomState>();

  function roomFor(roomId: string): RoomState {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const created: RoomState = { peers: new Map(), signals: [], nextId: 1 };
    rooms.set(roomId, created);
    return created;
  }

  function sweep(roomId: string, room: RoomState, at: number): void {
    for (const [id, peer] of room.peers) {
      if (at - peer.seenAt > PEER_TTL_MS) room.peers.delete(id);
    }
    const live = room.peers;
    room.signals = room.signals.filter((signal) => {
      if (at - signal.at > SIGNAL_TTL_MS) return false;
      return live.has(signal.from) && live.has(signal.to);
    });
    if (room.signals.length > MAX_SIGNALS) {
      room.signals.splice(0, room.signals.length - MAX_SIGNALS);
    }
    if (room.peers.size === 0) rooms.delete(roomId);
  }

  function others(room: RoomState, userId: string): CallPeer[] {
    const peers: CallPeer[] = [];
    for (const peer of room.peers.values()) {
      if (peer.id === userId) continue;
      peers.push({ id: peer.id, name: peer.name, generation: peer.generation });
    }
    return peers;
  }

  function dropPeer(roomId: string, userId: string): boolean {
    const room = rooms.get(roomId);
    if (!room?.peers.has(userId)) return false;
    room.peers.delete(userId);
    room.signals = room.signals.filter((signal) => signal.from !== userId && signal.to !== userId);
    if (room.peers.size === 0) rooms.delete(roomId);
    return true;
  }

  function trimSender(room: RoomState, from: string): void {
    let kept = 0;
    for (let i = room.signals.length - 1; i >= 0; i -= 1) {
      if (room.signals[i]?.from !== from) continue;
      kept += 1;
      if (kept > MAX_SIGNALS_PER_SENDER) room.signals.splice(i, 1);
    }
  }

  return {
    join(
      roomId: string,
      user: { id: string; name: string },
      at: number,
      cap: number = MAX_PEERS,
    ): JoinResult {
      const room = roomFor(roomId);
      sweep(roomId, room, at);
      const current = rooms.get(roomId) ?? roomFor(roomId);
      const existing = current.peers.get(user.id);
      if (!existing && current.peers.size >= Math.min(cap, MAX_PEERS)) {
        return { ok: false, status: 409, error: "That call is full." };
      }
      const cursor = current.nextId - 1;
      if (existing) {
        current.signals = current.signals.filter(
          (signal) => signal.from !== user.id && signal.to !== user.id,
        );
      }
      current.peers.set(user.id, {
        id: user.id,
        name: callDisplayName(user.name),
        seenAt: at,
        generation: (existing?.generation ?? 0) + 1,
        minSince: cursor,
        attempts: existing?.attempts.filter((stamp) => at - stamp < SIGNAL_WINDOW_MS) ?? [],
      });
      return { ok: true, peers: others(current, user.id), cursor };
    },

    /** The member's join generation in that call, or 0 when not in it. */
    generationOf(roomId: string, userId: string): number {
      return rooms.get(roomId)?.peers.get(userId)?.generation ?? 0;
    },

    leave(roomId: string, userId: string): void {
      dropPeer(roomId, userId);
    },

    /**
     * Drop this person from every room on this process. `evictCallMember`
     * is what a remove or ban calls. The slot is gone before the next poll.
     */
    evict(userId: string): number {
      let dropped = 0;
      for (const roomId of [...rooms.keys()]) {
        if (dropPeer(roomId, userId)) dropped += 1;
      }
      return dropped;
    },

    signal(roomId: string, from: string, input: unknown, at: number): SignalResult {
      const room = rooms.get(roomId);
      const sender = room?.peers.get(from);
      if (!room || !sender) return { ok: false, status: 409, error: "You are not in the call." };
      sender.seenAt = at;
      sender.attempts = sender.attempts.filter((stamp) => at - stamp < SIGNAL_WINDOW_MS);
      if (sender.attempts.length >= SIGNAL_LIMIT) {
        return {
          ok: false,
          status: 429,
          error: "Too many signals. Wait and try again.",
          retryAfter: 1,
        };
      }
      sender.attempts.push(at);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, status: 400, error: "That signal is not for a call." };
      }
      const body = input as { to?: unknown; kind?: unknown; payload?: unknown };
      if (body.kind !== "offer" && body.kind !== "answer" && body.kind !== "ice") {
        return { ok: false, status: 400, error: "That signal is not for a call." };
      }
      if (
        typeof body.to !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(body.to) ||
        body.to === from
      ) {
        return { ok: false, status: 409, error: "That person is not in the call." };
      }
      if (!room.peers.has(body.to)) {
        return { ok: false, status: 409, error: "That person is not in the call." };
      }
      const payload = normalizePayload(body.kind, body.payload);
      if (!payload) return { ok: false, status: 400, error: "That signal is not for a call." };
      const signal: StoredSignal = {
        id: room.nextId,
        from,
        to: body.to,
        kind: body.kind,
        payload,
        at,
      };
      room.nextId += 1;
      room.signals.push(signal);
      trimSender(room, from);
      if (room.signals.length > MAX_SIGNALS) {
        room.signals.splice(0, room.signals.length - MAX_SIGNALS);
      }
      return { ok: true };
    },

    poll(roomId: string, userId: string, since: number, at: number): PollResult {
      const room = rooms.get(roomId);
      const peer = room?.peers.get(userId);
      if (!room || !peer) return { ok: false, status: 409, error: "You are not in the call." };
      peer.seenAt = at;
      sweep(roomId, room, at);
      const still = rooms.get(roomId)?.peers.get(userId);
      const live = rooms.get(roomId);
      if (!live || !still) return { ok: false, status: 409, error: "You are not in the call." };
      const requested = Number.isFinite(since) && since >= 0 ? Math.floor(since) : still.minSince;
      const start = Math.max(requested, still.minSince);
      const signals = live.signals.filter((signal) => signal.id > start && signal.to === userId);
      const cursor = signals.reduce((max, signal) => Math.max(max, signal.id), start);
      return { ok: true, peers: others(live, userId), signals, cursor };
    },
  };
}

export type CallStore = ReturnType<typeof createCallStore>;
