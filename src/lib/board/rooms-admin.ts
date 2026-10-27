import { apiFetch } from "../api-base.ts";
import { UNCATEGORIZED_SLUG } from "./categories.ts";

/** One room as the admin Rooms manager sees it. */
export type AdminRoom = {
  id: string;
  name: string;
  audience: "all" | "men" | "women";
  status: string;
  categoryIds: string[];
  stewards: string[];
};

export type AdminRoomGroup = { slug: string; name: string; rooms: AdminRoom[] };

/** The label admins see for rooms that have no real category yet. */
export const NOT_YET_SORTED = "Not yet sorted";

export function categoryLabel(slug: string, categories: readonly { slug: string; name: string }[]) {
  if (slug === UNCATEGORIZED_SLUG) return NOT_YET_SORTED;
  return categories.find((category) => category.slug === slug)?.name ?? slug;
}

function roomFrom(value: unknown): AdminRoom | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  return {
    id: row.id,
    name: row.name,
    audience: row.audience === "men" || row.audience === "women" ? row.audience : "all",
    status: typeof row.status === "string" ? row.status : "active",
    categoryIds: strings(row.categoryIds),
    stewards: strings(row.stewards),
  };
}

/** Rooms matching a search on name or slug. Blank search keeps every room. */
export function filterRooms(rooms: readonly AdminRoom[], query: string): AdminRoom[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rooms];
  return rooms.filter(
    (room) => room.name.toLowerCase().includes(needle) || room.id.toLowerCase().includes(needle),
  );
}

/**
 * Rooms grouped by category in category order. A room in two categories is
 * listed under both. Rooms with no category, or only the Uncategorized one,
 * go to "Not yet sorted", which is always last.
 */
export function groupRooms(
  rooms: readonly AdminRoom[],
  categories: readonly { slug: string; name: string; sortOrder?: number }[],
): AdminRoomGroup[] {
  const ordered = [...categories]
    .filter((category) => category.slug !== UNCATEGORIZED_SLUG)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.slug.localeCompare(b.slug));
  const known = new Set(ordered.map((category) => category.slug));
  const groups: AdminRoomGroup[] = ordered.map((category) => ({
    slug: category.slug,
    name: category.name,
    rooms: [],
  }));
  const unsorted: AdminRoom[] = [];
  for (const room of rooms) {
    const real = room.categoryIds.filter((slug) => known.has(slug));
    if (real.length === 0) unsorted.push(room);
    for (const slug of real) groups.find((group) => group.slug === slug)?.rooms.push(room);
  }
  const byName = (a: AdminRoom, b: AdminRoom) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  for (const group of groups) group.rooms.sort(byName);
  unsorted.sort(byName);
  return [
    ...groups.filter((group) => group.rooms.length > 0),
    ...(unsorted.length > 0
      ? [{ slug: UNCATEGORIZED_SLUG, name: NOT_YET_SORTED, rooms: unsorted }]
      : []),
  ];
}

/** Plain sentence for the categories confirmation. */
export function moveSummary(
  room: { name: string },
  from: readonly string[],
  to: readonly string[],
  categories: readonly { slug: string; name: string }[],
): string {
  const names = (list: readonly string[]) =>
    list.length === 0
      ? NOT_YET_SORTED
      : list.map((slug) => categoryLabel(slug, categories)).join(", ");
  return `${room.name} will be listed under: ${names(to)}. It was under: ${names(from)}. Members see the change right away, and it's logged with your name.`;
}

/** The polite search status line. */
export function searchSummary(count: number): string {
  if (count === 0) return "No room matches that search.";
  return count === 1 ? "1 room matches." : `${count} rooms match.`;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function errorFrom(json: unknown, fallback: string): string {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === "string" && error ? error : fallback;
}

export async function loadAdminRooms(): Promise<
  { ok: true; rooms: AdminRoom[] } | { ok: false; error: string }
> {
  const response = await apiFetch("/api/admin/rooms", { credentials: "include" });
  const json = await readJson(response);
  if (!response.ok) return { ok: false, error: errorFrom(json, "Rooms did not load.") };
  const rooms = (json as { rooms?: unknown } | null)?.rooms;
  if (!Array.isArray(rooms)) return { ok: false, error: "Rooms did not load." };
  return { ok: true, rooms: rooms.map(roomFrom).filter((row): row is AdminRoom => row !== null) };
}

export async function saveRoomCategories(
  id: string,
  categoryIds: string[],
): Promise<{ ok: true; room: AdminRoom } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/admin/rooms/${encodeURIComponent(id)}/categories`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ categoryIds }),
  });
  const json = await readJson(response);
  if (!response.ok) return { ok: false, error: errorFrom(json, "That move was not saved.") };
  const room = roomFrom(json);
  if (!room) return { ok: false, error: "That move was not saved." };
  return { ok: true, room };
}
