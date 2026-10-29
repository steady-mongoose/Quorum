/** The server's 403 text for a post or reply from someone not in the room. */
export const MEMBERS_ONLY_POST = "Only members of this room can post here.";

/** What a non-member sees in place of the composer and Reply, and in empty room states. */
export const MEMBERS_ONLY_INVITE = `${MEMBERS_ONLY_POST} Ask a member of the room for an invite.`;

/**
 * Who may post or reply in a room: a member of it (saved it or stood there),
 * a steward of that room, or an admin. The local demo board has no rooms on a
 * server, so everyone there may post.
 */
export function canPostInRoom(input: {
  remote: boolean;
  member: boolean;
  admin: boolean;
  stewardOfRoom: boolean;
}): boolean {
  if (!input.remote) return true;
  return input.member || input.admin || input.stewardOfRoom;
}
