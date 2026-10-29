import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOMS, messageableNames, roomMatesOf, type Post, type Room } from "./model.ts";

function post(room: string, author: string, extra: Partial<Post> = {}): Post {
  return { id: `${room}-${author}`, room, author, at: 1, type: "shared", claim: "Hello.", ...extra } as Post;
}

test("people posting in a room you joined can be messaged; other rooms and removed posts do not count", () => {
  const rooms: Room[] = ROOMS.map((room) => ({ ...room, joined: room.id === "baptist" }));
  const posts = [
    post("baptist", "Ruth"),
    post("baptist", "Josh"),
    post("baptist", "Mallory", { removed: true }),
    post("shop", "Tom"),
  ];
  assert.deepEqual([...roomMatesOf("Josh", rooms, posts)], ["Ruth"]);
  assert.deepEqual([...messageableNames("Josh", [], posts, rooms)], ["Ruth"]);
});

test("the room page and the mailbox use the wider rule; the profile page keeps the meeting rule", () => {
  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  const profile = readFileSync(
    new URL("../../components/board/profile-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(room, /messageableNames\(me, cards, posts, rooms\)/);
  assert.match(mailbox, /messageableNames\(gateName, cards, posts, rooms\)/);
  assert.match(mailbox, /Block \{active\.otherName\}/);
  assert.match(mailbox, /They are not told\./);
  assert.match(profile, /stoodWith\(me, cards, posts\)/);
});
