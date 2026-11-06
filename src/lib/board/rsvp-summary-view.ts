import { roomById } from "./model.ts";

/**
 * Helpers for the admin RSVP counts panel (Design #126 M2). Room names come
 * from the room catalogue, never from members; weeks read "Week of Oct 26, 2026".
 */
/** A room with no name the admin can read (Design #126 r5712986677 M2). */
export const UNNAMED_ROOM = "Unnamed room";

/**
 * The name an admin reads: the server's room name, then the catalogue's,
 * else "Unnamed room". Never a raw room id (QA F7a).
 */
export function summaryRoomName(roomId: string, serverName = ""): string {
  if (!roomId) return "No room";
  if (serverName.trim()) return serverName.trim();
  const room = roomById(roomId as Parameters<typeof roomById>[0]);
  return room.id === roomId && room.name ? room.name : UNNAMED_ROOM;
}

/**
 * Named rooms alphabetically by the name the admin reads, then the unnamed
 * ones. Several unnamed rooms read "Unnamed room 1", "Unnamed room 2", in a
 * stable order (by room id, which is never shown), so a room keeps its number
 * between loads (Design #126 M2).
 */
export function sortSummaryRooms<T extends { roomId: string; name?: string }>(
  rooms: readonly T[],
  nameOf: (roomId: string, serverName?: string) => string = summaryRoomName,
): Array<T & { name: string }> {
  const named = rooms.map((room) => ({ ...room, name: nameOf(room.roomId, room.name ?? "") }));
  const unnamed = named.filter((room) => room.name === UNNAMED_ROOM).sort((a, b) => (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
  const rest = named
    .filter((room) => room.name !== UNNAMED_ROOM)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.roomId.localeCompare(b.roomId));
  const numbered = unnamed.length > 1 ? unnamed.map((room, i) => ({ ...room, name: `${UNNAMED_ROOM} ${i + 1}` })) : unnamed;
  return [...rest, ...numbered];
}

/** "2026-10-26" → "Week of Oct 26, 2026". */
export function weekLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return `Week of ${iso}`;
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
  );
  return `Week of ${day}`;
}

/** Oldest week first. */
export function sortWeeks<T extends { week: string }>(weeks: readonly T[]): T[] {
  return [...weeks].sort((a, b) => a.week.localeCompare(b.week));
}

/** No free-text title on the admin panel (QA S4): "Gathering on Oct 26, 2026". */
export function gatheringLabel(iso: string): string {
  if (!iso) return "Gathering, no date set";
  return `Gathering on ${weekLabel(iso).replace(/^Week of /, "")}`;
}
