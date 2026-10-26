import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCategoryPage } from "./api.ts";
import {
  CATEGORY_LIST,
  ROOM_CATEGORY,
  UNCATEGORIZED_SLUG,
  audienceLabel,
  browseCategories,
  categoryForRoom,
  categoryPreview,
  groupBrowseRooms,
  hiddenRooms,
  meetsLabel,
  orderBrowseRooms,
} from "./categories.ts";
import { ROOMS } from "./model.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("pinned rooms come first, then the rest A to Z", () => {
  const ordered = orderBrowseRooms([
    { name: "Shop", pinOrder: null },
    { name: "Alpha", pinOrder: 2 },
    { name: "Beta", pinOrder: null },
    { name: "Later", pinOrder: 0 },
    { name: "Cedar", pinOrder: null },
  ]);
  assert.deepEqual(
    ordered.map((room) => room.name),
    ["Later", "Alpha", "Beta", "Cedar", "Shop"],
  );
  assert.equal(meetsLabel("2026-10-22"), "meets Thu");
  assert.equal(meetsLabel(null), "");
  assert.equal(audienceLabel("men"), "Men only");
  assert.equal(audienceLabel("women"), "Women only");
  assert.equal(audienceLabel("all"), "");
  const churches = categoryPreview("churches");
  assert.equal(churches.title, "Churches");
  assert.match(churches.image, /dore-og\.webp$/);
  assert.match(churches.credit, /Doré/);
  assert.match(categoryPreview("men").credit, /Dürer/);
  assert.match(categoryPreview("civic").credit, /Martin/);
});

test("the seed rooms use the config mapping, and Men and Women stay labels", () => {
  for (const room of ROOMS) {
    assert.deepEqual(room.categoryIds, [categoryForRoom(room.id)]);
    assert.equal(ROOM_CATEGORY[room.id], room.categoryIds[0]);
    assert.equal("audience" in room, false);
    assert.equal("sex" in room, false);
  }
  assert.deepEqual(
    CATEGORY_LIST.map((category) => category.name),
    [
      "Churches",
      "Philosophy & Discussion",
      "Men's",
      "Women's",
      "Businesses",
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
  const parked = [
    {
      id: "mill",
      name: "Mill",
      what: "A mill.",
      categoryIds: [UNCATEGORIZED_SLUG],
      nextGathering: null,
    },
    {
      id: "shop",
      name: "Shop",
      what: "A shop.",
      categoryIds: [UNCATEGORIZED_SLUG],
      nextGathering: null,
    },
  ];
  assert.equal(hiddenRooms(parked, { stewardRooms: [] }).length, 0);
  assert.deepEqual(
    hiddenRooms(parked, { stewardRooms: ["shop"] }).map((room) => room.id),
    ["shop"],
  );
  assert.deepEqual(
    hiddenRooms(parked, { admin: true, stewardRooms: [] }).map((room) => room.id),
    ["mill", "shop"],
  );
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
        categoryIds: ["civic"],
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
  const heads = source("./route-heads.ts");
  const migration = source("../../../migrations/0021_categories.sql");
  const fluid = source("../../../public/fluid.css");
  const backgrounds = source("../../../public/backgrounds.css");
  const app = source("../../components/board/app.tsx");
  const card = browse.slice(browse.indexOf("function RoomCard"));
  assert.match(browse, /sticky top-32/);
  assert.match(browse, /w-\[14rem\]/);
  assert.match(browse, /room-grid/);
  assert.match(browse, /Your rooms/);
  assert.match(browse, /Find your room/);
  assert.match(browse, /No rooms here yet\. Ask a steward to open one\./);
  assert.match(browse, /aria-label="Joined"/);
  assert.match(browse, /Who may enter is set by the room/);
  assert.match(browse, /to="\/rooms"/);
  assert.match(browse, /aria-label="Categories"/);
  assert.match(browse, /aria-current=/);
  assert.equal(/\bplate\b/.test(card), false);
  assert.equal(/\bcount\b|\btrending\b|\branking\b|\blikes?\b|\bfeed\b/i.test(browse), false);
  assert.match(fluid, /repeat\(auto-fill,minmax\(16rem,1fr\)\)/);
  assert.match(fluid, /\.room-browse\{display:block\}/);
  assert.match(fluid, /grid-template-columns:14rem minmax\(0,1fr\)/);
  assert.match(fluid, /\[data-section="rooms"\] \.with-side\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(fluid, /\.room-column\{container-type:inline-size/);
  assert.match(backgrounds, /\.plate--hero\{margin-top:calc\(var\(--band-h\) \* -0\.42\)\}/);
  assert.equal(/\.plate\{[^}]*margin-top:calc\(var\(--band-h\)/.test(backgrounds), false);
  assert.match(app, /categoryPage/);
  assert.match(week, /categoryNames\(roomCategoryIds\(roomById\(card\.room\)\)\)/);
  assert.match(about, /Choose a category/);
  assert.match(about, /categoryId/);
  assert.match(index, /roomsIndexMeta/);
  assert.match(index, /categorySlug=\{null\}/);
  assert.match(slug, /categoryPageMeta/);
  assert.match(slug, /categorySlug=\{slug\}/);
  assert.match(heads, /noindex/);
  assert.match(heads, /og:title/);
  assert.match(heads, /og:description/);
  assert.match(heads, /og:image/);
  assert.match(heads, /categoryPreview/);
  const names = [
    "Churches",
    "Philosophy & Discussion",
    "Men's",
    "Women's",
    "Businesses",
    "Civic",
    "County",
  ];
  let at = 0;
  for (const name of names) {
    const next = migration.indexOf(name, at);
    assert.ok(next > at, name);
    at = next;
  }
  assert.match(migration, /0019 and 0020 are reserved/);
  assert.match(migration, /Uncategorized/);
});
