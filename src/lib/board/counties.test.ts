import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTIES,
  COUNTY_LINE,
  cardsForFind,
  cardsForWeek,
  countyDue,
  countyFromText,
  countyGroupId,
  countyName,
  currentCounty,
  deskShown,
  groupsForCounty,
  homeForCounty,
  inCounty,
  isCountyId,
  roomCounty,
} from "./counties.ts";
import { parseListingsJson } from "./listings.ts";
import { countyCategoryMeta, countyRoomsMeta } from "./route-heads.ts";

const rooms = [
  { id: "shop", countyId: "hillsborough" },
  { id: "lakeland", countyId: "polk" },
  { id: "palmetto", countyId: "manatee", joined: true },
  { id: "old" },
];

const roomIds = (cards: { room: string }[]) => cards.map((card) => card.room);
const cards = rooms.map((room) => ({ room: room.id }));

test("the four counties, in the order they were named", () => {
  assert.deepEqual(
    COUNTIES.map((county) => county.name),
    ["Hillsborough", "Polk", "Manatee", "Pinellas"],
  );
  assert.equal(COUNTY_LINE, "Hillsborough, Polk, Manatee, and Pinellas");
  assert.equal(isCountyId("polk"), true);
  assert.equal(isCountyId("sarasota"), false);
  assert.equal(countyName("pinellas"), "Pinellas");
  assert.equal(countyName("sarasota"), "");
});

test("a room with no county stands in Hillsborough", () => {
  assert.equal(roomCounty({}), "hillsborough");
  assert.equal(roomCounty({ countyId: "sarasota" }), "hillsborough");
  assert.equal(inCounty({ countyId: "polk" }, "polk"), true);
  assert.equal(inCounty({}, "polk"), false);
});

test("imported county text maps to one of the four, or to nothing", () => {
  assert.equal(countyFromText("Polk"), "polk");
  assert.equal(countyFromText(" polk county "), "polk");
  assert.equal(countyFromText("Pinellas County, FL"), "pinellas");
  assert.equal(countyFromText("Sarasota"), null);
  assert.equal(countyFromText(""), null);
});

test("a listing outside the four counties is refused, and names its row", () => {
  const row = {
    name: "First Baptist",
    town: "Sarasota",
    county: "Sarasota",
    category: "Churches",
    source_url: "https://example.com/first",
  };
  const parsed = parseListingsJson({ listings: [row] });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Row 1/);
  assert.match(parsed.error, /Hillsborough, Polk, Manatee, or Pinellas/);
  assert.equal(parseListingsJson({ listings: [{ ...row, county: "Polk County" }] }).ok, true);
});

test("this week is the chosen county plus anything joined elsewhere", () => {
  assert.deepEqual(roomIds(cardsForWeek(cards, rooms, "hillsborough")), [
    "shop",
    "palmetto",
    "old",
  ]);
  assert.deepEqual(roomIds(cardsForWeek(cards, rooms, "polk")), ["lakeland", "palmetto"]);
  assert.deepEqual(roomIds(cardsForWeek(cards, rooms, "pinellas")), ["palmetto"]);
});

test("Find is only the chosen county", () => {
  assert.deepEqual(roomIds(cardsForFind(cards, rooms, "polk")), ["lakeland"]);
  assert.deepEqual(roomIds(cardsForFind(cards, rooms, "pinellas")), []);
});

test("a card in a room outside the catalog is not dropped", () => {
  assert.deepEqual(roomIds(cardsForFind([{ room: "ghost" }], rooms, "polk")), ["ghost"]);
});

test("groups follow the county, and keep what you are in or invited to", () => {
  const groups = [
    { id: "carpentry", countyId: "hillsborough" },
    { id: "polk-carpentry", countyId: "polk" },
    { id: "polk-brewing", countyId: "polk", joined: true },
    { id: "polk-gardening", countyId: "polk", inviteFrom: "Maria" },
  ];
  assert.deepEqual(
    groupsForCounty(groups, "hillsborough").map((group) => group.id),
    ["carpentry", "polk-brewing", "polk-gardening"],
  );
  assert.equal(groupsForCounty(groups, "pinellas").length, 2);
});

test("the same group name in another county gets its own id", () => {
  assert.equal(countyGroupId("carpentry", "hillsborough"), "carpentry");
  assert.equal(countyGroupId("carpentry", "polk"), "polk-carpentry");
  assert.equal(countyGroupId("", "polk"), "");
  const long = countyGroupId("a-very-long-group-name-for-pinellas", "pinellas");
  assert.equal(long.length <= 32, true);
  assert.equal(long.endsWith("-"), false);
});

test("Home keeps what you joined and narrows the rest, dropping an empty section", () => {
  const sections = [
    { tier: "joined", rooms: [{ id: "palmetto", countyId: "manatee" }] },
    { tier: "region", rooms: [{ id: "region-hillsborough", countyId: "hillsborough" }] },
    { tier: "council", posts: [{ room: "lakeland" }] },
  ];
  assert.deepEqual(
    homeForCounty(sections, rooms, "polk").map((section) => section.tier),
    ["joined", "council"],
  );
  assert.deepEqual(
    homeForCounty(sections, rooms, "hillsborough").map((section) => section.tier),
    ["joined", "region"],
  );
});

test("the desk shows only in the county its calls are written for", () => {
  assert.equal(deskShown(true, "hillsborough"), true);
  assert.equal(deskShown(true, "polk"), false);
  assert.equal(deskShown(false, "hillsborough"), false);
});

test("the app asks for a county once the board has loaded and none is saved", () => {
  const due = { boardLoaded: true, countiesOn: true, homeCounty: null };
  assert.equal(countyDue(due), true);
  assert.equal(countyDue({ ...due, homeCounty: "polk" }), false);
  assert.equal(countyDue({ ...due, boardLoaded: false }), false);
  assert.equal(countyDue({ ...due, countiesOn: false }), false);
});

test("the address decides the county, then the last one chosen, then home", () => {
  assert.equal(
    currentCounty({ routeCounty: "polk", chosen: "manatee", homeCounty: "pinellas" }),
    "polk",
  );
  assert.equal(currentCounty({ routeCounty: null, chosen: "manatee" }), "manatee");
  assert.equal(currentCounty({ homeCounty: "pinellas" }), "pinellas");
  assert.equal(currentCounty({ routeCounty: "sarasota" }), "hillsborough");
  assert.equal(currentCounty({}), "hillsborough");
});

test("county pages name the county in the title and stay out of search", () => {
  const rooms = countyRoomsMeta("polk");
  assert.deepEqual(rooms[0], { title: "Polk rooms · Avouch Social" });
  assert.equal(rooms.some((row) => "content" in row && row.content === "noindex"), true);
  const page = countyCategoryMeta("manatee", "churches");
  assert.deepEqual(page[0], { title: "Churches · Manatee · Avouch Social" });
  assert.equal(page.some((row) => "content" in row && row.content === "noindex"), true);
});
