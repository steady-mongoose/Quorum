import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RULE_LABEL, removalConfirm, type HardRule } from "./model.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("every hard rule has confirmation wording with a Cancel", () => {
  for (const rule of Object.keys(RULE_LABEL) as HardRule[]) {
    for (const target of ["post", "message"] as const) {
      const copy = removalConfirm(rule, target);
      assert.equal(copy.cancelLabel, "Cancel");
      assert.ok(copy.title.endsWith("?"), copy.title);
      assert.ok(copy.description.length > 20);
    }
  }
  const csam = removalConfirm("csam", "post", "Maria");
  assert.match(csam.description, /This also suspends Maria everywhere on Avouch until an admin reviews it\./);
  assert.match(csam.description, /without anyone opening it/);
  assert.equal(csam.confirmLabel, "Remove", "only admins ban, so the steward's label stays Remove");
  const porn = removalConfirm("porn", "message", "Maria");
  assert.match(porn.description, /This also suspends Maria everywhere on Avouch until an admin reviews it\./);
  assert.equal(porn.confirmLabel, "Remove");
  assert.match(removalConfirm("threat", "post", "Maria").description, /second removal, this also suspends Maria/);
  for (const rule of Object.keys(RULE_LABEL) as HardRule[]) {
    assert.equal(/\bban\b/i.test(removalConfirm(rule, "post").description), false, rule);
  }
  assert.match(removalConfirm("blasphemy", "post").title, /mocking God or Christ/);
});

test("removal buttons open the dialog instead of removing on one click", () => {
  const room = source("../../components/board/room-view.tsx");
  assert.match(room, /onClick=\{\(\) => setConfirmRule\(rule\)\}/);
  assert.match(room, /removalConfirm\(confirmRule, "post", post\.author, viewerIsAdmin\)/);
  const chat = source("../../components/board/room-chat.tsx");
  assert.match(chat, /onClick=\{\(\) => setConfirm\(\{ id: message\.id, rule \}\)\}/);
  assert.match(chat, /removalConfirm\(confirm\.rule, "message", /);
  // The only removal calls sit behind onConfirm.
  assert.equal((room.match(/void remove\(post\.id/g) ?? []).length, 1);
  assert.equal((chat.match(/removeRoomChat\(roomId/g) ?? []).length, 1);
});

test("the dialog focuses Cancel first", () => {
  const dialog = source("../../components/board/confirm-dialog.tsx");
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
});

test("both removal dialogs are danger-toned, and a removal moves focus and is announced", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f: string) =>
    readFileSync(new URL(`../../components/board/${f}`, import.meta.url), "utf8");
  for (const file of ["room-view.tsx", "room-chat.tsx"]) {
    const source = read(file);
    assert.match(source, /removalConfirm\([^)]*\)\}\s*tone="danger"/, file);
    assert.match(source, /Removed\. The author can appeal\./, file);
    assert.match(source, /className="sr-only" role="status"/, file);
    assert.match(source, /tabIndex=\{-1\}/, file);
    assert.match(source, /\.focus\(\)/, file);
  }
});

test("an admin's removal says the account closes at once; a steward's says an admin reviews it", () => {
  assert.match(removalConfirm("porn", "post", "Maria", true).description, /closes Maria's account everywhere on Avouch at once/);
  assert.equal(/until an admin reviews it/.test(removalConfirm("porn", "post", "Maria", true).description), false);
  assert.match(removalConfirm("porn", "post", "Maria").description, /until an admin reviews it/);
  assert.match(removalConfirm("threat", "post", "Maria", true).description, /second removal, this also closes Maria's account/);
});

test("chat Report and Remove are 44px and named for the message's author", () => {
  const chat = readFileSync(
    new URL("../../components/board/room-chat.tsx", import.meta.url),
    "utf8",
  );
  const report = readFileSync(
    new URL("../../components/board/report-control.tsx", import.meta.url),
    "utf8",
  );
  assert.match(report, /cn\(btnQuiet, "self-start min-h-\[44px\] px-3"\)/);
  assert.match(
    chat,
    /label=\{itemActionName\("Report", "message", message\.author, whenText\(message\.at\), message\.text\)\}/,
  );
  assert.match(chat, /cn\(btnQuiet, "min-h-\[44px\] min-w-\[44px\] px-0"\)/);
  assert.match(
    chat,
    /aria-label=\{itemActionName\("Remove", "message", message\.author, whenText\(message\.at\), message\.text\)\}/,
  );
  assert.match(chat, /cn\(btnGhost, "min-h-\[44px\]"\)[\s\S]*Remove: \{RULE_LABEL\[rule\]\}/);
  assert.match(chat, /cn\(btnQuiet, "min-h-\[44px\]"\)\} onClick=\{\(\) => setRemoving\(null\)\}/);
});

test("accessible names use the visible time, and same-day items differ by excerpt", async () => {
  const { formatWhen, itemActionName } = await import("./model.ts");
  const now = new Date(2026, 9, 29, 14, 0, 0).getTime();
  const fiveAgo = now - 5 * 60 * 1000;
  const recent = itemActionName(
    "Report",
    "message",
    "Mark",
    formatWhen(fiveAgo, now),
    "See you at the bench",
  );
  assert.equal(recent, 'Report message from Mark, 5m ago: "See you at the bench"');

  // Both older than a day, same author, same calendar day: the visible time
  // reads the same for both, so the excerpt is what tells them apart.
  const morning = new Date(2026, 9, 26, 9, 15, 4).getTime();
  const evening = new Date(2026, 9, 26, 18, 40, 51).getTime();
  const mWhen = formatWhen(morning, now);
  const eWhen = formatWhen(evening, now);
  assert.equal(mWhen, eWhen, "the visible time is the same for both");
  const a = itemActionName("Report", "message", "Mark", mWhen, "See you at the bench");
  const b = itemActionName("Report", "message", "Mark", eWhen, "Bring the saw");
  assert.equal(a, `Report message from Mark, ${mWhen}: "See you at the bench"`);
  assert.notEqual(a, b, "same day: the excerpt differs");
  assert.doesNotMatch(a, /:\d\d:\d\d/, "no seconds in the name");
  const removeName = itemActionName("Remove", "message", "Mark", eWhen, "Bring the saw");
  assert.equal(removeName, `Remove message from Mark, ${eWhen}: "Bring the saw"`);
  const long = itemActionName("Remove", "message", "Mark", mWhen, "word ".repeat(30));
  assert.ok(long.length < 120 && long.endsWith('…"'), "long text is cut to a short excerpt");
  const p1 = itemActionName("Report", "post", "Mark", mWhen, "Fixing the porch Saturday");
  const p2 = itemActionName("Report", "post", "Mark", eWhen, "Fence repair Sunday");
  assert.notEqual(p1, p2);

  const chat = readFileSync(
    new URL("../../components/board/room-chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(chat, /const now = useNow\(\);/);
  assert.match(chat, /formatWhen\(at, now\.getTime\(\)\)/);
  assert.match(chat, /<When at=\{message\.at\} format=\{formatWhen\} \/>/);
  const view = readFileSync(
    new URL("../../components/board/room-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(view, /const now = useNow\(\);/);
  assert.match(
    view,
    /postWhen = post\.on \? formatDate\(post\.on\) : now \? formatWhen\(post\.at, now\.getTime\(\)\)/,
  );
  assert.match(
    view,
    /label=\{itemActionName\("Report", "post", post\.author, postWhen, post\.claim\)\}/,
  );
});
