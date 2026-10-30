import { listDmPeers, type DmTransport } from "../e2ee/mailbox.ts";
import { loadRoomMembers, type MemberList } from "./room-members.ts";

/**
 * The two reads behind the Message buttons. Both are GETs. Loading a room,
 * Find, a profile or the mailbox writes nothing: attendance (POST
 * /api/dm/attendance, which replaces your rows) is sent only when the mailbox
 * opens a conversation.
 */
export type ReachReads = {
  /** A room's member list, or null when it is hidden (404) or did not load. */
  members: (roomId: string) => Promise<MemberList | null>;
  peers: () => Promise<{ id: string; name: string }[]>;
};

export function serverReachReads(transport: DmTransport): ReachReads {
  return {
    // A failed list is quiet: nothing is logged, and nobody is added.
    members: (roomId) =>
      loadRoomMembers(roomId).then(
        (result) => (result.ok ? result.list : null),
        () => null,
      ),
    peers: () =>
      listDmPeers(transport).then(
        (found) => (found.ok ? found.peers : []),
        () => [],
      ),
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
