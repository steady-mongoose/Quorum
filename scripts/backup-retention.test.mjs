import assert from "node:assert/strict";
import test from "node:test";
import { dumpsToDelete } from "./backup-retention.mjs";

const now = Date.parse("2026-10-19T03:15:00Z");

test("dumps older than the retention window are deleted and newer ones stay", () => {
  const names = [
    "avouch-20261001T031500Z.dump.enc",
    "avouch-20261005T031500Z.dump.enc",
    "avouch-20261018T031500Z.dump",
    "avouch-20261019T031500Z.dump.enc",
    "notes.txt",
  ];
  // 2026-10-05 is exactly 14 days old, so it stays. Older than that goes.
  assert.deepEqual(dumpsToDelete(names, now, 14), ["avouch-20261001T031500Z.dump.enc"]);
});

test("a retention under one day is refused", () => {
  assert.throws(() => dumpsToDelete([], now, 0), /at least 1/);
});
