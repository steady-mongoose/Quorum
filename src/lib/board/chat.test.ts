import assert from "node:assert/strict";
import test from "node:test";
import { orderChat, parseChatPage, type RoomChatMessage } from "./chat.ts";

function line(
  partial: Partial<RoomChatMessage> & Pick<RoomChatMessage, "id" | "seq" | "at">,
): RoomChatMessage {
  return {
    author: "Maria",
    text: "The road is open.",
    ...partial,
  };
}

test("room chat stays in time order, and a tie follows the server sequence", () => {
  const ordered = orderChat([
    line({ id: "c", seq: 3, at: 3000, text: "Third." }),
    line({ id: "a", seq: 2, at: 1000, text: "Second." }),
    line({ id: "b", seq: 1, at: 1000, text: "First." }),
  ]);
  assert.deepEqual(
    ordered.map((message) => message.text),
    ["First.", "Second.", "Third."],
  );
});

test("a chat page drops likes, reactions, and scores", () => {
  const page = parseChatPage({
    messages: [
      {
        id: "m1",
        author: "Maria",
        text: "The chisels are sharp.",
        at: 10,
        seq: 1,
        like: 4,
        reaction: "heart",
        score: 99,
      },
    ],
    hidden: ["m0"],
    older: null,
  });
  assert.ok(page);
  assert.equal(page?.messages.length, 1);
  assert.equal("like" in (page?.messages[0] ?? {}), false);
  assert.equal("reaction" in (page?.messages[0] ?? {}), false);
  assert.equal("score" in (page?.messages[0] ?? {}), false);
  assert.deepEqual(page?.hidden, ["m0"]);
});
