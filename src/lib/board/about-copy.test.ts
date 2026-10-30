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

test("the door and About keep rooms and interest groups apart", () => {
  assert.equal(door.includes("One group each"), false);
  assert.ok(door.includes(`term: "One place each"`));
  assert.ok(door.includes(`term: "Interest groups"`));
  assert.ok(about.includes(`title: "Interest groups"`));
});

test("How it works is grouped, and every entry sits in exactly one group", () => {
  const titles = [...about.slice(about.indexOf("const HOW = ["), about.indexOf("const HOW_HEADINGS")).matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);
  const groups = about.slice(about.indexOf("const HOW_HEADINGS"), about.indexOf("const HOW_GROUPS"));
  const grouped = [...groups.matchAll(/titles: \[([^\]]+)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/"([^"]+)"/g)].map((name) => name[1]),
  );
  assert.equal(titles.length, 15);
  assert.deepEqual([...grouped].sort(), [...titles].sort());
  assert.ok(about.includes(`max-w-prose text-base text-fg/85`));
  assert.ok(source("../../routes/about.tsx").includes("<PublicDocument wide>"));
});
