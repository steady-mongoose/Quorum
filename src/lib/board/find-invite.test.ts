import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("Find no longer mints a browser-only invite code", () => {
  const find = read("src/components/board/find-view.tsx");
  assert.doesNotMatch(find, /createInvite/);
  assert.doesNotMatch(find, /Invite someone/);
  assert.match(find, /To invite someone, make a code under About\./);
});

test("About still makes real codes through the server", () => {
  assert.match(read("src/components/board/about-view.tsx"), /<ServerInvite \/>/);
  assert.match(read("src/components/board/server-invite.tsx"), /server\.createInvite\(/);
});

test("About's invite code has a labelled 44px Copy button with a fallback", () => {
  const source = read("src/components/board/server-invite.tsx");
  assert.match(source, /aria-label="Copy code"/);
  assert.match(source, /cn\(btnGhost, "min-h-\[44px\]"\)/);
  assert.match(source, /COPIED = "Copied\."/);
  assert.match(source, /role="status"/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /selectNodeContents/);
  assert.match(source, /\.then\(done, blocked\)/);
});
