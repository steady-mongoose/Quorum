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
    /@media \(prefers-reduced-motion:reduce\)\{[^@]*\*,\*::before,\*::after\{animation:none!important;transition-duration:0s!important\}/,
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

/** Every rule body in a sheet whose selector names one of the given layers (inside @media too). */
function rulesFor(css: string, layers: string[]): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (layers.some((l) => selector.split(",").some((s) => s.trim().endsWith(l)))) out.push({ selector, body: m[2] });
  }
  return out;
}

test("Josh: the glow on every plate is constant — no animation, no transition, no fade or pulse", () => {
  const outsideReduce = door.replace(lastReduceBlock(door), "");
  const glow = rulesFor(outsideReduce, ["::before", "::after"]).filter((r) => /plate-ground/.test(r.selector));
  assert.ok(glow.length >= 4, "found the light and mote rules");
  for (const { selector, body } of glow) {
    // Either it switches motion off outright or it sets none at all; it never names a keyframe or a timed transition.
    assert.doesNotMatch(body, /animation:(?!none)/, `${selector} animates`);
    assert.doesNotMatch(body, /animation-name|transition:(?!none)|transition-property/, `${selector} transitions`);
  }
  // The signed-in light and motes, at the softer strength, from first paint.
  assert.match(
    door,
    /\[data-entered\]>\.plate-ground::after\{content:"";position:absolute;inset:-10%;pointer-events:none;background:radial-gradient\(46% 40% at var\(--door-light\),var\(--door-glow\) 0%,rgba\(201,164,92,\.55\) 34%,transparent 72%\);mix-blend-mode:screen;opacity:\.32;animation:none;transition:none\}/,
  );
  assert.match(door, /\[data-entered\]>\.plate-ground::before\{[^}]*background:var\(--door-motes\)[^}]*opacity:\.3;animation:none;transition:none\}/);
  // No keyframe in the sheet touches opacity except the cards' short rise: the light never fades in or out.
  for (const m of door.matchAll(/@keyframes ([a-z-]+)\{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g)) {
    if (m[1] === "door-rise") continue;
    assert.doesNotMatch(m[2], /opacity/, `${m[1]} fades`);
  }
  // Under reduced motion the light and motes stay: the reduce block stops them moving, never hides them.
  const reduce = lastReduceBlock(door);
  assert.doesNotMatch(reduce, /display:none|opacity:0|content:none/);
});

