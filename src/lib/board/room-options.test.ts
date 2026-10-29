import "./test-storage.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ROOMS,
  blankDraft,
  composerCheck,
  newPost,
  roomIncludes,
  type CheckContext,
  type Post,
} from "./model.ts";
import { DEFAULT_ROOM_OPTIONS, roomOptionsFrom } from "./room-options.ts";
import { localRoomMembers, parseMemberList } from "./room-members.ts";
import { useBoard } from "./store.ts";

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
  assert.match(room, /roomIncludes\(meta, "calls"\) && canCall \? <RoomCall/);
  assert.match(room, /roomIncludes\(meta, "chat"\) \? <RoomChat/);
  assert.match(room, /roomIncludes\(meta, "members"\) \? <RoomMembers/);
  assert.match(room, /\{rollCall \? \(\r?\n\s+<fieldset/);
  assert.match(about, /Roll call is off unless an admin turns it on\./);
});

test("the member list shows Message, the wait line, or nothing, as the server says", () => {
  const members = read("../../components/board/room-members.tsx");
  assert.ok(members.includes(`row.name !== me && row.message === "open" ? (`));
  assert.ok(members.includes(`row.name !== me && row.message === "wait" ? (`));
  assert.ok(members.includes("{MEMBER_WAIT_LINE}"));
  assert.ok(members.includes(`"max-w-full self-start px-0 text-left [overflow-wrap:anywhere]"`));
  assert.ok(members.includes("text-base text-fg [overflow-wrap:anywhere]"));
  const parsed = parseMemberList({
    members: [
      { id: "a", name: "A", message: "wait" },
      { id: "b", name: "B", message: "maybe" },
    ],
  });
  assert.deepEqual(parsed?.members.map((row) => row.message), ["wait", "none"]);
  const top = read("../../components/board/conversation-top.tsx");
  assert.ok(top.includes("<h1 ref={heading} tabIndex={-1}"));
  assert.ok(top.includes("onClick={dmFrom ? backToRoom : onAllMessages}"));
});

test("Message from the member list opens the conversation; Back returns to the room and that row", () => {
  const shop = { ...ROOMS.find((room) => room.id === "shop")!, joined: true };
  useBoard.setState({
    remote: false,
    me: "Me",
    rooms: [shop],
    posts: [newPost({ room: "shop", type: "shared", author: "Hank", claim: "The lathe is oiled." })],
    cards: [],
    threads: [],
    section: "rooms",
    room: "shop",
    openThread: null,
    dmFrom: null,
    focusMember: null,
  });
  useBoard.getState().messageMember("shop", { id: "Otto", name: "Otto", userId: null });
  assert.equal(useBoard.getState().section, "rooms");

  useBoard.getState().messageMember("shop", { id: "Hank", name: "Hank", userId: null });
  let state = useBoard.getState();
  assert.equal(state.section, "messages");
  assert.ok(state.openThread);
  assert.deepEqual(state.dmFrom, { room: "shop", memberId: "Hank", name: "Hank", userId: null });

  state.backToRoom();
  state = useBoard.getState();
  assert.equal(state.section, "rooms");
  assert.equal(state.room, "shop");
  assert.equal(state.openThread, null);
  assert.equal(state.dmFrom, null);
  assert.equal(state.focusMember, "Hank");

  // Opened from the list of conversations instead: Back goes to all messages.
  state.messageMember("shop", { id: "Hank", name: "Hank", userId: null });
  useBoard.getState().setOpenThread(null);
  assert.equal(useBoard.getState().dmFrom, null);
});

test("Message on a rooms page leaves the rooms page so the conversation shows", () => {
  const app = read("../../components/board/app.tsx");
  assert.match(app, /if \(!onRoomsRoute\) return;\r?\n\s+return useBoard\.subscribe\(\(state, previous\) => \{/);
  assert.match(app, /state\.section !== previous\.section && state\.section !== "rooms"/);
});
