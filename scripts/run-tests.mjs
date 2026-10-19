#!/usr/bin/env node
/**
 * Runs the template script tests and the app/server tests.
 * The second suite always starts, even when the first suite fails, so a
 * pre-existing script failure cannot hide the closed-test tests.
 */
import { spawn } from "node:child_process";

const appTests = [
  "src/lib/api-base.test.ts",
  "src/lib/api-mode.test.ts",
  "src/lib/account-api.test.ts",
  "src/lib/app-data/app-data.test.ts",
  "src/lib/app-data/readiness-schedule.test.ts",
  "src/lib/auth/gate-identity.test.ts",
  "src/lib/auth/sign-in-gate.test.ts",
  "src/lib/e2ee/limits.test.ts",
  "src/lib/e2ee/vault-wrap.test.ts",
  "src/lib/e2ee/protocol.test.ts",
  "src/lib/e2ee/media-strip.test.ts",
  "src/lib/e2ee/media-crypto.test.ts",
  "src/lib/e2ee/media-bridge.test.ts",
  "server/dm/store.test.ts",
  "server/dm/mailbox.integration.test.ts",
  "workers/frontend.test.ts",
  "server/origins.test.ts",
  "server/proxy.test.ts",
  "server/rate-limit.test.ts",
  "server/env-file.test.ts",
  "server/http.test.ts",
  "server/closed-test/rules.test.ts",
  "server/closed-test/store.test.ts",
  "server/closed-test/schema.test.ts",
  "server/closed-test/auth.integration.test.ts",
];

const suites = [
  [process.execPath, ["--test", "scripts/**/*.test.mjs"]],
  [process.execPath, ["--experimental-strip-types", "--test", ...appTests]],
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const only = process.argv[2];
const selected =
  only === "app" ? suites.slice(1) : only === "scripts" ? suites.slice(0, 1) : suites;
if (only && only !== "app" && only !== "scripts") {
  console.error("Usage: node scripts/run-tests.mjs [app|scripts]");
  process.exit(1);
}

let failed = 0;
for (const [command, args] of selected) {
  const code = await run(command, args);
  if (code !== 0) failed = code;
}
process.exit(failed);
