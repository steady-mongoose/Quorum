import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const nav = read("../../components/board/public-nav.tsx");
const css = read("../../../public/public-nav.css");
const doc = read("../../components/board/public-document.tsx");
const root = read("../../routes/__root.tsx");

test("every public document carries the menu, with a way home", () => {
  assert.ok(doc.includes("<PublicNav page={page} />"));
  for (const href of ['"/"', '"/about"', '"/privacy"', '"/terms"']) {
    assert.ok(nav.includes(`href: ${href}`), href);
  }
  assert.ok(root.includes('href: "/public-nav.css"'));
});

test("the menu marks where you are for a screen reader", () => {
  assert.ok(nav.includes('aria-current={item.href === page ? "page" : undefined}'));
  assert.ok(nav.includes('aria-current={section.id === reading ? "location" : undefined}'));
  assert.ok(nav.includes('aria-label="On this page"'));
});

test("a bookmark marks the page, and nothing else in the menu moves", () => {
  assert.ok(css.includes(".pn-pages .pn-link[aria-current]::before{transform"));
  const moving = css.slice(css.indexOf("@media (prefers-reduced-motion:no-preference)"));
  assert.equal(moving.includes("@keyframes"), false);
  assert.equal(nav.includes("style"), false);
});

test("every movement waits for no-preference, and links stay 44px", () => {
  const still = css.slice(0, css.indexOf("@media (prefers-reduced-motion:no-preference)"));
  assert.equal(still.includes("transition:"), false);
  assert.ok(css.includes("scroll-behavior:smooth"));
  assert.ok(still.includes("min-height:44px"));
});

test("each About group and list stands in its own box", () => {
  const about = read("../../components/board/about-view.tsx");
  assert.ok(about.includes("<div key={group.heading} className={box}>"));
  assert.equal(about.split("<section className={publicView ? box : listCard}>").length, 3);
});
