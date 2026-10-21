import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard } from "./api.ts";
import { newPost, sortRoom } from "./model.ts";

test("the board payload drops likes, scores, and reshares", () => {
  const board = parseBoard({
    me: { member: true, steward: false, admin: false, ban: null },
    rooms: [
      {
        id: "shop",
        name: "The Shop",
        what: "Hands-on nights.",
        takes: ["did", "asked", "hosted"],
        stewardTakes: ["noted"],
        cardKinds: ["meeting", "trade"],
        cardNoun: "Meeting",
        requiresNextDate: true,
        parish: false,
        likes: 4,
      },
    ],
    posts: [
      {
        id: "p1",
        room: "shop",
        type: "did",
        claim: "Sharpened the chisels.",
        reason: "Tom checked them on Thursday.",
        on: "2026-10-19",
        next: "",
        came: [],
        named: "",
        author: "Maria",
        at: 10,
        parentId: null,
        closed: false,
        mark: null,
        removed: false,
        media: [],
        likeCount: 12,
        score: 99,
        reshares: 3,
      },
    ],
    marks: [],
    removals: [],
    bans: [],
  });
  assert.ok(board);
  assert.equal(board.posts.length, 1);
  assert.equal("likeCount" in board.posts[0], false);
  assert.equal("score" in board.posts[0], false);
  assert.equal("reshares" in board.posts[0], false);
  assert.equal("likes" in board.rooms[0], false);
  assert.equal(board.me.member, true);
});

test("room order is newest first, and a mark does not move a post", () => {
  const older = newPost({
    id: "old",
    room: "shop",
    type: "did",
    claim: "Old clean post about the shop.",
    author: "Maria",
    at: 1,
    reason: "Tom was there with me.",
  });
  const sloppy = newPost({
    id: "sloppy",
    room: "shop",
    type: "did",
    claim: "New sloppy post about the shop.",
    author: "Tom",
    at: 50,
    reason: "Someone told me.",
    mark: "sloppy",
  });
  const newest = newPost({
    id: "new",
    room: "shop",
    type: "asked",
    claim: "Can someone lend a carboy?",
    author: "Dale",
    at: 9,
    reason: "I already asked Luis.",
  });
  const hosted = newPost({
    id: "hosted",
    room: "shop",
    type: "hosted",
    claim: "Good night. Luis swept up.",
    author: "Tom",
    at: 2,
    cardId: "s-framing",
  });
  const ordered = sortRoom(
    [
      Object.assign({}, sloppy, { likes: 1000 }),
      Object.assign({}, older, { score: 5 }),
      newest,
      hosted,
    ],
    "shop",
  );
  assert.deepEqual(
    ordered.map((post) => post.id),
    ["sloppy", "new", "hosted", "old"],
  );
  assert.equal(
    ordered.some((post) => post.removed),
    false,
  );
});
