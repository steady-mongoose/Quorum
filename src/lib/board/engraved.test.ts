import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { artAttribute, artSection, heroLabel, isEveningHour, showsHero } from "./engraved.ts";

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
  assert.match(
    css,
    /\[data-section="landing"\],\[data-section="signin"\]\{background:var\(--bg\) var\(--art-landing\)/,
  );
  assert.equal([...css.matchAll(/var\(--art-landing\)/g)].length, 1);
  assert.equal(css.includes("martin-creation"), false);
  assert.equal(artSection({ entered: false, section: "week", signingIn: false }), "landing");
  assert.equal(artSection({ entered: false, section: "week", signingIn: true }), "signin");
  assert.equal(artSection({ entered: true, section: "week", signingIn: false }), "week");
  assert.equal(artSection({ entered: true, section: "rooms", signingIn: false }), "rooms");
  assert.equal(artSection({ entered: true, section: "messages", signingIn: false }), "messages");
  assert.equal(artSection({ entered: true, section: "find", signingIn: false }), null);
  assert.equal(artSection({ entered: true, section: "about", signingIn: false }), null);
  assert.equal(artSection({ entered: true, section: "profile", signingIn: false }), null);
  assert.equal(artSection({ entered: true, section: "civic", signingIn: false }), null);
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

test("reduced data and the first paint skip the art URL", () => {
  assert.match(css, /prefers-reduced-data:reduce/);
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
    ["#1f1912", "#f8f3e7", 4.5],
    ["#5e5242", "#f8f3e7", 4.5],
  ];
  for (const [fg, bg, min] of pairs) {
    assert.ok(contrast(fg, bg) >= min, `${fg} on ${bg}`);
  }
});

test("hero bands are week, rooms, and messages, and the label names the plate", () => {
  assert.equal(showsHero("week"), true);
  assert.equal(showsHero("landing"), false);
  assert.match(heroLabel("week") ?? "", /Doré/);
  assert.match(heroLabel("rooms") ?? "", /Dürer/);
  assert.match(heroLabel("messages") ?? "", /Jerome/);
  assert.equal(heroLabel("landing"), null);
  assert.match(css, /hero-band/);
  assert.match(css, /margin-art/);
});
