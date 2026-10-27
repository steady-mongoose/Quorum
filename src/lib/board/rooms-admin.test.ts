import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CATEGORY_LIST } from "./categories.ts";
import {
  NOT_YET_SORTED,
  filterRooms,
  groupRooms,
  moveSummary,
  searchSummary,
  type AdminRoom,
} from "./rooms-admin.ts";

const room = (id: string, name: string, categoryIds: string[]): AdminRoom => ({
  id,
  name,
  audience: "all",
  status: "active",
  categoryIds,
  stewards: [],
});

const rooms = [
  room("shop", "Shop", ["business-trades"]),
  room("county", "County", ["county", "civic"]),
  room("mill", "Mill", ["uncategorized"]),
  room("loose", "Loose", []),
  room("baptist", "Baptist", ["churches"]),
];

test("groups follow category order with Not yet sorted last", () => {
  const groups = groupRooms(rooms, CATEGORY_LIST);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["Churches", "Businesses", "Civic", "County", NOT_YET_SORTED],
  );
  assert.deepEqual(
    groups.at(-1)?.rooms.map((row) => row.id),
    ["loose", "mill"],
  );
  assert.equal(groups.find((group) => group.slug === "civic")?.rooms[0]?.id, "county");
});

test("empty categories and an empty Not yet sorted are hidden", () => {
  const groups = groupRooms([room("shop", "Shop", ["business-trades"])], CATEGORY_LIST);
  assert.deepEqual(
    groups.map((group) => group.slug),
    ["business-trades"],
  );
});

test("search matches name or slug", () => {
  assert.deepEqual(
    filterRooms(rooms, "BAP").map((row) => row.id),
    ["baptist"],
  );
  assert.equal(filterRooms(rooms, "  ").length, rooms.length);
});

test("the move confirmation says where the room goes", () => {
  assert.equal(
    moveSummary({ name: "Mill" }, [], ["civic", "county"], CATEGORY_LIST),
    "Mill will be listed under: Civic, County. It was under: Not yet sorted. Members see the change right away, and it's logged with your name.",
  );
});

test("the search status counts matches", () => {
  assert.equal(searchSummary(0), "No room matches that search.");
  assert.equal(searchSummary(1), "1 room matches.");
  assert.equal(searchSummary(4), "4 rooms match.");
});

test("the Rooms manager keeps Design's a11y and copy", () => {
  const view = readFileSync(
    new URL("../../components/board/rooms-manager.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(/\sdisabled=\{/.test(view), false);
  assert.match(view, /aria-disabled=\{picked\.length === 0 \|\| undefined\}/);
  assert.match(view, /aria-describedby=\{picked\.length === 0 \? hintId : undefined\}/);
  assert.match(view, /`Change categories for \$\{room\.name\}`/);
  assert.match(view, />\s*Categories\s*</);
  assert.match(view, />\s*Save categories\s*</);
  assert.match(view, /Change where \$\{editingRoom\.name\} is listed\?/);
  assert.match(view, /'s categories saved\./);
  assert.match(view, /aria-live="polite"/);
  assert.equal((view.match(/role="status"/g) ?? []).length, 1);
  assert.match(view, /setTimeout\([\s\S]*?500,?\s*\)/);
  assert.match(view, /\(in \$\{group\.name\}\)/);
  assert.match(view, /Archive and delete are coming soon\./);
  assert.equal(view.includes("<section key={group.slug}"), false);
  assert.ok((view.match(/min-h-\[44px\]/g) ?? []).length >= 4);
});
