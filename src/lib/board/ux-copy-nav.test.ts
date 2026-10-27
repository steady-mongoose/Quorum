import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("every text field on Home, Groups, and About has an accessible name", () => {
  for (const path of [
    "src/components/board/home-view.tsx",
    "src/components/board/groups-view.tsx",
    "src/components/board/about-view.tsx",
  ]) {
    const source = read(path);
    const controls = source.match(/<(input|select|textarea)\b[\s\S]*?(\/>|\n\s*>)/g) ?? [];
    for (const control of controls) {
      if (/type="(checkbox|radio|hidden)"/.test(control)) continue;
      assert.match(control, /aria-label|aria-labelledby|\bid=/, `${path}: ${control.slice(0, 80)}`);
    }
  }
});

test("This week opens on the week, with Home below it", () => {
  const source = read("src/components/board/week-view.tsx");
  assert.ok(source.indexOf("<Kicker>This week</Kicker>") < source.indexOf("<HomePanel />"));
});

test("Find points to About for the general invite code", () => {
  const source = read("src/components/board/find-view.tsx");
  assert.doesNotMatch(source, /get invite\s+codes to hand out/);
  assert.match(source, /under More, on About/);
});

test("a room you are not in offers a Join button", () => {
  const source = read("src/components/board/room-chat.tsx");
  assert.match(source, /note === NOT_IN_ROOM/);
  assert.match(source, /Join this room/);
  assert.match(source, /joinRoom\(roomId\)/);
});
