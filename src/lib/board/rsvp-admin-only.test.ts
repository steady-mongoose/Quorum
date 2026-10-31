import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../../components/board/${name}`, import.meta.url), "utf8");

test("every going or has-been list is behind an admin check", () => {
  for (const name of ["week-view.tsx", "find-view.tsx", "room-view.tsx"]) {
    const source = read(name);
    assert.match(source, /const admin = useBoard\(\(state\) => state\.admin\);/, name);
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      if (/going\.(length|join|map)|wentBy\.join/.test(line)) {
        const near = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
        assert.match(near, /admin &&|admin \?/, `${name}: ${line.trim()}`);
      }
    });
  }
});

test("members keep their own RSVP", () => {
  assert.match(read("week-view.tsx"), /const going = card\.going\.includes\(me\)/);
  assert.match(read("find-view.tsx"), /const going = card\.going\.includes\(rest\.me\)/);
  assert.match(read("rsvp-control.tsx"), /You’re going/);
});

test("about copy no longer promises who is going", () => {
  const source = read("about-view.tsx");
  assert.doesNotMatch(source, /who is going/);
  assert.match(source, /Who\\'s coming stays private\. Only admins see the list\./);
});

import { forViewer } from "./model.ts";
import { SEED_CARDS } from "./seed-cards.ts";

test("a non-admin's board data carries no other names", () => {
  const cards = [
    ...SEED_CARDS,
    { ...SEED_CARDS[0], id: "x", going: ["Ann", "Me", "Tom"], wentBy: ["Tom", "Me"] },
  ];
  for (const card of cards.map((c) => forViewer(c, { admin: false, name: "Me" }))) {
    for (const name of [...card.going, ...card.wentBy]) assert.equal(name, "Me", card.id);
  }
  const mine = forViewer(cards.at(-1)!, { admin: false, name: "Me" });
  assert.deepEqual(mine.going, ["Me"]);
  assert.deepEqual(mine.wentBy, ["Me"]);
  const admin = forViewer(cards.at(-1)!, { admin: true, name: "Me" });
  assert.deepEqual(admin.going, ["Ann", "Me", "Tom"]);
});

test("the views read cards through forViewer", () => {
  for (const name of ["week-view.tsx", "find-view.tsx", "room-view.tsx"]) {
    const source = read(name);
    assert.doesNotMatch(source, /const cards = useBoard\(\(state\) => state\.cards\)/, name);
    assert.match(source, /forViewer\(card, \{ admin: viewerAdmin, name: viewerName \}\)/, name);
  }
  assert.match(read("roll-call.tsx"), /Say how it went, and set the next date\./);
});

test("server board responses carry a forViewer TODO", () => {
  for (const path of ["../../../server/board/store.ts", "./store.ts"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /TODO\(rsvp-server\):[^\n]*forViewer/);
  }
});
