import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { KEYBOARD_MIN_PX, MAST_SELECTOR, MAST_VAR, keyboardOpen, mastHeightValue } from "./mast-height.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
const fluid = source("../../../public/fluid.css");
const backgrounds = source("../../../public/backgrounds.css");
const browse = source("../../components/board/room-browse.tsx");
const app = source("../../components/board/app.tsx");
const line = source("../../components/board/line.tsx");
const rings = source("../../components/board/call-rings.tsx");
const chat = source("../../components/board/room-chat.tsx");
const heads = source("./route-heads.ts");
const hook = source("./mast-height.ts");

test("Rooms chip row sticks at the measured header height, not a fixed 8rem (Josh, 29 Oct)", () => {
  assert.doesNotMatch(browse, /sticky top-32/);
  assert.match(browse, /className="room-chips sticky z-10/);
  // 1px under the header's rule: --mast-h rounds up, so a flush top left a 0.81px sliver (Design, #121)
  assert.match(fluid, /\.room-chips\{top:calc\(var\(--mast-h\) - 1px\)/);
  assert.doesNotMatch(fluid, /\.room-chips\{top:var\(--mast-h\)/);
  // desktop category list follows the header too, instead of top-28
  assert.match(browse, /sticky top-\[calc\(var\(--mast-h\)\+1rem\)\] hidden w-\[14rem\]/);
  // first-paint guesses until the hook measures
  assert.match(fluid, /:root\{--mast-h:70px\}/);
});

test("useMastHeight measures .mast-bar with a ResizeObserver and writes --mast-h on :root", () => {
  assert.equal(MAST_SELECTOR, ".mast-bar");
  assert.equal(MAST_VAR, "--mast-h");
  assert.match(hook, /new ResizeObserver\(/);
  assert.match(hook, /documentElement/);
  assert.match(app, /import \{ useMastHeight \} from "@\/lib\/board\/mast-height"/);
  assert.match(app, /useMastHeight\(\);/);
  assert.equal(mastHeightValue(68.6), "69px");
  assert.equal(mastHeightValue(97), "97px");
  assert.equal(mastHeightValue(0), null);
  assert.equal(mastHeightValue(Number.NaN), null);
});

test("the header is opaque and above every in-page sticky layer", () => {
  const mast = fluid.slice(fluid.indexOf(".mast-bar{"), fluid.indexOf("}", fluid.indexOf(".mast-bar{")));
  assert.match(mast, /position:sticky/);
  assert.match(mast, /z-index:40/);
  assert.match(mast, /background:var\(--bg\)/);
  assert.match(mast, /padding-top:env\(safe-area-inset-top\)/);
});

test("the shell rule leaves the skip link, call rings, 20-minute line and dialogs in their own position", () => {
  const rule = backgrounds.match(/\.shell>\*([^{]*)\{position:relative;z-index:1\}/);
  assert.ok(rule, "shell rule present");
  for (const keep of [".skip-link", ".call-rings", ".session-line", "dialog", ".top", ".tabbar"]) {
    assert.ok(rule[1].includes(`:not(${keep})`), `shell rule excludes ${keep}`);
  }
  assert.match(app, /className="skip-link sr-only/);
  // #127: the ring card sits in a box-less `call-rings` wrapper (the shell's direct child),
  // and the card inside it is position: fixed.
  assert.match(rings, /WRAPPER = "call-rings contents"/);
  assert.match(rings, /const CARD =\s*"fixed /);
  assert.match(line, /className="session-line fixed/);
});

test("viewport-fit=cover, and the tab bar respects the safe-area insets", () => {
  assert.match(heads, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.match(fluid, /padding-inline:env\(safe-area-inset-left\) env\(safe-area-inset-right\)/);
});

test("the 20-minute line sits on top of the tab bar, sharing #119's --tabbar-h:57px", () => {
  // #119's declaration, inside the phone tab bar block, is the one copy (QA M1 on #121).
  const phone = fluid.indexOf("/* Phone: five slots in one row.");
  assert.ok(phone >= 0);
  assert.match(fluid.slice(phone, phone + 300), /@media \(max-width:767px\)\{[^}]*:root\{--tabbar-h:57px\}/);
  assert.doesNotMatch(fluid, /@media \(max-width:767px\)\{:root\{--tabbar-h:57px\}\}/);
  assert.match(line, /bottom-\[calc\(var\(--tabbar-h,57px\)\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(line, /bottom-\[calc\(56px/);
});

test("an open dialog or sheet locks page scroll; overscroll is contained and bounces in the page colour", () => {
  assert.match(fluid, /html:has\(dialog:modal\)\{overflow:hidden/);
  assert.match(fluid, /dialog\{overscroll-behavior:contain\}/);
  assert.match(fluid, /html\{background:var\(--bg\);scroll-padding-top:calc\(var\(--mast-h\) \+ \.5rem\)\}/);
  // QA S3: the nested chat scroller no longer chains to the page
  assert.match(chat, /max-h-96 flex-col gap-2 overflow-y-auto overscroll-contain/);
});

test("the tab bar and 20-minute line step aside while the on-screen keyboard is open", () => {
  assert.match(hook, /visualViewport/);
  assert.match(fluid, /html\[data-keyboard="open"\] :is\(\.tabbar,\.session-line\)\{display:none\}/);
  assert.equal(keyboardOpen(844, 844), false);
  assert.equal(keyboardOpen(844, 844 - KEYBOARD_MIN_PX), false);
  assert.equal(keyboardOpen(844, 500), true);
  assert.equal(keyboardOpen(844, 500, 2), false, "pinch zoom is not the keyboard");
  assert.equal(keyboardOpen(0, 0), false);
});

test("viewport units: no bare vh where the iOS toolbar changes it", () => {
  assert.doesNotMatch(backgrounds, /height:calc\(100vh/);
  assert.doesNotMatch(backgrounds, /\b62vh\b/);
  assert.match(backgrounds, /height:100lvh;margin-bottom:-100lvh/);
  assert.match(source("../../components/board/room-call.tsx"), /landscape:max-h-\[50svh\]/);
  assert.doesNotMatch(source("../../components/not-found.tsx"), /min-h-screen/);
  assert.doesNotMatch(source("../error-component.tsx"), /min-h-screen/);
});

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector}{`);
  assert.ok(at >= 0, `${selector} rule present`);
  return css.slice(at, css.indexOf("}", at) + 1);
}

test("the chip row's top sits at or above the header's bottom", () => {
  const chipTop = (mast: number) => mast - 1; // calc(var(--mast-h) - 1px)
  for (const measured of [68.6, 69.19, 70, 96.4, 97]) {
    const published = Number.parseFloat(mastHeightValue(measured) ?? "NaN");
    assert.ok(chipTop(published) <= measured, `${measured}px header: chips at ${chipTop(published)}px`);
  }
});

test("the chip row runs to the screen edge so the next chip peeks in; no fade over chip text", () => {
  const chips = rule(fluid, ".room-chips");
  assert.match(chips, /margin-inline:calc\(-1 \* var\(--gutter-l\)\) calc\(-1 \* var\(--gutter-r\)\)/);
  assert.match(chips, /padding-inline:var\(--gutter-l\) var\(--gutter-r\)/);
  assert.match(chips, /scroll-padding-inline:var\(--gutter-l\) var\(--gutter-r\)/);
  assert.match(chips, /scroll-snap-type:x proximity/);
  assert.match(fluid, /\.room-chips>\*\{scroll-snap-align:start;flex:none\}/);
  assert.doesNotMatch(fluid, /\.room-chips[^{]*\{[^}]*(mask|gradient)/);
  assert.doesNotMatch(browse, /room-chips[^"]*(mask|gradient|px-|mx-)/);
});

test("focused controls clear the tab bar on phones and the chip row on Rooms below 1024px", () => {
  assert.match(
    fluid,
    /@media \(max-width:767px\)\{html\{scroll-padding-bottom:calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ \.5rem \+ var\(--call-card-h,0px\)\)\}\}/,
  );
  assert.match(
    fluid,
    /@media \(max-width:1023px\)\{html:has\(\.room-chips\)\{scroll-padding-top:calc\(var\(--mast-h\) \+ var\(--chips-h\) \+ \.5rem\)\}\}/,
  );
});

test("header controls cancel the scroll padding, so focusing them never scrolls the page (QA B1 on #121)", () => {
  // html scroll-padding-top treats the sticky header's own controls as obscured by it: at 1280, header focus
  // scrolled 1200 to 745 and the desktop More dialog 700 to 245 to 0. Each padding gets an equal negative margin.
  assert.match(fluid, /\.mast-bar,\.mast-bar \*\{scroll-margin-top:calc\(-1 \* \(var\(--mast-h\) \+ \.5rem\)\)\}/);
  assert.match(
    fluid,
    /@media \(max-width:1023px\)\{html:has\(\.room-chips\) :is\(\.mast-bar,\.mast-bar \*,\.room-chips,\.room-chips \*\)\{scroll-margin-top:calc\(-1 \* \(var\(--mast-h\) \+ var\(--chips-h\) \+ \.5rem\)\)\}\}/,
  );
  // Every scroll-padding-top on html has a matching cancel on the header.
  const pads = [...fluid.matchAll(/scroll-padding-top:calc\(([^;}]+)\)[;}]/g)].map((m) => m[1]);
  const cancels = [...fluid.matchAll(/scroll-margin-top:calc\(-1 \* \(([^;}]+)\)\)[;}]/g)].map((m) => m[1]);
  assert.ok(pads.length >= 2);
  assert.deepEqual([...new Set(cancels)].sort(), [...new Set(pads)].sort());
  // The chip-row pad also needs its cancel on the chips themselves, or focusing a chip below 1024px scrolls the
  // page 1200 to 840 at 390 (QA S2 on #121).
  assert.match(fluid, /html:has\(\.room-chips\) :is\([^)]*\.room-chips,\.room-chips \*\)\{scroll-margin-top:calc\(-1 \* \(var\(--mast-h\) \+ var\(--chips-h\) \+ \.5rem\)\)\}/);
  assert.doesNotMatch(fluid, /3\.75rem \+/);
  assert.match(fluid, /--chips-h:3\.75rem/);
});

test("desktop reserves a showing call card too, and the phone rules come after and win (Design M2 on #128)", () => {
  // At 1280 the card (649-773) sat on the chat field (744-800): only the phone rules added --call-card-h.
  const desktopPad = /^html\{scroll-padding-bottom:var\(--call-card-h,0px\)\}$/m;
  const desktopMain = /^\.shell-body > main\{padding-bottom:calc\(var\(--space-4\) \+ var\(--call-card-h,0px\)\)\}$/m;
  assert.match(fluid, desktopPad, "top level, not inside a media query");
  assert.match(fluid, desktopMain, "top level, not inside a media query");
  const phonePad = fluid.indexOf("@media (max-width:767px){html{scroll-padding-bottom:");
  const phoneMain = fluid.indexOf(".shell-body > main{padding-bottom:calc(var(--tabbar-h,56px)");
  assert.ok(phonePad > 0 && phoneMain > 0);
  assert.ok(fluid.search(desktopPad) < phonePad, "the phone scroll padding comes later");
  assert.ok(fluid.search(desktopMain) < phoneMain, "the phone main padding comes later");
});

test("from 768px a showing card's 1.5rem lift is reserved too, and nothing changes with no card (Design L1 on #128)", () => {
  const block = fluid.match(/@media \(min-width:768px\)\{\n([^@]*?)\n\}/)?.[1] ?? "";
  assert.match(block, /html\{scroll-padding-bottom:calc\(var\(--call-card-h,0px\) \+ min\(var\(--call-card-h,0px\),2rem\)\)\}/);
  assert.match(
    block,
    /\.shell-body > main\{padding-bottom:calc\(var\(--space-4\) \+ var\(--call-card-h,0px\) \+ min\(var\(--call-card-h,0px\),1\.5rem\)\)\}/,
  );
  // Every extra term is the card's height or capped by it, so with no card (0px) both add nothing.
  const mins = block.match(/min\(/g)?.length ?? 0;
  assert.equal(mins, 2);
  assert.equal(block.match(/min\(var\(--call-card-h,0px\),[\d.]+rem\)/g)?.length, mins);
});

test("the desktop --mast-h first-paint guess is the measured 84px board header (QA N1)", () => {
  assert.match(fluid, /@media \(min-width:768px\)\{:root\{--mast-h:84px\}\}/);
  assert.doesNotMatch(fluid, /--mast-h:97px/);
});

test("main reserves the tab bar's own height, and --tabbar-h:57px is declared exactly once", () => {
  assert.match(
    fluid,
    /\.shell-body > main\{padding-bottom:calc\(var\(--tabbar-h,56px\) \+ 1rem \+ env\(safe-area-inset-bottom\) \+ var\(--call-card-h,0px\)\)\}/,
  );
  assert.doesNotMatch(fluid, /padding-bottom:calc\(56px \+ 1rem/);
  assert.equal(fluid.match(/--tabbar-h:57px/g)?.length, 1);
});

test("landscape: the 20-minute line pads to the notch on each side", () => {
  assert.match(
    fluid,
    /\.session-line\{padding-inline:max\(1rem,env\(safe-area-inset-left\)\) max\(1rem,env\(safe-area-inset-right\)\)\}/,
  );
  assert.doesNotMatch(line, /className="session-line[^"]*\bpx-4\b/);
});

test("the plate keeps lvh, never dvh", () => {
  assert.match(backgrounds, /\.plate-ground\{[^}]*height:100lvh/);
  assert.doesNotMatch(backgrounds, /\.plate-ground\{[^}]*100dvh/);
});
