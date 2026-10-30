import { useEffect, useMemo, useState } from "react";
import { authorName, localReach, roomMatesOf } from "@/lib/board/model";
import { serverReach } from "@/lib/board/message-reach";
import { loadRoomMembers, type MemberList } from "@/lib/board/room-members";
import { browserTransport } from "@/lib/e2ee/browser";
import { listDmPeers, recordAttendance } from "@/lib/e2ee/mailbox";
import { useBoard } from "@/lib/board/store";

/** Server answers are reused this long, so each page does not refetch them. */
const FRESH_MS = 30_000;

type Cached<T> = { at: number; value: Promise<T> };
const roomLists = new Map<string, Cached<MemberList | null>>();
let peerList: (Cached<{ id: string; name: string }[]> & { key: string }) | null = null;

function fresh<T>(entry: Cached<T> | null | undefined, now: number): entry is Cached<T> {
  return Boolean(entry && now - entry.at < FRESH_MS);
}

function roomList(roomId: string, now: number): Promise<MemberList | null> {
  const cached = roomLists.get(roomId);
  if (fresh(cached, now)) return cached.value;
  // A room that hides its member list, or one you are not in, adds nobody.
  const value = loadRoomMembers(roomId).then((result) => (result.ok ? result.list : null));
  roomLists.set(roomId, { at: now, value });
  return value;
}

/**
 * The server's peers list. The mailbox confirms your meetings before it asks;
 * this does the same, with the same cards, so a meeting you went to counts here
 * as it does when you open a conversation.
 */
function peers(cardIds: string[], now: number): Promise<{ id: string; name: string }[]> {
  const key = [...cardIds].sort().join(",");
  if (peerList && peerList.key === key && fresh(peerList, now)) return peerList.value;
  const transport = browserTransport();
  const value = (async () => {
    const recorded = await recordAttendance(transport, cardIds);
    if (!recorded.ok) return [];
    const found = await listDmPeers(transport);
    return found.ok ? found.peers : [];
  })();
  peerList = { key, at: now, value };
  return value;
}

/** Forget cached answers, after a block or unblock changes them. */
export function forgetMessageReach(): void {
  roomLists.clear();
  peerList = null;
}

export type MessageReach = {
  canMessage: (name: string) => boolean;
  sharesRoom: (name: string) => boolean;
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
  const roomKey = [...new Set(roomIds)].sort().join(",");
  const cardIds = useMemo(
    () =>
      cards
        .filter((card) => card.kind === "meeting" && card.wentBy.includes(me))
        .map((card) => card.id),
    [cards, me],
  );
  const cardKey = cardIds.join(",");
  const roomMates = useMemo(() => roomMatesOf(me, rooms, posts), [me, rooms, posts]);
  const [answer, setAnswer] = useState<{
    lists: MemberList[];
    peers: { id: string; name: string }[];
  }>({ lists: [], peers: [] });

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const now = Date.now();
    const ids = roomKey ? roomKey.split(",") : [];
    void Promise.all([Promise.all(ids.map((id) => roomList(id, now))), peers(cardIds, now)]).then(
      ([lists, found]) => {
        if (cancelled) return;
        setAnswer({
          lists: lists.filter((list): list is MemberList => list !== null),
          peers: found,
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // cardIds is keyed by cardKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, roomKey, cardKey]);

  return useMemo(() => {
    if (!remote) {
      const local = localReach(me, cards, posts, rooms);
      return {
        canMessage: (name: string) => local.has(name),
        sharesRoom: (name: string) => roomMates.has(name),
      };
    }
    const reach = serverReach(me, answer.lists, answer.peers, roomMates);
    return {
      canMessage: (name: string) => reach.open.has(name),
      sharesRoom: (name: string) => reach.inRoom.has(name),
    };
  }, [remote, me, cards, posts, rooms, roomMates, answer]);
}
