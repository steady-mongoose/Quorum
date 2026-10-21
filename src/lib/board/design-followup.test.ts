import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  blankDraft,
  composerCheck,
  composerErrorId,
  composerSubmitsOnEnter,
  draftHasWriting,
  postButtonLabel,
  type CheckContext,
} from "./model.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const ctx: CheckContext = {
  author: "Josh",
  steward: false,
  posts: [],
  cards: [],
  removals: [],
  now: Date.now(),
};

test("post buttons use plain wording", () => {
  assert.equal(postButtonLabel("asked"), "Post question");
  assert.equal(postButtonLabel("did"), "Post what you did");
  assert.equal(postButtonLabel("noted"), "Post notice");
  assert.equal(postButtonLabel("hosted"), "Post meeting");
  assert.equal(postButtonLabel("saw"), "Post bulletin");
  const room = source("../../components/board/room-view.tsx");
  assert.equal(room.includes("File {type.label}"), false);
  assert.equal(room.includes("File Asked"), false);
});

test("Enter posts a single-line field, and Ctrl or Cmd+Enter posts from a textarea", () => {
  const plain = { meta: false, ctrl: false, shift: false };
  assert.equal(composerSubmitsOnEnter("Enter", plain, false), true);
  assert.equal(composerSubmitsOnEnter("Enter", { ...plain, shift: true }, false), false);
  assert.equal(composerSubmitsOnEnter("Enter", plain, true), false);
  assert.equal(composerSubmitsOnEnter("Enter", { ...plain, ctrl: true }, true), true);
  assert.equal(composerSubmitsOnEnter("Enter", { ...plain, meta: true }, true), true);
  assert.equal(
    composerSubmitsOnEnter("Enter", { meta: true, ctrl: false, shift: true }, true),
    false,
  );
  assert.equal(composerSubmitsOnEnter("a", plain, false), false);
});

test("Clear asks only when the draft has writing", () => {
  const draft = { ...blankDraft("shop"), type: "asked" as const };
  assert.equal(draftHasWriting(draft), false);
  assert.equal(draftHasWriting({ ...draft, claim: "   " }), false);
  assert.equal(draftHasWriting({ ...draft, claim: "Where is the hall?" }), true);
  assert.equal(draftHasWriting({ ...draft, reason: "I looked on the card." }), true);
  assert.equal(draftHasWriting({ ...draft, media: [{ id: "pic", kind: "image" }] }), true);
  assert.equal(draftHasWriting({ ...draft, on: "2020-01-01" }), true);
});

test("composer errors name the field they belong to", () => {
  const missing = composerCheck({ ...blankDraft("shop"), type: "asked" }, ctx);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.fields?.claim, ["Missing: the question."]);
  assert.deepEqual(missing.fields?.reason, ["Missing: what you already tried."]);
  assert.equal(composerErrorId("claim"), "composer-claim-error");
  assert.equal(composerErrorId("reason"), "composer-reason-error");

  const dated = composerCheck(
    {
      ...blankDraft("shop"),
      type: "did",
      claim: "Sharpened the chisels in the shop.",
      reason: "Tom checked them on Thursday.",
      on: "",
    },
    ctx,
  );
  assert.deepEqual(dated.fields?.on, ["Add the date."]);
  assert.equal(dated.fields?.claim, undefined);

  const threat = composerCheck(
    {
      ...blankDraft("shop"),
      type: "asked",
      claim: "I will burn that hall down.",
      reason: "I already asked the host.",
    },
    ctx,
  );
  assert.equal(
    threat.stops.filter((stop) => stop === "That reads as a threat and will not post.").length,
    1,
  );
  assert.deepEqual(threat.fields?.claim, ["That reads as a threat and will not post."]);
  assert.equal(threat.fields?.reason, undefined);
});

test("the clear dialog and the post form use the review markup", () => {
  const about = source("../../components/board/about-view.tsx");
  const dialog = source("../../components/board/confirm-dialog.tsx");
  const room = source("../../components/board/room-view.tsx");
  const app = source("../../components/board/app.tsx");
  const week = source("../../components/board/week-view.tsx");
  const css = source("../../styles.css");

  assert.match(css, /--color-line-strong:\s*#857c6f/);
  assert.match(about, /Clear the sample week\?/);
  assert.match(about, /Everything here will be removed\./);
  assert.match(about, /confirmLabel="Clear it"/);
  assert.match(about, /cancelLabel="Keep it"/);
  assert.match(about, /clearLocalBoard\(\)/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{descriptionId\}/);
  assert.match(dialog, /min-h-\[44px\]/);

  assert.match(room, /<form/);
  assert.match(room, /onSubmit=\{\(event\)/);
  assert.match(room, /type="submit"/);
  assert.match(room, /composerSubmitsOnEnter/);
  assert.match(room, /aria-invalid=\{/);
  assert.match(room, /aria-describedby=\{describedBy/);
  assert.match(room, /role="alert"/);
  assert.match(room, /postButtonLabel\(type\.id\)/);
  assert.match(room, /draftHasWriting\(current\)/);
  assert.match(room, /ml-auto min-h-\[44px\]/);
  assert.match(room, /Clear this draft\?/);
  assert.equal(room.includes("File {type.label}"), false);
  assert.equal(/\blike\b|\bscore\b|\brank/i.test(room), false);

  assert.match(app, /Boolean\(server\.user\) \|\| sample \|\| localEntry/);
  assert.match(app, /undoClearBoard\(\)/);
  assert.match(app, />\s*Undo\s*</);
  assert.match(week, /The board is cleared, and nothing is on the calendar\./);
});
