import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  assert.equal(clearOwnerPasswordFile(path), "cleared");
  assert.equal(readFileSync(path, "utf8").includes("correct-horse"), false);
});

test("a clean env file is not rewritten and no password line is appended", () => {
  const clean = "POSTGRES_PASSWORD=db\n";
  const empty = "BOOTSTRAP_OWNER_PASSWORD=\nPOSTGRES_PASSWORD=db\n";
  const quoted = 'BOOTSTRAP_OWNER_PASSWORD=""\n';
  assert.equal(stripOwnerPassword(clean), clean);
  assert.equal(stripOwnerPassword(empty), empty);
  assert.equal(stripOwnerPassword(quoted), quoted);
  assert.equal(stripOwnerPassword(""), "");

  const dir = mkdtempSync(join(tmpdir(), "avouch-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, clean);
  const before = statSync(path).mtimeMs;
  assert.equal(clearOwnerPasswordFile(path), "clean");
  assert.equal(readFileSync(path, "utf8"), clean);
  assert.equal(statSync(path).mtimeMs, before);
});
