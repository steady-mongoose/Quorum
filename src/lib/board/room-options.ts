/**
 * What a room includes. An admin picks these when the room is set up and can
 * change them later (Josh, 2026-10-29). Roll call is off unless an admin turns
 * it on: not every room takes roll.
 */
export type RoomOption = "roll_call" | "members" | "chat" | "calls";

/** Every option, in the order the menu shows them. */
export const LEGACY_ROOM_OPTIONS: readonly RoomOption[] = ["roll_call", "members", "chat", "calls"];

/** A new room: everything but roll call. */
export const DEFAULT_ROOM_OPTIONS: readonly RoomOption[] = ["members", "chat", "calls"];

export const ROOM_OPTION_LABEL: Record<RoomOption, string> = {
  roll_call: "Roll call",
  members: "Member list",
  chat: "Room chat",
  calls: "Video calls",
};

/** One sentence each, for the menu. */
export const ROOM_OPTION_WHAT: Record<RoomOption, string> = {
  roll_call:
    "After a special event, the host or a steward records who came. Only they see it. You see your own.",
  members:
    "Members can see who is in the room, when each joined, and when each last posted.",
  chat: "A running chat for the members of the room.",
  calls: "Members can start a video call in the room.",
};

/** What the server says when a room has an option switched off. */
export const ROOM_OPTION_OFF: Record<RoomOption, string> = {
  roll_call: "This room does not take roll. Leave out who came.",
  members: "This room does not show its member list.",
  chat: "This room has no chat.",
  calls: "This room has no video calls.",
};

export function roomOptionsFrom(value: unknown): RoomOption[] {
  if (!Array.isArray(value)) return [...DEFAULT_ROOM_OPTIONS];
  const known = new Set<string>(LEGACY_ROOM_OPTIONS);
  return LEGACY_ROOM_OPTIONS.filter(
    (option) => known.has(option) && value.some((item) => item === option),
  );
}
