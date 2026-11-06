import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIELD_HINT } from "./field-hints.ts";

/**
 * Josh, Oct 29 2026: a new account must not see example names, households,
 * churches, trades, or other sample data in its fields. A label above a field
 * gives the guidance instead.
 */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const files = sources("src").map((path) => ({ path, text: readFileSync(path, "utf8") }));

/**
 * Every placeholder in the app must be one of these. A placeholder is only an
 * instruction ("Write to the room"), never an example of an answer. Anything
 * else fails, so a new placeholder="Smith family" cannot slip in. A literal is
 * compared by its text, whatever quotes it uses; an expression by its source.
 */
const APPROVED: { file: string; value: string; why?: string }[] = [
  {
    file: "components/board/find-view.tsx",
    value: "{options.placeholder}",
    why: "Host field only: the member's own name, which the field defaults to",
  },
  { file: "components/board/dm-view.tsx", value: "{`To ${other}`}" },
  { file: "components/board/encrypted-mailbox.tsx", value: "{`To ${active.otherName}`}" },
  { file: "components/board/rooms-manager.tsx", value: "Name or slug" },
  { file: "components/board/room-chat.tsx", value: "Write to the room" },
  { file: "components/board/room-view.tsx", value: "A reply with a reason" },
  { file: "components/board/room-browse.tsx", value: "Blank leaves it alphabetical" },
  { file: "components/board/about-view.tsx", value: "Your name" },
  { file: "components/quorum/cell-view.tsx", value: "Your name" },
  { file: "components/quorum/cell-view.tsx", value: "Name" },
  { file: "components/quorum/cell-view.tsx", value: "City" },
  { file: "components/quorum/offices-view.tsx", value: "Name" },
  // Approved by Josh, Oct 29 2026 (8:22 PM ET): this role hint stays as written.
  { file: "components/quorum/offices-view.tsx", value: "Role, such as commission chair", why: "approved by Josh" },
  { file: "components/quorum/offices-view.tsx", value: "Public phone" },
  { file: "components/quorum/desk-view.tsx", value: "Group name" },
  { file: "components/quorum/desk-view.tsx", value: "How many will call" },
  { file: "components/quorum/desk-view.tsx", value: "How you reach them" },
];

/** Sample data that must never appear in a placeholder, matched as whole words. */
const SAMPLES: RegExp[] = [
  /\bMcMullins?\b/i,
  /\bEpiphany\b/i,
  /\bElectrician\b/i,
  /\bElectrical, residential\b/i,
  /\bJosh\b/i,
  /\bwoodshop\b/i,
  /\bMarcus Aurelius\b/i,
  /\bMeditations\b/i,
  /\bBook one\b/i,
  /\bchapters 5 and 6\b/i,
  /\bDinners this week\b/i,
  /\bFirst Monday\b/i,
  /\bFL\b/,
  /\bCity, State\b/i,
  /\bWhatsApp\b/i,
  /\bfor example\b/i,
  /\be\.g\./i,
];

/**
 * Reads every placeholder in a source text, in any quoting style:
 * placeholder="…", placeholder='…', placeholder={"…"}, placeholder={'…'},
 * placeholder={`…`}, placeholder={expression}, and placeholder: "…" in an
 * object. A literal yields its text; anything else yields its source.
 */
function readPlaceholders(text: string): { value: string; literal: boolean }[] {
  const pattern =
    /\bplaceholder\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`$]*)`\s*\}|(\{`[^`]*`\}|\{[^{}]*\}))|:\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`))/g;
  return [...text.matchAll(pattern)].map((m) => {
    const literal = [m[1], m[2], m[3], m[4], m[5], m[7], m[8], m[9]].find((v) => v !== undefined);
    return literal !== undefined ? { value: literal, literal: true } : { value: m[6]!, literal: false };
  });
}

