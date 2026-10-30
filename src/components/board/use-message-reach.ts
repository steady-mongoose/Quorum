import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { authorName, localReach, roomMatesOf } from "@/lib/board/model";
import {
  createVersion,
  currentAnswer,
  reachKey,
  serverReach,
  type ReachAnswer,
} from "@/lib/board/message-reach";
import { readReach, serverReachReads, type ReachReads } from "@/lib/board/message-reach-reads";
import type { MemberList } from "@/lib/board/room-members";
import { browserTransport } from "@/lib/e2ee/browser";
import { useBoard } from "@/lib/board/store";

/** Server answers are reused this long, so each page does not refetch them. */
const FRESH_MS = 30_000;
/** A hidden member list (404) is not asked again for this long, so it stays quiet. */
const HIDDEN_MS = 5 * 60_000;

type Cached<T> = { at: number; ttl: number; value: Promise<T> };
const roomLists = new Map<string, Cached<MemberList | null>>();
let peerList: Cached<{ id: string; name: string }[]> | null = null;
const reachVersion = createVersion();

function fresh<T>(entry: Cached<T> | null | undefined, now: number): entry is Cached<T> {
  return Boolean(entry && now - entry.at < entry.ttl);
}

/** GETs only, cached. See message-reach-reads.ts: a page load never writes. */
function cachedReads(): ReachReads {
  const server = serverReachReads(browserTransport());
  return {
    members(roomId) {
      const now = Date.now();
      const cached = roomLists.get(roomId);
      if (fresh(cached, now)) return cached.value;
      const entry: Cached<MemberList | null> = { at: now, ttl: FRESH_MS, value: server.members(roomId) };
      void entry.value.then((list) => {
        if (list === null) entry.ttl = HIDDEN_MS;
      });
      roomLists.set(roomId, entry);
      return entry.value;
    },
    peers() {
      const now = Date.now();
      if (fresh(peerList, now)) return peerList.value;
      peerList = { at: now, ttl: FRESH_MS, value: server.peers() };
      return peerList.value;
    },
  };
}

/** Forget cached answers after a block or unblock; screens showing Message refetch. */
export function forgetMessageReach(): void {
  roomLists.clear();
  peerList = null;
  reachVersion.bump();
}

export type MessageReach = {
  canMessage: (name: string) => boolean;
  sharesRoom: (name: string) => boolean;
  /** The server has answered for these rooms (always true on the demo board). */
  loaded: boolean;
};

/**
 * Who you may message, for these rooms' pages. Signed in, it is the server's
 * answer (serverReach). On the demo board, it is the demo rule (localReach).
 */
export function useMessageReach(roomIds: readonly string[]): MessageReach {
  const remote = useBoard((state) => state.remote);
  const me = useBoard((state) => authorName(state.me));
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const rooms = useBoard((state) => state.rooms);
  const version = useSyncExternalStore(reachVersion.subscribe, reachVersion.get, reachVersion.get);
  const cardIds = useMemo(
    () =>
      cards
        .filter((card) => card.kind === "meeting" && card.wentBy.includes(me))
        .map((card) => card.id),
    [cards, me],
  );
  const key = reachKey(roomIds, cardIds);
  const roomMates = useMemo(() => roomMatesOf(me, rooms, posts), [me, rooms, posts]);
  const [answer, setAnswer] = useState<ReachAnswer | null>(null);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const rooms = key.split("|")[0];
    void readReach(rooms ? rooms.split(",") : [], cachedReads()).then(({ lists, peers }) => {
      if (cancelled) return;
      setAnswer({ key, lists, peers });
    });
    return () => {
      cancelled = true;
    };
  }, [remote, key, version]);

  return useMemo(() => {
    if (!remote) {
      const local = localReach(me, cards, posts, rooms);
      return {
        canMessage: (name: string) => local.has(name),
        sharesRoom: (name: string) => roomMates.has(name),
        loaded: true,
      };
    }
    const now = currentAnswer(answer, key);
    const reach = serverReach(me, now.lists, now.peers, roomMates);
    return {
      canMessage: (name: string) => reach.open.has(name),
      sharesRoom: (name: string) => reach.inRoom.has(name),
      loaded: now.loaded,
    };
  }, [remote, me, cards, posts, rooms, roomMates, answer, key]);
}
