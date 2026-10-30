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
    "To protect privacy, a count under 5 is hidden, and so is one count beside it, so a total can't give it away. A count that matches a room's whole membership is hidden too.",
  );
  assert.match(privacyNote(7), /a count under 7 is hidden/);
  // The panel always shows it, from the server's minCount or the constant, and types no number.
  assert.match(panel, /\{privacyNote\(n\)\}/);
  assert.match(panel, /state\.summary\.minCount : RSVP_SUMMARY_MIN_COUNT/);
  assert.doesNotMatch(panel, /under \d|<5|&lt;5/);
  const rules = readFileSync(new URL("./rsvp-rules.ts", import.meta.url), "utf8");
  assert.match(rules, /decided by Josh, Oct 30[\s\S]*RSVP_SUMMARY_MIN_COUNT = 5/);
  assert.doesNotMatch(rules, /TODO\(Josh\)/);
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
  // The server's name first, then the catalogue, then "Unnamed room": never a raw id (QA F7, Design M2).
  assert.equal(summaryRoomName("x-9f2", "Garage crew"), "Garage crew");
  assert.equal(summaryRoomName("x-9f2"), "Unnamed room");
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

test("the panel is a card, 'RSVP counts', with scrolling tables, right-aligned numbers and 'Times came'", () => {
  assert.match(panel, /rounded-lg border border-line bg-surface p-4 sm:p-6/);
  assert.match(panel, />\s*RSVP counts\s*</);
  assert.match(panel, /className="overflow-x-auto"/);
  assert.match(panel, /px-2 py-2 text-right tabular-nums/);
  // Visible "Times came", heard as "Times members came", no <abbr> (Design #126 M1).
  assert.match(panel, /<span aria-hidden="true">Times came<\/span>\s*<span className="sr-only">Times members came<\/span>/);
  assert.doesNotMatch(panel, /<abbr/);
  assert.match(panel, /whitespace-nowrap text-right/);
  assert.doesNotMatch(panel, /Have come/);
  assert.match(panel, /so one member who came to three gatherings counts three times/);
  assert.match(panel, /Gatherings in \{room\.name\}: going, times members came and write-ups for each/);
  // One always-mounted status line for loading and messages.
  assert.equal((panel.match(/role="status"/g) ?? []).length, 1);
  assert.match(panel, /"Loading RSVP counts\."/);
  // Not hidden when the main stats fail.
  assert.doesNotMatch(page, /load\.kind === "ready" \? <RsvpSummaryPanel \/>/);
});

test("the mark-who-came form shows for an admin only as a real host or steward (live setting), never as an admin alone", async () => {
  const { forViewer, takesRoll } = await import("./model.ts");
  const { ADMIN_ROLE_SEES_NAMES, withAdminRoleSeesNames } = await import("./rsvp-rules.ts");
  assert.equal(ADMIN_ROLE_SEES_NAMES, true);
  const card = { id: "0123456789abcdef01234567", room: "shop", host: "Dale", going: ["Ann"], wentBy: [] } as unknown as Parameters<typeof forViewer>[0];
  const steward = { admin: true, name: "Josh", stewardRooms: ["shop"] };
  const host = { admin: true, name: "Josh", hosts: [card.id] };
  const alone = { admin: true, name: "Josh" };
  assert.equal(takesRoll(forViewer(card, steward)), true);
  assert.equal(takesRoll(forViewer(card, host)), true);
  assert.equal(takesRoll(forViewer(card, alone)), false);
  assert.deepEqual(forViewer(card, alone).going, []);
  await withAdminRoleSeesNames(false, () => {
    for (const viewer of [steward, host, alone]) assert.equal(takesRoll(forViewer(card, viewer)), false);
  });
});
