import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { MESSAGE_RULE } from "../e2ee/copy.ts";
import {
  ROOM_REFUSAL,
  createVersion,
  currentAnswer,
  reachKey,
  refusalText,
  serverReach,
} from "./message-reach.ts";
import * as model from "./model.ts";
import { ROOMS, localReach, metAt, type MeetingCard, type Post, type Room } from "./model.ts";
import type { MemberList, MemberRow } from "./room-members.ts";
import {
  FAILED_MS,
  FRESH_MS,
  HIDDEN_MS,
  cachedReachReads,
  serverReachAnswers,
  type MemberAnswer,
  type ReachAnswers,
} from "./message-reach-reads.ts";

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

test("room B never shows room A's answer while B's is loading", () => {
  const a = reachKey(["room-a"], ["c1"]);
  const b = reachKey(["room-b"], ["c1"]);
  const answerA = { key: a, lists: [list(row("u-x", "Xan", "open"))], peers: [] };
  // On room A the answer counts.
  const onA = currentAnswer(answerA, a);
  assert.equal(onA.loaded, true);
  assert.equal(serverReach("Josh", onA.lists, onA.peers).open.has("Xan"), true);
  // On room B, A's answer is nothing yet: no button for Xan, who B may refuse.
  const onB = currentAnswer(answerA, b);
  assert.deepEqual(onB, { lists: [], peers: [], loaded: false });
  assert.equal(serverReach("Josh", onB.lists, onB.peers).open.has("Xan"), false);
  // New meeting cards are a different question too.
  assert.equal(currentAnswer(answerA, reachKey(["room-a"], ["c1", "c2"])).loaded, false);
  assert.equal(reachKey(["b", "a", "a"], ["2", "1"]), reachKey(["a", "b"], ["1", "2"]));
  assert.equal(currentAnswer(null, a).loaded, false);
});

