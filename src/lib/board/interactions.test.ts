import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { gatheringShare, SHARE_GATHERINGS, townOf } from "./gathering.ts";
import { publicQuote, quoteCardLines, quoteCardSize, quoteHoldKept } from "./quote.ts";

test("a shared gathering is the title, the date, the time, and the town", () => {
  const payload = gatheringShare({
    id: "s-lifts",
    name: "Saturday lifts, garage gym",
    place: "Dale's garage, Riverview",
    time: "Saturdays 7 a.m.",
    next: "2026-10-24",
  });
  assert.equal(payload.title, "Saturday lifts, garage gym");
  assert.equal(payload.url, "https://avouchsocial.com/e/s-lifts");
  assert.match(payload.text, /Riverview/);
  assert.match(payload.text, /7 a\.m\./);
  assert.equal(/Dale|Josh|Pete|garage,|1010|invite|code/i.test(payload.text), false);
  assert.equal(payload.text.includes("#"), false);
});

test("a street and the word address never become the town", () => {
  assert.equal(townOf("1010 E Brandon Blvd, Brandon"), "Brandon");
  assert.equal(townOf("St. John the Baptist, 2418 W Swann Ave"), "");
  assert.equal(townOf("Leave it on the porch; Dale has the address"), "");
  assert.equal(townOf("The Hendersons' back yard, Valrico"), "Valrico");
  assert.equal(townOf("Back room, Brandon hall"), "Brandon");
  const street = gatheringShare({
    id: "s-baptist",
    name: "Grace Bible Church of Brandon",
    place: "1010 E Brandon Blvd, Brandon",
    time: "Sunday school 9:00, worship 10:30",
    next: "2026-10-25",
  });
  assert.equal(/1010|Blvd|Brandon Blvd/.test(street.text), false);
  assert.match(street.text, /Brandon/);
  assert.equal(JSON.stringify(street).includes("INVITE"), false);
});

test("a public-domain line can become a card, and the member cannot", () => {
  const quote = publicQuote({
    claim: "“They also serve who only stand and wait.”",
    reason: "John Milton, Sonnet XIX",
    author: "Maria",
  });
  assert.ok(quote);
  assert.equal(quote.words, 8);
  assert.equal(quote.author, "John Milton");
  assert.equal(quote.work, "Sonnet XIX");
  assert.deepEqual(quoteCardSize(quote.words), { width: 1080, height: 1080 });
  assert.deepEqual(quoteCardSize(20), { width: 1080, height: 1350 });
  for (const line of quoteCardLines(quote)) {
    assert.equal(/\bMaria\b/.test(line), false);
    assert.equal(line.includes("#"), false);
  }
  assert.equal(
    publicQuote({
      claim: "“They also serve who only stand and wait.”",
      reason: "Maria said it once",
      author: "Maria",
    }),
    null,
  );
  assert.equal(
    publicQuote({
      claim: "“A short line here now.”",
      reason: "John Milton, Sonnet XIX",
      author: "Josh",
    })?.text.includes("Josh"),
    false,
  );
  const named = publicQuote({
    claim: "“Josh also serves who only stands and waits today.”",
    reason: "John Milton, Sonnet XIX",
    author: "Josh",
  });
  assert.equal(named, null);
});

test("a quote hold gives up when the finger moves or lifts early", () => {
  assert.equal(quoteHoldKept(500, 0, false), true);
  assert.equal(quoteHoldKept(499, 0, false), false);
  assert.equal(quoteHoldKept(800, 9, false), false);
  assert.equal(quoteHoldKept(800, 0, true), false);
});

test("tap interactions add no count, badge, or feed gesture", () => {
  const week = read("../../components/board/week-view.tsx");
  const find = read("../../components/board/find-view.tsx");
  const room = read("../../components/board/room-view.tsx");
  const haptic = read("../../components/board/haptics.tsx");
  const rsvp = read("../../components/board/rsvp-control.tsx");
  assert.match(rsvp, /You’re going/);
  assert.match(rsvp, /aria-hidden="true">✓/);
  assert.equal(rsvp.includes("aria-pressed"), false);
  assert.match(week, /RsvpControl/);
  assert.match(find, /RsvpControl/);
  assert.equal(SHARE_GATHERINGS, false);
  assert.match(rsvp, /SHARE_GATHERINGS \? <ShareGathering/);
  assert.match(rsvp, /Share this gathering/);
  assert.equal(rsvp.includes("execCommand"), false);
  assert.equal(read("../../components/quorum/bits.tsx").includes("execCommand"), false);
  assert.match(rsvp, /Link copied/);
  assert.match(rsvp, /role="status"/);
  assert.equal(week.includes("I'll be there · undo"), false);
  assert.equal(find.includes("I'll be there · undo"), false);
  assert.equal(/people are going|confetti|streak/i.test(week + find + rsvp), false);
  assert.equal(/\blike\b|\bscore\b|\brank/i.test(room), false);
  assert.match(haptic, /navigator\.vibrate\?\.\(8\)/);
  assert.match(haptic, /btn-primary/);
  const motionTs = read("../../lib/board/motion.ts");
  assert.match(motionTs, /startViewTransition/);
  assert.match(motionTs, /viewTransitionName = ""/);
  assert.match(week, /clearChipNames/);
  const sheet = read("../../../public/backgrounds.css");
  assert.match(sheet, /prefers-reduced-motion:\s*reduce/);
  assert.match(sheet, /vt-fade/);
  assert.match(sheet, /user-select:\s*none/);
  assert.match(sheet, /-webkit-touch-callout:\s*none/);
  assert.match(sheet, /\.laurel\{width:46px/);
  assert.equal(sheet.includes("#b08d4a"), false);
  assert.equal(sheet.includes("@font-face"), false);
  assert.equal(sheet.includes("filter:blur"), false);
  const root = read("../../routes/__root.tsx");
  assert.equal(root.includes("interactions.css"), false);
  assert.match(root, /EBGaramond-latin\.woff2/);
  assert.equal(existsSync(new URL("../../../public/interactions.css", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../routes/e/$id.tsx", import.meta.url)), false);
  const quote = read("../../components/board/quote-card.tsx");
  assert.match(quote, /quote-hold/);
  assert.match(quote, /onContextMenu/);
  assert.match(quote, /#c9a45c/);
  assert.match(quote, /#14100c/);
  assert.equal(quote.includes("#b08d4a"), false);
  assert.match(rsvp, /btn-primary/);
  assert.match(rsvp, /bg-transparent/);
});

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
