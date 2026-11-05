import { listDmPeers, type DmTransport } from "../e2ee/mailbox.ts";
import { loadRoomMembers, type MemberList } from "./room-members.ts";

/**
 * The two reads behind the Message buttons. Both are GETs. Loading a room,
 * Find, a profile or the mailbox writes nothing: attendance (POST
 * /api/dm/attendance) is sent only when the member acts, by tapping "I went"
 * or by the mailbox opening a conversation by name.
 */
export type ReachReads = {
  /** A room's member list, or null when it is hidden (404) or did not load. */
  members: (roomId: string) => Promise<MemberList | null>;
  peers: () => Promise<{ id: string; name: string }[]>;
};

/** A member list read: the list, hidden (404: the room has the list turned off), or failed. */
export type MemberAnswer =
  { kind: "list"; list: MemberList } | { kind: "hidden" } | { kind: "failed" };

export type PeersAnswer =
  { kind: "peers"; peers: { id: string; name: string }[] } | { kind: "failed" };

export type ReachAnswers = {
  members: (roomId: string) => Promise<MemberAnswer>;
  peers: () => Promise<PeersAnswer>;
};

/** Server answers are reused this long, so each page does not refetch them. */
export const FRESH_MS = 30_000;
/** Only a hidden member list (404) is not asked again for this long, so it stays quiet. */
export const HIDDEN_MS = 5 * 60_000;
/** A 500, 429, 401 or network error is asked again after this, not after HIDDEN_MS. */
export const FAILED_MS = 10_000;

/** The server's answers, with a failure told apart from a hidden list. Never throws or logs. */
export function serverReachAnswers(transport: DmTransport): ReachAnswers {
  return {
    members: (roomId) =>
      loadRoomMembers(roomId).then(
        (result): MemberAnswer =>
          result.ok
            ? { kind: "list", list: result.list }
            : result.status === 404
              ? { kind: "hidden" }
              : { kind: "failed" },
        (): MemberAnswer => ({ kind: "failed" }),
      ),
    peers: () =>
      listDmPeers(transport).then(
        (found): PeersAnswer =>
          found.ok ? { kind: "peers", peers: found.peers } : { kind: "failed" },
        (): PeersAnswer => ({ kind: "failed" }),
      ),
  };
}

function asReads(answers: ReachAnswers): ReachReads {
  // A failed list is quiet: nothing is logged, and nobody is added.
  return {
    members: (roomId) =>
      answers.members(roomId).then((answer) => (answer.kind === "list" ? answer.list : null)),
    peers: () => answers.peers().then((answer) => (answer.kind === "peers" ? answer.peers : [])),
  };
}

export function serverReachReads(transport: DmTransport): ReachReads {
  return asReads(serverReachAnswers(transport));
}

type Cached<T> = { at: number; ttl: number; value: Promise<T> };

function ttlOf(answer: MemberAnswer | PeersAnswer): number {
  if (answer.kind === "hidden") return HIDDEN_MS;
  if (answer.kind === "failed") return FAILED_MS;
  return FRESH_MS;
}

/**
 * The reads, cached: an answer is reused for FRESH_MS, a hidden list for
 * HIDDEN_MS, and a failure only for FAILED_MS, so a brief outage or rate
 * limit does not hide Message for five minutes.
 */
export function cachedReachReads(
  server: () => ReachAnswers,
  clock: () => number = Date.now,
): { reads: ReachReads; forget: () => void } {
  const rooms = new Map<string, Cached<MemberAnswer>>();
  let peers: Cached<PeersAnswer> | null = null;
  const fresh = <T>(entry: Cached<T> | null | undefined): entry is Cached<T> =>
    Boolean(entry && clock() - entry.at < entry.ttl);
  const remember = <T extends MemberAnswer | PeersAnswer>(value: Promise<T>): Cached<T> => {
    const entry: Cached<T> = { at: clock(), ttl: FRESH_MS, value };
    void value.then((answer) => {
      entry.ttl = ttlOf(answer);
    });
    return entry;
  };
  const answers: ReachAnswers = {
    members(roomId) {
      const cached = rooms.get(roomId);
      if (fresh(cached)) return cached.value;
      const entry = remember(server().members(roomId));
      rooms.set(roomId, entry);
      return entry.value;
    },
    peers() {
      if (fresh(peers)) return peers.value;
      peers = remember(server().peers());
      return peers.value;
    },
  };
  return {
    reads: asReads(answers),
    forget() {
      rooms.clear();
      peers = null;
    },
  };
}

export async function readReach(
  roomIds: readonly string[],
  reads: ReachReads,
): Promise<{ lists: MemberList[]; peers: { id: string; name: string }[] }> {
  const [lists, peers] = await Promise.all([
    Promise.all([...new Set(roomIds)].map((id) => reads.members(id))),
    reads.peers(),
  ]);
  return { lists: lists.filter((list): list is MemberList => list !== null), peers };
}