test("a block or unblock tells every screen to refetch", () => {
  const version = createVersion();
  let heard = 0;
  const stop = version.subscribe(() => (heard += 1));
  assert.equal(version.get(), 0);
  version.bump();
  assert.equal(version.get(), 1);
  assert.equal(heard, 1);
  stop();
  version.bump();
  assert.equal(heard, 1);
  const hook = readFileSync(
    new URL("../../components/board/use-message-reach.ts", import.meta.url),
    "utf8",
  );
  const forget = hook.slice(hook.indexOf("export function forgetMessageReach"));
  assert.match(forget.slice(0, forget.indexOf("\n}")), /reachVersion\.bump\(\)/);
  assert.match(hook, /useSyncExternalStore\(reachVersion\.subscribe/);
  assert.match(hook, /\[remote, key, version\]/);
  assert.match(hook, /currentAnswer\(answer, key\)/);
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((mailbox.match(/forgetMessageReach\(\);/g) ?? []).length, 2);
});

test("loading a room, Find or a profile only reads; attendance is written only when the mailbox opens a conversation", () => {
  const hook = readFileSync(
    new URL("../../components/board/use-message-reach.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(hook, /recordAttendance|\.post\(|method:\s*"(POST|PUT|PATCH|DELETE)"/);
  const reads = readFileSync(new URL("./message-reach-reads.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reads, /recordAttendance|\.post\(|method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.match(hook, /readReach\(.*cachedReads\(\)\)/);
  const client = readFileSync(new URL("../e2ee/mailbox.ts", import.meta.url), "utf8");
  const peersCall = client.slice(client.indexOf("export async function listDmPeers"));
  assert.match(peersCall.slice(0, peersCall.indexOf("\n}")), /transport\.get\("\/api\/dm\/peers"\)/);
  const members = readFileSync(new URL("./room-members.ts", import.meta.url), "utf8");
  const load = members.slice(members.indexOf("export async function loadRoomMembers"));
  assert.doesNotMatch(load.slice(0, load.indexOf("\n}")), /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  // The one app caller of the attendance write is the mailbox's open-a-conversation effect.
  const root = new URL("../../", import.meta.url);
  const callers: string[] = [];
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir));
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
        if (/recordAttendance\(transport/.test(readFileSync(url, "utf8"))) callers.push(name);
      }
    }
  };
  walk(root);
  assert.deepEqual(callers, ["encrypted-mailbox.tsx"]);
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  const effect = mailbox.slice(mailbox.indexOf("if (!me || !vault || vault.userId !== me.id || !openThread) return;"));
  assert.ok(effect.indexOf("recordAttendance(transport") > 0);
  assert.ok(effect.indexOf("recordAttendance(transport") < effect.indexOf("[openThread, me?.id"));
});

test("Design: the refusal is an alert in body ink, and Find waits for the answer before its hint", () => {
  const mailbox = readFileSync(
    new URL("../../components/board/encrypted-mailbox.tsx", import.meta.url),
    "utf8",
  );
  assert.match(mailbox, /<p role="alert" className="text-sm text-fg">\s*\{refused\}\s*<\/p>/);
  assert.match(mailbox, /setRefused\(refusalText\(opened\.message, sharesRoom\)\)/);
  const find = readFileSync(new URL("../../components/board/find-view.tsx", import.meta.url), "utf8");
  assert.match(find, /card\.firstTimer && peers\.loaded/);
});

test("only a hidden member list (404) is cached for five minutes; 500, 429, 401 and network errors are asked again soon", async () => {
  const realFetch = globalThis.fetch;
  const statuses: Record<string, number | "network"> = {
    hidden: 404,
    broken: 500,
    limited: 429,
    signedout: 401,
    offline: "network",
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const room = String(input instanceof Request ? input.url : input).match(/rooms\/([^/]+)\/members/)?.[1] ?? "";
    const status = statuses[room];
    if (status === "network") throw new TypeError("Failed to fetch");
    if (status) return new Response(JSON.stringify({ error: "No." }), { status });
    return new Response(JSON.stringify({ members: [], rollCall: false }), { status: 200 });
  }) as typeof fetch;
  try {
    const answers = serverReachAnswers({} as never);
    const kinds: Record<string, string> = {};
    for (const room of ["open", ...Object.keys(statuses)]) {
      kinds[room] = (await answers.members(room)).kind;
    }
    assert.deepEqual(kinds, {
      open: "list",
      hidden: "hidden",
      broken: "failed",
      limited: "failed",
      signedout: "failed",
      offline: "failed",
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(FAILED_MS <= 30_000 && FRESH_MS <= 30_000 && HIDDEN_MS === 5 * 60_000);
  let now = 0;
  const asked: string[] = [];
  const answer: Record<string, MemberAnswer> = {
    hidden: { kind: "hidden" },
    broken: { kind: "failed" },
    open: { kind: "list", list: list(row("u1", "Ruth", "open")) },
  };
  const server: ReachAnswers = {
    members: async (roomId) => {
      asked.push(roomId);
      return answer[roomId]!;
    },
    peers: async () => {
      asked.push("peers");
      return { kind: "failed" };
    },
  };
  const { reads } = cachedReachReads(() => server, () => now);
  const ask = async () => {
    asked.length = 0;
    for (const room of ["hidden", "broken", "open"]) await reads.members(room);
    await reads.peers();
    return [...asked];
  };
  assert.deepEqual(await ask(), ["hidden", "broken", "open", "peers"]);
  now = 1_000;
  assert.deepEqual(await ask(), []);
  now = FAILED_MS;
  // The failed list and the failed peers are asked again; the others are not.
  assert.deepEqual(await ask(), ["broken", "peers"]);
  now = FAILED_MS + 30_000;
  assert.deepEqual(await ask(), ["broken", "open", "peers"]);
  now = HIDDEN_MS;
  assert.ok((await ask()).includes("hidden"));
  assert.equal((await reads.members("open"))?.members[0]?.name, "Ruth");
});
