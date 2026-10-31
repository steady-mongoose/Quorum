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
 * The server has four refusals (server/dm/store.ts): NOT_REACHABLE, the generic
 * one that also covers bans, bars, the audience rule and being blocked; BLOCKED,
 * only for someone you blocked yourself; ROOM_WAIT; and ROOM_DAILY_LIMIT. Only
 * NOT_REACHABLE is reworded here: when the app believes the two of you share a
 * room, its "message someone in one of your rooms" sentence reads wrong, so say
 * ROOM_REFUSAL instead, which does not say which of the gates behind
 * NOT_REACHABLE refused. Your own block, the wait and the daily limit keep the
 * server's own sentences, as does the plain no-shared-room case.
 */
export function refusalText(serverError: string, sharesRoom: boolean): string {
  return sharesRoom && serverError === MESSAGE_RULE ? ROOM_REFUSAL : serverError;
}

/** The server's answer for one set of rooms and meetings, tagged with what it answers. */
export type ReachAnswer = {
  key: string;
  lists: MemberList[];
  peers: { id: string; name: string }[];
};

/** What an answer is for: these rooms, these meeting cards. Order does not matter. */
export function reachKey(roomIds: readonly string[], cardIds: readonly string[]): string {
  const rooms = [...new Set(roomIds)].sort().join(",");
  const cards = [...new Set(cardIds)].sort().join(",");
  return `${rooms}|${cards}`;
}

/**
 * The answer to use now. One fetched for other rooms (room A, while room B is
 * on screen) counts as nothing yet, so B never shows A's Message buttons.
 */
export function currentAnswer(
  answer: ReachAnswer | null,
  key: string,
): { lists: MemberList[]; peers: { id: string; name: string }[]; loaded: boolean } {
  if (!answer || answer.key !== key) return { lists: [], peers: [], loaded: false };
  return { lists: answer.lists, peers: answer.peers, loaded: true };
}

/** A counter that screens subscribe to, so a block or unblock refetches what is shown. */
export function createVersion() {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bump() {
      version += 1;
      for (const listener of listeners) listener();
    },
  };
}
