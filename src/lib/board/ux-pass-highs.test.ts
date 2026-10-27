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
  assert.match(account, /\["email", "password"\]/);
  assert.match(account, /refs\[empty\[0\]\]\.current\?\.focus\(\)/);
  assert.match(account, /id=\{`door-\$\{key\}-error`\} role="alert"/);
  assert.match(account, /"aria-invalid": fieldErrors\[key\] \? true : undefined/);
  assert.match(
    account,
    /"aria-describedby": fieldErrors\[key\] \? `door-\$\{key\}-error` : undefined/,
  );
  for (const key of ["name", "email", "password"]) {
    assert.match(account, new RegExp(`\\{\\.\\.\\.fieldProps\\("${key}"\\)\\}`));
    assert.match(account, new RegExp(`\\{fieldError\\("${key}"\\)\\}`));
  }
  // The empty check runs before any request goes out.
  assert.ok(account.indexOf("empty.length > 0") < account.indexOf("server.signIn("));
});
