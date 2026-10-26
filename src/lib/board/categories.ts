/**
 * The category list. Stewards can edit the rows on the server. This module is
 * the seed and the backfill, so the migration, the browse page, and room
 * create all start from the same names.
 *
 * Men and Women are labels only. Who may enter those rooms is not stored
 * here. A later migration (0019) enforces audience. This file does not.
 */

export type RoomCategory = {
  slug: string;
  name: string;
  sortOrder: number;
};

/** Seeded order. Uncategorized is last and is not part of Browse. */
export const CATEGORY_LIST: readonly RoomCategory[] = [
  { slug: "churches", name: "Churches", sortOrder: 0 },
  { slug: "discussion", name: "Discussion", sortOrder: 1 },
  { slug: "men", name: "Men", sortOrder: 2 },
  { slug: "women", name: "Women", sortOrder: 3 },
  { slug: "business-trades", name: "Business & Trades", sortOrder: 4 },
  { slug: "civic", name: "Civic", sortOrder: 5 },
  { slug: "county", name: "County", sortOrder: 6 },
  { slug: "uncategorized", name: "Uncategorized", sortOrder: 1000 },
];

export const UNCATEGORIZED_SLUG = "uncategorized";

/**
 * Rooms shipped in earlier migrations, and where they belong.
 * Anything absent stays Uncategorized until a steward moves it.
 *
 * Churches: the parish rooms and the congregation rooms.
 * Discussion: Debate Night, Literary Society, and the co-op.
 * Business & Trades: the shop rooms.
 * Civic: Dispatch and the town rooms.
 * County: The County and the Hillsborough region room.
 * Men and Women have no rooms. They are labels.
 */
export const ROOM_CATEGORY: Readonly<Record<string, string>> = {
  baptist: "churches",
  presbyterian: "churches",
  latin: "churches",
  orthodox: "churches",
  "cong-epiphany": "churches",
  "cong-grace": "churches",
  "cong-redeemer": "churches",
  "cong-st-john": "churches",
  question: "discussion",
  shelf: "discussion",
  coop: "discussion",
  shop: "business-trades",
  "rv-shop": "business-trades",
  dispatch: "civic",
  "rv-town": "civic",
  "brandon-town": "civic",
  "valrico-town": "civic",
  "tampa-town": "civic",
  county: "county",
  "region-hillsborough": "county",
};

/** A room approved from a place request. Topic rooms choose a category in the form. */
export function categoryForScope(kind: "town" | "congregation" | "region" | "topic"): string {
  if (kind === "congregation") return "churches";
  if (kind === "town") return "civic";
  if (kind === "region") return "county";
  return UNCATEGORIZED_SLUG;
}

export function categoryForRoom(roomId: string): string {
  return ROOM_CATEGORY[roomId] ?? UNCATEGORIZED_SLUG;
}

export function roomCategoryId(room: { id: string; categoryId?: string }): string {
  const slug = room.categoryId?.trim();
  return slug || categoryForRoom(room.id);
}

const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function categorySlugOk(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 32 && CATEGORY_SLUG.test(slug);
}

export function categoryName(
  slug: string,
  categories: readonly Pick<RoomCategory, "slug" | "name">[] = CATEGORY_LIST,
): string {
  return categories.find((category) => category.slug === slug)?.name ?? "Uncategorized";
}

/** Uncategorized stays off Browse. Stewards still receive it so they can fix rooms. */
export function browseCategories<T extends { slug: string }>(
  categories: readonly T[],
  steward: boolean,
): T[] {
  const ordered = [...categories].sort(
    (a, b) =>
      ("sortOrder" in a && "sortOrder" in b ? Number(a.sortOrder) - Number(b.sortOrder) : 0) ||
      a.slug.localeCompare(b.slug),
  );
  return steward ? ordered : ordered.filter((category) => category.slug !== UNCATEGORIZED_SLUG);
}

export function categoryListed(
  slug: string,
  categories: readonly { slug: string }[],
  steward: boolean,
): boolean {
  if (!categories.some((category) => category.slug === slug)) return false;
  if (slug === UNCATEGORIZED_SLUG) return steward;
  return true;
}

export type Gatherable = {
  room: string;
  next: string;
  kind?: string;
  paused?: boolean;
  cancelled?: boolean;
};

/** The soonest gathering still ahead, or none. Trades and needs are not gatherings. */
export function nextGatheringOn(
  roomId: string,
  cards: readonly Gatherable[],
  today: string,
): string | null {
  let best: string | null = null;
  for (const card of cards) {
    if (card.room !== roomId || card.paused || card.cancelled) continue;
    if (card.kind === "trade" || card.kind === "need") continue;
    const next = card.next.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < today) continue;
    if (!best || next < best) best = next;
  }
  return best;
}

/** Soonest gathering first. Rooms with no gathering follow, A to Z. */
export function orderBrowseRooms<T extends { name: string; nextGathering: string | null }>(
  rooms: readonly T[],
): T[] {
  return [...rooms].sort((a, b) => {
    const left = a.nextGathering ?? "";
    const right = b.nextGathering ?? "";
    if (left !== right) {
      if (!left) return 1;
      if (!right) return -1;
      return left < right ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

export type BrowseRoom = {
  id: string;
  name: string;
  what: string;
  categoryId: string;
  nextGathering: string | null;
};

export type BrowseSection = {
  category: RoomCategory;
  rooms: BrowseRoom[];
};

/** Browse sections. Uncategorized is omitted here; stewards read it from hiddenRooms. */
export function groupBrowseRooms(
  categories: readonly RoomCategory[],
  rooms: readonly BrowseRoom[],
  focusSlug: string | null,
): BrowseSection[] {
  const visible = browseCategories(categories, false);
  const chosen = focusSlug ? visible.filter((category) => category.slug === focusSlug) : visible;
  return chosen.map((category) => ({
    category,
    rooms: orderBrowseRooms(rooms.filter((room) => room.categoryId === category.slug)),
  }));
}

export function hiddenRooms(rooms: readonly BrowseRoom[], steward: boolean): BrowseRoom[] {
  if (!steward) return [];
  return orderBrowseRooms(rooms.filter((room) => room.categoryId === UNCATEGORIZED_SLUG));
}
