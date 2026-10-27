import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RULE_SENTENCE } from "./model.ts";

const SUMMARY =
  "A second removal by a steward suspends the account everywhere on Avouch until an admin reviews it. Pornography or child sexual abuse material removed by a steward suspends the account the first time, until an admin reviews it. When an admin makes either removal, the account is closed at once.";

test("pornography and CSAM rule sentences say who suspends and who closes, with no brackets", () => {
  assert.equal(
    RULE_SENTENCE.porn,
    "Pornography is removed. A steward's removal suspends the account everywhere on Avouch until an admin reviews it. An admin's removal closes it at once.",
  );
  assert.equal(
    RULE_SENTENCE.csam,
    "Child sexual abuse material is removed at once and the evidence is held for one year, pending counsel. A steward's removal suspends the account everywhere on Avouch until an admin closes it. An admin's removal closes it at once.",
  );
  for (const sentence of Object.values(RULE_SENTENCE)) assert.doesNotMatch(sentence, /[()]/);
});

test("About and the Moderation explainer carry the same removal summary and keep the appeal line", () => {
  const about = readFileSync(new URL("../../components/board/about-view.tsx", import.meta.url), "utf8");
  assert.equal(about.split(SUMMARY).length - 1, 2);
  assert.doesNotMatch(about, /and an admin then reviews it/);
  assert.match(about, /a pornography closure can be appealed only with proof that someone else took over the account/);
  assert.match(about, /A pornography closure can be appealed\s+only with proof that someone else took over the account\./);
});
