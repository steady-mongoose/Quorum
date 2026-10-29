import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { artSection, heroLabel, showsHero } from "./engraved.ts";
import type { Section } from "./model.ts";

const pageArt = readFileSync(new URL("../../../public/page-art.css", import.meta.url), "utf8");
const backgrounds = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
const NEW_PAGES = ["find", "groups", "profile", "about", "civic"] as const;
const ALL: Section[] = ["week", "rooms", "messages", "find", "groups", "profile", "about", "civic"];

test("every signed-in page carries a plate and names what it shows", () => {
  for (const section of ALL) {
    const art = artSection({ entered: true, section, signingIn: false });
    assert.equal(art, section);
    assert.equal(showsHero(art), true, section);
    assert.ok(heroLabel(art), section);
  }
  assert.equal(showsHero("landing"), false);
  assert.equal(heroLabel("signin"), null);
});

test("each page has its own work, except Messages, which shares the Rooms band", () => {
  const labels = ALL.filter((s) => s !== "messages").map((s) => heroLabel(s));
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(heroLabel("messages"), heroLabel("rooms"));
  // Messages has its own margin plate, the Praying Hands.
  assert.match(backgrounds, /--art-messages-side:url\("\/art\/durer-hands-side-A\.webp"\)/);
});

test("the new pages have a band, a phone band, and a margin plate in both palettes", () => {
  for (const page of NEW_PAGES) {
    assert.ok(pageArt.includes(`[data-section="${page}"] .hero-band{--band:var(--art-${page}-band)`), `${page} band`);
    assert.ok(pageArt.includes(`[data-section="${page}"] .outer-art{background-image:var(--art-${page}-side)`), `${page} outer plates`);
  }
  const urls = [...pageArt.matchAll(/url\("(\/art\/[^"]+\.webp)"\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 30, "five works, band, phone band, and margin, in A and B");
  for (const url of urls) {
    const file = new URL(`../../../public${url}`, import.meta.url);
    const size = statSync(file).size;
    assert.ok(size > 1000 && size < 400 * 1024, `${url} is ${size} bytes`);
    const head = readFileSync(file).subarray(0, 12);
    assert.equal(head.subarray(8, 12).toString("ascii"), "WEBP", url);
  }
  for (const palette of ["A", "B"]) {
    for (const work of ["rembrandt-preaching", "millet-diggers", "rembrandt-self", "rembrandt-trees", "durand-declaration"]) {
      for (const kind of ["band", "band-900", "side"]) {
        const name = kind === "band-900" ? `${work}-band-${palette}-900` : `${work}-${kind}-${palette}`;
        assert.ok(urls.includes(`/art/${name}.webp`), name);
      }
    }
  }
});

test("Find keeps its own column, so its side plate shows only on the outer edges", () => {
  assert.match(pageArt, /\[data-section="find"\] \.with-side\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(pageArt, /\[data-section="find"\] \.side-art\{display:none\}/);
});

test("the page art loads after fluid.css and stays small", () => {
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.ok(root.indexOf('href: "/page-art.css"') > root.indexOf('href: "/fluid.css"'));
  assert.ok(gzipSync(pageArt).length <= 2 * 1024);
  assert.equal(pageArt.includes("martin"), false, "Martin stays on the door");
});

test("About, Privacy, and Terms carry the About plate", () => {
  const doc = readFileSync(new URL("../../components/board/public-document.tsx", import.meta.url), "utf8");
  assert.match(doc, /useEngravedDocument\("about"\);/);
  assert.match(doc, /<div className="hero-band full" role="img" aria-label=\{heroLabel\("about"\) \?\? undefined\} \/>/);
});

test("every new work is credited with its source and licence", () => {
  const credits = readFileSync(new URL("../../../public/art/ATTRIBUTION.md", import.meta.url), "utf8");
  for (const work of ["rembrandt-preaching", "millet-diggers", "rembrandt-self", "rembrandt-trees", "durand-declaration"]) {
    assert.ok(credits.includes("`" + work + "-band-A.webp`"), work);
  }
  assert.equal((credits.match(/\| CC0 \(/g) ?? []).length >= 7, true);
});
