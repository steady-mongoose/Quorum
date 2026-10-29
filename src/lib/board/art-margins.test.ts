import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Stylesheets in the order __root.tsx links them, so a later rule of equal weight wins.
const SHEETS = ["backgrounds", "fluid", "page-art", "gathering", "engraved-adjust", "door"];
const css = (name: string) => readFileSync(new URL(`../../../public/${name}.css`, import.meta.url), "utf8");
const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");

type Rule = { sheet: number; order: number; selector: string; body: string };
function rules(): Rule[] {
  const out: Rule[] = [];
  let order = 0;
  SHEETS.forEach((name, sheet) => {
    const text = css(name).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
      for (const selector of m[1].split(",")) out.push({ sheet, order: order++, selector: selector.trim(), body: m[2] });
    }
  });
  return out;
}
function weight(selector: string): number {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  return ids * 100 + classes;
}
const setsImage = (body: string) => /background(-image)?\s*:[^;]*(url\(|var\(--art)/.test(body);
const clearsImage = (body: string) => /background-image\s*:\s*none/.test(body);

test("the stylesheet order the test assumes is the order the app links", () => {
  const linked = [...root.matchAll(/href: "\/([\w-]+)\.css"/g)].map((m) => m[1]);
  assert.deepEqual(linked, SHEETS);
});

test("no page shows the same plate in both outer margins", () => {
  const all = rules().filter((r) => /\.outer-art(?![\w-])/.test(r.selector));
  // The right outer plate is cleared, and nothing that paints a margin image outranks the clear.
  const clear = all.filter((r) => /\.outer-art\.r(?![\w-])/.test(r.selector) && clearsImage(r.body));
  assert.ok(clear.length > 0, "the right outer plate carries no image");
  const best = clear.reduce((a, b) => (weight(b.selector) > weight(a.selector) || (weight(b.selector) === weight(a.selector) && b.order > a.order) ? b : a));
  for (const r of all.filter((x) => setsImage(x.body) && !/\.outer-art\.l(?![\w-])/.test(x.selector))) {
    const w = weight(r.selector);
    const loses = w < weight(best.selector) || (w === weight(best.selector) && r.order < best.order);
    assert.ok(loses, `${r.selector} would paint the right margin too`);
  }
});

test("the 1100 to 1599 side column is a single plate, never mirrored", () => {
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/className="side-art"/g) ?? []).length, 1);
  assert.equal((app.match(/className="outer-art l"/g) ?? []).length, 1);
});

test("each band can aim its own crop, and the Desk keeps the delegates' heads in frame", () => {
  const backgrounds = css("backgrounds");
  const pageArt = css("page-art");
  assert.match(backgrounds, /\.hero-band\{[^}]*background:var\(--band\) var\(--band-pos,center 45%\)\/cover/);
  const pos = (section: string) => pageArt.match(new RegExp(`\\[data-section="${section}"\\] \\.hero-band\\{[^}]*--band-pos:center ([\\w%]+)`))?.[1];
  assert.equal(pos("civic"), "8%", "Desk: Trumbull's standing figures sit in the top tenth");
  assert.equal(pos("groups"), "top", "Groups: Millet's right digger's head touches the top edge");
  assert.equal(pos("find"), "25%", "Find: Christ and the listeners' heads");
  assert.equal(pos("profile"), "38%");
  // No band sets background-position directly; that would bypass --band-pos.
  for (const r of rules().filter((x) => /\.hero-band(?![\w-])/.test(x.selector) && !/category-engraving/.test(x.selector))) {
    assert.equal(/background-position\s*:/.test(r.body), false, r.selector);
  }
});
