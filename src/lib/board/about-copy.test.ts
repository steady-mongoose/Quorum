import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const about = source("../../components/board/about-view.tsx");
const door = source("../../components/board/door.tsx");
const dmCopy = source("../e2ee/copy.ts");

test("About says rooms are joined only by an invite from inside the app", () => {
  assert.match(about, /After that, you join each room only by an invite from someone inside the app\./);
});

test("About says every room has a steward and cannot lose its last one", () => {
  assert.match(about, /title: "Stewards"/);
  assert.match(about, /Every room has a steward who keeps it on track\./);
  assert.match(about, /The last one can step down only by naming someone in the room to take over\./);
});

test("the door and About describe messaging the way the server enforces it", () => {
  // mayMessage in server/dm/store.ts allows a verified meeting together, or a
  // room both people are in. A block either way stops both.
  assert.match(
    door,
    /You can message people in your rooms and people you've been at a gathering with\. No one else can message you, and you can block anyone\./,
  );
  assert.equal(door.includes("shared a room with"), false);
  assert.match(
    dmCopy,
    /People in your rooms and people who have been to the same meeting as you can message you\. Nobody else can\./,
  );
  assert.match(dmCopy, /A new member of a room waits three days before starting a conversation there\./);
  assert.match(dmCopy, /You can block anyone, and they are not told\./);
  assert.match(dmCopy, /Only people from the same meeting can see your profile\./);
});

test("the About rule list lowercases only the first letter, so God and Christ keep their capitals", () => {
  assert.equal(about.includes("RULE_LABEL[rule].toLowerCase()"), false);
  assert.match(about, /return label\.charAt\(0\)\.toLowerCase\(\) \+ label\.slice\(1\);/);
});
