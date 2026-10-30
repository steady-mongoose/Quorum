import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOMS, localReach, roomMatesOf, type Post, type Room } from "./model.ts";

function post(room: string, author: string, extra: Partial<Post> = {}): Post {
  return { id: `${room}-${author}`, room, author, at: 1, type: "shared", claim: "Hello.", ...extra } as Post;
}

test("people posting in a room you joined can be messaged on the demo board; other rooms and removed posts do not count", () => {
  const rooms: Room[] = ROOMS.map((room) => ({ ...room, joined: room.id === "baptist" }));
  const posts = [
    post("baptist", "Ruth"),
    post("baptist", "Josh"),
    post("baptist", "Mallory", { removed: true }),
    post("shop", "Tom"),
  ];
  assert.deepEqual([...roomMatesOf("Josh", rooms, posts)], ["Ruth"]);
  assert.deepEqual([...localReach("Josh", [], posts, rooms)], ["Ruth"]);
});

test("the room page and the mailbox take the server's answer; the profile page keeps the meeting rule", () => {
  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  const profile = readFileSync(
    new URL("../../components/board/profile-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(room, /useMessageReach\(\[room\]\)/);
  assert.match(room, /canMessage=\{reach\.canMessage\(post\.author\)\}/);
  assert.doesNotMatch(mailbox, /setNotice\(MESSAGE_RULE\)/);
  assert.match(mailbox, /refusalText\(opened\.message, sharesRoom\)/);
  assert.match(mailbox, /Block \{active\.otherName\}/);
  assert.match(mailbox, /They are not told\./);
  assert.match(profile, /metAt\(me, cards\)/);
});

test("a room card keeps its height when the reach answer loads: the members-only line has a line of its own", () => {
  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  const wrapped = room.match(
    /\{!canPost \? \([^<]*<div className="basis-full">\s*<MemberGate allowed=\{false\}>\{null\}<\/MemberGate>\s*<\/div>/,
  );
  assert.ok(wrapped?.index, "the members-only line is wrapped in a full-width row");
  // The wrapper takes the whole row, so "Message X" lands on the row below it,
  // beside Report, instead of wrapping the sentence.
  const gate = wrapped.index;
  const message = room.indexOf("Message {post.author}");
  const report = room.indexOf("<ReportControl", message);
  assert.ok(gate < message && message < report);
});

test("the mailbox refusal sits under the conversations, before Blocked and Key backup, and the pressed row stays", () => {
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  const main = mailbox.slice(mailbox.indexOf('<div className="flex flex-col gap-6">'));
  const at = (text: string) => {
    const index = main.indexOf(text);
    assert.ok(index >= 0, text);
    return index;
  };
  const none = at("No messages yet.");
  const choices = at("{choices.map((peer)");
  const notice = at("{notice ? <p");
  const refusal = at("{refused}");
  const blocked = at(">Blocked</h2>");
  const backup = at(">Key backup</h2>");
  for (const index of [choices, notice, refusal]) {
    assert.ok(none < index && index < blocked && index < backup);
  }
  assert.equal(main.indexOf("{refused}", refusal + 1), -1);
  // The choices clear only once a conversation opens.
  const open = mailbox.slice(mailbox.indexOf("async function openPeer("), mailbox.indexOf("async function loadThread("));
  const refusedBranch = open.indexOf("if (!opened.ok)");
  const cleared = open.indexOf("setChoices([])");
  assert.ok(refusedBranch > 0 && cleared > open.indexOf("return;", refusedBranch));
});
