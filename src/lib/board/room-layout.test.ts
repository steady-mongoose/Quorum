import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function pageHtml(css: string): string {
  const names = [
    "Epiphany of Our Lord",
    "Reformed Presbyterian",
    "Grace",
    "Redeemer",
  ];
  const cards = names
    .map(
      (name, index) => `<button class="room-card" id="card-${index}" type="button">
        <span class="room-card-top">
          <span class="room-card-name">${name} parish bulletin for the week ahead</span>
          <span class="room-joined-dot" role="img" aria-label="Joined"></span>
        </span>
        <span class="room-card-what">Service times and the parish bulletin for the week ahead, with coffee after.</span>
        <span class="room-card-meta">meets Thu</span>
      </button>`,
    )
    .join("");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>*,*::before,*::after{box-sizing:border-box}${css}</style>
</head>
<body data-section="rooms">
  <div class="shell">
    <div class="shell-body">
      <main>
        <div class="with-side">
          <div>
            <section class="plate plate--hero" id="intro">
              <h1>Churches</h1>
              <p id="intro-copy">Parish and congregation rooms.</p>
            </section>
            <div class="room-browse">
              <nav>Categories</nav>
              <div class="room-column">
                <div class="room-grid" id="grid">${cards}</div>
              </div>
            </div>
          </div>
          <aside class="side-art"></aside>
        </div>
      </main>
    </div>
  </div>
  <button class="plate" id="plate-card" type="button">Plate</button>
</body>
</html>`;
}

test("rendered room cards do not overlap at 390, 768, and 1440", async (t) => {
  if (!existsSync("/usr/bin/google-chrome")) {
    t.skip("Chrome is not installed");
    return;
  }
  const { chromium } = await import("playwright");
  const css = `${source("../../../public/backgrounds.css")}\n${source("../../../public/fluid.css")}`;
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(pageHtml(css), { waitUntil: "load" });
      const report = await page.evaluate(() => {
        const box = (node: Element) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
        };
        const overlaps = (a: { top: number; right: number; bottom: number; left: number }, b: typeof a) =>
          a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const cards = [...document.querySelectorAll<HTMLElement>(".room-card")];
        const rects = cards.map(box);
        let hits = 0;
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            if (overlaps(rects[i]!, rects[j]!)) hits += 1;
          }
        }
        const intro = document.querySelector("#intro-copy");
        const first = cards[0];
        const introBox = intro ? box(intro) : null;
        const firstBox = first ? box(first) : null;
        const name = first?.querySelector<HTMLElement>(".room-card-name");
        const what = first?.querySelector<HTMLElement>(".room-card-what");
        const nameBox = name ? box(name) : null;
        const whatBox = what ? box(what) : null;
        const cardStyle = first ? getComputedStyle(first) : null;
        const whatStyle = what ? getComputedStyle(what) : null;
        const grid = document.querySelector<HTMLElement>("#grid");
        const tracks = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean) : [];
        return {
          plateMargin: getComputedStyle(document.querySelector("#plate-card")!).marginTop,
          heroMargin: getComputedStyle(document.querySelector("#intro")!).marginTop,
          cardMargin: cardStyle?.marginTop ?? "",
          display: cardStyle?.display ?? "",
          direction: cardStyle?.flexDirection ?? "",
          clamp: whatStyle?.webkitLineClamp ?? "",
          columns: tracks.length,
          gridWidth: grid ? grid.getBoundingClientRect().width : 0,
          hits,
          introClear: Boolean(introBox && firstBox && introBox.bottom <= firstBox.top + 1),
          stacked: Boolean(nameBox && whatBox && nameBox.bottom <= whatBox.top + 1),
          nameFits: Boolean(name && first && name.scrollWidth <= first.clientWidth + 1),
          dot: getComputedStyle(document.querySelector(".room-joined-dot")!).width,
          noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
      });
      assert.equal(report.plateMargin, "0px", `${width} plate margin ${report.plateMargin}`);
      assert.equal(report.heroMargin.startsWith("-"), true, `${width} hero margin ${report.heroMargin}`);
      assert.equal(report.cardMargin, "0px", `${width} card margin`);
      if (width === 390) assert.equal(report.columns, 1, `${width} columns ${report.columns}`);
      if (width === 768) assert.ok(report.columns >= 2, `${width} columns ${report.columns}`);
      if (width === 1440) {
        assert.ok(report.columns >= 2 && report.columns <= 3, `${width} columns ${report.columns}`);
        assert.ok(report.gridWidth >= 800, `${width} grid ${report.gridWidth}`);
      }
      assert.equal(report.display, "flex", `${width} display`);
      assert.equal(report.direction, "column", `${width} direction`);
      assert.equal(report.clamp, "1", `${width} clamp`);
      assert.equal(report.hits, 0, `${width} overlaps`);
      assert.equal(report.introClear, true, `${width} intro`);
      assert.equal(report.stacked, true, `${width} lines`);
      assert.equal(report.nameFits, true, `${width} name`);
      assert.equal(report.dot, "8px", `${width} dot`);
      assert.equal(report.noOverflow, true, `${width} overflow`);
    }
  } finally {
    await browser.close();
  }
});
