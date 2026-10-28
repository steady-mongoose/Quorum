import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("aria-disabled buttons get the disabled look site-wide", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const rule = css.match(/button\[aria-disabled="true"\],\s*\[role="button"\]\[aria-disabled="true"\]\s*\{([^}]*)\}/);
  assert.ok(rule, "missing [aria-disabled=\"true\"] button rule");
  assert.match(rule[1], /opacity:\s*0\.5/);
  assert.match(rule[1], /cursor:\s*not-allowed/);
});
