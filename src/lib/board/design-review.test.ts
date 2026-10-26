import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { entryFromSearch, INVITE_CODE_ERROR, INVITE_INVALID, inviteCodeError } from "./invite-entry.ts";
import { THEMES, themeById, OWNER_THEME } from "./themes.ts";
import { dayHeading, localCalendarIso, meetingDates, shiftLocalDate } from "./week-days.ts";

process.env.TZ = "America/New_York";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast ratio of two hex colours. */
function contrast(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function weekday(iso: string): number {
  const local = localCalendarIso(iso);
  assert.ok(local, iso);
  const [year, month, day] = local.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

test("the zone under test is New York, where the clock falls back and springs forward", () => {
  assert.equal(new Date(2026, 9, 31, 12).getTimezoneOffset(), 240);
  assert.equal(new Date(2026, 10, 1, 12).getTimezoneOffset(), 300);
  assert.equal(new Date(2026, 2, 7, 12).getTimezoneOffset(), 300);
  assert.equal(new Date(2026, 2, 8, 12).getTimezoneOffset(), 240);
});

test("a Saturdays card lands only on Saturday, including across a DST change", () => {
  const time = "Saturdays 7 a.m. Squat, press, deadlift. Coffee after.";
  const cases = [
    { today: "2026-10-21", next: "2026-10-24", expect: ["2026-10-24"] },
    { today: "2026-10-31", next: "2026-10-31", expect: ["2026-10-31"] },
    { today: "2026-11-01", next: "2026-11-07", expect: ["2026-11-07"] },
    { today: "2026-03-06", next: "2026-03-07", expect: ["2026-03-07"] },
    { today: "2026-03-08", next: "2026-03-14", expect: ["2026-03-14"] },
  ];
  for (const item of cases) {
    const dates = meetingDates(time, item.next, item.today);
    assert.deepEqual(dates, item.expect, item.today);
    assert.equal(new Set(dates).size, dates.length);
    for (const iso of dates) assert.equal(weekday(iso), 6, iso);
  }
});

test("the week after the fallback Sunday is seven distinct local dates and still reaches Saturday", () => {
  const days = Array.from({ length: 7 }, (_, index) => shiftLocalDate("2026-11-01", index));
  assert.deepEqual(days, [
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
  ]);
  assert.equal(dayHeading("2026-11-01", "2026-11-01"), "Today");
  assert.equal(dayHeading("2026-11-02", "2026-11-01"), "Tomorrow");
  assert.equal(dayHeading("2026-11-07", "2026-11-01"), "Saturday");
  const spring = Array.from({ length: 7 }, (_, index) => shiftLocalDate("2026-03-08", index));
  assert.deepEqual(spring, [
    "2026-03-08",
    "2026-03-09",
    "2026-03-10",
    "2026-03-11",
    "2026-03-12",
    "2026-03-13",
    "2026-03-14",
  ]);
});

test("a stored instant is read as a local calendar date, not as UTC midnight", () => {
  const dates = meetingDates("9 a.m.", "2026-11-07T00:00:00.000Z", "2026-11-01");
  assert.deepEqual(dates, ["2026-11-07"]);
  assert.equal(weekday("2026-11-07"), 6);
  assert.equal(new Date("2026-11-07T00:00:00.000Z").getDay(), 5);
});

test("a weekly meeting is placed only on a date it actually occurs", () => {
  const term = "Tuesdays 9 a.m., term time";
  assert.deepEqual(meetingDates(term, "2026-11-03", "2026-10-21"), []);
  assert.deepEqual(meetingDates(term, "2026-10-27", "2026-10-21"), ["2026-10-27"]);
  assert.deepEqual(meetingDates(term, "", "2026-10-21"), ["2026-10-27"]);
  assert.deepEqual(meetingDates("Saturdays 7 a.m.", "", "2026-10-21"), ["2026-10-24"]);
  assert.deepEqual(meetingDates("Saturdays 7 a.m.", "", "2026-10-31"), ["2026-10-31"]);
  assert.deepEqual(meetingDates("Saturdays 7 a.m.", "", "2026-11-01"), ["2026-11-07"]);
  assert.deepEqual(meetingDates("Saturdays 7 a.m.", "2026-11-01", "2026-10-31"), []);
  assert.deepEqual(meetingDates("Saturdays 7 a.m.", "2026-10-22", "2026-10-21"), ["2026-10-24"]);
  assert.deepEqual(
    meetingDates("Saturdays, never cancelled for rain", "2026-10-24", "2026-10-21"),
    ["2026-10-24"],
  );
});

test("paused, cancelled, and ended series do not fill later weekdays", () => {
  const time = "Tuesdays 9 a.m.";
  assert.deepEqual(meetingDates("Tuesdays 9 a.m., paused", "2026-10-27", "2026-10-21"), [
    "2026-10-27",
  ]);
  assert.deepEqual(meetingDates("Tuesdays 9 a.m. Cancelled.", "2026-10-27", "2026-10-21"), [
    "2026-10-27",
  ]);
  assert.deepEqual(meetingDates(time, "paused", "2026-10-21"), ["2026-10-27"]);
  assert.deepEqual(meetingDates(time, "cancelled", "2026-10-21"), ["2026-10-27"]);
  assert.deepEqual(meetingDates(time, "2026-10-27", "2026-10-21", { paused: true }), []);
  assert.deepEqual(meetingDates(time, "2026-10-27", "2026-10-21", { cancelled: true }), []);
  assert.deepEqual(meetingDates(time, "2026-10-20", "2026-10-21", { until: "2026-10-20" }), []);
  assert.deepEqual(meetingDates(time, "2026-10-20", "2026-10-21", { until: "2026-10-27" }), [
    "2026-10-27",
  ]);
});

test("ordinal and every-other rules stay on the weekday they name", () => {
  assert.deepEqual(meetingDates("Second Tuesday 7 p.m.", "", "2026-10-08"), ["2026-10-13"]);
  assert.deepEqual(meetingDates("Second Tuesday 7 p.m.", "", "2026-10-21"), []);
  assert.deepEqual(meetingDates("Second and fourth Wednesday, 7 p.m.", "", "2026-10-26"), [
    "2026-10-28",
  ]);
  assert.deepEqual(meetingDates("Every other Tuesday, 7:30 p.m.", "2026-11-03", "2026-10-21"), []);
  assert.deepEqual(meetingDates("Every other Tuesday, 7:30 p.m.", "2026-11-10", "2026-10-21"), [
    "2026-10-27",
  ]);
  assert.equal(weekday("2026-10-13"), 2);
  assert.equal(weekday("2026-10-27"), 2);
  assert.equal(weekday("2026-10-28"), 3);
});

test("an empty code or an invite_invalid refusal names the field error", () => {
  assert.equal(inviteCodeError("  "), INVITE_CODE_ERROR);
  assert.equal(inviteCodeError("ABCD", { code: INVITE_INVALID }), INVITE_CODE_ERROR);
  assert.equal(
    inviteCodeError("ABCD", { code: INVITE_INVALID, message: "That code is not valid." }),
    INVITE_CODE_ERROR,
  );
  assert.equal(inviteCodeError("ABCD", { code: "name_invalid" }), null);
  assert.equal(inviteCodeError("ABCD", { message: "That code is not valid." }), null);
  assert.equal(inviteCodeError("ABCD", { message: "Unicode in your name isn't allowed" }), null);
  assert.equal(inviteCodeError("ABCD", { message: "Check the zip code." }), null);
  assert.equal(inviteCodeError("ABCD"), null);
  assert.equal(INVITE_INVALID, "invite_invalid");
  assert.match(INVITE_CODE_ERROR, /one meeting/);
});

test("?code= opens the code form and an empty code does not", () => {
  assert.deepEqual(entryFromSearch("?code=HELLO"), { mode: "sign-up", code: "HELLO" });
  assert.deepEqual(entryFromSearch("?other=1&code=ab12"), { mode: "sign-up", code: "ab12" });
  assert.deepEqual(entryFromSearch("?code="), { mode: "sign-in", code: "" });
  assert.deepEqual(entryFromSearch("?code=%20"), { mode: "sign-in", code: "" });
  assert.deepEqual(entryFromSearch(""), { mode: "sign-in", code: "" });
});

test("ink and bone are the colour tokens, and the amber theme is gone", () => {
  const css = source("../../styles.css");
  const theme = themeById(OWNER_THEME);
  const tokens: Record<string, string> = {
    "--color-bg": theme.colors.bg,
    "--color-surface": theme.colors.surface,
    "--color-raised": theme.colors.raised,
    "--color-fg": theme.colors.fg,
    "--color-muted": theme.colors.muted,
    "--color-line": theme.colors.line,
    "--color-signal": theme.colors.signal,
    "--color-signal-ink": theme.colors.signalInk,
  };
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(css, new RegExp(`${name}:\\s*${value}`), name);
  }
  assert.match(css, /--color-line-strong:\s*#8a7a62/);
  assert.ok(contrast("#8a7a62", "#241d16") >= 3);
  const load = source("../../components/quorum/load-view.tsx");
  assert.match(load, /<select className="[^"]*border-line-strong[^"]*bg-raised/);
  assert.equal(css.includes("#e6a23c"), false);
  assert.equal(css.includes("#0e0e0c"), false);
  assert.deepEqual(
    THEMES.map((item) => item.id),
    ["appeal", "jerusalem", "gadsden"],
  );
  assert.equal(
    THEMES.some((item) => item.colors.signal === "#e6a23c"),
    false,
  );
  assert.equal(theme.colors.raised, "#241d16");
  assert.equal(theme.colors.signal, "#f0e7d3");
});

test("the week, the door, and the fields use the review's markup", () => {
  const week = source("../../components/board/week-view.tsx");
  const model = source("./model.ts");
  const door = source("../../components/board/door.tsx");
  const account = source("../../components/board/account-door.tsx");
  const bits = source("../../components/quorum/bits.tsx");
  assert.match(week, /dayHeading\(day\.iso, today\)/);
  assert.match(model, /shiftLocalDate\(iso, days\)/);
  assert.match(model, /meetingDates\(card\.time, card\.next, today/);
  const formAt = door.indexOf("<AccountDoor");
  const pitchAt = door.indexOf("Someone brought you here");
  assert.ok(formAt > 0 && formAt < pitchAt);
  assert.match(door, /lg:order-last/);
  assert.equal(door.includes("order-first"), false);
  assert.match(door, /codeFromSearch\(window\.location\.search\)/);
  assert.match(account, /entryFromSearch\(window\.location\.search\)/);
  assert.match(account, /role="alert"/);
  assert.equal(account.includes("aria-live"), false);
  const inputAt = account.indexOf('id="invite-code"');
  const labelClose = account.indexOf("</label>", inputAt);
  const alertAt = account.indexOf('role="alert"');
  assert.ok(inputAt > 0 && labelClose > inputAt && alertAt > labelClose);
  assert.match(account, /text-danger/);
  assert.match(account, /aria-invalid=\{codeError \? true : undefined\}/);
  assert.match(account, /aria-describedby=\{codeError \? INVITE_CODE_ERROR_ID : undefined\}/);
  assert.match(account, /inline-flex min-h-\[44px\] items-center/);
  assert.match(bits, /export const btn =\n {2}"inline-flex min-h-\[44px\]/);
  assert.match(bits, /inline-flex min-h-\[44px\] shrink-0 items-center/);
  assert.match(week, /inline-flex min-h-\[44px\] items-center rounded-sm bg-raised px-3/);
  const find = source("../../components/board/find-view.tsx");
  assert.match(find, /inline-flex min-h-\[44px\] cursor-pointer items-center gap-2/);
  assert.match(bits, /border-line-strong/);
  assert.match(bits, /focus-visible:border-fg/);
  const rooms = source("../../components/board/room-view.tsx");
  assert.match(rooms, /inline-flex min-h-\[44px\] items-center font-semibold text-fg hover:underline/);
  assert.match(
    rooms,
    /inline-flex min-h-\[44px\] items-center gap-2 self-end[\s\S]*className="size-5"/,
  );
  assert.equal(source("./sample.ts").includes("[CHURCH HALL]"), false);
  assert.match(source("./sample.ts"), /Riverview church hall/);
});
