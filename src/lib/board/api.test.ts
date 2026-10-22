import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard } from "./api.ts";
import { MARK_LABEL, newPost, sortRoom } from "./model.ts";

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
  const scope = newPost({
    id: "scope",
    room: "shop",
    type: "did",
    claim: "This belongs in the county room.",
    author: "Ruth",
    at: 30,
    reason: "Tom was there with me.",
    mark: "out_of_scope",
  });
  const ordered = sortRoom(
    [
      Object.assign({}, sloppy, { likes: 1000 }),
      Object.assign({}, older, {
        score: 5,
        council: {
          label: "Council-approved",
          reason: "Named the office.",
          checklist: ["The post names the candidate and the office."],
          approvalId: "c1",
        },
      }),
      newest,
      hosted,
      scope,
    ],
    "shop",
  );
  assert.equal(MARK_LABEL.unsupported, "No legs");
  assert.equal(scope.removed, false);
  assert.deepEqual(
    ordered.map((post) => post.id),
    ["sloppy", "scope", "new", "hosted", "old"],
  );
  assert.equal(ordered.find((post) => post.id === "old")?.council?.label, "Council-approved");
  assert.equal(
    ordered.some((post) => post.removed),
    false,
  );
});

test("a CyberTipline row keeps metadata and drops the post itself", () => {
  const secret = "the sealed words must not survive parsing";
  const board = parseBoard({
    me: { member: true, steward: false, admin: true, ban: null },
    rooms: [],
    posts: [],
    marks: [
      {
        id: "m",
        room: "shop",
        postId: "p",
        author: "Maria",
        by: "Tom",
        mark: "out_of_scope",
        reason: "Wrong room.",
        at: 3,
      },
    ],
    removals: [{ id: "r", postId: "p", author: "Maria", reason: "doxxing", at: 4 }],
    bans: [],
    appeals: [
      {
        id: "a",
        room: "shop",
        postId: "p",
        author: "Maria",
        kind: "removal",
        reason: "The post did not name a private person.",
        decision: "uphold",
        decisionNote: "The removal stands.",
        decidedBy: "Tom",
        at: 5,
        decidedAt: 6,
        rule: "doxxing",
        claim: secret,
      },
    ],
    csamReports: [
      {
        id: "c",
        postId: "p",
        room: "shop",
        author: "Maria",
        accountId: "user-1",
        incidentAt: 7,
        retainUntil: 8,
        mediaCount: 1,
        byteSize: 12,
        mediaTypes: ["image/jpeg"],
        status: "prepared",
        claim: secret,
        sealed: secret,
        fileKey: "ready/secret",
        url: "https://example.test/secret",
      },
      {
        id: "filed",
        postId: "p",
        room: "shop",
        author: "Maria",
        accountId: "user-1",
        incidentAt: 7,
        retainUntil: 8,
        mediaCount: 0,
        byteSize: 0,
        mediaTypes: [],
        status: "filed",
        reportId: "NCMEC-1",
        filedAt: 9,
        filedBy: "Josh",
        sealed: secret,
      },
      { id: "sent", status: "submitted", claim: secret },
    ],
  });
  assert.ok(board);
  assert.equal(board.marks[0]?.mark, "out_of_scope");
  assert.equal(board.removals[0]?.reason, "doxxing");
  assert.equal(board.appeals[0]?.decision, "uphold");
  assert.equal(board.csamReports.length, 2);
  assert.equal(board.csamReports[0]?.status, "prepared");
  assert.equal(board.csamReports[1]?.status, "filed");
  assert.equal(board.csamReports[1]?.reportId, "NCMEC-1");
  assert.equal(JSON.stringify(board).includes(secret), false);
  assert.equal("fileKey" in (board.csamReports[0] ?? {}), false);
  assert.equal("sealed" in (board.csamReports[1] ?? {}), false);
  assert.equal("claim" in (board.appeals[0] ?? {}), false);
});
