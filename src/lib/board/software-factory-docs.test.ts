import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../../../", import.meta.url).pathname;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Strip fenced/quoted ban-list examples so we only judge the doc's own prose. */
function proseWithoutQuotedBans(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*[-*]\s+\*[^*]+\*\s*$/gm, " ")
    .replace(/Rhetorical \*"[\s\S]*?"\* contrast clichés/g, " ")
    .replace(/\*"It's not X—it's Y"\*/g, " ");
}

const SLOP = [
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\btestament to\b/i,
  /\bin today's fast-paced world\b/i,
  /\bunlock the power of\b/i,
  /\bseamless\b/i,
  /\bgame-changer\b/i,
  /\belevate\b/i,
  /\bfoster\b/i,
  /It's not [^-]+—it's /i,
];

test("elastic-ui-and-collections.mdc exists with Avouch layout and Belonging Moat rules", () => {
  const mdc = read(".cursor/rules/elastic-ui-and-collections.mdc");
  assert.match(mdc, /^---\n/);
  assert.match(mdc, /alwaysApply:\s*false/);
  assert.match(mdc, /\*\*\/\*\.tsx/);
  assert.match(mdc, /\*\*\/\*\.ts/);
  assert.match(mdc, /\*\*\/\*\.css/);
  assert.match(mdc, /\*\*\/\*\.html/);
  for (const needle of [
    "@container",
    "min-w-0",
    "shrink-0",
    "whitespace-nowrap",
    "clamp(",
    "tabular-nums",
    "44",
    "Intl.Collator",
    "aria-sort",
    "Belonging Moat",
    "This week",
    "likes",
    "reshares",
    "validateSearch",
    "DESIGN.md",
  ]) {
    assert.ok(mdc.includes(needle), `missing ${needle}`);
  }
  assert.equal(mdc.includes("ArmorVaultLive"), false);
});

test("BRAND_VOICE_AND_SOFTWARE_FACTORY.md codifies moat, harness, conveyor, and approval relay", () => {
  const doc = read("docs/BRAND_VOICE_AND_SOFTWARE_FACTORY.md");
  for (const needle of [
    "Belonging Moat",
    "Anti-Slop",
    "Software Factory",
    "SHA-pinned",
    "Approval Relay",
    "DESIGN.md",
    "docs/TESTING.md",
    "check-ui-gate.mjs",
    "CALLS",
    "/var/backups/avouch",
  ]) {
    assert.ok(doc.includes(needle), `missing ${needle}`);
  }
  // Title uses "anti-slop harness"; require the harness section heading shape.
  assert.match(doc, /anti-slop harness/i);
  assert.match(doc, /Software Factory conveyor/i);

  const prose = proseWithoutQuotedBans(doc);
  for (const re of SLOP) {
    assert.equal(re.test(prose), false, `slop phrase leaked into prose: ${re}`);
  }
});
