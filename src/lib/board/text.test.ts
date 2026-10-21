import assert from "node:assert/strict";
import test from "node:test";
import { isEnglish, oneSentence } from "./text.ts";

test("a mark reason is one English sentence", () => {
  assert.equal(
    oneSentence("The notice does not say where that came from."),
    "The notice does not say where that came from.",
  );
  assert.equal(oneSentence("No."), null);
  assert.equal(oneSentence("One sentence. And then another."), null);
  assert.equal(oneSentence("This has no stop"), null);
});

test("posts are English", () => {
  assert.equal(isEnglish("Heard it on the net, from Dale."), true);
  assert.equal(isEnglish("Слышал это в сети."), false);
  assert.equal(isEnglish("道路が閉まっている。"), false);
});
