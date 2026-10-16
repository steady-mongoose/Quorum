// Directory of towns, congregations, and the rooms Home can place.
// Town ids match the census ZIP seed (`riverview-fl`, not `riverview`).
// The national ZIP file is `zcta-towns.json`. A card with no local room
// is not given a topical stand-in here.

import type { CongregationRef, HomeCatalog, RoomScope, ZipTown } from "@/lib/board/home";

export const PLACE = {
  rvShop: "rv-shop",
  rvTown: "rv-town",
  brandonTown: "brandon-town",
  valricoTown: "valrico-town",
  tampaTown: "tampa-town",
  epiphany: "cong-epiphany",
  grace: "cong-grace",
  redeemer: "cong-redeemer",
  stJohn: "cong-st-john",
  hillsborough: "region-hillsborough",
} as const;

export type Town = { id: string; name: string };

export type LocalRoom = {
  id: string;
  name: string;
  scope: RoomScope;
};

export const TOWNS: readonly Town[] = [
  { id: "brandon-fl", name: "Brandon" },
  { id: "riverview-fl", name: "Riverview" },
  { id: "valrico-fl", name: "Valrico" },
  { id: "tampa-fl", name: "Tampa" },
];

export const CONGREGATIONS: readonly CongregationRef[] = [
  { id: "epiphany", name: "Epiphany of Our Lord" },
  { id: "grace", name: "Grace Bible Church of Brandon" },
  { id: "redeemer", name: "Redeemer Presbyterian" },
  { id: "st-john", name: "St. John the Baptist" },
];

/** Rooms a member can join. Not theme groups; those are a later PR. */
export const MEMBER_ROOMS: readonly LocalRoom[] = [
  { id: PLACE.rvShop, name: "Shop nights", scope: { kind: "town", townId: "riverview-fl" } },
  { id: PLACE.rvTown, name: "Town room", scope: { kind: "town", townId: "riverview-fl" } },
  { id: PLACE.brandonTown, name: "Town room", scope: { kind: "town", townId: "brandon-fl" } },
  { id: PLACE.valricoTown, name: "Town room", scope: { kind: "town", townId: "valrico-fl" } },
  { id: PLACE.tampaTown, name: "Town room", scope: { kind: "town", townId: "tampa-fl" } },
  { id: PLACE.epiphany, name: "Epiphany of Our Lord", scope: { kind: "congregation", congregationId: "epiphany" } },
  { id: PLACE.grace, name: "Grace Bible Church of Brandon", scope: { kind: "congregation", congregationId: "grace" } },
  { id: PLACE.redeemer, name: "Redeemer Presbyterian", scope: { kind: "congregation", congregationId: "redeemer" } },
  { id: PLACE.stJohn, name: "St. John the Baptist", scope: { kind: "congregation", congregationId: "st-john" } },
  { id: PLACE.hillsborough, name: "Hillsborough County", scope: { kind: "region", regionId: "hillsborough" } },
];

export function localRoomLabel(room: LocalRoom): string {
  const scope = room.scope;
  if (scope.kind !== "town") return room.name;
  const town = TOWNS.find((item) => item.id === scope.townId);
  return town ? `${town.name} · ${room.name}` : room.name;
}

/**
 * Rooms Home may place, plus the member's one ZIP row. Topical room ids are
 * not added. A card with no local room has nothing to match and stays off Home.
 */
/** Shipped rooms plus town rooms an admin or steward has approved. A ZIP does not add one. */
export function directoryRooms(extra: readonly LocalRoom[] = []): readonly LocalRoom[] {
  const seen = new Set(MEMBER_ROOMS.map((room) => room.id));
  const towns = new Set(MEMBER_ROOMS.flatMap((room) => (room.scope.kind === "town" ? [room.scope.townId] : [])));
  const added = extra.filter((room) => room.scope.kind === "town" && !seen.has(room.id) && !towns.has(room.scope.townId));
  return [...MEMBER_ROOMS, ...added];
}

export function homeCatalog(zips: readonly ZipTown[], extra: readonly LocalRoom[] = []): HomeCatalog {
  return { zips, rooms: directoryRooms(extra) };
}
