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

test("every plate the sheet names is in public/art, and Groups and a group have none yet", () => {
  const urls = [...craft.matchAll(/url\((\/art\/[^)]+\.webp)\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 14, "seven plates, desktop and phone");
  for (const url of urls) {
    const file = new URL(`../../../public${url}`, import.meta.url);
    assert.ok(existsSync(file), url);
    assert.equal(readFileSync(file).subarray(8, 12).toString("ascii"), "WEBP", url);
    assert.ok(readFileSync(file).length < 100 * 1024, url);
  }
  assert.equal(/plate-groups?-A/.test(craft), false, "the Groups plates wait for v3");
  assert.equal(existsSync(new URL("../../../public/art/plate-groups-A.webp", import.meta.url)), false);
  assert.equal(existsSync(new URL("../../../public/art/plate-group-A.webp", import.meta.url)), false);
  assert.equal(render({ section: "groups" }).ground.backgroundImage, "none");
  assert.equal(render({ section: "groups", view: "group" }).ground.backgroundImage, "none");
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
  for (const section of ["week", "rooms", "find", "messages", "profile", "about", "civic"]) {
    const page = render({ section, saveData: true });
    assert.equal(page.ground.backgroundImage, "none", section);
    assert.equal(page.ground.animation, "none", section);
    assert.equal(page.credit.display, "none", section);
  }
  assert.match(block(craft, "(prefers-reduced-data:reduce)"), /\.plate-ground\{background-image:none;animation:none\}/);
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
  assert.equal(/\.hero-band|\.side-art|\.outer-art|\.with-side/.test(craft), false);
});

test("the 60rem column at 1100px and up, solid backing for loose text", () => {
  assert.match(
    block(craft, "(min-width:1100px)"),
    /\[data-entered\] \.shell-body>main\{width:min\(60rem,100%\);justify-self:center\}/,
  );
  assert.match(craft, /\[data-entered\] main :is\(h2,h3,p,label,legend,dt,dd\)/);
});

test("the shell renders the plate for every section, and the credit names it", () => {
  assert.match(app, /<div className="plate-ground" aria-hidden="true" \/>\n\s*<div className="scrim" aria-hidden="true" \/>/);
  assert.equal(/hero-band|outer-art|side-art|with-side/.test(app), false);
  assert.match(app, /<p className="pc-credit">Plate: \{caption\}<\/p>/);
  assert.equal(plateCaption("week", null), "Gustave Doré · Jacob’s Dream · 1866");
  assert.equal(plateCaption("rooms", "room"), "Gustave Doré · The Sermon on the Mount · 1866");
  assert.equal(plateCaption("civic", null), "Gustave Doré · The Judgment of Solomon · 1866");
  assert.equal(plateCaption("about", null), "John Martin · The Creation of Light · 1824–27");
  assert.equal(plateCaption("groups", null), null);
  assert.equal(plateCaption("groups", "group"), null);
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
