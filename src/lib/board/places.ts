// Directory of towns, ZIPs, congregations, and the rooms Home can place.
// Topical rooms (The Shop, The County, …) stay what they are. A card's
// local room is where it sits for Home. This is the sample area around
// Brandon and Riverview, not a national ZIP file.

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
  { id: "brandon", name: "Brandon" },
  { id: "riverview", name: "Riverview" },
  { id: "valrico", name: "Valrico" },
  { id: "tampa", name: "Tampa" },
];

export const ZIP_TOWNS: readonly ZipTown[] = [
  { zip: "33510", townId: "brandon" },
  { zip: "33511", townId: "brandon" },
  { zip: "33568", townId: "riverview" },
  { zip: "33569", townId: "riverview" },
  { zip: "33578", townId: "riverview" },
  { zip: "33579", townId: "riverview" },
  { zip: "33594", townId: "valrico" },
  { zip: "33596", townId: "valrico" },
  { zip: "33602", townId: "tampa" },
  { zip: "33609", townId: "tampa" },
  { zip: "33610", townId: "tampa" },
];

export const CONGREGATIONS: readonly CongregationRef[] = [
  { id: "epiphany", name: "Epiphany of Our Lord" },
  { id: "grace", name: "Grace Bible Church of Brandon" },
  { id: "redeemer", name: "Redeemer Presbyterian" },
  { id: "st-john", name: "St. John the Baptist" },
];

/** Rooms a member can join. Not theme groups; those are a later PR. */
export const MEMBER_ROOMS: readonly LocalRoom[] = [
  { id: PLACE.rvShop, name: "Shop nights", scope: { kind: "town", townId: "riverview" } },
  { id: PLACE.rvTown, name: "Town room", scope: { kind: "town", townId: "riverview" } },
  { id: PLACE.brandonTown, name: "Town room", scope: { kind: "town", townId: "brandon" } },
  { id: PLACE.valricoTown, name: "Town room", scope: { kind: "town", townId: "valrico" } },
  { id: PLACE.tampaTown, name: "Town room", scope: { kind: "town", townId: "tampa" } },
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
 * Member rooms, plus each topical room id as a wider region. A card that is
 * not tied to a town yet still has a place on Home: last, with the other
 * wider rooms. Pass the topical ids from `ROOMS` so this file does not import
 * the board model.
 */
export function homeCatalog(topicalRoomIds: readonly string[]): HomeCatalog {
  return {
    zips: ZIP_TOWNS,
    rooms: [
      ...MEMBER_ROOMS,
      ...topicalRoomIds.map((id) => ({ id, scope: { kind: "region" as const, regionId: "hillsborough" } })),
    ],
  };
}
