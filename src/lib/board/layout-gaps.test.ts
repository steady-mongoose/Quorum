import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("About's entries are full-width rows, so a long entry never sits beside a short one", () => {
  const about = source("../../components/board/about-view.tsx");
  // Two columns put "Stewards" beside the far longer "Moderation", as a grid or as flowing columns.
  assert.ok(about.includes("sm:grid-cols-[10rem_minmax(0,1fr)]"));
  assert.doesNotMatch(about, /<dl className="[^"]*(columns|grid)/);
  assert.equal(about.split("<dl>").length - 1, 3);
});

test("About's Moderation entry reads in paragraphs, with its words unchanged", () => {
  const about = source("../../components/board/about-view.tsx");
  assert.ok(about.includes('item.text.split("\\n")'));
  for (const start of ["A removal bars", "Child sexual abuse material is removed", "Stewards can mark a post", "A steward can mark, remove"]) {
    assert.ok(about.includes(`\\n${start}`), start);
  }
});

test("This week drops its side column when there is no call and no parish need", () => {
  const week = source("../../components/board/week-view.tsx");
  // An empty side column kept its 20 to 26rem and squeezed the week into a strip.
  assert.match(week, /const hasSide = deskOn \|\| needs\.length > 0;/);
  assert.match(
    week,
    /"week-columns grid gap-8",\s*hasSide && "lg:grid-cols-\[minmax\(0,1fr\)_minmax\(20rem,26rem\)\] lg:gap-12"/,
  );
  assert.match(week, /\{hasSide \? \(\s*<aside className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">/);
  // Both things the column holds still render inside it.
  const aside = week.slice(week.indexOf("{hasSide ? ("), week.indexOf("</aside>"));
  assert.match(aside, /\{deskOn \? <TheCall \/> : null\}/);
  assert.match(aside, /A parish needs/);
});
