import { roomById } from "./model.ts";

/**
 * Helpers for the admin RSVP counts panel (Design #126 M2). Room names come
 * from the room catalogue, never from members; weeks read "Week of Oct 26, 2026".
 */
export function summaryRoomName(roomId: string): string {
  if (!roomId) return "No room";
  const room = roomById(roomId as Parameters<typeof roomById>[0]);
  return room.id === roomId ? room.name : roomId;
}

/** Rooms sorted alphabetically by the name the admin reads. */
export function sortSummaryRooms<T extends { roomId: string }>(
  rooms: readonly T[],
  nameOf: (roomId: string) => string = summaryRoomName,
): Array<T & { name: string }> {
  return rooms
    .map((room) => ({ ...room, name: nameOf(room.roomId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.roomId.localeCompare(b.roomId));
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
