import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { MESSAGE_RULE } from "../e2ee/copy.ts";
import { ROOM_REFUSAL, refusalText, serverReach } from "./message-reach.ts";
import * as model from "./model.ts";
import { ROOMS, localReach, metAt, type MeetingCard, type Post, type Room } from "./model.ts";
import type { MemberList, MemberRow } from "./room-members.ts";

function row(id: string, name: string, message: MemberRow["message"]): MemberRow {
  return { id, name, steward: false, joinedOn: "", lastPostedOn: "", attended: [], message };
}
function list(...members: MemberRow[]): MemberList {
  return { members, rollCall: false };
}
function card(id: string, wentBy: string[]): MeetingCard {
  return { id, kind: "meeting", room: "baptist", host: wentBy[0] ?? "", wentBy } as unknown as MeetingCard;
}
function reply(author: string, parent: string): Post {
  return { id: `r-${author}`, room: "shop", author, at: 2, type: "shared", claim: "Yes.", parentId: parent } as unknown as Post;
}

test("signed in, Message follows the server: open members and server peers only", () => {
  const reach = serverReach(
    "Josh",
    [list(row("u-ruth", "Ruth", "open"), row("u-new", "Nell", "wait"), row("u-bar", "Barry", "none"), row("u-josh", "Josh", "open"))],
    [{ id: "u-met", name: "Mae" }],
  );
  assert.deepEqual([...reach.open.entries()], [["Mae", "u-met"], ["Ruth", "u-ruth"]]);
  // A member on the wait, or barred, blocked or out of audience ("none"), gets no button.
  assert.equal(reach.open.has("Nell"), false);
  assert.equal(reach.open.has("Barry"), false);
  assert.equal(reach.open.has("Josh"), false);
  // But the app knows they share a room, for wording a refusal.
  assert.deepEqual([...reach.inRoom].sort(), ["Barry", "Nell", "Ruth"]);
});

test("a room-mate by posts alone is not messageable signed in until the server says so", () => {
  const reach = serverReach("Josh", [], [], new Set(["Tom"]));
  assert.equal(reach.open.has("Tom"), false);
  assert.equal(reach.inRoom.has("Tom"), true);
});

test("someone who only replied to your post is not messageable, on either board", () => {
  const rooms: Room[] = ROOMS.map((room) => ({ ...room, joined: false }));
  const posts = [
    { id: "p1", room: "shop", author: "Josh", at: 1, type: "shared", claim: "Hi.", parentId: null } as Post,
    reply("Stranger", "p1"),
  ];
  assert.equal(localReach("Josh", [], posts, rooms).has("Stranger"), false);
  assert.equal(serverReach("Josh", [], []).open.has("Stranger"), false);
  assert.equal("stoodWith" in model, false);
  assert.equal("messageableNames" in model, false);
});

test("the demo board keeps the meeting way in", () => {
  const cards = [card("c1", ["Ann", "Josh", "Bea"]), card("c2", ["Cal"])];
  assert.deepEqual([...metAt("Josh", cards)].sort(), ["Ann", "Bea"]);
  assert.deepEqual([...localReach("Josh", cards, [], [])].sort(), ["Ann", "Bea"]);
});

test("a refusal for someone in a shared room says so plainly and names no reason", () => {
  assert.equal(ROOM_REFUSAL, "You can't message this member right now.");
  assert.equal(refusalText(MESSAGE_RULE, true), ROOM_REFUSAL);
  // The plain no-shared-room case keeps the server's sentence.
  assert.equal(refusalText(MESSAGE_RULE, false), MESSAGE_RULE);
  // Other errors pass through unchanged.
  assert.equal(refusalText("Messages did not load.", true), "Messages did not load.");
});

test("the app's refusal sentence is still the server's NOT_REACHABLE text", () => {
  const server = readFileSync(new URL("../../../server/dm/store.ts", import.meta.url), "utf8");
  const match = /export const NOT_REACHABLE =\s*"([^"]+)"/.exec(server);
  assert.equal(match?.[1], MESSAGE_RULE);
});

test("no app code recomputes the reply rule", () => {
  const root = new URL("../../", import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(url.pathname);
    }
  };
  walk(root);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bstoodWith\b|\bmessageableNames\b/, file);
  }
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const start = store.indexOf("openDm: (other)");
  const openDm = store.slice(start, store.indexOf("sendDm:", start));
  assert.match(openDm, /!get\(\)\.remote && !localReach/);
});
