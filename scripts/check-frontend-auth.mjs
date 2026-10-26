#!/usr/bin/env node
/**
 * Fail when a production frontend build left auth off.
 *
 * `deploy-frontend.yml` sets `VITE_AUTH_ENABLED=true`. Vite bakes that value
 * into the client and server bundles. This fails if any built JavaScript
 * sets the flag to "false", or if the build never sets it to "true".
 *
 *   node scripts/check-frontend-auth.mjs [bundle-dir]
 *
 * The directory defaults to dist/frontend.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FLAG = /VITE_AUTH_ENABLED["']?\s*:\s*[`"'](true|false)[`"']/g;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const workflow = readFileSync(join(root, ".github/workflows/deploy-frontend.yml"), "utf8");
if (!/VITE_AUTH_ENABLED:\s*"true"/.test(workflow)) {
  fail('deploy-frontend.yml must set VITE_AUTH_ENABLED: "true".');
}

const bundleDir = process.argv[2] ?? join(root, "dist/frontend");
if (!existsSync(bundleDir)) fail(`No frontend bundle at ${bundleDir}.`);
const files = [];
walk(bundleDir, files);
if (files.length === 0) fail(`No JavaScript in ${bundleDir}.`);
const disabled = [];
let enabled = false;
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(FLAG)) {
    if (match[1] === "false") disabled.push(file);
    if (match[1] === "true") enabled = true;
  }
}
if (disabled.length > 0) {
  fail(`The built bundle has auth disabled:\n${[...new Set(disabled)].join("\n")}`);
}
if (!enabled) fail("The built bundle does not set VITE_AUTH_ENABLED to true.");
console.log("Built bundle has auth enabled.");
