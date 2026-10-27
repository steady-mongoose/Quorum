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

const ui = readFileSync(new URL("../../components/board/member-profile.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../profile-client.ts", import.meta.url), "utf8");

test("visibility uses radio fieldsets and keeps All members as the default", () => {
  assert.match(ui, /type="radio"/);
  assert.match(ui, /<legend className="font-semibold text-fg">\{field\.label\}<\/legend>/);
  assert.match(ui, /\?\? "members"/);
  assert.match(ui, /Every field starts at All members/);
  assert.doesNotMatch(ui, /onChange=\{\(event\) => setVisibility/);
});

test("gender stays required and visible, birthdate never shown", () => {
  assert.match(ui, /Members can see it\./);
  assert.match(ui, /Members see your age, never this date/);
  assert.match(ui, /Say whether you are a man or a woman/);
});

test("photo has alt text, remove and replace, upload status and errors", () => {
  assert.match(ui, /alt=\{`Profile photo of \$\{name\}`\}/);
  assert.match(ui, /Remove photo/);
  assert.match(ui, /"Replace photo" : "Add a photo"/);
  assert.match(ui, /Uploading your photo…/);
  assert.match(ui, /over 5 MB/);
  assert.match(ui, /self-start/);
  assert.match(client, /"\/api\/profile\/photo", \{ method: "DELETE"/);
});

test("onboarding can skip optional fields; optional hints and lookup copy", () => {
  assert.match(ui, /Skip optional fields for now/);
  assert.match(ui, /submitWith\(true\)/);
  assert.match(ui, /<Field label="Town" hint="Optional\.">/);
  assert.match(ui, /Member id \(from their profile link\)/);
  assert.match(ui, /setLookupError\(result\.error\)/);
  assert.match(ui, /focus-visible:outline-2/);
});

test("corrections UI requests and decides through the API", () => {
  assert.match(ui, /Ask for a correction/);
  assert.match(ui, /decide\(row\.id, "refuse"\)/);
  assert.match(client, /\/api\/profile\/corrections\?scope=/);
  assert.match(client, /JSON\.stringify\(\{ decision, note \}\)/);
});
