// Copy guard (Design #126 review 5713515017, H1). Josh, Oct 30 7:55 AM ET: an
// admin sees names and marks who came only where they really host or steward.
// No member-facing string may say admins see the lists or record who came, or
// that only the host records who came (stewards do too).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url).pathname;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|routeTree\.gen/.test(name)) out.push(path);
  }
  return out;
}

/** Source with comments removed and whitespace collapsed, so only strings and JSX text remain to match. */
function copy(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const NEAR = 160;
const ADMIN_CLAIM = /\badmins? (?:also )?(?:see|sees|can see|record|records|mark|marks)\b(?! only\b)|\band the admins\b|\bor an admin\b/gi;
const HOST_ONLY = /\bonly the host (?:records|marks)\b|\bthe host (?:also )?records who came\b|\blets the host record who came\b/gi;

function hits(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(ADMIN_CLAIM)) {
    const at = match.index ?? 0;
    const window = text.slice(Math.max(0, at - NEAR), at + match[0].length + NEAR);
    if (/\bgoing\b|\bcame\b|\bcoming\b|\bevery list\b|roll/i.test(window)) found.push(window.trim());
  }
  for (const match of text.matchAll(HOST_ONLY)) found.push(match[0]);
  return found;
}

test("the guard catches the old wording", () => {
  assert.ok(hits(copy('"The host, the room\'s stewards, and the admins see who is going."')).length > 0);
  assert.ok(hits(copy('"Only the host or an admin records who came."')).length > 0);
  assert.ok(hits(copy('"In a room that takes roll, the host records who came."')).length > 0);
  assert.ok(hits(copy("<p>Admins see who came.</p>")).length > 0);
  assert.equal(hits(copy('"Other admins see only totals."')).length, 0);
  assert.equal(hits(copy('// admins see who is going (a comment)')).length, 0);
});

test("no member-facing string says admins see the lists or record who came, or that only the host records", () => {
  const bad: string[] = [];
  for (const path of files(root)) {
    for (const hit of hits(copy(readFileSync(path, "utf8")))) bad.push(`${relative(root, path)}: ${hit}`);
  }
  assert.deepEqual(bad, []);
});

test("the copy says what Josh's 7:55 rule says", () => {
  const door = readFileSync(join(root, "components/board/door.tsx"), "utf8");
  assert.ok(door.includes("Say you're going to a gathering. You see only your own answer. The host and the room's stewards see who is going."));
  assert.ok(door.includes("In a room that takes roll, the host or a steward records who came. Only they see the list. You see your own."));
  const about = readFileSync(join(root, "components/board/about-view.tsx"), "utf8");
  assert.ok(about.includes("The host sees who is coming to their own gathering, and a room\\'s stewards see who is coming and who came in that room. Other admins see only totals, with small counts hidden. Press \"I\\'ll be there\""));
  assert.ok(about.includes("Who is going and who came stay with the host and the room's stewards."));
  const options = readFileSync(join(root, "lib/board/room-options.ts"), "utf8");
  assert.ok(options.includes("After a gathering, the host or a steward records who came. Only they see it. You see your own."));
});
