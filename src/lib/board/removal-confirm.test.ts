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
