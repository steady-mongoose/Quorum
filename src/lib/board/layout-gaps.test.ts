import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("About's How it works flows in two columns, so a long entry leaves no gap beside a short one", () => {
  const about = source("../../components/board/about-view.tsx");
  // A two-column grid sized each row to its tallest entry: "Church needs" sat
  // beside "Moderation" with a 225px blank under it at desktop width.
  assert.match(about, /<dl className="about-how -mb-4 columns-1 gap-x-8 lg:columns-2">/);
  assert.match(about, /className="mb-4 flex break-inside-avoid flex-col gap-1"/);
  assert.doesNotMatch(about, /<dl className="grid gap-x-8 gap-y-4 lg:grid-cols-2">/);
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
