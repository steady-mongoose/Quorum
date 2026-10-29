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
      "Avouch exists so you can see what is happening in your community, meet face to face, then log off and go do the work. It is not a replacement for other social media, but a tool to help you get away from the machine. We want to rebuild what our founders assumed and modernity dissolved: the family, the parish, the town, and honest work.",
    ),
  );
});

test("About says a second removal suspends the account pending an admin, not that it closes it", () => {
  assert.ok(prose.includes("A second removal by a steward suspends the account everywhere on Avouch until an admin reviews it."));
  assert.equal(prose.includes("A second removal closes the account"), false);
  assert.equal(prose.includes("A second removal suspends the account. "), false);
  assert.ok(prose.includes("When an admin makes either removal, the account is closed at once."));
});

test("About says a pornography closure is appealable only if someone else took over the account", () => {
  assert.ok(prose.includes("A pornography closure can be appealed only with proof that someone else took over the account."));
  assert.equal(prose.includes("account was compromised"), false);
});
