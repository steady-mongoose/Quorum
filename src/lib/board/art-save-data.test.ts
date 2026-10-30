import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = (name: string) => readFileSync(new URL(`../../../public/${name}`, import.meta.url), "utf8");
const pageArt = css("page-art.css");
const LAYERS = [".hero-band", ".outer-art", ".side-art"] as const;

// Every rule that paints one of the page-art layers, in every stylesheet the board loads.
function paintingRules(): string[] {
  const out: string[] = [];
  for (const name of ["backgrounds.css", "page-art.css", "fluid.css", "door.css", "engraved-adjust.css", "gathering.css"]) {
    for (const m of css(name).matchAll(/([^{}]+)\{([^{}]*background(?:-image)?\s*:[^{}]*)\}/g)) {
      if (LAYERS.some((l) => m[1].includes(l))) out.push(`${name}: ${m[1].trim()}{${m[2]}}`);
    }
  }
  return out;
}

test("Save-Data: <html data-save-data> drops the band, margin and side images", () => {
  const rule = pageArt.match(/\[data-save-data\] \.shell \.hero-band,\[data-save-data\] \.shell \.outer-art,\[data-save-data\] \.shell \.side-art\{([^}]*)\}/);
  assert.ok(rule, "the Save-Data rule is in page-art.css");
  assert.equal(rule[1], "background-image:none!important");
});

test("prefers-reduced-data drops the band, margin and side images", () => {
  const rule = pageArt.match(/@media \(prefers-reduced-data:reduce\)\{\.shell \.hero-band,\.shell \.outer-art,\.shell \.side-art\{([^}]*)\}\}/);
  assert.ok(rule, "the reduced-data rule is in page-art.css");
  assert.equal(rule[1], "background-image:none!important");
});

test("no other page-art rule is !important, so the data-saver rules always win", () => {
  const rules = paintingRules();
  assert.ok(rules.length > 10, "found the band and margin rules");
  const important = rules.filter((r) => r.includes("!important"));
  assert.equal(important.length, 2, important.join("\n"));
  for (const r of important) assert.match(r, /background-image:none!important/);
});

test("the data-saver rules are the last word in page-art.css", () => {
  const save = pageArt.lastIndexOf("[data-save-data] .shell .hero-band");
  const reduced = pageArt.lastIndexOf("@media (prefers-reduced-data:reduce)");
  const lastPaint = Math.max(...[...pageArt.matchAll(/background-image:var\(/g)].map((m) => m.index ?? 0));
  assert.ok(save > lastPaint && reduced > lastPaint);
});
