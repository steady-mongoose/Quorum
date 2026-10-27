import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../components/board/${path}`, import.meta.url), "utf8");

for (const [file, start] of [
  ["room-view.tsx", "{mine && appealing ? ("],
  ["about-view.tsx", "function RemovalAppeal("],
] as const) {
  test(`${file}: the appeal form keeps buttons out of the label, 44px targets, and moves focus`, () => {
    const source = read(file);
    const from = source.indexOf(start);
    assert.ok(from >= 0);
    const block = source.slice(from, from + 4000);
    const label = /<label htmlFor=\{\w+\}>[^<]*<\/label>/.exec(block);
    assert.ok(label, "the label holds only its text");
    assert.match(block, /File appeal/);
    for (const button of block.match(/<button[\s\S]*?>/g) ?? []) {
      assert.match(button, /min-h-\[44px\]/, button);
    }
    assert.match(block, /\.focus\(\)/);
    assert.match(source, /Appeal filed with the stewards\. They will read it and decide\./);
    assert.match(source, /role="status"/);
  });
}

test("About finds your removals by user id on the server, not by name", () => {
  const about = readFileSync(new URL("../../components/board/about-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(about, /row\.author === authorName\(me\)/);
  assert.match(about, /isMyRemoval\(row, \{ remote, name: authorName\(me\) \}\)/);
  const owner = readFileSync(new URL("./removal-owner.ts", import.meta.url), "utf8");
  assert.match(owner, /viewer\.remote \? row\.mine === true : row\.author === viewer\.name/);
});
