import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

// Stylesheets in the order __root.tsx links them, so a later rule of equal weight wins.
const SHEETS = ["backgrounds", "fluid", "page-art", "gathering", "engraved-adjust", "door"];
const css = (name: string) => readFileSync(new URL(`../../../public/${name}.css`, import.meta.url), "utf8");
const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
const attribution = readFileSync(new URL("../../../public/art/ATTRIBUTION.md", import.meta.url), "utf8");

type Decl = { prop: string; value: string };
type Rule = { order: number; selector: string; media: string; decls: Decl[] };
// A small cascade: top-level rules and one level of @media, in link order.
function rules(): Rule[] {
  const out: Rule[] = [];
  let order = 0;
  for (const name of SHEETS) {
    const text = css(name).replace(/\/\*[\s\S]*?\*\//g, "");
    let i = 0;
    const take = (block: string, media: string) => {
      for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
          const at = d.indexOf(":");
          return { prop: d.slice(0, at).trim(), value: d.slice(at + 1).trim() };
        });
        for (const selector of m[1].split(",")) out.push({ order: order++, selector: selector.trim(), media, decls });
      }
    };
    while (i < text.length) {
      const at = text.indexOf("@media", i);
      if (at < 0) { take(text.slice(i), ""); break; }
      take(text.slice(i, at), "");
      const open = text.indexOf("{", at);
      let depth = 1, j = open + 1;
      while (depth > 0) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      take(text.slice(open + 1, j - 1), text.slice(at + 6, open).trim());
      i = j;
    }
  }
  return out;
}
const RULES = rules();
function mediaAt(media: string, width: number): boolean {
  if (!media) return true;
  if (/prefers-|print/.test(media)) return false;
  const min = media.match(/min-width:\s*(\d+)px/); const max = media.match(/max-width:\s*(\d+)px/);
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}
function weight(selector: string): number {
  return (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
}
// Does the selector reach a margin element with these classes, under this section and palette?
function reaches(selector: string, classes: string[], section: string, palette: string): boolean {
  const parts = selector.split(/\s+/);
  const last = parts.pop()!;
  const own = last.match(/\.[\w-]+/g) ?? [];
  if (last.replace(/\.[\w-]+/g, "") !== "" || own.length === 0 || own.some((c) => !classes.includes(c.slice(1)))) return false;
  return parts.every((p) => p === ".shell-body" || p === ".shell" || p === `[data-section="${section}"]` || (palette === "parchment" && p === `[data-palette="parchment"]`));
}
function custom(width: number, palette: string): Map<string, string> {
  const vars = new Map<string, string>();
  const scopes = palette === "parchment" ? [":root", '[data-palette="parchment"]'] : [":root"];
  for (const scope of scopes) {
    for (const r of RULES.filter((x) => x.selector === scope && mediaAt(x.media, width))) {
      for (const d of r.decls) if (d.prop.startsWith("--")) vars.set(d.prop, d.value);
    }
  }
  return vars;
}
function resolve(value: string, vars: Map<string, string>): string {
  let v = value;
  for (let n = 0; n < 10 && /var\(--/.test(v); n++) v = v.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, k) => vars.get(k) ?? "none");
  return v;
}
function marginImage(side: "l" | "r", section: string, palette: string, width = 1700): string {
  let best: Rule | null = null;
  let bestValue = "none";
  for (const r of RULES) {
    if (!mediaAt(r.media, width) || !reaches(r.selector, ["outer-art", side], section, palette)) continue;
    const d = [...r.decls].reverse().find((x) => x.prop === "background-image" || (x.prop === "background" && /url\(|var\(/.test(x.value)));
    if (!d) continue;
    if (!best || weight(r.selector) >= weight(best.selector)) { best = r; bestValue = d.value; }
  }
  const url = resolve(bestValue, custom(width, palette)).match(/url\("?([^")]+)"?\)/);
  return url ? url[1] : "none";
}
const SECTIONS = ["week", "rooms", "messages", "find", "groups", "profile", "about", "civic"];
const work = (url: string) => url.replace(/-[AB]\.webp$/, "");

test("the stylesheet order the test assumes is the order the app links", () => {
  const linked = [...root.matchAll(/href: "\/([\w-]+)\.css"/g)].map((m) => m[1]);
  assert.deepEqual(linked, SHEETS);
});

test("from 1600px every page has art in both outer margins, and never the same picture twice", () => {
  for (const palette of ["ink", "parchment"]) {
    for (const width of [1600, 1920, 2560]) {
      for (const section of SECTIONS) {
        const left = marginImage("l", section, palette, width);
        const right = marginImage("r", section, palette, width);
        assert.match(left, /^\/art\/.+\.webp$/, `${section} ${palette} ${width}: left plate`);
        assert.match(right, /^\/art\/.+\.webp$/, `${section} ${palette} ${width}: right plate`);
        assert.notEqual(left, right, `${section} ${palette} ${width}: same file both sides`);
        // Side B is the parchment tint of side A, so a palette swap is still the same picture.
        assert.notEqual(work(left), work(right), `${section} ${palette} ${width}: same work file both sides`);
        assert.equal(left.endsWith(palette === "parchment" ? "-B.webp" : "-A.webp"), true, `${section} left palette`);
        assert.equal(right.endsWith(palette === "parchment" ? "-B.webp" : "-A.webp"), true, `${section} right palette`);
        assert.ok(existsSync(new URL(`../../../public${right}`, import.meta.url)), right);
      }
    }
  }
});

test("each right-margin crop is a new region, not a flip of the left plate", () => {
  const crops = readdirSync(new URL("../../../public/art/", import.meta.url)).filter((f) => /-side-R-[AB]\.webp$/.test(f));
  assert.equal(crops.length, 12, "six works, two palettes");
  for (const f of crops) {
    const size = statSync(new URL(`../../../public/art/${f}`, import.meta.url)).size;
    assert.ok(size > 20_000 && size < 200 * 1024, `${f} is ${size} bytes`);
    const work = f.replace(/-side-R-[AB]\.webp$/, "");
    assert.match(attribution, new RegExp(`${work}-side-R-A\\.webp`), `${f} credited`);
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
  for (const r of RULES.filter((x) => /\.hero-band(?![\w-])/.test(x.selector) && !/category-engraving/.test(x.selector))) {
    assert.equal(r.decls.some((d) => d.prop === "background-position"), false, r.selector);
  }
});
