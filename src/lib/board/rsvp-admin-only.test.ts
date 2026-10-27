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
  assert.match(source, /Only admins see who said they would come\./);
});
