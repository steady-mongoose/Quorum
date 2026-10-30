import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";
import { plateCaption, plateCaptionWide } from "./engraved.ts";

/**
 * Josh, Oct 29: art on both sides of the text, never the same picture twice, only Doré, Martin, Dürer,
 * Rackham and Bauer. From 1600px every signed-in page shows one plate whose left and right edges are
 * different works, or crops of one work that share no figure. This renders each page under the real
 * sheets (with the old band and margin markup too, in case it ever comes back) at 1600, 1920 and 2560,
 * and fails if any screen shows the same file or panel twice, or an off-list artist.
 */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const root = read("src/routes/__root.tsx");
const sheets = [...root.matchAll(/href: "\/([a-z-]+\.css)"/g)].map((m) => read(`public/${m[1]}`)).join("\n");
const ON_LIST = /^(Gustave Doré|John Martin|Albrecht Dürer|Arthur Rackham|John Bauer)$/;

type Panel = { artist: string; work: string; box: [number, number, number, number] };
/** What each edge of each wide plate shows: source work and crop box (x0, y0, x1, y1, as fractions of the scan). */
const PLATES: Record<string, { left: Panel; right: Panel }> = {
  "plate-week-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "Jacob's Dream", box: [0, 0.45, 0.441, 0.95] },
    right: { artist: "Gustave Doré", work: "Jacob's Dream", box: [0.422, 0.055, 0.819, 0.505] },
  },
  "plate-rooms-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "Saint Jerome in His Study", box: [0.091, 0.125, 0.509, 0.575] },
    right: { artist: "Albrecht Dürer", work: "Saint Jerome in His Study", box: [0.488, 0.3, 0.952, 0.8] },
  },
  "plate-room-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "The Sermon on the Mount", box: [0.364, 0.105, 0.796, 0.555] },
    right: { artist: "Gustave Doré", work: "The Sermon on the Mount", box: [0.627, 0.55, 0.973, 0.91] },
  },
  "plate-groups-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "The Feast of the Rose Garlands", box: [0.09, 0.32, 0.451, 0.92] },
    right: { artist: "Albrecht Dürer", work: "The Feast of the Rose Garlands", box: [0.599, 0.28, 0.96, 0.88] },
  },
  "plate-group-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "Ruth and Boaz", box: [0, 0.225, 0.492, 0.775] },
    right: { artist: "Gustave Doré", work: "Ruth and Boaz", box: [0.508, 0.225, 1, 0.775] },
  },
  "plate-find-A-2400.webp": {
    left: { artist: "John Bauer", work: "Princess Tuvstarr", box: [0.36, 0.275, 0.754, 0.825] },
    right: { artist: "John Bauer", work: "Princess Tuvstarr", box: [0, 0.25, 0.358, 0.75] },
  },
  "plate-messages-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "Praying Hands", box: [0.138, 0.1, 0.862, 0.8] },
    right: { artist: "Albrecht Dürer", work: "Erasmus of Rotterdam", box: [0.487, 0.125, 0.993, 0.675] },
  },
  "plate-you-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "Self-Portrait at Thirteen", box: [0.171, 0.085, 0.73, 0.635] },
    right: { artist: "Albrecht Dürer", work: "Self-Portrait, 1500", box: [0.179, 0.115, 0.621, 0.565] },
  },
  "plate-desk-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "The Judgment of Solomon", box: [0.258, 0, 0.652, 0.45] },
    right: { artist: "Gustave Doré", work: "The Judgment of Solomon", box: [0, 0.3, 0.263, 0.6] },
  },
  // The door's plate, already 2400 wide: its left and its right half.
  "martin-hero-A.webp": {
    left: { artist: "John Martin", work: "The Creation of Light", box: [0, 0, 0.5, 1] },
    right: { artist: "John Martin", work: "The Creation of Light", box: [0.5, 0, 1, 1] },
  },
};

const PAGES: { name: string; section: string; view?: string; wide: string }[] = [
  { name: "This week", section: "week", wide: "plate-week-A-2400.webp" },
  { name: "Rooms", section: "rooms", wide: "plate-rooms-A-2400.webp" },
  { name: "A room", section: "rooms", view: "room", wide: "plate-room-A-2400.webp" },
  { name: "Groups", section: "groups", wide: "plate-groups-A-2400.webp" },
  { name: "A group", section: "groups", view: "group", wide: "plate-group-A-2400.webp" },
  { name: "Find", section: "find", wide: "plate-find-A-2400.webp" },
  { name: "Messages", section: "messages", wide: "plate-messages-A-2400.webp" },
  { name: "You", section: "profile", wide: "plate-you-A-2400.webp" },
  { name: "The desk", section: "civic", wide: "plate-desk-A-2400.webp" },
  { name: "About", section: "about", wide: "martin-hero-A.webp" },
];

