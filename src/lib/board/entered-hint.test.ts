import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cookieSaysEntered, enteredCookie } from "./entered-hint.ts";

test("the entered cookie is a plain hint, set and cleared without a secret", () => {
  assert.equal(cookieSaysEntered(""), false);
  assert.equal(cookieSaysEntered("theme=ink"), false);
  assert.equal(cookieSaysEntered("avouch-entered=1"), true);
  assert.equal(cookieSaysEntered("other=1; avouch-entered=1"), true);
  assert.equal(cookieSaysEntered("avouch-entered=1; theme=ink"), true);
  assert.match(enteredCookie(true), /^avouch-entered=1; Path=\/; Max-Age=31536000; SameSite=Lax$/);
  assert.match(enteredCookie(false), /^avouch-entered=; Path=\/; Max-Age=0; SameSite=Lax$/);
  assert.equal(enteredCookie(true).includes("password"), false);
});

test("the signed-in header is chosen from that cookie until the saved board returns", () => {
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /enteredHint/);
  assert.match(app, /hydrated \? false : enteredHint/);
  assert.match(app, /Boolean\(server\.user\) \|\| localEntry \|\| hint/);
  assert.match(app, /member \|\| hint/);
  assert.match(app, /document\.cookie = enteredCookie/);
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.match(root, /beforeLoad: async \(\) => \(\{ enteredHint: await readEnteredHint\(\) \}\)/);
});
