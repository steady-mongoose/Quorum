import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { artSection, heroLabel } from "./engraved.ts";
import type { Section } from "./model.ts";

const pageArt = readFileSync(new URL("../../../public/page-art.css", import.meta.url), "utf8");
const backgrounds = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
const ALL: Section[] = ["week", "rooms", "messages", "find", "groups", "profile", "about", "civic"];
/** Josh's approved artists. */
const ON_LIST = /Doré|Martin|Dürer|Rackham|Bauer/;

test("every signed-in section resolves to its own art key", () => {
  for (const section of ALL) {
    const art = artSection({ entered: true, section, signingIn: false });
    assert.equal(art, section);
    assert.ok(heroLabel(art), section);
  }
  assert.equal(heroLabel("signin"), null);
});

test("each page names its own work, by an approved artist, except Messages, which shares the Rooms band", () => {
  const labels = ALL.filter((s) => s !== "messages").map((s) => heroLabel(s));
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(heroLabel("messages"), heroLabel("rooms"));
  for (const s of ALL) assert.match(heroLabel(s) ?? "", ON_LIST, s);
  assert.match(backgrounds, /--art-messages-side:url\("\/art\/durer-hands-side-A\.webp"\)/);
});

test("the public About band is the right half of Martin's Creation of Light, the door's file", () => {
  assert.ok(
    pageArt.includes(
      '[data-section="about"] .hero-band{--band:var(--art-landing);--band-h:clamp(150px,18vw,240px);background-position:75% 40%}',
    ),
  );
  assert.equal([...pageArt.matchAll(/url\(/g)].length, 0, "no file of its own");
  assert.equal(heroLabel("about"), "John Martin, The Creation of Light, 1824–27");
});

test("the off-list works and the old right-margin crops are gone from public/art", () => {
  const files = readdirSync(new URL("../../../public/art/", import.meta.url));
  const stray = files.filter((f) => /rembrandt|millet|durand|trumbull|-side-R-/i.test(f));
  assert.deepEqual(stray, []);
  for (const css of [pageArt, backgrounds]) assert.doesNotMatch(css, /rembrandt|millet|durand/);
});

test("Save-Data and reduced-data drop the band, margin and side art", () => {
  assert.ok(
    pageArt.includes(
      "[data-save-data] .shell .hero-band,[data-save-data] .shell .outer-art,[data-save-data] .shell .side-art,[data-save-data] .shell .margin-art{background-image:none!important}",
    ),
  );
  assert.ok(
    pageArt.includes(
      "@media (prefers-reduced-data:reduce){.shell .hero-band,.shell .outer-art,.shell .side-art,.shell .margin-art{background-image:none!important}}",
    ),
  );
});

test("the page art loads after fluid.css and stays small", () => {
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.ok(root.indexOf('href: "/page-art.css"') > root.indexOf('href: "/fluid.css"'));
  assert.ok(gzipSync(pageArt).length <= 2 * 1024);
});

test("About, Privacy, and Terms carry the About band", () => {
  const doc = readFileSync(new URL("../../components/board/public-document.tsx", import.meta.url), "utf8");
  assert.match(doc, /useEngravedDocument\("about"\);/);
  assert.match(doc, /<div className="hero-band full" role="img" aria-label=\{heroLabel\("about"\) \?\? undefined\} \/>/);
});

test("ATTRIBUTION credits no off-list artist", () => {
  const credits = readFileSync(new URL("../../../public/art/ATTRIBUTION.md", import.meta.url), "utf8");
  const rows = credits.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Screen") && /\.webp/.test(l));
  assert.ok(rows.length >= 10);
  for (const row of rows) assert.match(row.split("|")[2] + row.split("|")[3], ON_LIST, row.slice(0, 80));
  assert.doesNotMatch(credits, /`(rembrandt|millet|durand)-/);
});
