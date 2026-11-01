/**
 * The county is the top level of the app. Every room and every group has
 * exactly one county. A county is a place to look, not a wall: anyone can look
 * at another county, and a room invite works across counties. Who may join or
 * read a room is still the room's own rule.
 */

export type CountyId = "hillsborough" | "polk" | "manatee" | "pinellas";

export type County = { id: CountyId; name: string };

/** The first four, in the order they were named. Migration 0051 seeds the same rows. */
export const COUNTIES: readonly County[] = [
  { id: "hillsborough", name: "Hillsborough" },
  { id: "polk", name: "Polk" },
  { id: "manatee", name: "Manatee" },
  { id: "pinellas", name: "Pinellas" },
];

/** Where a room with no county stands. Everything before 0051 is here. */
export const DEFAULT_COUNTY: CountyId = "hillsborough";

/** Which county the desk's calls are written for. */
export const DESK_COUNTY: CountyId = "hillsborough";

export const COUNTY_LINE = "Hillsborough, Polk, Manatee, and Pinellas";

export const COUNTY_REQUIRED = `Choose ${COUNTY_LINE.replace(", and ", ", or ")}.`;

export function isCountyId(value: unknown): value is CountyId {
  return COUNTIES.some((county) => county.id === value);
}

export function countyName(id: string | null | undefined): string {
  return COUNTIES.find((county) => county.id === id)?.name ?? "";
}

/** A county from imported text: "Polk", "polk county", "Polk County, FL". */
export function countyFromText(text: string): CountyId | null {
  const first = text.trim().toLowerCase().split(/[\s,]+/)[0];
  return isCountyId(first) ? first : null;
}

export function roomCounty(room: { countyId?: string | null }): CountyId {
  return isCountyId(room.countyId) ? room.countyId : DEFAULT_COUNTY;
}

export function inCounty(room: { countyId?: string | null }, county: CountyId): boolean {
  return roomCounty(room) === county;
}

type CountyRoom = { id: string; countyId?: string | null; joined?: boolean };

/** Room ids to leave off for this county. A joined room stays when `keepJoined`. */
function otherCountyRooms(
  rooms: readonly CountyRoom[],
  county: CountyId,
  keepJoined: boolean,
): Set<string> {
  return new Set(
    rooms
      .filter((room) => !inCounty(room, county) && !(keepJoined && room.joined === true))
      .map((room) => room.id),
  );
}

/** This week: the chosen county, and anything you joined elsewhere. */
export function cardsForWeek<T extends { room: string }>(
  cards: readonly T[],
  rooms: readonly CountyRoom[],
  county: CountyId,
): T[] {
  const away = otherCountyRooms(rooms, county, true);
  return cards.filter((card) => !away.has(card.room));
}

/** Find: only the chosen county. */
export function cardsForFind<T extends { room: string }>(
  cards: readonly T[],
  rooms: readonly CountyRoom[],
  county: CountyId,
): T[] {
  const away = otherCountyRooms(rooms, county, false);
  return cards.filter((card) => !away.has(card.room));
}

/** Groups: the chosen county, plus any you are in or have been invited to. */
export function groupsForCounty<
  T extends { countyId?: string | null; joined?: boolean; inviteFrom?: string },
>(groups: readonly T[], county: CountyId): T[] {
  return groups.filter(
    (group) => inCounty(group, county) || group.joined === true || Boolean(group.inviteFrom),
  );
}

/** Rooms and council posts on Home. What you've joined stays whichever county you're in. */
export function homeForCounty<
  S extends {
    tier: string;
    rooms?: readonly { id: string; countyId?: string | null }[];
    posts?: readonly { room: string }[];
  },
>(sections: readonly S[], rooms: readonly CountyRoom[], county: CountyId): S[] {
  const away = otherCountyRooms(rooms, county, true);
  return sections
    .map((section) => {
      if (section.tier === "joined") return section;
      return {
        ...section,
        ...(section.rooms ? { rooms: section.rooms.filter((room) => inCounty(room, county)) } : {}),
        ...(section.posts ? { posts: section.posts.filter((post) => !away.has(post.room)) } : {}),
      };
    })
    .filter((section) => (section.rooms ?? section.posts ?? []).length > 0);
}

/**
 * Group ids are global, so Carpentry in Polk needs its own. The default county
 * keeps the plain name, which is what every group before counties has.
 */
export function countyGroupId(plain: string, county: CountyId): string {
  if (!plain || county === DEFAULT_COUNTY) return plain;
  return `${county}-${plain}`.slice(0, 32).replace(/-+$/g, "");
}

/** The desk's calls are written for one county, so it shows only there. */
export function deskShown(deskOn: boolean, county: CountyId): boolean {
  return deskOn && county === DESK_COUNTY;
}

/** The app asks once: the server's board has loaded, it holds counties, and none is saved. */
export function countyDue(input: {
  boardLoaded: boolean;
  countiesOn: boolean;
  homeCounty: CountyId | null;
}): boolean {
  return input.boardLoaded && input.countiesOn && input.homeCounty === null;
}

/** A rooms page's address, for navigate(). */
export function roomsAddress(county: CountyId, slug: string | null, replace = false) {
  return slug
    ? ({ to: "/$county/rooms/$slug", params: { county, slug }, replace } as const)
    : ({ to: "/$county/rooms", params: { county }, replace } as const);
}

/** The county on screen: the address first, then the last one chosen, then home. */
export function currentCounty(input: {
  routeCounty?: string | null;
  chosen?: CountyId | null;
  homeCounty?: CountyId | null;
}): CountyId {
  if (isCountyId(input.routeCounty)) return input.routeCounty;
  return input.chosen ?? input.homeCounty ?? DEFAULT_COUNTY;
}
