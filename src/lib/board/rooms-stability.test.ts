import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Rooms paints the signed-in header from the entered cookie, with no new motion", () => {
  const browse = source("../../components/board/room-browse.tsx");
  const fluid = source("../../../public/fluid.css");
  const app = source("../../components/board/app.tsx");
  assert.match(browse, /sticky top-\[calc\(var\(--mast-h\)\+1rem\)\]/);
  assert.match(browse, /id="your-rooms"/);
  assert.match(fluid, /@media \(min-width:48em\)\{:root\{--mast-h:84px\}\}/);
  assert.match(app, /function useInitialEntered\(\)/);
  assert.match(app, /function effectiveEntered\(/);
  assert.match(fluid, /@media \(max-width:47\.99em\)\{\.hero-band\{height:clamp\(140px,46vw,180px\)\}\}/);
  assert.match(fluid, /\.topnav :is\(a, button\):focus-visible \{ outline-offset: -2px; \}/);
  assert.doesNotMatch(browse, /animate-pulse|backdrop-filter|blur\(/);
  assert.doesNotMatch(fluid, /backdrop-filter|blur\(/);
});
