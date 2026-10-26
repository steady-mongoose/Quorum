import type { Db } from "../db.ts";
import { isUniqueViolation } from "../db.ts";
import { actorRole } from "./access.ts";
import { openBan, type OpenBan } from "./store.ts";
import { isEnglish } from "../../src/lib/board/text.ts";
import {
  UNCATEGORIZED_SLUG,
  categorySlugOk,
  orderBrowseRooms,
  type RoomCategory,
} from "../../src/lib/board/categories.ts";

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; status: number; error: string; ban?: OpenBan };
export type CategoryResult<T> = Ok<T> | Err;

export type CategoryRoom = {
  id: string;
  name: string;
  what: string;
  nextGathering: string | null;
};

function fail(status: number, error: string, ban?: OpenBan): Err {
  return ban ? { ok: false, status, error, ban } : { ok: false, status, error };
}

function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function toCategory(row: { slug: string; name: string; sort_order: number }): RoomCategory {
  return { slug: row.slug, name: row.name, sortOrder: Number(row.sort_order) };
}

async function memberOrStop(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ steward: boolean } | Err> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read categories.");
  const ban = await openBan(db, userId, now);
  if (ban) return fail(403, "banned", ban);
  return { steward: actor.steward };
}

async function stewardOrStop(db: Db, userId: string, now: Date): Promise<true | Err> {
  const actor = await actorRole(db, userId);
  if (!actor.member) return fail(403, "Only a member can read categories.");
  if (!actor.steward) return fail(403, "Only a steward can manage categories.");
  const ban = await openBan(db, userId, now);
  if (ban) return fail(403, "banned", ban);
  return true;
}

function nameOk(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || !isEnglish(trimmed))
    return "Name the category in English.";
  return null;
}

export async function listCategories(
  db: Db,
  userId: string,
  now: Date,
): Promise<CategoryResult<{ categories: RoomCategory[] }>> {
  const actor = await memberOrStop(db, userId, now);
  if ("ok" in actor) return actor;
  const rows = await db.query<{ slug: string; name: string; sort_order: number }>(
    `select slug, name, sort_order from categories order by sort_order asc, slug asc`,
  );
  const categories = rows
    .map(toCategory)
    .filter((category) => actor.steward || category.slug !== UNCATEGORIZED_SLUG);
  return { ok: true, value: { categories } };
}

export async function readCategory(
  db: Db,
  userId: string,
  slug: string,
  now: Date,
): Promise<CategoryResult<{ category: RoomCategory; rooms: CategoryRoom[] }>> {
  const actor = await memberOrStop(db, userId, now);
  if ("ok" in actor) return actor;
  if (!categorySlugOk(slug)) return fail(404, "That category is not listed.");
  if (slug === UNCATEGORIZED_SLUG && !actor.steward)
    return fail(404, "That category is not listed.");
  const found = await db.query<{ slug: string; name: string; sort_order: number }>(
    `select slug, name, sort_order from categories where slug = $1`,
    [slug],
  );
  const category = found[0];
  if (!category) return fail(404, "That category is not listed.");
  const rows = await db.query<{
    id: string;
    name: string;
    what: string;
    next_gathering: string | null;
  }>(
    `select r.id, r.name, r.what,
            (
              select min(g.gather_on)
              from public_gathering g
              where g.room_id = r.id
                and g.removed = false
                and g.gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                and g.gather_on >= $2
            ) as next_gathering
     from room r
     where r.category_id = $1 and r.name <> ''`,
    [slug, dayStamp(now)],
  );
  const rooms: CategoryRoom[] = [];
  for (const row of rows) {
    const roomBan = await openBan(db, userId, now, row.id);
    if (roomBan) continue;
    rooms.push({
      id: row.id,
      name: row.name,
      what: row.what,
      nextGathering: row.next_gathering,
    });
  }
  return {
    ok: true,
    value: { category: toCategory(category), rooms: orderBrowseRooms(rooms) },
  };
}

export async function createCategory(
  db: Db,
  input: { userId: string; slug: string; name: string; now: Date },
): Promise<CategoryResult<{ category: RoomCategory }>> {
  const allowed = await stewardOrStop(db, input.userId, input.now);
  if (allowed !== true) return allowed;
  const slug = input.slug.trim().toLowerCase();
  if (!categorySlugOk(slug)) return fail(400, "Use a short name of letters, numbers, and hyphens.");
  if (slug === UNCATEGORIZED_SLUG) return fail(409, "That category already exists.");
  const nameError = nameOk(input.name);
  if (nameError) return fail(400, nameError);
  const order = await db.query<{ next: number }>(
    `select coalesce(max(sort_order), -1) + 1 as next from categories where slug <> $1`,
    [UNCATEGORIZED_SLUG],
  );
  const sortOrder = Number(order[0]?.next ?? 0);
  try {
    await db.query(`insert into categories (slug, name, sort_order) values ($1, $2, $3)`, [
      slug,
      input.name.trim(),
      sortOrder,
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "That category already exists.");
    throw error;
  }
  return { ok: true, value: { category: { slug, name: input.name.trim(), sortOrder } } };
}

export async function updateCategory(
  db: Db,
  input: { userId: string; slug: string; name?: string; sortOrder?: number; now: Date },
): Promise<CategoryResult<{ category: RoomCategory }>> {
  const allowed = await stewardOrStop(db, input.userId, input.now);
  if (allowed !== true) return allowed;
  if (!categorySlugOk(input.slug)) return fail(404, "That category is not listed.");
  const found = await db.query<{ slug: string; name: string; sort_order: number }>(
    `select slug, name, sort_order from categories where slug = $1`,
    [input.slug],
  );
  const current = found[0];
  if (!current) return fail(404, "That category is not listed.");
  const name = input.name === undefined ? current.name : input.name;
  const nameError = nameOk(name);
  if (nameError) return fail(400, nameError);
  const sortOrder = input.sortOrder === undefined ? Number(current.sort_order) : input.sortOrder;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000)
    return fail(400, "Give the category a place in the list.");
  if (input.name === undefined && input.sortOrder === undefined)
    return fail(400, "Nothing to change.");
  await db.query(`update categories set name = $2, sort_order = $3 where slug = $1`, [
    input.slug,
    name.trim(),
    sortOrder,
  ]);
  return {
    ok: true,
    value: { category: { slug: input.slug, name: name.trim(), sortOrder } },
  };
}

export async function deleteCategory(
  db: Db,
  input: { userId: string; slug: string; now: Date },
): Promise<CategoryResult<{ slug: string }>> {
  const allowed = await stewardOrStop(db, input.userId, input.now);
  if (allowed !== true) return allowed;
  if (!categorySlugOk(input.slug)) return fail(404, "That category is not listed.");
  if (input.slug === UNCATEGORIZED_SLUG)
    return fail(400, "Uncategorized stays, so a room without a place has somewhere to go.");
  const found = await db.query<{ slug: string }>(`select slug from categories where slug = $1`, [
    input.slug,
  ]);
  if (!found[0]) return fail(404, "That category is not listed.");
  const used = await db.query<{ id: string }>(
    `select id from room where category_id = $1 limit 1`,
    [input.slug],
  );
  if (used[0]) return fail(400, "Move the rooms out of this category first.");
  await db.query(`delete from categories where slug = $1`, [input.slug]);
  return { ok: true, value: { slug: input.slug } };
}
