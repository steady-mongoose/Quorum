import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const about = readFileSync(
  new URL("../../components/board/about-view.tsx", import.meta.url),
  "utf8",
);
const prose = about.replace(/\s+/g, " ");

test("About page never shows the owner placeholder", () => {
  assert.ok(!about.includes("[OWNER TO WRITE]"));
});

test("What we stand for carries the mission statement", () => {
  assert.ok(prose.includes("What we stand for"));
  assert.ok(
    prose.includes(
      "{APP_NAME} exists so you can see what is happening in your community, meet face to face, then log off and go do the work. It is not a replacement for other social media, but a tool to help you get away from the machine. We want to rebuild what our founders assumed and modernity dissolved: the family, the parish, the town, and honest work.",
    ),
  );
});

test("the removal rules appear once, under Moderation, and doxxing stays defined", () => {
  assert.equal(prose.split("Five things get a post removed").length - 1, 1);
  assert.ok(!prose.includes("Removed for:"));
  assert.ok(!prose.includes("RULE_SENTENCE"));
  assert.ok(
    prose.includes(
      "Doxxing means publishing a private person's home address, phone number, or other contact so strangers can find them.",
    ),
  );
});
