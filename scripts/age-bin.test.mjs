import assert from "node:assert/strict";
import test from "node:test";
import { ageInstalled } from "./age-bin.mjs";

test("ageInstalled is false when PATH has neither age tool", () => {
  const saved = process.env.PATH;
  process.env.PATH = "/tmp/avouch-no-age";
  try {
    assert.equal(ageInstalled(), false);
  } finally {
    process.env.PATH = saved;
  }
});