/** Counts placeholder= attributes and quoted placeholder: keys, so none hides from readPlaceholders. */
function countPlaceholders(text: string): number {
  return (text.match(/\bplaceholder\s*=/g)?.length ?? 0) + (text.match(/\bplaceholder\s*:\s*["'`]/g)?.length ?? 0);
}

function placeholders(): { file: string; value: string }[] {
  return files.flatMap(({ path, text }) => {
    const file = path.replaceAll("\\", "/").replace(/^src\//, "");
    const found = readPlaceholders(text).map(({ value }) => ({ file, value }));
    assert.equal(found.length, countPlaceholders(text), `${path} has a placeholder this test cannot read`);
    return found;
  });
}

function approved(file: string, value: string): boolean {
  return APPROVED.some((ok) => ok.file === file && ok.value === value);
}

test("the test scans every .tsx file under src, not only src/components", () => {
  assert.ok(files.some(({ path }) => /^src[\\/]routes[\\/]/.test(path)));
  assert.ok(files.some(({ path }) => /^src[\\/]components[\\/]board[\\/]/.test(path)));
  assert.ok(files.some(({ path }) => /^src[\\/]components[\\/]quorum[\\/]/.test(path)));
});

test("every placeholder under src is on the approved list", () => {
  for (const { file, value } of placeholders()) {
    assert.ok(
      approved(file, value),
      `${file} has placeholder ${value}, which is not approved. Use a label and a hint instead of sample text.`,
    );
  }
});

test("the approved list has no stale entries", () => {
  const found = placeholders();
  for (const ok of APPROVED) {
    assert.ok(
      found.some((item) => item.file === ok.file && item.value === ok.value),
      `${ok.file} no longer has placeholder ${ok.value}; remove it from APPROVED`,
    );
  }
});

test("regression: placeholders the old blocklist missed are now caught", () => {
  const fixtures: [string, string][] = [
    ['<input placeholder="Mary Smith" />', "Mary Smith"],
    ["<input placeholder={'Meditations'} />", "Meditations"],
    ["<input placeholder='Smith family' />", "Smith family"],
    ['<input placeholder={"Book one"} />', "Book one"],
    ["<input placeholder={`chapters 5 and 6`} />", "chapters 5 and 6"],
    ['<input placeholder = "FL" />', "FL"],
    ['field({ placeholder: "the McMullins" })', "the McMullins"],
  ];
  for (const [source, value] of fixtures) {
    const found = readPlaceholders(source);
    assert.deepEqual(found, [{ value, literal: true }], source);
    assert.equal(countPlaceholders(source), 1, source);
    assert.equal(approved("components/board/find-view.tsx", value), false, `${source} would be refused`);
  }
  assert.ok(SAMPLES.some((sample) => sample.test("Meditations")));
  assert.equal(readPlaceholders('className="placeholder:text-muted"').length, 0, "a Tailwind variant is not a placeholder");
});

test("no placeholder carries a sample name, place, trade, or example", () => {
  for (const { file, value } of placeholders()) {
    if (APPROVED.some((ok) => ok.file === file && ok.value === value && ok.why === "approved by Josh")) continue;
    for (const sample of SAMPLES) {
      assert.equal(sample.test(value), false, `${file} has placeholder ${value}, which reads as sample data (${sample})`);
    }
  }
});

test("the FL check matches the state code only, not words that contain fl", () => {
  const fl = SAMPLES.find((sample) => sample.source === "\\bFL\\b");
  assert.ok(fl);
  assert.equal(fl.test("FL"), true);
  assert.equal(fl.test("conflict"), false);
  assert.equal(fl.test("Florida"), false);
});

test("each field that lost its sample text has a hint tied with aria-describedby", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const uses: [string, keyof typeof FIELD_HINT, number][] = [
    ["src/components/board/find-view.tsx", "meetingTime", 1],
    ["src/components/board/find-view.tsx", "tradeWork", 1],
    ["src/components/board/find-view.tsx", "needWhat", 1],
    ["src/components/board/find-view.tsx", "pages", 2],
    ["src/components/board/room-view.tsx", "pages", 1],
    ["src/components/board/room-view.tsx", "appeal", 1],
    ["src/components/board/profile-view.tsx", "household", 1],
    ["src/components/board/profile-view.tsx", "church", 1],
    ["src/components/board/profile-view.tsx", "trade", 1],
    ["src/components/board/about-view.tsx", "roomAddress", 1],
    ["src/components/board/about-view.tsx", "state", 1],
    ["src/components/board/about-view.tsx", "appeal", 1],
    ["src/components/quorum/cell-view.tsx", "cityState", 1],
    ["src/components/quorum/desk-view.tsx", "allyChannel", 1],
    ["src/components/quorum/desk-view.tsx", "refusal", 1],
    ["src/components/board/room-view.tsx", "markReason", 1],
  ];
  for (const [path, key, count] of uses) {
    const text = read(path);
    assert.equal(text.split(`FIELD_HINT.${key}`).length - 1, count, `${path} shows FIELD_HINT.${key} ${count} time(s)`);
    assert.match(text, /aria-describedby=/, `${path} ties its hints to fields`);
  }
  assert.match(read("src/components/board/room-view.tsx"), /describedBy\("pages", pageErrors, pagesHintId\)/);
});

test("the hint copy is exactly what Design approved", () => {
  assert.deepEqual(FIELD_HINT, {
    meetingTime: "The day and hour, and how often it meets.",
    tradeWork: "The trade, and the kind of work they take.",
    needWhat: "What would help, and by when.",
    household: "Your family name, as neighbors would say it.",
    church: "The full name of the church you attend.",
    trade: "Your work, in a word or two. Leave it blank if you like.",
    pages: "Chapters or pages, as you would say them aloud.",
    roomAddress: "Lowercase letters, numbers and hyphens. This becomes the room's web address.",
    state: "Two letters, as on an envelope.",
    appeal: "Say plainly why you think the decision was wrong.",
    cityState: "Your city, then your state.",
    allyChannel: "Signal, WhatsApp, or text.",
    markReason: "Say plainly what the post gets wrong.",
    refusal: "One thing you will not give up in a deal. Add each one on its own.",
  });
});

test("empty states say what happens next, and a non-poster gets no empty status line", () => {
  const room = readFileSync("src/components/board/room-view.tsx", "utf8");
  assert.ok(room.includes('"Nothing posted here yet. Write the first post above."'));
  assert.match(room, /feed\.length === 0 && !canPost \? null :/);
  const profile = readFileSync("src/components/board/profile-view.tsx", "utf8");
  assert.ok(profile.includes('"No one yet. People you meet at a gathering will appear here."'));
  assert.equal(profile.includes("Go to a meeting."), false);
});

test("the card form passes no sample value to its text fields", () => {
  const find = readFileSync("src/components/board/find-view.tsx", "utf8");
  for (const sample of ["Electrical, residential", "Dinners this week", "First Monday 7:30"]) {
    assert.equal(find.includes(sample), false, `find-view.tsx still has "${sample}"`);
  }
});

test("a new member's own profile fields start empty, with labels and no placeholders", () => {
  const profile = readFileSync("src/components/board/profile-view.tsx", "utf8");
  assert.equal(/placeholder=/.test(profile), false, "profile-view.tsx has no placeholder text");
  for (const label of ["Name, as people know you", "Household", "Church", "Trade"]) {
    assert.ok(profile.includes(label), `the ${label} label stays`);
  }
  const store = readFileSync("src/lib/board/store.ts", "utf8");
  assert.match(store, /EMPTY_PROFILE: Profile = \{ household: "", parish: "", trade: "" \}/);
});

test("the browser tab title never takes the household or another profile value", () => {
  const heads = readFileSync("src/lib/board/route-heads.ts", "utf8");
  assert.equal(/household|profile\.|useBoard/.test(heads), false, "route-heads.ts reads no profile");
  assert.match(heads, /\{ title: APP_NAME \}/, "the default tab title is the app name");
  for (const { path, text } of files) {
    assert.equal(/document\.title\s*=/.test(text), false, `${path} sets document.title`);
  }
});

test("a new board starts empty, and each empty view says what to do next", () => {
  const store = readFileSync("src/lib/board/store.ts", "utf8");
  // Josh, Oct 29 2026 (8:22 PM ET): no seed listings on a new board. Boards a
  // member already has keep their cards, because persisted state still merges in.
  assert.equal(store.includes("SEED_CARDS"), false, "store.ts seeds no cards");
  assert.match(store, /function emptyLocalBoard[\s\S]*?cards: \[\] as MeetingCard\[\],/);
  assert.match(store, /partialize: \(state\) => \(\{[\s\S]*?cards: state\.cards,/);
  assert.match(store, /merge: \(persisted, current\) => \{[\s\S]*?\.\.\.saved,/);
  const week = readFileSync("src/components/board/week-view.tsx", "utf8");
  assert.ok(week.includes('"Nothing on the calendar yet."'));
  const find = readFileSync("src/components/board/find-view.tsx", "utf8");
  assert.ok(find.includes('"Nothing is listed yet. Add the first card under List a card."'));
  const room = readFileSync("src/components/board/room-view.tsx", "utf8");
  assert.ok(room.includes("Nothing coming up in this room inside two weeks."));
});
