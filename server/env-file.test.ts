import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearOwnerPasswordFile, stripOwnerPassword } from "./env-file.ts";

test("the owner password line is cleared and the rest of the file stays", () => {
  const source = "BOOTSTRAP_OWNER=Josh\nBOOTSTRAP_OWNER_PASSWORD=correct-horse\nBOOTSTRAP_OWNER_EMAIL=josh@example.com\n";
  const cleared = stripOwnerPassword(source);
  assert.equal(cleared.includes("correct-horse"), false);
  assert.match(cleared, /^BOOTSTRAP_OWNER_PASSWORD=$/m);
  assert.match(cleared, /^BOOTSTRAP_OWNER=Josh$/m);
  assert.match(cleared, /^BOOTSTRAP_OWNER_EMAIL=josh@example.com$/m);

  const dir = mkdtempSync(join(tmpdir(), "avouch-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, source);
  assert.equal(clearOwnerPasswordFile(path), true);
  assert.equal(readFileSync(path, "utf8").includes("correct-horse"), false);
});
