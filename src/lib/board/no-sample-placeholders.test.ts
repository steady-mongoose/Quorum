import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Josh, Oct 29 2026: a new account must not see example names, households,
 * churches, trades, or other sample data in its fields. A label above a field
 * gives the guidance instead.
 */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

const files = sources("src/components").map((path) => ({ path, text: readFileSync(path, "utf8") }));

const SAMPLES = [
  "McMullin",
  "Epiphany",
  "Electrician",
  "Electrical, residential",
  "Josh",
  "Woodshop",
  "Marcus Aurelius",
  "Meditations",
  "Book one",
  "chapters 5 and 6",
  "Dinners this week",
  "First Monday",
  '"FL"',
];

test("no field placeholder in the app carries a sample name, place, trade, or value", () => {
  for (const { path, text } of files) {
    const placeholders = [...text.matchAll(/placeholder=(\{`[^`]*`\}|"[^"]*"|\{"[^"]*"\})/g)].map((m) => m[1]);
    for (const value of placeholders) {
      for (const sample of SAMPLES) {
        assert.equal(
          value.toLowerCase().includes(sample.toLowerCase().replaceAll('"', "")),
          false,
          `${path} has placeholder ${value}, which reads as sample data (${sample})`,
        );
      }
    }
  }
});

test("the card form passes no sample value to its text fields", () => {
  const find = readFileSync("src/components/board/find-view.tsx", "utf8");
  for (const sample of ["Electrical, residential", "Dinners this week", "First Monday 7:30"]) {
    assert.equal(find.includes(sample), false, `find-view.tsx still has "${sample}"`);
  }
});

test("a new member's own profile fields start empty, with labels and no placeholders", () => {
  const profile = readFileSync("src/components/board/profile-view.tsx", "utf8");
  assert.equal(/placeholder=/.test(profile), false, "profile-view.tsx has no placeholder text");
  for (const label of ["Name, as people know you", "Household", "Church", "Trade"]) {
    assert.ok(profile.includes(label), `the ${label} label stays`);
  }
  const store = readFileSync("src/lib/board/store.ts", "utf8");
  assert.match(store, /EMPTY_PROFILE: Profile = \{ household: "", parish: "", trade: "" \}/);
});

test("the browser tab title never takes the household or another profile value", () => {
  const heads = readFileSync("src/lib/board/route-heads.ts", "utf8");
  assert.equal(/household|profile\.|useBoard/.test(heads), false, "route-heads.ts reads no profile");
  assert.match(heads, /\{ title: APP_NAME \}/, "the default tab title is the app name");
  for (const { path, text } of files) {
    assert.equal(/document\.title\s*=/.test(text), false, `${path} sets document.title`);
  }
});
