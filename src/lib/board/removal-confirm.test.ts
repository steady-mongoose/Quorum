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
  const csam = removalConfirm("csam", "post");
  assert.match(csam.description, /banned from the whole site/);
  assert.match(csam.description, /without anyone opening it/);
  assert.equal(csam.confirmLabel, "Remove and ban");
  assert.match(removalConfirm("blasphemy", "post").title, /mocking God or Christ/);
});

test("removal buttons open the dialog instead of removing on one click", () => {
  const room = source("../../components/board/room-view.tsx");
  assert.match(room, /onClick=\{\(\) => setConfirmRule\(rule\)\}/);
  assert.match(room, /removalConfirm\(confirmRule, "post"\)/);
  const chat = source("../../components/board/room-chat.tsx");
  assert.match(chat, /onClick=\{\(\) => setConfirm\(\{ id: message\.id, rule \}\)\}/);
  assert.match(chat, /removalConfirm\(confirm\.rule, "message"\)/);
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
    /label=\{itemActionName\("Report", "message", message\.author, message\.at, message\.text\)\}/,
  );
  assert.match(chat, /cn\(btnQuiet, "min-h-\[44px\] min-w-\[44px\] px-0"\)/);
  assert.match(
    chat,
    /aria-label=\{itemActionName\("Remove", "message", message\.author, message\.at, message\.text\)\}/,
  );
  assert.match(chat, /cn\(btnGhost, "min-h-\[44px\]"\)[\s\S]*Remove: \{RULE_LABEL\[rule\]\}/);
  assert.match(chat, /cn\(btnQuiet, "min-h-\[44px\]"\)\} onClick=\{\(\) => setRemoving\(null\)\}/);
});

test("two messages or posts from the same author get distinct accessible names", async () => {
  const { itemActionName } = await import("./model.ts");
  // Both older than a day, same author, same calendar day: the rounded
  // display time would read "Mon, Oct 26" for both.
  const morning = new Date(2026, 9, 26, 9, 15, 4).getTime();
  const evening = new Date(2026, 9, 26, 18, 40, 51).getTime();
  const a = itemActionName("Report", "message", "Mark", morning, "See you at the bench");
  const b = itemActionName("Report", "message", "Mark", evening, "See you at the bench");
  assert.match(a, /^Report message from Mark, Oct 26, 9:15:04\sAM: "See you at the bench"$/);
  assert.notEqual(a, b, "same day, same text: the exact time still differs");
  const sameSecond = itemActionName("Report", "message", "Mark", morning, "Bring the saw");
  assert.notEqual(a, sameSecond, "same second: the excerpt differs");
  assert.doesNotMatch(a, /ago|Mon,/);
  const long = itemActionName("Remove", "message", "Mark", morning, "word ".repeat(30));
  assert.ok(long.length < 120 && long.endsWith('…"'), "long text is cut to a short excerpt");
  const p1 = itemActionName("Report", "post", "Mark", morning, "Fixing the porch Saturday");
  const p2 = itemActionName("Report", "post", "Mark", evening, "Fixing the porch Saturday");
  assert.notEqual(p1, p2);
  const view = readFileSync(
    new URL("../../components/board/room-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    view,
    /label=\{itemActionName\("Report", "post", post\.author, post\.at, post\.claim\)\}/,
  );
});
