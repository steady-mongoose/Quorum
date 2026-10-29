import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOMS, blankDraft, composerCheck, roomIncludes, type CheckContext, type Post } from "./model.ts";
import { DEFAULT_ROOM_OPTIONS, roomOptionsFrom } from "./room-options.ts";
import { localRoomMembers, parseMemberList } from "./room-members.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a room includes everything but roll call unless an admin says otherwise", () => {
  assert.deepEqual([...DEFAULT_ROOM_OPTIONS], ["members", "chat", "calls"]);
  assert.equal(roomIncludes({}, "roll_call"), false);
  assert.equal(roomIncludes({}, "chat"), true);
  assert.equal(roomIncludes({ options: ["roll_call"] }, "roll_call"), true);
  assert.deepEqual(roomOptionsFrom(["calls", "likes", "roll_call"]), ["roll_call", "calls"]);
});

test("the composer refuses a roll in a room that does not take roll", () => {
  const ctx: CheckContext = { author: "Hank", steward: false, posts: [], cards: [], removals: [], now: Date.now() };
  const shop = ROOMS.find((room) => room.id === "shop");
  assert.ok(shop);
  const draft = {
    ...blankDraft("shop"),
    type: "hosted" as const,
    claim: "The lathe night went well.",
    on: "2026-10-22",
    came: ["Hank", "Iris"],
  };
  const refused = composerCheck(draft, { ...ctx, rooms: [{ ...shop, options: ["members"] }] });
  assert.ok(refused.fields?.form?.includes("This room does not take roll. Leave out who came."));
  const allowed = composerCheck(draft, { ...ctx, rooms: [{ ...shop, options: ["roll_call"] }] });
  assert.equal(allowed.fields?.form?.includes("This room does not take roll. Leave out who came.") ?? false, false);
});

test("the demo member list: name order, and who came only where the room takes roll", () => {
  const shop = { ...ROOMS.find((room) => room.id === "shop")!, joined: true };
  const posts = [
    { id: "1", room: "shop", type: "hosted", author: "Zeb", on: "2026-10-22", came: ["Zeb", "Amos"], at: Date.UTC(2026, 9, 22), parentId: null, removed: false },
    { id: "2", room: "coop", type: "shared", author: "Elsewhere", on: "", came: [], at: 1, parentId: null, removed: false },
  ] as unknown as Post[];
  const off = localRoomMembers({ ...shop, options: ["members"] }, posts, "Me");
  assert.deepEqual(off.members.map((row) => row.name), ["Me", "Zeb"]);
  assert.equal(off.rollCall, false);
  const on = localRoomMembers({ ...shop, options: ["roll_call", "members"] }, posts, "Me");
  assert.deepEqual(on.members.map((row) => row.name), ["Amos", "Me", "Zeb"]);
  assert.deepEqual(on.members.find((row) => row.name === "Amos")?.attended, [
    { on: "2026-10-22", host: "Zeb", hosted: false },
  ]);
  assert.equal(parseMemberList({ members: [{ id: "a", name: "A" }], rollCall: true })?.rollCall, true);
});

test("admins get the options menu when setting up and editing a room; the room page follows it", () => {
  const menu = read("../../components/board/room-options-menu.tsx");
  const browse = read("../../components/board/room-browse.tsx");
  const about = read("../../components/board/about-view.tsx");
  const room = read("../../components/board/room-view.tsx");
  assert.match(menu, /What this room includes/);
  assert.match(browse, /\{admin \? <RoomOptionsMenu selected=\{options\} onChange=\{setOptions\} \/> : null\}/);
  assert.match(about, /<RoomOptionsMenu selected=\{options\} onChange=\{setOptions\} \/>/);
  assert.match(room, /roomIncludes\(meta, "calls"\) \? <RoomCall/);
  assert.match(room, /roomIncludes\(meta, "chat"\) \? <RoomChat/);
  assert.match(room, /roomIncludes\(meta, "members"\) \? <RoomMembers/);
  assert.match(room, /\{rollCall \? \(\r?\n\s+<fieldset/);
  assert.match(about, /Roll call is off unless an admin turns it on\./);
});

test("the member list offers Message only to people you may already write to", () => {
  const members = read("../../components/board/room-members.tsx");
  assert.match(members, /messageableNames\(me, cards, posts, rooms\)/);
  assert.match(members, /row\.name !== me && peers\.has\(row\.name\) \? \(/);
  assert.match(members, /onClick=\{\(\) => openDm\(row\.name\)\}/);
  assert.match(members, /Message \{row\.name\}/);
});

test("Message on a rooms page leaves the rooms page so the conversation shows", () => {
  const app = read("../../components/board/app.tsx");
  assert.match(app, /if \(!onRoomsRoute\) return;\r?\n\s+return useBoard\.subscribe\(\(state, previous\) => \{/);
  assert.match(app, /state\.section !== previous\.section && state\.section !== "rooms"/);
});
