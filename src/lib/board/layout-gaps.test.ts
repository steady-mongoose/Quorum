import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("About's entries are full-width rows, so a long entry never sits beside a short one", () => {
  const about = source("../../components/board/about-view.tsx");
  // Two columns put "Stewards" beside the far longer "Moderation", as a grid or as flowing columns.
  assert.ok(about.includes("lg:grid-cols-[10rem_minmax(0,1fr)]"));
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

test("About's plate groups give the plate its own column, so no entry is squeezed beside it (Josh, Nov 3)", () => {
  const about = source("../../components/board/about-view.tsx");
  const css = source("../../../public/page-art.css");
  assert.match(about, /<div className=\{group\.plate \? "how-body" : "flow-root"\}>/);
  assert.match(about, /className=\{group\.plate \? entryStacked : entry\}/);
  // The name sits over its text beside a plate; the lists with no plate keep the name beside the text.
  assert.match(about, /const entryStacked =\s*"flex flex-col gap-1 border-t/);
  assert.match(css, /\.how-body\{display:grid;grid-template-columns:minmax\(0,1fr\) 13rem;/);
  assert.match(css, /\.how-body>\.section-plate\{grid-column:2;grid-row:1;float:none;/);
  // With the plate skipped for data savers, no empty column is left.
  assert.match(css, /\[data-save-data\] \.how-body\{display:block\}/);
});

test("the category editor is one aligned row per category, folded on a card, on All rooms only (Josh, Nov 3)", () => {
  const browse = source("../../components/board/room-browse.tsx");
  const editor = browse.slice(browse.indexOf("function CategoryEditor"), browse.indexOf("export function RoomCategoryFields"));
  assert.match(browse, /\{admin && remote && focusSlug === null \? <CategoryEditor/);
  assert.match(editor, /<details className="card pc-card p-4 sm:p-5">/);
  assert.match(editor, /Edit categories/);
  // A fixed button column, so Uncategorized (no Remove) lines up with the rest; Order beside Name on a phone.
  assert.match(editor, /grid-cols-\[minmax\(0,1fr\)_5rem\] items-end/);
  assert.match(editor, /sm:grid-cols-\[minmax\(0,1fr\)_5rem_minmax\(11rem,auto\)\]/);
  assert.match(editor, /col-span-2 flex flex-wrap gap-2 sm:col-span-1/);
  assert.match(editor, /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_auto\] sm:items-end/);
  // Short buttons on screen; the category's name stays in each button's accessible name.
  assert.match(editor, /aria-label=\{`Save \$\{category\.name\}`\}/);
  assert.match(editor, /aria-label=\{`Remove \$\{category\.name\}`\}/);
  assert.doesNotMatch(editor, /Save \{category\.name\}|Remove \{category\.name\}/);
});
