import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COUNCIL_APPROVED_LABEL } from "./council.ts";
import {
  normalizeZip,
  orderCouncilPosts,
  orderHomeRooms,
  parseHomePayload,
  resolvedTownId,
  townSlug,
  type ScopedRoom,
} from "./home.ts";

const rooms: ScopedRoom[] = [
  { id: "county", name: "The County", scopeKind: "topic", townId: "", congregationId: "", regionId: "", sortOrder: 0 },
  { id: "rv-shop", name: "Shop nights", scopeKind: "town", townId: "riverview-fl", congregationId: "", regionId: "", sortOrder: 20 },
  { id: "rv-town", name: "Riverview town room", scopeKind: "town", townId: "riverview-fl", congregationId: "", regionId: "", sortOrder: 21 },
  { id: "brandon-town", name: "Brandon town room", scopeKind: "town", townId: "brandon-fl", congregationId: "", regionId: "", sortOrder: 22 },
  { id: "cong-grace", name: "Grace", scopeKind: "congregation", townId: "", congregationId: "grace", regionId: "", sortOrder: 31 },
  { id: "cong-epiphany", name: "Epiphany", scopeKind: "congregation", townId: "", congregationId: "epiphany", regionId: "", sortOrder: 30 },
  { id: "region-hillsborough", name: "Hillsborough County", scopeKind: "region", townId: "", congregationId: "", regionId: "hillsborough", sortOrder: 40 },
];

test("a ZIP resolves to one town, and a correction wins", () => {
  assert.equal(normalizeZip("33578-1234"), "33578");
  assert.equal(normalizeZip("3357"), "");
  assert.equal(townSlug("Seffner", "fl"), "seffner-fl");
  const seed = [{ zip: "33578", townId: "riverview-fl" }];
  assert.equal(resolvedTownId("33578", seed), "riverview-fl");
  assert.equal(
    resolvedTownId("33578", seed, [
      { id: "a", zip: "33578", townId: "brandon-fl", at: 1 },
      { id: "b", zip: "33578", townId: "", at: 2 },
    ]),
    null,
  );
  assert.equal(
    resolvedTownId("33578", [
      { zip: "33578", townId: "riverview-fl" },
      { zip: "33578", townId: "brandon-fl" },
    ]),
    null,
  );
});

test("home rooms are nearest first, and a score does not move one", () => {
  const ordered = orderHomeRooms({
    rooms: rooms.map((room, index) => ({ ...room, score: index === 0 ? 100 : 0 })),
    joined: ["rv-shop", "county"],
    townId: "riverview-fl",
    congregationId: "grace",
  });
  assert.deepEqual(
    ordered.map((row) => [row.tier, row.room.id]),
    [
      ["joined", "county"],
      ["joined", "rv-shop"],
      ["town", "rv-town"],
      ["congregation", "cong-grace"],
      ["region", "region-hillsborough"],
    ],
  );
  assert.equal(
    ordered.some((row) => row.room.id === "brandon-town" || row.room.id === "cong-epiphany"),
    false,
  );
});

test("a council lift is newest first and is not a rank", () => {
  const live = new Map([
    ["old", { id: "c1", reason: "Named the office.", checklist: ["The post names the candidate and the office."] }],
    ["new", { id: "c2", reason: "Named the business.", checklist: ["The post names the business and the town."] }],
  ]);
  const lifted = orderCouncilPosts(
    [
      { id: "old", at: 1, subject: "candidate", score: 99, mark: "sloppy" },
      { id: "plain", at: 50, subject: null, score: 1 },
      { id: "new", at: 20, subject: "business", replies: 40 },
      { id: "reply", at: 80, subject: "candidate", parentId: "old" },
    ],
    live,
  );
  assert.deepEqual(
    lifted.map((post) => post.id),
    ["new", "old"],
  );
  assert.equal(lifted[1]?.label, COUNCIL_APPROVED_LABEL);
  assert.equal(lifted[1]?.reason, "Named the office.");
  assert.equal(lifted[0]?.id, "new");
});

test("the home payload keeps server order and drops a score", () => {
  const parsed = parseHomePayload({
    zip: "33578",
    congregationId: "grace",
    congregations: [{ id: "grace", name: "Grace", likes: 3 }],
    sections: [
      {
        tier: "council",
        label: COUNCIL_APPROVED_LABEL,
        posts: [
          {
            id: "p1",
            room: "county",
            roomName: "The County",
            claim: "Jane Doe for commission.",
            author: "Maria",
            at: 5,
            subject: "candidate",
            reason: "Named the office.",
            checklist: ["The post names the candidate and the office."],
            label: COUNCIL_APPROVED_LABEL,
            score: 10,
          },
        ],
      },
      {
        tier: "joined",
        label: "What you've joined",
        rooms: [
          { id: "rv-shop", name: "Shop nights", score: 1 },
          { id: "county", name: "The County", score: 9 },
        ],
      },
    ],
    requests: [],
    accessLog: [],
  });
  assert.ok(parsed);
  assert.equal(parsed.sections[1]?.tier, "joined");
  if (parsed.sections[1]?.tier !== "joined") return;
  assert.deepEqual(
    parsed.sections[1].rooms.map((room) => room.id),
    ["rv-shop", "county"],
  );
  assert.equal("score" in parsed.sections[1].rooms[0], false);
  assert.equal(parsed.townId, null);
  assert.equal(parsed.townName, "");
});

test("home controls keep a 44px target, visible labels, and errors on the form", () => {
  const home = readFileSync(new URL("../../components/board/home-view.tsx", import.meta.url), "utf8");
  const about = readFileSync(new URL("../../components/board/about-view.tsx", import.meta.url), "utf8");
  const council = readFileSync(new URL("../../components/board/council-bar.tsx", import.meta.url), "utf8");
  const bits = readFileSync(new URL("../../components/quorum/bits.tsx", import.meta.url), "utf8");
  const week = readFileSync(new URL("../../components/board/week-view.tsx", import.meta.url), "utf8");
  assert.match(bits, /min-h-\[44px\]/);
  assert.match(week, /inline-flex min-h-\[44px\] items-center rounded-sm bg-raised px-3/);
  assert.match(home, /<summary[\s\S]*Request a town/);
  assert.match(home, /<summary[\s\S]*Decide/);
  assert.match(home, /aria-live="polite"/);
  assert.match(home, /No town for that ZIP/);
  assert.match(home, /aria-pressed=\{joined\}/);
  assert.match(home, /Joined ✓/);
  assert.match(home, /role="alert"/);
  assert.equal(home.includes("text-xs"), false);
  assert.match(about, /<summary[^>]*>\{title\}<\/summary>/);
  assert.match(about, /title="Add member"/);
  assert.match(about, /title="Add steward"/);
  assert.match(about, /title="Add admin"/);
  assert.match(about, /Member email/);
  assert.match(about, /role="alert"/);
  assert.match(council, /htmlFor=\{reasonId\}/);
  assert.match(council, /Council review/);
  assert.match(council, /text-\[0\.8125rem\]/);
  assert.match(council, /role="alert"/);
  assert.equal(council.includes("text-xs"), false);
  assert.equal(/\blikes?\b|\bscore\b|\breshare\b/i.test(home), false);
});
