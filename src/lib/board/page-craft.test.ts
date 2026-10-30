import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { Window } from "happy-dom";
import { plateCaption, plateView } from "./engraved.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const craft = read("public/page-craft.css");
const root = read("src/routes/__root.tsx");
/** The public sheets in the order __root.tsx links them. */
const sheets = [...root.matchAll(/href: "\/([a-z-]+\.css)"/g)].map((m) => read(`public/${m[1]}`)).join("\n");
const app = read("src/components/board/app.tsx");

/** The body of the first `@media <query>{…}` block in a sheet. */
function block(css: string, query: string): string {
  const at = css.indexOf(`@media ${query}{`);
  assert.ok(at >= 0, `no ${query} block`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error(`unclosed ${query} block`);
}

type Page = {
  section: string;
  view?: string;
  saveData?: boolean;
  motion?: "reduce" | "no-preference";
  width?: number;
  entered?: boolean;
};

/** Renders the shell's plate, scrim and credit under the real sheets and returns the computed styles. */
function render(page: Page) {
  const window = new Window({
    url: "http://localhost/",
    width: page.width ?? 1280,
    height: 900,
    settings: { device: { prefersReducedMotion: page.motion ?? "no-preference" } },
  });
  const document = window.document;
  document.head.innerHTML = `<style>${sheets}</style>`;
  if (page.saveData) document.documentElement.dataset.saveData = "1";
  document.body.dataset.section = page.section;
  if (page.view) document.body.dataset.view = page.view;
  document.body.innerHTML = `<div class="shell"${page.entered === false ? "" : ' data-entered="true"'}>
    <div class="plate-ground" aria-hidden="true"></div><div class="scrim" aria-hidden="true"></div>
    <div class="shell-body"><main id="main"><p class="pc-credit">Plate</p></main></div></div>`;
  const style = (selector: string) => window.getComputedStyle(document.querySelector(selector)!);
  return { ground: style(".plate-ground"), scrim: style(".scrim"), credit: style(".pc-credit") };
}

test("page-craft.css loads last and stays at 3 KB or under gzipped", () => {
  const links = [...root.matchAll(/href: "(\/[a-z-]+\.css)"/g)].map((m) => m[1]);
  assert.equal(links.at(-1), "/page-craft.css");
  assert.ok(links.indexOf("/page-craft.css") > links.indexOf("/door.css"));
  const size = gzipSync(craft).length;
  assert.ok(size <= 3 * 1024, `page-craft.css is ${size} B gzipped`);
});

test("every plate the sheet names is in public/art, Groups and a group included", () => {
  const urls = [...craft.matchAll(/url\((\/art\/[^)]+\.webp)\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 27, "nine plates: desktop, phone, and the two-sided 2400px file from 1600px");
  for (const url of urls) {
    const file = new URL(`../../../public${url}`, import.meta.url);
    assert.ok(existsSync(file), url);
    assert.equal(readFileSync(file).subarray(8, 12).toString("ascii"), "WEBP", url);
    assert.ok(readFileSync(file).length < (url.endsWith("-2400.webp") ? 140 : 100) * 1024, url);
    if (url.endsWith("-900.webp")) assert.ok(readFileSync(file).length < 52 * 1024, url);
  }
  const attribution = read("public/art/ATTRIBUTION.md");
  assert.match(attribution, /plate-groups-A\.webp.*Feast_of_Rose_Garlands/);
  assert.match(attribution, /plate-group-A\.webp.*069\.Ruth_and_Boaz/);
  assert.equal(render({ section: "groups" }).ground.backgroundImage, 'url("/art/plate-groups-A.webp")');
  assert.equal(
    render({ section: "groups", view: "group" }).ground.backgroundImage,
    'url("/art/plate-group-A.webp")',
  );
  assert.equal(
    render({ section: "groups", width: 375 }).ground.backgroundImage,
    'url("/art/plate-groups-A-900.webp")',
  );
  assert.equal(
    render({ section: "groups", view: "group", width: 375 }).ground.backgroundImage,
    'url("/art/plate-group-A-900.webp")',
  );
});

test("each signed-in page sets its own plate, a room its own, and phones the 900px crop", () => {
  assert.equal(render({ section: "week" }).ground.backgroundImage, 'url("/art/plate-week-A.webp")');
  assert.equal(render({ section: "rooms" }).ground.backgroundImage, 'url("/art/plate-rooms-A.webp")');
  assert.equal(
    render({ section: "rooms", view: "room" }).ground.backgroundImage,
    'url("/art/plate-room-A.webp")',
  );
  assert.equal(
    render({ section: "profile", width: 375 }).ground.backgroundImage,
    'url("/art/plate-you-A-900.webp")',
  );
  assert.equal(render({ section: "civic" }).ground.backgroundImage, 'url("/art/plate-desk-A.webp")');
});

test("Save-Data clears the plate's background-image and hides the credit", () => {
  for (const section of ["week", "rooms", "groups", "find", "messages", "profile", "about", "civic"]) {
    const page = render({ section, saveData: true });
    assert.equal(page.ground.backgroundImage, "none", section);
    assert.equal(page.ground.animation, "none", section);
    assert.equal(page.credit.display, "none", section);
  }
  assert.equal(render({ section: "groups", view: "group", saveData: true }).ground.backgroundImage, "none");
  // Design r145: the reduced-data rule must outrank [data-entered]>.plate-ground (0,2,0), so it carries the same selector.
  const reduced = block(craft, "(prefers-reduced-data:reduce)");
  assert.match(reduced, /\[data-entered\]>\.plate-ground\{background-image:none;animation:none\}/);
  assert.match(reduced, /\.pc-credit\{display:none\}/);
  const entered = craft.indexOf("[data-entered]>.plate-ground{background:");
  assert.ok(entered >= 0 && entered < craft.indexOf("@media (prefers-reduced-data:reduce)"), "reduced-data comes after the plate rule");
});

test("Groups and a group sit under v3's scrim and Groups ink weights", () => {
  // v3 §1 and §6: the radial Ink & Bone scrim, .62 in the middle and .28 at the edges, unchanged for the new plates.
  const scrim = "radial-gradient(75% 95% at 50% 45%,rgba(20,16,12,.62),rgba(20,16,12,.28))";
  assert.ok(craft.includes(`--pc-scrim:${scrim}`));
  assert.match(craft, /\[data-entered\]>\.scrim\{[^}]*background:var\(--pc-scrim\)/);
  assert.ok(
    craft.includes('[data-section="groups"]{--pc-t1:#2e291c;--pc-t2:#221f15;--pc-t3:#13110b;'),
    "the Groups card tints from v3",
  );
  for (const view of [undefined, "group"]) {
    const page = render({ section: "groups", view });
    assert.equal(page.scrim.position, "fixed", view ?? "groups");
  }
});

test("reduced motion: the plate does not animate", () => {
  const still = render({ section: "week", motion: "reduce" });
  assert.equal(still.ground.animation, "none");
  const moving = render({ section: "week" });
  assert.match(moving.ground.animation, /^pc-settle 4\.5s .* 1 both$/);
});

test("motion plays once, in 5 s or less, only for no-preference", () => {
  const motion = block(craft, "(prefers-reduced-motion:no-preference)");
  const outside = craft.replace(motion, "");
  assert.equal(/animation:/.test(outside.replace(/animation:none/g, "")), false, "every animation is opt-in");
  const animations = [...motion.matchAll(/animation:([^;}]+)/g)].map((m) => m[1]);
  assert.equal(animations.length, 2);
  for (const value of animations) {
    const seconds = Number(/([\d.]+)s/.exec(value)?.[1]);
    assert.ok(seconds > 0 && seconds <= 5, value);
    assert.match(value, / 1 both$/, value);
  }
  assert.equal((craft.match(/@keyframes /g) ?? []).length, 2);
  assert.equal(/infinite|backdrop-filter|alternate/.test(craft), false);
});

test("the door keeps its own plate and scrim: the signed-in rules do not reach it", () => {
  for (const section of ["landing", "signin"]) {
    const door = render({ section, entered: false });
    assert.equal(door.ground.backgroundImage, 'url("/art/martin-hero-A.webp")', section);
    assert.notEqual(door.ground.animation, "pc-settle 4.5s cubic-bezier(.22,.61,.36,1) 1 both");
    assert.equal(/rgba\(20,\s?16,\s?12,\s?\.?0?\.62\)/.test(door.scrim.backgroundImage), false, section);
  }
  // The door's selectors are untouched, and the signed-in ones are scoped to the entered shell.
  // Only the data-saving rules (which only take art away) reach the door's plate.
  const scoped = craft.replace(block(craft, "(prefers-reduced-data:reduce)"), "");
  for (const rule of scoped.match(/[^{}]*\.(?:plate-ground|scrim)\{/g) ?? []) {
    if (/data-save-data/.test(rule)) continue;
    assert.match(rule, /\[data-entered\]>/, rule);
  }
  // The old art is only ever hidden, and only inside the entered shell (Design r131 safety net).
  const net =
    ".shell[data-entered]>.hero-band,.shell[data-entered]>.shell-body>.outer-art,.shell[data-entered] .with-side>.side-art{display:none}";
  assert.ok(craft.includes(net));
  assert.equal(/\.hero-band|\.side-art|\.outer-art|\.with-side/.test(craft.replace(net, "")), false);
});

test("the 60rem column at 1100px and up, solid backing for loose text", () => {
  assert.match(
    block(craft, "(min-width:1100px)"),
    /\[data-entered\] \.shell-body>main\{width:min\(60rem,100%\);justify-self:center\}/,
  );
  // Blocks sit on cards; loose text (h1, li, td, small and the rest) gets a solid, fit-to-text backing.
  // No full-width panels behind sections (Design r131 R6).
  assert.equal(/main section:not\(/.test(craft), false);
  assert.match(
    craft,
    /\[data-entered\] main :is\(h1,h2,h3,h4,p,label,legend,dt,dd,li,td,th,small,blockquote,figcaption\):not\([^{]*\)\{width:fit-content;max-width:100%;padding:\.15rem \.5rem;border-radius:3px;background:var\(--pc-solid\)\}/,
  );
  // A section heading outside a card carries its own backing.
  assert.match(craft, /\[data-entered\] main \.pc-h:not\([^{]*\)\{padding:[^}]*background:var\(--pc-solid\)\}/);
  // Fully opaque: no part of the plate shows through behind text, in either palette.
  assert.match(craft, /--pc-solid:#14100c;/);
  assert.match(craft, /--pc-solid:#ece2cc;/);
});

test("focus over a plate is a light ring with a dark halo, and cards keep the app's rings (Design r131 R7)", () => {
  const rule = craft.match(/\[data-entered\] main :focus-visible:not\(([^{]*)\)\{([^}]*)\}/);
  assert.ok(rule, "scoped focus ring");
  assert.equal(rule[2], "outline:2px solid var(--pc-ink);outline-offset:2px;box-shadow:0 0 0 5px var(--pc-solid)");
  for (const surface of [".card", ".plate", ".pc-card", "dialog"]) assert.ok(rule[1].includes(surface), surface);
  // Only rings over the plate: #114's .focus-target / [data-focus-ring] rules are not restated here.
  assert.equal(/focus-target|data-focus-ring/.test(craft), false);
});

test("the credit has room: a closed details lays out no hidden form under it (QA #116 N3)", () => {
  assert.match(craft, /\[data-entered\] main details:not\(\[open\]\)>:not\(summary\)\{display:none\}/);
  assert.match(craft, /\.pc-credit\{position:relative;z-index:1;clear:both;width:fit-content;margin:2\.5rem 0 1rem;/);
});

test("the shell renders the plate for every section, and the credit names it", () => {
  assert.match(app, /<div className="plate-ground" aria-hidden="true" \/>\n\s*<div className="scrim" aria-hidden="true" \/>/);
  assert.equal(/hero-band|outer-art|side-art|with-side/.test(app), false);
  assert.match(app, /<p className=\{wideCaption \? "pc-credit pc-narrow" : "pc-credit"\}>Plate: \{caption\}<\/p>/);
  assert.equal(plateCaption("week", null), "Gustave Doré · Jacob’s Dream · 1866");
  assert.equal(plateCaption("rooms", "room"), "Gustave Doré · The Sermon on the Mount · 1866");
  assert.equal(plateCaption("civic", null), "Gustave Doré · The Judgment of Solomon · 1866");
  assert.equal(plateCaption("about", null), "John Martin · The Creation of Light · 1824–27");
  assert.equal(plateCaption("groups", null), "Albrecht Dürer · The Feast of the Rose Garlands · 1506");
  assert.equal(plateCaption("groups", "group"), "Gustave Doré · Ruth and Boaz · 1866");
  assert.equal(plateCaption("landing", null), null);
  assert.equal(plateCaption("signin", null), null);
  assert.equal(plateView({ section: "rooms", browsing: false, groupOpen: false }), "room");
  assert.equal(plateView({ section: "rooms", browsing: true, groupOpen: false }), null);
  assert.equal(plateView({ section: "groups", browsing: true, groupOpen: true }), "group");
  assert.equal(plateView({ section: "week", browsing: false, groupOpen: true }), null);
});

test("no scores, counts or likes in the credit map", () => {
  const engraved = read("src/lib/board/engraved.ts");
  assert.equal(/\blikes?\b|\breshares?\b|\bscore\b|\bfeed\b|\btrending\b/i.test(engraved), false);
});

test("the gilt rule under a heading has room below it (Design: margin-block .25rem .75rem)", () => {
  const rule = craft.match(/\.pc-rule\{([^}]*)\}/);
  assert.ok(rule, ".pc-rule is in page-craft.css");
  assert.match(rule[1], /margin-block:\.25rem \.75rem/);
  assert.doesNotMatch(rule[1], /(^|;)margin:/, "no shorthand margin to undo it");
});

test("on phones the desk plate sits at 80% so Solomon's fingertips stay on screen (Design r155 L2)", () => {
  const phone = craft.match(/@media \(max-width:640px\)\{([\s\S]*?)\n\}/);
  assert.ok(phone, "the phone block is in page-craft.css");
  // (0,3,0) outranks the plate rule's background shorthand (0,2,0), wherever it sits.
  assert.ok(phone[1].includes('[data-section="civic"] [data-entered]>.plate-ground{background-position:80% 35%}'));
});
