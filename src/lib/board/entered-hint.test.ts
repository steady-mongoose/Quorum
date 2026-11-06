import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cookieSaysEntered, enteredCookie, writeEnteredCookie } from "./entered-hint.ts";

test("the entered cookie is a plain hint, set and cleared without a secret", () => {
  assert.equal(cookieSaysEntered(""), false);
  assert.equal(cookieSaysEntered("theme=ink"), false);
  assert.equal(cookieSaysEntered("avouch-entered=1"), true);
  assert.equal(cookieSaysEntered("other=1; avouch-entered=1"), true);
  assert.equal(cookieSaysEntered("avouch-entered=1; theme=ink"), true);
  assert.match(enteredCookie(true), /^avouch-entered=1; Path=\/; Max-Age=31536000; SameSite=Lax$/);
  assert.match(enteredCookie(false), /^avouch-entered=; Path=\/; Max-Age=0; SameSite=Lax$/);
  assert.equal(enteredCookie(true).includes("password"), false);
  const jar: { cookie: string } = { cookie: "" };
  const previous = globalThis.document;
  globalThis.document = { get cookie() { return jar.cookie; }, set cookie(value: string) { jar.cookie = value; } } as Document;
  try {
    writeEnteredCookie(true);
    assert.equal(cookieSaysEntered(jar.cookie), true);
    writeEnteredCookie(false);
    assert.equal(jar.cookie.includes("Max-Age=0"), true);
  } finally {
    globalThis.document = previous;
  }
});

test("the signed-in header is chosen from that cookie until the saved board returns", () => {
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /function useInitialEntered\(\)/);
  assert.match(app, /function effectiveEntered\(/);
  assert.match(app, /writeEnteredCookie\(useBoard\.getState\(\)\.member\)/);
  assert.match(app, /Boolean\(server\.user\) \|\| localEntry/);
  assert.match(app, /const initialEntered = useInitialEntered\(\)/);
  assert.match(app, /effectiveEntered\(/);
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.match(root, /beforeLoad: async \(\) => \(\{ enteredHint: await readEnteredHint\(\) \}\)/);
  assert.doesNotMatch(app, /initialSection/);
  assert.doesNotMatch(app, /to: "\/you"/);
});
