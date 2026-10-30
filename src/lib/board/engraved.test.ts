import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { artAttribute, artSection, heroLabel, isEveningHour } from "./engraved.ts";

function contrast(foreground: string, background: string): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");

test("the engraved stylesheet stays under 3 KB gzipped", () => {
  assert.ok(gzipSync(css).length <= 3 * 1024);
});

test("Martin is only the landing and the sign-in plate", () => {
  assert.match(css, /--art-landing:url\("\/art\/martin-hero-A\.webp"\)/);
  assert.match(css, /\[data-section="landing"\],\[data-section="signin"\]\{background:var\(--bg\)\}/);
  assert.match(
    css,
    /\[data-section="landing"\] \.plate-ground,\[data-section="signin"\] \.plate-ground\{background:var\(--art-landing\) center 30%\/cover no-repeat\}/,
  );
  assert.match(css, /\.plate-ground\{position:sticky/);
  assert.equal(css.includes("no-repeat fixed"), false);
  assert.equal([...css.matchAll(/var\(--art-landing\)/g)].length, 1);
  assert.equal(css.includes("martin-creation"), false);
  assert.equal(artSection({ entered: false, section: "week", signingIn: false }), "landing");
  assert.equal(artSection({ entered: false, section: "week", signingIn: true }), "signin");
  assert.equal(artSection({ entered: true, section: "week", signingIn: false }), "week");
  assert.equal(artSection({ entered: true, section: "rooms", signingIn: false }), "rooms");
  assert.equal(artSection({ entered: true, section: "messages", signingIn: false }), "messages");
  assert.equal(artSection({ entered: true, section: "find", signingIn: false }), "find");
  assert.equal(artSection({ entered: true, section: "about", signingIn: false }), "about");
  assert.equal(artSection({ entered: true, section: "profile", signingIn: false }), "profile");
  assert.equal(artSection({ entered: true, section: "civic", signingIn: false }), "civic");
});

test("no destruction or apocalyptic plate is shipped", () => {
  const names = readdirSync(new URL("../../../public/art", import.meta.url));
  const banned = /apocalyp|destruction|adam-and-eve|morning-hymn|deluge|pandemonium|fallen-angels/i;
  assert.equal(names.some((name) => banned.test(name)), false);
  assert.equal(css.search(banned), -1);
});

test("every plate the stylesheet names is a WebP in public/art", () => {
  const urls = [...css.matchAll(/url\("(\/art\/[^"]+\.webp)"\)/g)].map((match) => match[1]);
  assert.ok(urls.length >= 8);
  for (const url of urls) {
    const file = new URL(`../../../public${url}`, import.meta.url);
    const size = statSync(file).size;
    assert.ok(size > 1000, url);
    assert.ok(size < 400 * 1024, url);
    const bytes = readFileSync(file).subarray(0, 12);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
  }
});

test("the desktop Doré week bands are about 160 KB", () => {
  for (const name of ["dore-band-A.webp", "dore-band-B.webp"]) {
    const size = statSync(new URL(`../../../public/art/${name}`, import.meta.url)).size;
    assert.ok(size >= 140 * 1024 && size <= 180 * 1024, `${name} is ${size} bytes`);
  }
});

test("EB Garamond is a Latin WOFF2 pair of about 100 KB, and only the roman is preloaded", () => {
  const fonts = new URL("../../../public/fonts/", import.meta.url);
  const roman = statSync(new URL("EBGaramond-latin.woff2", fonts)).size;
  const italic = statSync(new URL("EBGaramond-italic-latin.woff2", fonts)).size;
  assert.ok(roman + italic < 110 * 1024, `${roman + italic} bytes`);
  assert.equal(roman > 20 * 1024 && italic > 10 * 1024, true);
  const names = readdirSync(fonts);
  assert.equal(names.some((name) => name.endsWith(".ttf")), false);
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  assert.match(root, /EBGaramond-latin\.woff2/);
  assert.equal(root.includes("EBGaramond-italic-latin.woff2"), false);
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(styles, /font-size:\s*clamp\(16px,\s*0\.95rem \+ 0\.25vw,\s*18px\)/);
});

test("reduced data and the first paint skip the art URL", () => {
  assert.match(css, /prefers-reduced-data:\s*reduce/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:none!important/);
  assert.equal(artAttribute({ painted: false, reducedData: false, section: "week" }), null);
  assert.equal(artAttribute({ painted: true, reducedData: true, section: "landing" }), null);
  assert.equal(artAttribute({ painted: true, reducedData: false, section: "rooms" }), "rooms");
});

test("evening is the local night hours only, with no animation of its own", () => {
  assert.equal(isEveningHour(18), true);
  assert.equal(isEveningHour(23), true);
  assert.equal(isEveningHour(4), true);
  assert.equal(isEveningHour(5), false);
  assert.equal(isEveningHour(12), false);
  assert.match(css, /data-evening/);
  assert.equal(css.includes("@keyframes evening"), false);
});

test("ink and bone text clears WCAG AA on the card, including evening", () => {
  const pairs: Array<[string, string, number]> = [
    ["#f0e7d3", "#241d16", 4.5],
    ["#bcae94", "#241d16", 4.5],
    ["#bcae94", "#14100c", 4.5],
    ["#f0e7d3", "#17110b", 4.5],
    ["#bcae94", "#17110b", 4.5],
    ["#c9a45c", "#14100c", 3],
    ["#c9a45c", "#241d16", 3],
    ["#b4483e", "#241d16", 3],
    ["#b4483e", "#14100c", 3],
    ["#1f1912", "#f8f3e7", 4.5],
    ["#5e5242", "#f8f3e7", 4.5],
    ["#14100c", "#f0e7d3", 4.5],
  ];
  for (const [fg, bg, min] of pairs) {
    assert.ok(contrast(fg, bg) >= min, `${fg} on ${bg}`);
  }
  // Oxblood is a large initial, not body text: it clears 3:1 and misses 4.5:1.
  assert.ok(contrast("#b4483e", "#241d16") < 4.5);
  assert.match(css, /\.illum::first-letter\{color:var\(--accent\)/);
  const illum = css.match(/\.illum::first-letter\{[^}]+\}/)?.[0] ?? "";
  assert.equal(illum.includes("border-bottom"), false);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\[data-section\]\{background-attachment:scroll\}/);
  assert.equal(css.includes("background-attachment:fixed"), false);
  assert.equal(css.includes("filter:blur"), false);
  assert.ok(contrast("#8f6f2f", "#f0e7d3") >= 3, "focus ring on the bone button");
  assert.ok(contrast("#8f6f2f", "#ece2cc") >= 3, "parchment focus ring");
  assert.ok(contrast("#8f6f2f", "#fffaf0") >= 3, "parchment focus ring on the raised card");
  assert.ok(contrast("#8f6f2f", "#14100c") >= 3, "focus ring on the ink ground");
  assert.match(css, /--focus:#8f6f2f/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--focus\)/);
  assert.match(css, /@media \(max-width:1023px\)\{[^]*dore-band-A-900\.webp/);
  assert.equal([...css.matchAll(/var\(--accent\)/g)].length, 1);
  const adjust = readFileSync(new URL("../../../public/engraved-adjust.css", import.meta.url), "utf8");
  assert.equal(adjust.includes("background-color"), false);
  const fluid = readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  assert.match(fluid, /--content-max:72rem/);
  assert.match(fluid, /min-width:1600px/);
  assert.match(fluid, /min-width:1100px\) and \(max-width:1599px\)/);
  assert.match(fluid, /repeat\(auto-fit,minmax\(min\(100%,22rem\),1fr\)\)/);
  assert.match(fluid, /\.tabbar/);
  assert.match(fluid, /100dvh/);
  assert.match(fluid, /safe-area-inset-bottom/);
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /overflow-x-clip/);
  assert.equal(app.includes("overflow-x-hidden"), false);
  assert.match(app, /plate-ground/);
  const week = readFileSync(new URL("../../components/board/week-view.tsx", import.meta.url), "utf8");
  assert.equal([...week.matchAll(/illum/g)].length, 1);
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(styles, /--color-bg:\s*#14100c/);
  assert.match(styles, /--color-raised:\s*#241d16/);
  assert.match(styles, /--color-fg:\s*#f0e7d3/);
  assert.match(styles, /--color-gilt:\s*#c9a45c/);
  assert.match(styles, /--color-rubric:\s*#b4483e/);
  assert.match(styles, /--color-parchment:\s*#ece2cc/);
  assert.equal(styles.includes("outline: 2px solid var(--color-gilt)"), false);
  assertIlluminatedCapitals();
});

function assertIlluminatedCapitals() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.includes("illum")) continue;
      assert.match(line, /text-(2xl|3xl|4xl|5xl|6xl)/, line.trim());
      assert.equal(/text-(xs|sm|base|lg)\b/.test(line), false, line.trim());
    }
  }
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) out.push(...sourceFiles(file));
    else if (name.endsWith(".tsx")) out.push(file);
  }
  return out;
}

test("the public pages' band labels still name the plate", () => {
  assert.match(heroLabel("week") ?? "", /Doré/);
  assert.match(heroLabel("rooms") ?? "", /Dürer/);
  assert.match(heroLabel("messages") ?? "", /Jerome/);
  assert.equal(heroLabel("landing"), null);
  assert.match(css, /hero-band/);
  assert.match(css, /margin-art/);
});
