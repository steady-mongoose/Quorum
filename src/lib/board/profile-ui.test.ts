import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { linkText } from "../profile-links.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("a profile link always shows its real host and opens as untrusted", () => {
  assert.equal(linkText({ url: "https://evil.example.net/x", label: "https://bank.com" }), "https://bank.com (evil.example.net)");
  assert.equal(linkText({ url: "https://church.org/", label: "" }), "church.org");
  assert.equal(linkText({ url: "https://church.org/", label: "Our parish" }), "Our parish (church.org)");
  const ui = source("../../components/board/member-profile.tsx");
  assert.match(ui, /rel="ugc nofollow noopener noreferrer"/);
  assert.match(ui, /\{linkText\(link\)\}/);
  assert.equal(ui.includes("{link.label || link.url}"), false);
});
