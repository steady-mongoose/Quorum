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
/** What each edge of each wide plate shows: source work and crop box (x0, y0, x1, y1, as fractions of the scan;
 *  below 0 or above 1 where the panel runs past the scan and fades to the dark ground). */
const PLATES: Record<string, { left: Panel; right: Panel }> = {
  "plate-week-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "Jacob's Dream", box: [0.109, 0.5, 0.55, 1.0] },
    right: { artist: "Gustave Doré", work: "Jacob's Dream", box: [0.422, 0.055, 0.819, 0.505] },
  },
  "plate-rooms-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "Saint Jerome in His Study", box: [0.409, 0.65, 0.734, 1.0] },
    right: { artist: "Albrecht Dürer", work: "Saint Jerome in His Study", box: [0.408, 0.287, 0.742, 0.647] },
  },
  "plate-room-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "The Sermon on the Mount", box: [0.389, 0.105, 0.821, 0.555] },
    right: { artist: "Gustave Doré", work: "The Sermon on the Mount", box: [0.627, 0.55, 0.973, 0.91] },
  },
  "plate-groups-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "The Feast of the Rose Garlands", box: [0, 0.29, 0.361, 0.89] },
    right: { artist: "Albrecht Dürer", work: "The Feast of the Rose Garlands", box: [0.639, 0.24, 1.0, 0.84] },
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
    right: { artist: "Albrecht Dürer", work: "Erasmus of Rotterdam", box: [0.202, -0.075, 0.823, 0.6] },
  },
  "plate-you-A-2400.webp": {
    left: { artist: "Albrecht Dürer", work: "Self-Portrait at Thirteen", box: [0.156, -0.28, 1.456, 1.0] },
    right: { artist: "Albrecht Dürer", work: "Self-Portrait, 1500", box: [-0.026, -0.037, 0.688, 0.689] },
  },
  "plate-desk-A-2400.webp": {
    left: { artist: "Gustave Doré", work: "The Judgment of Solomon", box: [0.338, 0, 0.732, 0.45] },
    right: { artist: "Gustave Doré", work: "The Judgment of Solomon", box: [0, 0.265, 0.325, 0.636] },
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

/**
 * QA 5707271934 S4: where the faces are. Each wide plate's key heads, in canvas pixels of the 2400x1350
 * file, and the narrowest 16:9 screen at which each must sit whole in a margin: clear of the real text
 * column (width taken from the sheets: `min(60rem,100%)` at the root font size the clamp in styles.css
 * gives), below the sticky header, inside the screen, and clear of the panel's fade into the dark middle.
 * The plate is drawn `center 35%/cover`, also read from the sheets. Boxes were measured on the files.
 */
const HEADER_PX = 115; // the sticky header, measured in the real app at 1600-2560 (QA measured 113; 115 is the stricter)
const HEADS: Record<string, { who: string; box: [number, number, number, number]; from: number }[]> = {
  "plate-messages-A-2400.webp": [{ who: "Erasmus", box: [2020, 210, 2150, 570], from: 1600 }],
  "plate-you-A-2400.webp": [
    { who: "the boy at thirteen", box: [8, 435, 380, 735], from: 1600 },
    { who: "Dürer at twenty-eight", box: [2020, 400, 2320, 880], from: 1600 },
  ],
  "plate-groups-A-2400.webp": [
    { who: "the man in the black cap (left)", box: [170, 340, 260, 490], from: 1600 },
    { who: "the man in the black cap (right)", box: [2030, 500, 2140, 620], from: 1600 },
  ],
  "plate-desk-A-2400.webp": [
    { who: "the woman in the turban", box: [130, 400, 230, 560], from: 1600 },
    { who: "the mother", box: [2050, 330, 2240, 520], from: 1600 },
  ],
  "plate-rooms-A-2400.webp": [
    { who: "the lion", box: [40, 420, 380, 800], from: 1600 },
    { who: "Saint Jerome", box: [2040, 600, 2250, 870], from: 1600 },
  ],
  "plate-room-A-2400.webp": [
    { who: "Christ", box: [250, 600, 360, 725], from: 1600 },
    { who: "the woman beside Christ", box: [40, 710, 115, 805], from: 1600 },
  ],
  "plate-week-A-2400.webp": [{ who: "Jacob", box: [230, 420, 380, 520], from: 1600 }],
};

const rootPx = (vw: number) => {
  const css = read("src/styles.css");
  // In rem, so it follows the browser default; these boxes assume the 16px default.
  const m = css.match(/font-size:\s*clamp\(([\d.]+)rem,\s*([\d.]+)rem\s*\+\s*([\d.]+)vw,\s*([\d.]+)rem\)/);
  assert.ok(m, "root font-size clamp not found in styles.css");
  const [lo, rem, vwk, hi] = m.slice(1).map(Number);
  return Math.min(hi * 16, Math.max(lo * 16, rem * 16 + (vwk * vw) / 100));
};
const column = (vw: number) => {
  const m = sheets.match(/@media \(min-width:(\d+)px\)\{\[data-entered\] \.shell-body>main\{width:min\(([\d.]+)rem,100%\)/);
  assert.ok(m, "the column width rule is not in the sheets");
  return vw >= Number(m[1]) ? Math.min(Number(m[2]) * rootPx(vw), vw) : vw;
};

test("the plate is drawn center 35% / cover, which the face boxes assume", () => {
  assert.match(sheets, /\[data-entered\]>\.plate-ground\{background:var\(--pc-plate\) center 35%\/cover no-repeat/);
  assert.equal(column(1600), 1080, "the real column is 60rem at 18px");
});

for (const [vw, vh] of [[1600, 900], [1700, 956], [1920, 1080], [2560, 1440]] as const) {
  test(`at ${vw}x${vh} every listed head sits whole in a margin, below the header, off the column and the fade`, () => {
    const s = Math.max(vw / 2400, vh / 1350);
    const ox = (vw - 2400 * s) * 0.5;
    const oy = (vh - 1350 * s) * 0.35;
    const toX = (px: number) => (px - ox) / s; // screen x to canvas x
    const col = column(vw);
    const leftEnd = toX((vw - col) / 2);
    const rightStart = toX((vw + col) / 2);
    const top = (HEADER_PX - oy) / s;
    const bottom = (vh - oy) / s;
    for (const [file, heads] of Object.entries(HEADS)) {
      for (const { who, box, from } of heads) {
        if (vw < from) continue;
        const [x0, y0, x1, y1] = box;
        const left = x1 <= 960;
        const where = `${file} ${who} [${box}] at ${vw}x${vh}`;
        if (left) {
          assert.ok(x0 >= toX(0) && x1 <= leftEnd, `${where}: not whole in the left margin (canvas ${Math.round(toX(0))}-${Math.round(leftEnd)})`);
          assert.ok(x1 <= 640, `${where}: runs into the fade at 640`);
        } else {
          assert.ok(x0 >= 1440, `${where}: in the dark middle`);
          assert.ok(x0 >= rightStart && x1 <= toX(vw), `${where}: not whole in the right margin (canvas ${Math.round(rightStart)}-${Math.round(toX(vw))})`);
          assert.ok(x0 >= 1760, `${where}: runs into the fade at 1760`);
        }
        assert.ok(y0 >= top && y1 <= bottom, `${where}: under the header or off the screen (canvas ${Math.round(top)}-${Math.round(bottom)})`);
      }
    }
  });
}

test("every wide plate's heads are on the manifest's two-sided list", () => {
  for (const f of Object.keys(HEADS)) assert.ok(PLATES[f], f);
});
