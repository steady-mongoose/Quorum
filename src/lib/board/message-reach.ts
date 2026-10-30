import { MESSAGE_RULE } from "../e2ee/copy.ts";
import type { MemberList } from "./room-members.ts";

/**
 * Who the signed-in app offers "Message" for. The server decides: its peers
 * list (people from a confirmed meeting, with its gates applied) and each room
 * member list's `message` state (a shared room, the 3-day wait counted from
 * your own join, the daily limit, blocks, bars and audience). The app does not
 * recompute the rule. The server checks again when a conversation opens.
 */
export type ServerReach = {
  /** Names the server says you may message now, with an account id. */
  open: Map<string, string>;
  /** Names the app believes share a room with you. Only for wording a refusal. */
  inRoom: Set<string>;
};

export function serverReach(
  me: string,
  lists: readonly MemberList[],
  peers: readonly { id: string; name: string }[],
  roomMates: ReadonlySet<string> = new Set(),
): ServerReach {
  const open = new Map<string, string>();
  const inRoom = new Set<string>(roomMates);
  for (const peer of peers) if (peer.name && !open.has(peer.name)) open.set(peer.name, peer.id);
  for (const list of lists) {
    for (const row of list.members) {
      if (!row.name || row.name === me) continue;
      inRoom.add(row.name);
      if (row.message === "open" && !open.has(row.name)) open.set(row.name, row.id);
    }
  }
  open.delete(me);
  inRoom.delete(me);
  return { open, inRoom };
}

/** Shown when the server refuses someone the app believes shares a room with you. */
export const ROOM_REFUSAL = "You can't message this member right now.";

/**
 * The server sends one refusal, MESSAGE_RULE, for every gate. When the app
 * believes the two of you share a room, that sentence reads wrong, so say
 * ROOM_REFUSAL instead. It names no reason (a ban, a bar, a block, the wait).
 * Any other error, and the plain no-shared-room case, stay as they are.
 */
export function refusalText(serverError: string, sharesRoom: boolean): string {
  return sharesRoom && serverError === MESSAGE_RULE ? ROOM_REFUSAL : serverError;
}
