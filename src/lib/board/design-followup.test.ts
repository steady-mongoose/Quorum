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

  assert.match(css, /--color-line-strong:\s*#8a7a62/);
  assert.match(about, /title="Clear the board\?"/);
  assert.match(about, /Everything here will be removed\./);
  assert.match(about, /confirmLabel="Clear it"/);
  assert.match(about, /cancelLabel="Keep it"/);
  assert.match(about, /clearLocalBoard\(\)/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /aria-modal=\{open \? "true" : undefined\}/);
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

  assert.match(app, /Boolean\(server\.user\) \|\| localEntry/);
  assert.match(app, /undoClearBoard\(\)/);
  assert.match(app, />\s*Undo\s*</);
  assert.match(week, /The board is cleared, and nothing is on the calendar\./);
});

function channel(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
}

function contrast(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = channel(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** 60% of the warning colour painted over the surface, the way the border is. */
function blend(foreground: string, background: string, alpha: number): string {
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const fg = rgb(foreground);
  const bg = rgb(background);
  const mixed = fg.map((value, index) =>
    Math.round(value * alpha + (bg[index] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

test("the clear button, undo bar, and backdrop follow the review", () => {
  const dialog = source("../../components/board/confirm-dialog.tsx");
  const app = source("../../components/board/app.tsx");
  const about = source("../../components/board/about-view.tsx");
  const css = source("../../styles.css");
  const surface = css.match(/--color-surface:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase() ?? "";
  const warning = css.match(/--color-danger:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase() ?? "";
  assert.equal(surface, "#1f1914");
  assert.equal(warning, "#f0b4a4");
  assert.ok(contrast(warning, surface) >= 4.5);
  assert.ok(contrast(blend(warning, surface, 0.6), surface) >= 3);

  assert.match(dialog, /border-danger\/60 text-danger/);
  assert.equal(dialog.includes("#f0b4a4"), false);
  assert.match(dialog, /className="plate /);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  const fluid = source("../../../public/fluid.css");
  assert.match(fluid, /dialog\.plate:not\(\[open\]\)\{display:none\}/);
  assert.equal(fluid.includes(".plate .plate"), false);
  const backgrounds = source("../../../public/backgrounds.css");
  assert.match(backgrounds, /\.plate--hero\{margin-top:calc\(var\(--band-h\) \* -0\.42\)\}/);
  assert.match(
    fluid,
    /dialog\.plate\{position:fixed;inset:0;width:min\(28rem,calc\(100% - 2rem\)\);max-width:28rem;height:fit-content;margin:auto\}/,
  );
  assert.match(app, /<ConfirmDialog/);
  assert.match(dialog, /backdrop:bg-bg\/80/);
  assert.equal(dialog.includes("backdrop:bg-[#0f1a14]"), false);
  assert.match(css, /--color-bg:\s*#14100c/);

  assert.equal(/sample week/i.test(app), false);
  assert.equal(app.includes("Clear it under About"), false);
  assert.match(app, /UNDO_BAR_MS/);
  assert.match(app, /UNDO_TTL_MS/);
  assert.match(app, />\s*Close\s*</);
  assert.match(app, /setUndoBar\(false\)/);
  assert.match(about, /Put the board back/);
});

test("the composer announces one error and ignores a second click", () => {
  const room = source("../../components/board/room-view.tsx");
  const composer = room.slice(room.indexOf("function Composer"), room.indexOf("function Name"));
  assert.equal(composer.match(/role="alert"/g)?.length, 1);
  assert.match(room, /const latestError = visible\?\.stops\.at\(-1\)/);
  assert.match(room, /role="alert" className="sr-only"/);
  assert.match(room, /if \(pendingRef\.current\) return/);
  assert.match(room, /disabled=\{pending\}/);
  assert.match(room, /aria-disabled=\{pending \? true : undefined\}/);
  assert.match(room, /Posting…/);
  const fieldError = room.slice(
    room.indexOf("function FieldError"),
    room.indexOf("function describedBy"),
  );
  assert.equal(fieldError.includes("role="), false);
});

test("the authenticator banner is not covered by the hero at 390px", () => {
  const backgrounds = source("../../../public/backgrounds.css");
  assert.match(backgrounds, /\.mfa-banner\{position:relative;z-index:2\}/);
  assert.match(backgrounds, /\.mfa-banner ~ \* \.plate--hero\{margin-top:0\}/);
  // The banner moved into its own component so "Set it up" can share the focus helper.
  const app = source("../../components/board/app.tsx");
  assert.match(app, /<MfaBanner onSetUp=/);
  const banner = source("../../components/board/mfa-banner.tsx");
  assert.match(banner, /className="mfa-banner /);
});
