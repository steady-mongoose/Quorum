import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cookieSaysEntered,
  enteredCookie,
  enteredHintDecision,
  writeEnteredCookie,
} from "./entered-hint.ts";

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
  assert.match(app, /enteredHintDecision\(/);
  assert.match(app, /writeEnteredCookie\(next\)/);
  assert.doesNotMatch(app, /writeEnteredCookie\(useBoard\.getState\(\)\.member\)/);
  assert.match(app, /server\.mode === "pending"\s*\?\s*false/);
  assert.match(app, /Boolean\(server\.user\) \|\| localEntry/);
  assert.match(app, /const initialEntered = useInitialEntered\(\)/);
  assert.match(app, /effectiveEntered\(/);
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.match(root, /beforeLoad: async \(\) => \(\{ enteredHint: await readEnteredHint\(\) \}\)/);
  assert.doesNotMatch(app, /initialSection/);
  assert.doesNotMatch(app, /to: "\/you"/);
});

test("an expired live session clears the hint; demo, sign-in, and an outage do not", () => {
  const base = {
    hydrated: true,
    mode: "live" as const,
    configured: true,
    user: false,
    localEntry: false,
    member: true,
  };
  assert.equal(enteredHintDecision(base), false, "expired live session clears it");
  assert.equal(enteredHintDecision({ ...base, user: true }), true, "a live sign-in keeps it");
  assert.equal(enteredHintDecision({ ...base, localEntry: true }), true, "a local entry keeps it");
  assert.equal(enteredHintDecision({ ...base, hydrated: false }), null, "wait until the saved board is back");
  assert.equal(enteredHintDecision({ ...base, mode: "pending" }), null, "still checking the server");
  assert.equal(
    enteredHintDecision({ ...base, mode: "demo" }),
    null,
    "an API outage does not clear it",
  );
  assert.equal(
    enteredHintDecision({ ...base, mode: "demo", configured: false, member: true }),
    true,
    "the browser demo follows membership",
  );
  assert.equal(
    enteredHintDecision({ ...base, mode: "demo", configured: false, member: false }),
    false,
    "signing out of the demo clears it",
  );
});
