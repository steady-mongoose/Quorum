import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HIDDEN_CELL_LABEL, RSVP_SUMMARY_MIN_COUNT, privacyNote } from "./rsvp-rules.ts";
import { gatheringLabel, sortSummaryRooms, sortWeeks, summaryRoomName, weekLabel } from "./rsvp-summary-view.ts";

const panel = readFileSync(new URL("../../components/board/rsvp-summary-panel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../routes/admin/stats.tsx", import.meta.url), "utf8");

test("the privacy copy is derived from N, never typed", () => {
  assert.equal(RSVP_SUMMARY_MIN_COUNT, 5);
  assert.equal(
    privacyNote(),
    "To protect privacy, a count under 5 is hidden, and so is one count beside it, so a total can't give it away.",
  );
  assert.match(privacyNote(7), /a count under 7 is hidden/);
  // The panel always shows it, from the server's minCount or the constant, and types no number.
  assert.match(panel, /\{privacyNote\(n\)\}/);
  assert.match(panel, /state\.summary\.minCount : RSVP_SUMMARY_MIN_COUNT/);
  assert.doesNotMatch(panel, /under \d|<5|&lt;5/);
  const rules = readFileSync(new URL("./rsvp-rules.ts", import.meta.url), "utf8");
  assert.match(rules, /TODO\(Josh\)[\s\S]*RSVP_SUMMARY_MIN_COUNT = 5/);
});

test("a hidden cell reads 'Hidden' and a screen reader hears 'hidden to protect privacy'", () => {
  assert.equal(HIDDEN_CELL_LABEL, "hidden to protect privacy");
  assert.match(panel, /<span aria-hidden="true">Hidden<\/span>\s*<span className="sr-only">\{HIDDEN_CELL_LABEL\}<\/span>/);
});

test("rooms show their names, sorted alphabetically, not ids", () => {
  const names: Record<string, string> = { zz: "Apple room", aa: "Zebra room", "": "No room", mm: "mango room" };
  const sorted = sortSummaryRooms([{ roomId: "aa" }, { roomId: "zz" }, { roomId: "" }, { roomId: "mm" }], (id) => names[id]!);
  assert.deepEqual(sorted.map((r) => r.name), ["Apple room", "mango room", "No room", "Zebra room"]);
  assert.equal(summaryRoomName(""), "No room");
  assert.match(panel, /sortSummaryRooms\(summary\.rooms\)/);
  assert.match(panel, /\{room\.name\}:/);
  assert.doesNotMatch(panel, /\{room\.roomId \|\| "No room"\}/);
});

test("weeks read 'Week of Oct 26, 2026', oldest first; gatherings by date, never a title", () => {
  assert.equal(weekLabel("2026-10-26"), "Week of Oct 26, 2026");
  assert.deepEqual(sortWeeks([{ week: "2026-10-26" }, { week: "2026-10-12" }]).map((w) => w.week), ["2026-10-12", "2026-10-26"]);
  assert.equal(gatheringLabel("2026-10-26"), "Gathering on Oct 26, 2026");
  assert.doesNotMatch(panel, /g\.title/);
});

test("the panel is a card, 'RSVP counts', with scrolling tables, right-aligned numbers and 'Have come'", () => {
  assert.match(panel, /rounded-lg border border-line bg-surface p-4 sm:p-6/);
  assert.match(panel, />\s*RSVP counts\s*</);
  assert.match(panel, /className="overflow-x-auto"/);
  assert.match(panel, /px-2 py-2 text-right tabular-nums/);
  assert.match(panel, />Have come</);
  assert.match(panel, /Have come\\u201d is how many members a host or steward has ever marked as having come/);
  // One always-mounted status line for loading and messages.
  assert.equal((panel.match(/role="status"/g) ?? []).length, 1);
  assert.match(panel, /"Loading RSVP counts\."/);
  // Not hidden when the main stats fail.
  assert.doesNotMatch(page, /load\.kind === "ready" \? <RsvpSummaryPanel \/>/);
});
