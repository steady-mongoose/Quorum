/**
 * The category list. Admins can edit the rows on the server. This module is
 * the seed and the backfill, so the migration, the browse page, and room
 * create all start from the same names.
 *
 * Men only and Women only are where a room is listed. Who may enter is the
 * room's audience, enforced by a later migration (0019). This file does not
 * store that column.
 */

export type RoomCategory = {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
};

/** Seeded order. Uncategorized is last and is not part of Browse. */
export const CATEGORY_LIST: readonly RoomCategory[] = [
  {
    slug: "churches",
    name: "Churches",
    description: "Parish and congregation rooms.",
    sortOrder: 0,
  },
  {
    slug: "discussion",
    name: "Discussion",
    description: "Questions, the shelf, and the co-op.",
    sortOrder: 1,
  },
  { slug: "men", name: "Men only", description: "Rooms listed for men.", sortOrder: 2 },
  { slug: "women", name: "Women only", description: "Rooms listed for women.", sortOrder: 3 },
  {
    slug: "business-trades",
    name: "Business & Trades",
    description: "Shops and the trades.",
    sortOrder: 4,
  },
  { slug: "civic", name: "Civic", description: "Town rooms and dispatch.", sortOrder: 5 },
  { slug: "county", name: "County", description: "The county and its regions.", sortOrder: 6 },
  {
    slug: "uncategorized",
    name: "Uncategorized",
    description: "Rooms waiting for a category.",
    sortOrder: 1000,
  },
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
 * Men only and Women only have no rooms.
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

/** Pinned rooms first, in pin order. The rest follow, A to Z. */
export function orderBrowseRooms<T extends { name: string; pinOrder?: number | null }>(
  rooms: readonly T[],
): T[] {
  return [...rooms].sort((a, b) => {
    const left = typeof a.pinOrder === "number" ? a.pinOrder : null;
    const right = typeof b.pinOrder === "number" ? b.pinOrder : null;
    if (left !== null || right !== null) {
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return left - right;
    }
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A one-line cadence. Empty when the room has no gathering ahead. */
export function meetsLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const name = WEEKDAYS[date.getUTCDay()];
  return name ? `meets ${name}` : "";
}

/** #49's audience wording. Empty until that room has an audience. */
export function audienceLabel(audience: string | null | undefined): "Men only" | "Women only" | "" {
  if (audience === "men") return "Men only";
  if (audience === "women") return "Women only";
  return "";
}

export type CategoryEngraving = {
  src: string;
  image: string;
  credit: string;
};

const ART_ORIGIN = "https://avouchsocial.com";

/** The vignette for one category page. Martin is the civic and county plate. */
export function categoryEngraving(slug: string): CategoryEngraving {
  if (slug === "churches") {
    return {
      src: "/art/dore-band-A.webp",
      image: `${ART_ORIGIN}/art/dore-og.webp`,
      credit: "Gustave Doré, Jacob’s Dream, 1866",
    };
  }
  if (slug === "discussion") {
    return {
      src: "/art/durer-jerome-band-A.webp",
      image: `${ART_ORIGIN}/art/durer-jerome-band-A.webp`,
      credit: "Albrecht Dürer, Saint Jerome in His Study, 1514",
    };
  }
  if (slug === "men" || slug === "women") {
    return {
      src: "/art/durer-hands-side-A.webp",
      image: `${ART_ORIGIN}/art/durer-hands-side-A.webp`,
      credit: "Albrecht Dürer, Study of an Apostle’s Hands, 1508",
    };
  }
  return {
    src: "/art/martin-hero-A.webp",
    image: `${ART_ORIGIN}/art/martin-hero-A.webp`,
    credit: "John Martin, Paradise Lost: The Creation of Light",
  };
}

/** Open Graph fields for /rooms/<slug>. Unknown slugs stay a rooms preview. */
export function categoryPreview(
  slug: string,
  categories: readonly RoomCategory[] = CATEGORY_LIST,
): { title: string; description: string; image: string; credit: string } {
  const category = categories.find((item) => item.slug === slug);
  const art = categoryEngraving(category ? slug : "civic");
  return {
    title: category?.name ?? "Rooms",
    description: category?.description.trim() || "Find your room",
    image: art.image,
    credit: art.credit,
  };
}

export type BrowseRoom = {
  id: string;
  name: string;
  what: string;
  categoryId: string;
  nextGathering: string | null;
  pinOrder?: number | null;
  joined?: boolean;
  audience?: string;
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
