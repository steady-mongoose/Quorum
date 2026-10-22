import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT = join(projectRoot(), "scripts/check-frontend-auth.mjs");

function bundle(text) {
  const dir = mkdtempSync(join(tmpdir(), "frontend-auth-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/app.js"), text);
  return dir;
}

async function rejected(args) {
  return execFileAsync(process.execPath, args).then(
    () => {
      throw new Error("expected the check to fail");
    },
    (err) => err,
  );
}

test("a bundle that sets VITE_AUTH_ENABLED to false fails", async () => {
  const dir = bundle("const env = { VITE_AUTH_ENABLED: `false` };");
  const error = await rejected([SCRIPT, dir]);
  assert.equal(error.code, 1);
  assert.match(String(error.stderr), /auth disabled/);
});

test("a quoted false flag fails too", async () => {
  const dir = bundle('{ "VITE_AUTH_ENABLED": "false" }');
  const error = await rejected([SCRIPT, dir]);
  assert.equal(error.code, 1);
  assert.match(String(error.stderr), /auth disabled/);
});

test("a bundle that sets VITE_AUTH_ENABLED to true passes", async () => {
  const dir = bundle("const env = { VITE_AUTH_ENABLED: `true` };");
  const result = await execFileAsync(process.execPath, [SCRIPT, dir]);
  assert.match(result.stdout, /auth enabled/);
});

test("a bundle that never sets the flag fails", async () => {
  const dir = bundle("const authEnabled = true;");
  const error = await rejected([SCRIPT, dir]);
  assert.equal(error.code, 1);
  assert.match(String(error.stderr), /does not set VITE_AUTH_ENABLED to true/);
});

test("an empty client directory fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frontend-auth-empty-"));
  const error = await rejected([SCRIPT, dir]);
  assert.equal(error.code, 1);
  assert.match(String(error.stderr), /No JavaScript/);
});
