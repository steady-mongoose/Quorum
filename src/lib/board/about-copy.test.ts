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
  // listPeers in server/dm/store.ts pairs people by verified attendance at the
  // same meeting, not by belonging to the same room.
  assert.match(door, /You can message people you've been at a gathering with\. No one else can message you\./);
  assert.equal(door.includes("shared a room with"), false);
  assert.match(dmCopy, /People who have been to the same meeting as you can see your profile and message you\. Nobody else can\./);
});

test("the About rule list lowercases only the first letter, so God and Christ keep their capitals", () => {
  assert.equal(about.includes("RULE_LABEL[rule].toLowerCase()"), false);
  assert.match(about, /return label\.charAt\(0\)\.toLowerCase\(\) \+ label\.slice\(1\);/);
});