test("the signed-in light sits before the reduce block, and the plate keeps pc-settle, not door-drift", () => {
  const at = door.indexOf("[data-entered]>.plate-ground::after{");
  assert.ok(at > 0 && at < door.lastIndexOf("@media (prefers-reduced-motion:reduce){"));
  assert.doesNotMatch(door, /\[data-entered\][^{]*\{[^}]*door-drift/);
  assert.match(door, /\[data-entered\] \.pc-head h1\{text-shadow:0 1px 0 rgba\(0,0,0,\.35\),0 0 24px rgba\(201,164,92,\.12\)\}/);
});

test("public pages stand on the door's plate, and data savers still get none", () => {
  assert.match(door, /\.plate-ground\.door-ground\{background:var\(--door-art,var\(--art-landing\)\) center 30%\/cover no-repeat;/);
  for (const layer of ["::after", "::before"]) {
    const list = door.match(new RegExp(`\\[data-section="landing"\\] \\.plate-ground${layer},\\[data-section="signin"\\] \\.plate-ground${layer},([^{]+)\\{\\n  content`));
    assert.ok(list && list[1].includes(`.plate-ground.door-ground${layer}`), `door ${layer} names .door-ground`);
  }
  assert.match(door, /\[data-save-data\] \.plate-ground\.door-ground\{background-image:none;animation:none\}/);
  assert.match(door, /@media \(prefers-reduced-data:reduce\)\{\.plate-ground\.door-ground\{background-image:none;animation:none\}\}/);
  const save = door.indexOf("[data-save-data] .plate-ground.door-ground");
  assert.ok(save > door.indexOf(".plate-ground.door-ground{background:"), "the data-saver rule comes after the plate");
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  for (const [name, file] of [
    ["PublicDocument", src("../../components/board/public-document.tsx")],
    ["PublicGatheringFrame", src("../../components/board/public-gathering-view.tsx")],
    ["NotFoundPage", src("../../components/not-found.tsx")],
    ["/e server HTML", src("./public-gathering.ts")],
  ] as const) {
    assert.match(file, /(className=|class=|: )"plate-ground door-ground"/, `${name} renders the plate`);
    assert.match(file, /(className|class)="scrim"/, `${name} renders the scrim`);
    assert.doesNotMatch(file, /hero-band/, `${name} drops the band`);
    assert.doesNotMatch(file, /backdrop-filter|backdrop-blur|blur\(/, `${name} has no blur`);
  }
  assert.match(src("../../components/not-found.tsx"), /<div className="shell /);
  assert.match(src("../../components/board/public-document.tsx"), /<div className="card pc-card /);
  assert.match(src("../../components/not-found.tsx"), /<div className="card pc-card /);
});

/** Where the light lands on screen: the ::after box is inset -10%, so 120% of the plate. */
const onScreen = (v: number) => -10 + 1.2 * v;
const light = (css: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\{--door-light:(\\d+)% (\\d+)%\\}`));
  assert.ok(m, `no light for ${selector}`);
  return [Number(m[1]), Number(m[2])] as const;
};
const phoneBlock = () => {
  const at = door.indexOf('@media (max-width:640px){\n  [data-section="week"] [data-entered]>.plate-ground{--door-light');
  assert.ok(at > 0, "the phone light block");
  return door.slice(at, door.indexOf("\n}", at));
};

test("Design r178: each plate's light lands on screen where the picture shows, below the header and the head card", () => {
  const plate = (s: string) => `[data-section="${s}"] [data-entered]>.plate-ground`;
  assert.deepEqual(light(door, plate("week")), [62, 50]);
  const phone = phoneBlock();
  assert.deepEqual(light(phone, plate("week")), [70, 58]);
  assert.deepEqual(light(phone, plate("rooms")), [12, 36]);
  assert.deepEqual(light(phone, plate("messages")), [36, 44]);
  assert.deepEqual(light(phone, plate("about")), [50, 34]);
  assert.doesNotMatch(door, /--door-light:40% 20%|--door-light:36% 22%/, "the old phone values are gone");
  // The plates Design asked to sanity-check sit their light in the side margin the column leaves, not under the
  // head card (measured r2: 41-65% of the glow shows at 1280, against 8-22% before).
  const view = (s: string, v: string) => `[data-section="${s}"][data-view="${v}"] [data-entered]>.plate-ground`;
  assert.deepEqual(light(door, plate("groups")), [86, 46]);
  assert.deepEqual(light(door, view("groups", "group")), [84, 44]);
  assert.deepEqual(light(door, plate("civic")), [12, 46]);
  assert.deepEqual(light(door, plate("profile")), [12, 46]);
  assert.deepEqual(light(door, plate("rooms")), [22, 22], "desktop rooms kept");
  assert.deepEqual(light(door, view("rooms", "room")), [58, 24], "desktop room kept");
  assert.deepEqual(light(door, plate("messages")), [16, 22], "desktop messages kept");
  assert.deepEqual(light(phone, view("rooms", "room")), [88, 34]);
  assert.deepEqual(light(phone, plate("groups")), [86, 60]);
  assert.deepEqual(light(phone, view("groups", "group")), [86, 62]);
  assert.deepEqual(light(phone, plate("civic")), [88, 46]);
  assert.deepEqual(light(phone, plate("profile")), [12, 56]);
  // On a phone the header and head card take the top ~30% of the screen: every phone light clears it.
  for (const s of ["week", "rooms", "messages", "groups", "civic", "profile"]) {
    const [, y] = light(phone, plate(s));
    assert.ok(onScreen(y) >= 30, `${s} phone light at ${onScreen(y)}% is under the head card`);
  }
  // The light never lands off-screen.
  for (const m of door.matchAll(/--door-light:(\d+)% (\d+)%/g)) {
    for (const v of [Number(m[1]), Number(m[2])]) assert.ok(onScreen(v) >= 0 && onScreen(v) <= 100, m[0]);
  }
});

test("Josh: on a phone Doré's Jacob is never cropped at the edge, in the app or on the shared /e page", () => {
  assert.ok(
    door.includes(
      '@media (max-width:640px){.gathering-page .plate-ground.door-ground,[data-section="week"] [data-entered]>.plate-ground{background-position:6% 35%}}',
    ),
  );
});

test("the public h1s (About, Privacy, Terms, /e, 404) carry the door title's gilt glow", () => {
  assert.ok(door.includes(".door-ground~* h1{text-shadow:0 1px 0 rgba(0,0,0,.35),0 0 24px rgba(201,164,92,.12)}"));
});

test("Privacy and Terms stand on Dürer's Saint Jerome, with its own light; About and 404 keep Martin", () => {
  assert.ok(door.includes(".door-ground.doc-jerome{--door-art:url(/art/plate-rooms-A.webp)}"));
  assert.ok(door.includes(".plate-ground.door-ground.doc-jerome::after{--door-light:22% 22%}"));
  assert.match(door, /@media \(max-width:640px\)\{\n  \.door-ground\.doc-jerome\{--door-art:url\(\/art\/plate-rooms-A-900\.webp\)\}\n  \.plate-ground\.door-ground\.doc-jerome::after\{--door-light:12% 36%\}\n\}/);
  assert.ok(door.includes("@media (min-width:1600px){.door-ground.doc-jerome{--door-art:url(/art/plate-rooms-A-2400.webp)}}"));
  for (const f of ["plate-rooms-A.webp", "plate-rooms-A-900.webp", "plate-rooms-A-2400.webp"]) {
    assert.ok(readFileSync(new URL(`../../../public/art/${f}`, import.meta.url)).length > 0, f);
  }
  const notFound = readFileSync(new URL("../../components/not-found.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(notFound, /doc-jerome/);
});

test("the app /e card is as wide as the server one", () => {
  const gathering = readFileSync(new URL("../../../public/gathering.css", import.meta.url), "utf8");
  assert.ok(gathering.includes(".gathering-page .shell-body > main { width: min(1088px, 100%); margin-inline: auto; }"));
});

test("QA #130: at 320 the edge tabs keep their whole focus ring", () => {
  const fluid = readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  assert.ok(fluid.includes(".tabbar button:focus-visible{outline-offset:-3px}"));
});
