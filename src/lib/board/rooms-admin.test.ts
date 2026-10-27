import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_LIST } from "./categories.ts";
import {
  NOT_YET_SORTED,
  filterRooms,
  groupRooms,
  moveSummary,
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
    "Mill moves from Not yet sorted to Civic, County. Members see it in the new place right away. The change is logged with your name.",
  );
});
