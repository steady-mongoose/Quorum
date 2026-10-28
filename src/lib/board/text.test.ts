import assert from "node:assert/strict";
import test from "node:test";
import { isEnglish, looksLikeBlasphemy, looksLikeDoxxing, oneSentence } from "./text.ts";
import { MARK_LABEL, blankDraft, composerCheck } from "./model.ts";

test("a mark reason is one English sentence", () => {
  assert.equal(
    oneSentence("The notice does not say where that came from."),
    "The notice does not say where that came from.",
  );
  assert.equal(oneSentence("No."), null);
  assert.equal(oneSentence("One sentence. And then another."), null);
  assert.equal(oneSentence("This has no stop"), "This has no stop.");
  assert.equal(oneSentence("Two lines. Then more"), null);
});

test("unsupported is labeled No legs, and the stored value stays", () => {
  assert.equal(MARK_LABEL.unsupported, "No legs");
  assert.equal(MARK_LABEL.out_of_scope, "Out of scope");
});

test("doxxing and mockery of God or Christ do not post", () => {
  assert.equal(looksLikeDoxxing("Her phone is 555-014-2291."), true);
  assert.equal(looksLikeDoxxing("Call the shop at noon."), false);
  assert.equal(looksLikeBlasphemy("Jesus is a joke."), true);
  assert.equal(looksLikeBlasphemy("God is not a joke."), false);
  assert.equal(looksLikeBlasphemy("God is good, and the meal is after the service."), false);
  assert.equal(looksLikeBlasphemy("Q&A 4, what is God."), false);
  const base = {
    author: "Maria",
    steward: false,
    posts: [],
    cards: [],
    removals: [],
    now: Date.parse("2026-10-19T12:00:00Z"),
  };
  const draft = {
    ...blankDraft("shop"),
    type: "did" as const,
    on: "2026-10-18",
    reason: "Tom checked them on Thursday.",
  };
  assert.equal(composerCheck({ ...draft, claim: "Her phone is 555-014-2291." }, base).ok, false);
  assert.equal(composerCheck({ ...draft, claim: "Jesus is a joke." }, base).ok, false);
  assert.equal(
    composerCheck({ ...draft, claim: "God is good, and the meal is after the service." }, base).ok,
    true,
  );
});

test("posts are English", () => {
  assert.equal(isEnglish("Heard it on the net, from Dale."), true);
  assert.equal(isEnglish("Слышал это в сети."), false);
  assert.equal(isEnglish("道路が閉まっている。"), false);
});

test("the removal list names every rule, and porn and CSAM are permanent on the first offense", async () => {
  const { PERMANENT_ON_FIRST, permanentOnFirst } = await import("./text.ts");
  const { RULE_LABEL, RULE_SENTENCE } = await import("./model.ts");
  assert.deepEqual([...PERMANENT_ON_FIRST], ["porn", "csam"]);
  assert.equal(permanentOnFirst("porn"), true);
  assert.equal(permanentOnFirst("csam"), true);
  for (const rule of ["threat", "doxxing", "blasphemy"]) assert.equal(permanentOnFirst(rule), false);
  assert.match(RULE_LABEL.threat, /Calls for violence, threats, or plans to attack or intimidate/);
  assert.match(RULE_LABEL.blasphemy, /^Blasphemy/);
  assert.match(RULE_SENTENCE.porn, /suspends the account everywhere on Avouch until an admin reviews it/);
  assert.match(RULE_SENTENCE.csam, /suspends the account everywhere on Avouch until an admin closes it/);
});

test("About's Moderation copy names no person and states the compromise-only appeal", async () => {
  const { readFileSync } = await import("node:fs");
  const about = readFileSync(new URL("../../components/board/about-view.tsx", import.meta.url), "utf8");
  const start = about.indexOf('title: "Moderation"');
  const moderation = about.slice(start, about.indexOf("},", start));
  assert.equal(moderation.includes("Josh"), false, "the public page names a role, not a person");
  assert.match(moderation, /An admin files that report by hand\./);
  assert.match(moderation, /the evidence is held for at least one year\./);
  assert.match(moderation, /A pornography closure is lifted only if the member shows technical evidence that someone else took over the account\./);
});