function render(section: string, view: string | undefined, width: number) {
  const window = new Window({ url: "http://localhost/", width, height: Math.round(width * 0.5625) });
  const document = window.document;
  document.head.innerHTML = `<style>${sheets}</style>`;
  document.body.dataset.section = section;
  if (view) document.body.dataset.view = view;
  document.body.innerHTML = `<div class="shell" data-entered="true">
    <div class="plate-ground" aria-hidden="true"></div><div class="scrim" aria-hidden="true"></div>
    <div class="hero-band full" role="img"></div>
    <div class="shell-body"><div class="outer-art l"></div><div class="outer-art r"></div>
    <main id="main"><div class="with-side"><div class="min-w-0"></div><aside class="side-art"></aside></div>
    <p class="pc-credit pc-narrow">Plate</p><p class="pc-credit pc-wide">Plates</p></main></div></div>`;
  const shown: string[] = [];
  for (const el of document.querySelectorAll(".plate-ground,.hero-band,.outer-art,.side-art")) {
    const style = window.getComputedStyle(el);
    if (style.display === "none") continue;
    for (const m of style.backgroundImage.matchAll(/url\("?\/art\/([^")]+)"?\)/g)) shown.push(m[1]);
  }
  const display = (sel: string) => window.getComputedStyle(document.querySelector(sel)!).display;
  return { shown, narrow: display(".pc-narrow"), wide: display(".pc-wide") };
}

const overlap = (a: Panel["box"], b: Panel["box"]) => {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (r: Panel["box"]) => (r[2] - r[0]) * (r[3] - r[1]);
  return (w * h) / Math.min(area(a), area(b));
};

for (const width of [1600, 1920, 2560]) {
  test(`at ${width}px every page shows two different pictures, once each, all on Josh's list`, () => {
    for (const page of PAGES) {
      const { shown } = render(page.section, page.view, width);
      assert.deepEqual(shown, [page.wide], `${page.name} shows only its two-sided plate`);
      assert.equal(new Set(shown).size, shown.length, `${page.name}: a file twice`);
      const panels = shown.flatMap((f) => {
        const p = PLATES[f];
        assert.ok(p, `${page.name}: ${f} has no left/right manifest`);
        return [p.left, p.right];
      });
      for (const p of panels) assert.match(p.artist, ON_LIST, `${page.name}: ${p.artist}`);
      for (let i = 0; i < panels.length; i++) {
        for (let j = i + 1; j < panels.length; j++) {
          const [a, b] = [panels[i], panels[j]];
          if (a.work !== b.work) continue;
          // Same work: the two crops may touch, but must not share a figure (under 5% overlap).
          assert.ok(overlap(a.box, b.box) < 0.05, `${page.name}: ${a.work} twice at ${width}px`);
        }
      }
    }
  });
}

test("no two signed-in pages use the same wide plate, and every wide file is 2400 wide WebP under 140 KB", () => {
  const wides = PAGES.map((p) => p.wide);
  assert.equal(new Set(wides).size, wides.length);
  for (const f of wides) {
    const file = new URL(`../../../public/art/${f}`, import.meta.url);
    const buf = readFileSync(file);
    assert.equal(buf.subarray(8, 12).toString("ascii"), "WEBP", f);
    assert.ok(statSync(file).size < 140 * 1024, `${f} is ${statSync(file).size} B`);
  }
});

test("below 1600px each page keeps its single 1600px plate", () => {
  for (const page of PAGES.filter((p) => p.section !== "about")) {
    const { shown } = render(page.section, page.view, 1280);
    assert.equal(shown.length, 1, page.name);
    assert.match(shown[0], /^plate-[a-z]+-A\.webp$/, page.name);
  }
});

test("the credit chip names both works where the right edge is a second work", () => {
  assert.equal(plateCaptionWide("messages", null), "Albrecht Dürer · Praying Hands · 1508, and Erasmus of Rotterdam · 1526");
  assert.equal(plateCaptionWide("profile", null), "Albrecht Dürer · Self-Portrait at Thirteen · 1484, and Self-Portrait · 1500");
  assert.equal(plateCaptionWide("week", null), null);
  assert.equal(plateCaptionWide("groups", "group"), null);
  assert.equal(plateCaption("messages", null), "Albrecht Dürer · Erasmus of Rotterdam · 1526");
  const wide = render("messages", undefined, 1920);
  assert.deepEqual([wide.narrow, wide.wide], ["none", "block"]);
  const narrow = render("messages", undefined, 1280);
  assert.deepEqual([narrow.narrow === "none", narrow.wide], [false, "none"]);
  const app = read("src/components/board/app.tsx");
  assert.match(app, /<p className="pc-credit pc-wide">Plates: \{wideCaption\}<\/p>/);
});
