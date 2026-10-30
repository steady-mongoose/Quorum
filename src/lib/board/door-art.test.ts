import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markSaveData } from "./save-data.ts";

const door = readFileSync(new URL("../../../public/door.css", import.meta.url), "utf8");
const backgrounds = readFileSync(
  new URL("../../../public/backgrounds.css", import.meta.url),
  "utf8",
);
const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
const doorTsx = readFileSync(new URL("../../components/board/door.tsx", import.meta.url), "utf8");

/** The body of the last `@media (prefers-reduced-motion:reduce){…}` block in a sheet. */
function lastReduceBlock(css: string): string {
  const at = css.lastIndexOf("@media (prefers-reduced-motion:reduce){");
  assert.ok(at >= 0, "no reduced-motion block");
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error("unclosed reduced-motion block");
}

test("reduced motion reaches pseudo-elements, not just elements", () => {
  assert.match(
    backgrounds,
    /@media \(prefers-reduced-motion:reduce\)\{[^@]*\*,\*::before,\*::after\{animation:none!important;transition-duration:0s!important;transition-delay:0s!important\}/,
  );
});

test("door.css ends by stopping every moving layer under reduced motion", () => {
  const block = lastReduceBlock(door);
  assert.ok(door.trimEnd().endsWith(block), "the reduce block is the last rule in door.css");
  for (const selector of [
    ".plate-ground",
    ".plate-ground::before",
    ".plate-ground::after",
    ".door-week::after",
    ".door-rooms::after",
    ".door-rule",
    ".door-hero",
    ".door-side",
    ".door-week",
    ".door-rooms",
    ".door-room:hover",
    ".door-week:hover",
    ".door-rooms:hover",
    ".door-side .card:hover",
    ".door-side .btn-primary:hover",
  ]) {
    assert.ok(block.includes(selector), `reduce block names ${selector}`);
  }
  assert.match(block, /\{animation:none!important;transform:none!important\}/);
});

test("every door animation is opt-in, runs once, and the hero and form never animate", () => {
  assert.doesNotMatch(door, /infinite/);
  assert.doesNotMatch(door, /@keyframes door-(breathe|ghost)|animation:door-(breathe|ghost)/);
  assert.match(door, /\.door-hero,\.door-side\{animation:none\}/);
  // Each animation: declaration sits inside a prefers-reduced-motion:no-preference block.
  const stripped = door.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  for (const match of stripped.matchAll(/animation:door-[a-z]+/g)) {
    const before = stripped.slice(0, match.index);
    const open = before.lastIndexOf("@media (prefers-reduced-motion:no-preference){");
    assert.ok(open >= 0, `${match[0]} is gated on no-preference`);
    const between = before.slice(open);
    assert.ok(
      (between.match(/\{/g) ?? []).length > (between.match(/\}/g) ?? []).length,
      `${match[0]} is inside the no-preference block`,
    );
  }
  assert.match(door, /@keyframes door-rise\{\s*from\{opacity:\.001;transform:translateY\(12px\)\}/);
  assert.match(door, /animation:door-rise \.5s /);
});

test("the door clips sideways overflow from the drifting plate", () => {
  assert.match(door, /\[data-section="landing"\],\[data-section="signin"\],/);
  assert.match(
    door,
    /html:has\(> body\[data-section="landing"\]\),html:has\(> body\[data-section="signin"\]\)\{overflow-x:clip\}/,
  );
});

test("nothing that can't be clicked reacts to hover, and the button's glow has a keyboard twin", () => {
  const outsideReduce = door.replace(lastReduceBlock(door), "");
  assert.doesNotMatch(
    outsideReduce,
    /\.door-room:hover|\.door-week:hover|\.door-rooms:hover|\.card:hover|#sign-in:hover/,
  );
  assert.match(door, /\.door-side \.btn-primary:focus-visible\{\s*box-shadow:/);
  assert.doesNotMatch(door, /translateY\(-\d/);
});

test("data saver: <html data-save-data> drops the plate light and the ghosted engravings", () => {
  assert.match(root, /import \{ markSaveData \} from "@\/lib\/board\/save-data";/);
  assert.match(root, /\nmarkSaveData\(\);\n/);
  assert.match(door, /\[data-save-data\] \.plate-ground\{background-image:none;animation:none\}/);
  for (const layer of [
    ".plate-ground::before",
    ".plate-ground::after",
    ".door-week::after",
    ".door-rooms::after",
  ]) {
    assert.ok(door.includes(`[data-save-data] ${layer}`), layer);
  }
  assert.match(door, /\[data-save-data\] \.door-rooms::after\{display:none;/);

  const el = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  assert.equal(markSaveData({ connection: { saveData: false } }, el), false);
  assert.equal(markSaveData({}, el), false);
  assert.equal(markSaveData(undefined, el), false);
  assert.equal(el.dataset.saveData, undefined);
  assert.equal(markSaveData({ connection: { saveData: true } }, el), true);
  assert.equal(el.dataset.saveData, "1");
});

test("parchment gilt is dark enough to read, and the aside is upright", () => {
  assert.match(door, /\[data-palette="parchment"\]\{[^}]*--door-gilt:#6f5420/);
  const aside = door.match(/\.door-aside\{[^}]*\}/)?.[0] ?? "";
  assert.ok(aside, "door-aside rule");
  assert.doesNotMatch(aside, /italic/);
});

test("the rooms list is labelled by its heading", () => {
  assert.match(doorTsx, /<h2 id="door-rooms-heading"/);
  assert.match(
    doorTsx,
    /<ul className="door-roomlist" role="list" aria-labelledby="door-rooms-heading">/,
  );
  assert.doesNotMatch(doorTsx, /aria-label="Rooms"/);
});

test("the engravings sit under the words, and smooth scroll is the door's alone", () => {
  assert.match(door, /\.door-week::after,\.door-rooms::after\{z-index:0\}/);
  assert.match(door, /\.door-week>\*,\.door-rooms>\*\{position:relative;z-index:1\}/);
  assert.doesNotMatch(door, /\{html\{scroll-behavior/);
  assert.match(
    door,
    /html:has\(> body\[data-section="landing"\]\),html:has\(> body\[data-section="signin"\]\)\{scroll-behavior:smooth\}/,
  );
});

test("WCAG 2.2.2: nothing on the door moves for more than 5s", () => {
  const durations = [...door.matchAll(/animation:[a-z-]+ ([\d.]+)(m?s)/g)].map(([, n, u]) =>
    u === "ms" ? Number(n) / 1000 : Number(n),
  );
  assert.ok(durations.length > 0, "door has animations");
  for (const d of durations) assert.ok(d <= 5, `animation of ${d}s is over 5s`);
  assert.match(door, /animation:door-drift 5s [a-z-]+ 1 forwards;/);
  assert.doesNotMatch(door, /animation:door-motes/);
  assert.doesNotMatch(door, /@keyframes door-motes/);
  assert.doesNotMatch(door, /infinite/);
});

test("the aside has its own ground, so it reads over the bare engraving", () => {
  const aside = door.match(/\.door-aside\{[^}]*\}/)?.[0] ?? "";
  assert.match(aside, /background:color-mix\(in srgb,var\(--bg\) 82%,transparent\);/);
  assert.match(aside, /padding:\.3rem \.6rem;/);
  assert.match(aside, /border-radius:3px;/);
  assert.match(aside, /width:fit-content;/);
});

test("parchment: the door scrim follows the palette, not fixed dark ink", () => {
  assert.ok(
    door.includes(
      '[data-palette="parchment"] [data-section="landing"] .scrim,[data-palette="parchment"] [data-section="signin"] .scrim{background:var(--scrim)}',
    ),
  );
  const at = door.indexOf('[data-palette="parchment"] [data-section="landing"] .scrim');
  assert.ok(at > door.indexOf('[data-section="landing"] .scrim,[data-section="signin"] .scrim{\n'), "after the dark override");
  assert.ok(at < door.indexOf("@media (max-width:640px){\n  [data-section=\"landing\"] .scrim"), "phones keep var(--bg)");
});
