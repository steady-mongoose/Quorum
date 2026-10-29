import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("UX pass: every text field uses the strong line for its border", () => {
  const files = [
    "../../components/quorum/bits.tsx",
    "../../components/quorum/desk-view.tsx",
    "../../components/quorum/cell-view.tsx",
    "../../components/board/stats-view.tsx",
  ];
  assert.match(source(files[0]), /fieldClass =\s+"[^"]*border border-line-strong /);
  for (const file of files.slice(1)) {
    const s = source(file);
    for (const m of s.matchAll(/<(select|input|textarea)\b[^>]*className="([^"]*)"/g)) {
      if (/\bborder\b/.test(m[2])) assert.match(m[2], /border-line-strong/, `${file}: ${m[2]}`);
    }
  }
});

test("UX pass: an empty sign-in submit names each empty field and focuses the first", () => {
  const account = source("../../components/board/account-door.tsx");
  assert.match(account, /email: "Please enter your email\."/);
  assert.match(account, /password: "Please enter your password\."/);
  assert.match(account, /name: "Please enter your name\."/);
  // Both sets of errors: one line under each empty field, and the summary alert.
  assert.match(account, /SIGN_IN_EMPTY_ERROR = "Enter your email and password\."/);
  assert.match(account, /setBlank\(\{ name: nameBlank, email: emailBlank, password: passwordBlank \}\)/);
  assert.match(account, /focusFirst\(\[\s*nameBlank \? nameRef\.current/);
  assert.match(account, /id=\{`door-\$\{key\}-error`\} className="text-sm text-danger"/);
  for (const key of ["name", "email", "password"]) {
    assert.match(
      account,
      new RegExp(`describedBy\\(\\s*blank\\.${key} && "door-${key}-error",\\s*summaryId\\("${key}"\\),?\\s*\\)`),
    );
  }
  // The summary is built from the empty fields, and sits above the first field.
  assert.match(account, /emptyFieldsSummary\(emptyKeys\)/);
  assert.ok(account.indexOf("id={SIGN_IN_ERROR_ID}") < account.indexOf('id="sign-up-name"'));
  for (const key of ["name", "email", "password"]) {
    assert.match(account, new RegExp(`\\{(mode === "sign-up" \\? )?fieldError\\("${key}"\\)`));
  }
  // The empty check runs before any request goes out.
  assert.ok(account.indexOf("if (nameBlank || emailBlank || passwordBlank)") < account.indexOf("server.signIn("));
});
