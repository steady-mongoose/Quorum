import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("Find no longer mints a browser-only invite code", () => {
  const find = read("src/components/board/find-view.tsx");
  assert.doesNotMatch(find, /createInvite/);
  assert.doesNotMatch(find, /Invite someone/);
  assert.match(find, /To invite someone,\{" "\}/);
  assert.match(find, /<Link\s+to="\/"\s+hash="invite"[\s\S]*?setSection\("about"\)[\s\S]*?>\s*make a code on the About page\s*<\/Link>/);
  assert.match(read("src/components/board/app.tsx"), /watchInviteHash\(window, \(\) => setSection\("about"\)\)/);
});

test("About still makes real codes through the server", () => {
  assert.match(read("src/components/board/about-view.tsx"), /<ServerInvite \/>/);
  assert.match(read("src/components/board/server-invite.tsx"), /server\.createInvite\(/);
});

test("About's invite code has a labelled 44px Copy button with a fallback", () => {
  const source = read("src/components/board/server-invite.tsx");
  assert.match(source, /aria-label="Copy code"/);
  assert.match(source, /cn\(btnGhost, "min-h-\[44px\]"\)/);
  assert.match(source, /COPIED = "Code copied\."/);
  assert.match(source, /setCopyNote\(""\);[\s\S]*setTimeout\(\(\) => setCopyNote\(text\)/);
  assert.match(source, /id=\{INVITE_HASH\}/);

  assert.match(source, /<h2 ref=\{heading\} tabIndex=\{-1\}/);
  assert.match(source, /landOnInvite\(window, heading\.current\)[\s\S]*watchInviteHash\(window, land\)/);
  assert.match(source, /role="status"/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /selectNodeContents/);
  assert.match(source, /\.then\(done, blocked\)/);
});

import { INVITE_HASH, watchInviteHash } from "./invite-hash.ts";

test("hashchange and back/forward to #invite open About again", () => {
  const win = Object.assign(new EventTarget(), { location: { hash: "" } });
  let opened = 0;
  const stop = watchInviteHash(win as never, () => (opened += 1));
  assert.equal(opened, 0, "not on #invite yet");
  win.location.hash = `#${INVITE_HASH}`;
  win.dispatchEvent(new Event("hashchange"));
  assert.equal(opened, 1, "the link from Find");
  win.location.hash = "";
  win.dispatchEvent(new Event("popstate"));
  assert.equal(opened, 1, "back to Find stays on Find");
  win.location.hash = "#invite";
  win.dispatchEvent(new Event("popstate"));
  assert.equal(opened, 2, "forward lands on About again");
  stop();
  win.dispatchEvent(new Event("hashchange"));
  assert.equal(opened, 2, "cleanup removes the listeners");
});

test("arriving on #invite at first load opens About", () => {
  const win = Object.assign(new EventTarget(), { location: { hash: "#invite" } });
  let opened = 0;
  watchInviteHash(win as never, () => (opened += 1))();
  assert.equal(opened, 1);
});

import { landOnInvite } from "./invite-hash.ts";

test("after landing, the hash is cleared and a back/forward without it does not move focus", () => {
  const location = { pathname: "/", search: "?x=1", hash: "#invite" };
  const calls: string[] = [];
  const win = Object.assign(new EventTarget(), {
    location,
    history: {
      state: { key: "k" },
      replaceState(state: unknown, _title: string, url: string) {
        calls.push(`replace ${url} ${JSON.stringify(state)}`);
        location.hash = "";
      },
    },
  });
  let focused = 0;
  const heading = { focus: () => (focused += 1), scrollIntoView: () => {} };
  const stop = watchInviteHash(win, () => landOnInvite(win, heading));
  assert.equal(focused, 1);
  assert.deepEqual(calls, ['replace /?x=1 {"key":"k"}']);
  assert.equal(location.hash, "");
  win.dispatchEvent(new Event("popstate"));
  win.dispatchEvent(new Event("hashchange"));
  assert.equal(focused, 1);
  stop();
});
