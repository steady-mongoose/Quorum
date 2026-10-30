import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deskDid, formatDate, formatWhen } from "./model.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("a desk log uses Avouch Social wording and an older date matches the calendar", () => {
  const post = deskDid({
    title: "Put the ordinance on the commission agenda.",
    waveLabel: "Board office",
    office: "Ken Hagan",
    role: "Chair",
    window: "9am–11am local",
    who: "Josh",
    campaignId: "county-agenda",
    author: "Josh",
  });
  assert.match(post.reason, /^Logged on the Avouch Social desk by Josh\. Window 9am–11am local\.$/);
  assert.equal(post.reason.includes("Quorum"), false);
  const at = new Date(2026, 9, 20, 12).getTime();
  assert.equal(formatWhen(at, at + 3 * 24 * 60 * 60 * 1000), formatDate("2026-10-20"));
});

test("the design follow-ups are in the screens they belong to", () => {
  const dm = source("../../components/board/dm-view.tsx");
  const app = source("../../components/board/app.tsx");
  const model = source("./model.ts");
  const bits = source("../../components/quorum/bits.tsx");
  const css = source("../../styles.css");
  const find = source("../../components/board/find-view.tsx");
  const room = source("../../components/board/room-view.tsx");
  const about = source("../../components/board/about-view.tsx");
  const profile = source("../../components/board/profile-view.tsx");
  const door = source("../../components/board/door.tsx");
  const desk = source("../../components/quorum/app.tsx");
  const account = source("../../components/board/account-door.tsx");

  assert.equal(dm.includes("plain text, not encrypted"), false);
  assert.equal(dm.includes("The words stay in this browser, are not encrypted"), false);
  assert.match(dm, /\{DM_DEMO_NOTICE\}/);
  assert.match(app, /Skip to content/);
  assert.match(app, /id="main"/);
  assert.match(app, /tabIndex=\{-1\}/);
  assert.match(app, /<SectionTabs /);
  assert.equal(app.includes("grid-cols-5"), false);
  assert.match(app, /aria-busy=\{busy/);
  assert.match(app, /Checking the server/);
  assert.match(app, /motion-reduce:animate-none/);
  assert.equal(door.includes("sample week"), false);
  assert.equal(model.includes("Logged on the Quorum desk"), false);
  assert.match(model, /Logged on the \$\{APP_NAME\} desk/);
  assert.match(bits, /motion-safe:active:scale-95/);
  assert.equal(bits.includes(" active:scale-95"), false);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /--color-danger:\s*#f0b4a4/);

  assert.match(room, /role="status"/);
  assert.match(room, /text-danger" role="alert"/);
  assert.match(find, /role="status"/);
  assert.match(find, /role="alert"/);
  assert.match(find, /text-danger/);
  assert.match(find, /Removed \{removal\.removed\.name\}/);
  assert.match(find, />\s*Undo\s*</);
  assert.match(find, /How it went/);
  assert.match(find, /Next date/);
  assert.match(find, /aria-label="Room"/);
  assert.match(find, /aria-label="Kind"/);
  assert.match(find, /text-\[0\.8125rem\]/);
  assert.equal(find.includes("text-xs"), false);
  assert.match(find, />\s*Remove\s*</);

  assert.match(about, /Grant adds a role\. Revoke takes one away/);
  assert.match(about, /text-danger/);
  assert.match(about, /setPending\("grant-steward"\)/);
  assert.match(about, /setPending\("revoke"\)/);
  assert.match(about, /Revoke this role\?/);
  assert.match(about, /cancelLabel="Not now"/);
  assert.match(about, /tone="neutral"/);
  assert.match(about, /of \$\{room\}/);
  assert.match(about, /in \$\{room\}/);
  assert.match(about, /room\?\.name/);
  assert.match(about, /Member granted\./);
  assert.match(about, /Role revoked\./);
  assert.match(about, /role="status"/);
  assert.match(profile, /Name, as people know you/);
  assert.match(profile, /role="status"/);
  assert.match(profile, />\s*Saved\s*</);
  assert.match(profile, /The desk/);
  assert.match(source("./phone-nav.ts"), /label: "About"/);
  assert.match(source("./phone-nav.ts"), /label: "More"/);
  assert.match(door, /text-base font-semibold text-fg">\s*The rooms/);
  assert.match(desk, /<summary[\s\S]*How it works/);
  assert.match(account, /autoComplete="name"/);
  assert.match(account, /autoComplete="email"/);
  assert.match(account, /text-danger/);
  assert.match(bits, /min-h-\[44px\]/);
  assert.equal(source("../../components/quorum/desk-view.tsx").includes("min-h-11"), false);
});
