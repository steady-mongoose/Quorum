import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCategoryPage } from "./api.ts";
import {
  CATEGORY_LIST,
  ROOM_CATEGORY,
  UNCATEGORIZED_SLUG,
  browseCategories,
  categoryForRoom,
  groupBrowseRooms,
  hiddenRooms,
  orderBrowseRooms,
} from "./categories.ts";
import { ROOMS } from "./model.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("rooms with a gathering come first, then the rest A to Z", () => {
  const ordered = orderBrowseRooms([
    { name: "Shop", nextGathering: null },
    { name: "Alpha", nextGathering: "2026-10-22" },
    { name: "Beta", nextGathering: "2026-10-20" },
    { name: "Later", nextGathering: null },
    { name: "Cedar", nextGathering: "2026-10-20" },
  ]);
  assert.deepEqual(
    ordered.map((room) => room.name),
    ["Beta", "Cedar", "Alpha", "Later", "Shop"],
  );
});

test("the seed rooms use the config mapping, and Men and Women stay labels", () => {
  for (const room of ROOMS) {
    assert.equal(room.categoryId, categoryForRoom(room.id));
    assert.equal(ROOM_CATEGORY[room.id], room.categoryId);
    assert.equal("audience" in room, false);
    assert.equal("sex" in room, false);
  }
  assert.deepEqual(
    CATEGORY_LIST.map((category) => category.name),
    [
      "Churches",
      "Discussion",
      "Men",
      "Women",
      "Business & Trades",
      "Civic",
      "County",
      "Uncategorized",
    ],
  );
  assert.equal(Object.values(ROOM_CATEGORY).includes("men"), false);
  assert.equal(Object.values(ROOM_CATEGORY).includes("women"), false);
  const hidden = browseCategories(CATEGORY_LIST, false).map((category) => category.slug);
  assert.equal(hidden.includes(UNCATEGORIZED_SLUG), false);
  assert.equal(
    browseCategories(CATEGORY_LIST, true).some((category) => category.slug === UNCATEGORIZED_SLUG),
    true,
  );
  const parked = hiddenRooms(
    [
      {
        id: "mill",
        name: "Mill",
        what: "A mill.",
        categoryId: UNCATEGORIZED_SLUG,
        nextGathering: null,
      },
    ],
    false,
  );
  assert.equal(parked.length, 0);
});

test("a category page drops counts, likes, and trending", () => {
  const page = parseCategoryPage({
    category: { slug: "civic", name: "Civic", sortOrder: 5, count: 4, likes: 1 },
    rooms: [
      {
        id: "dispatch",
        name: "Dispatch",
        what: "Notices.",
        nextGathering: "2026-10-20",
        count: 2,
        likes: 9,
        trending: true,
        rank: 1,
      },
    ],
    trending: true,
  });
  assert.ok(page);
  assert.equal("count" in (page?.category ?? {}), false);
  assert.equal("likes" in (page?.rooms[0] ?? {}), false);
  assert.equal("trending" in (page?.rooms[0] ?? {}), false);
  assert.equal("rank" in (page?.rooms[0] ?? {}), false);
  const sections = groupBrowseRooms(
    CATEGORY_LIST,
    [
      {
        id: "dispatch",
        name: "Dispatch",
        what: "Notices.",
        categoryId: "civic",
        nextGathering: null,
      },
    ],
    "civic",
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.rooms[0]?.id, "dispatch");
});

test("browse, the week, and room create follow the category layout", () => {
  const browse = source("../../components/board/room-browse.tsx");
  const week = source("../../components/board/week-view.tsx");
  const about = source("../../components/board/about-view.tsx");
  const index = source("../../routes/rooms/index.tsx");
  const slug = source("../../routes/rooms/$slug.tsx");
  const migration = source("../../../migrations/0021_categories.sql");
  assert.match(browse, /sticky top-32/);
  assert.match(browse, /w-\[14rem\]/);
  assert.match(browse, /lg:grid-cols-2/);
  assert.match(browse, /xl:grid-cols-3/);
  assert.match(browse, /to="\/rooms"/);
  assert.match(browse, /aria-label="Categories"/);
  assert.equal(/\bcount\b|\btrending\b|\branking\b|\blikes?\b|\bfeed\b/i.test(browse), false);
  assert.match(week, /categoryName\(roomCategoryId\(roomById\(card\.room\)\)\)/);
  assert.match(about, /Choose a category/);
  assert.match(about, /categoryId/);
  assert.match(index, /noindex/);
  assert.match(index, /categorySlug=\{null\}/);
  assert.match(slug, /noindex/);
  assert.match(slug, /categorySlug=\{slug\}/);
  const names = ["Churches", "Discussion", "Men", "Women", "Business & Trades", "Civic", "County"];
  let at = 0;
  for (const name of names) {
    const next = migration.indexOf(name, at);
    assert.ok(next > at, name);
    at = next;
  }
  assert.match(migration, /0019 and 0020 are reserved/);
  assert.match(migration, /Uncategorized/);
});
