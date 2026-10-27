import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/admin/stats" });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { StatsView } = await import("./stats-view.tsx");

const roomRows = Array.from({ length: 21 }, (_, index) => ({
  week: "2026-10-19",
  room: `Room ${String(index + 1).padStart(2, "0")}`,
  posts: index === 0 ? "<5" : 6,
  gatherings: "<5",
}));

const stats = /** @type {import("../../lib/board/stats.ts").StatsPayload} */ ({
  asOf: "2026-10-25",
  days: 30,
  category: "all",
  tiles: [
    { id: "members", label: "Members", value: 12, change: 4 },
    { id: "invites", label: "Invites accepted (30 days)", value: 8, change: 0 },
    { id: "rooms", label: "Active rooms (30 days)", value: "<5", change: null },
    { id: "gatherings", label: "Gatherings held (30 days)", value: 6, change: -2 },
  ],
  joins: [
    { date: "2026-10-20", count: "<5" },
    { date: "2026-10-21", count: 6 },
  ],
  active: [{ date: "2026-10-25", dau: "<5", wau: 6, mau: 12 }],
  roll: [{ date: "2026-10-20", roll: "<5", attendance: 6 }],
  rooms: {
    weeks: [{ week: "2026-10-19", posts: 10, gatherings: "<5" }],
    rows: roomRows,
    steady: "<5",
  },
  categories: [
    { id: "churches", label: "Churches" },
    { id: "choir", label: "Parish choir" },
  ],
  roomsByCategory: [
    { id: "churches", label: "Churches", count: 6 },
    { id: "discussion", label: "Discussion", count: "<5" },
    { id: "men", label: "Men", count: "<5" },
    { id: "women", label: "Women", count: "<5" },
    { id: "business-trades", label: "Business & Trades", count: "<5" },
    { id: "civic", label: "Civic", count: "<5" },
    { id: "county", label: "County", count: "<5" },
  ],
  funnel: [
    { id: "sent", label: "Sent", count: 8 },
    { id: "opened", label: "Opened", count: null },
    { id: "accepted", label: "Accepted", count: 6 },
    { id: "first", label: "First gathering", count: "<5" },
  ],
  alerts: { reports: 3, health: "ok" },
  features: [
    { group: "board", label: "Board", count: 8 },
    { group: "calls", label: "Calls", count: "<5" },
  ],
  mostUsed: "Board",
  leastUsed: null,
  intent: {
    attendance: [{ date: "2026-10-20", count: 6 }],
    rsvpNote:
      "The going list stays on each member's board. It is not collected, so there is no RSVP count. Attendance is the host's roll.",
    inPersonCount: 6,
    inPersonPercent: 60,
    crossRoomMembers: "<5",
    crossRoomVouches: "<5",
  },
});

test("the stats page shows four tiles, gold totals, a table, and hidden small counts", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let downloaded = false;
  let picked = 0;
  act(() => {
    root.render(
      createElement(StatsView, {
        stats,
        days: 30,
        category: "all",
        onDays: (next) => {
          picked = next;
        },
        onCategory: () => {},
        onCsv: () => (downloaded = true),
        csvError: "",
      }),
    );
  });
  const text = document.body.textContent ?? "";
  assert.match(text, /Parish choir/);
  assert.match(text, /Members/);
  assert.match(text, /Invites accepted \(30 days\)/);
  assert.match(text, /Active rooms \(30 days\)/);
  assert.match(text, /Gatherings held \(30 days\)/);
  assert.match(text, /▲ 4 vs prior 30 days/);
  assert.match(text, /No change/);
  assert.match(text, /▼ 2 vs prior 30 days/);
  assert.match(text, /3 reports waiting/);
  assert.match(text, /That day/);
  assert.match(text, /7 days/);
  assert.match(text, /30 days/);
  assert.match(text, /Not collected/);
  assert.match(text, /<5/);
  assert.match(text, /Most used: Board/);
  assert.match(text, /no RSVP count/);
  assert.match(
    text,
    /Category shows only rooms in that category and their gatherings\. A room in more than one category appears under each, but totals count it once\./,
  );
  assert.equal(text.includes("Lovelace"), false);
  const up = document.querySelector("[aria-label='up 4 versus prior 30 days']");
  assert.ok(up);
  assert.match(document.body.innerHTML, /text-danger/);
  assert.match(document.body.innerHTML, /border-danger/);

  const marks = [...document.querySelectorAll("[data-count]")];
  assert.ok(marks.length > 0);
  assert.equal(
    marks.every((mark) => mark.getAttribute("fill") === "#c9a45c"),
    true,
  );
  assert.equal(
    marks.every((mark) => !mark.getAttribute("opacity") || mark.getAttribute("opacity") === "1"),
    true,
  );
  const grids = [...document.querySelectorAll("rect[stroke='#857c6f']")];
  assert.ok(grids.length >= 3);
  const axis = [...document.querySelectorAll("text")].map((node) => node.getAttribute("font-size"));
  assert.ok(axis.includes("12"));
  const joinsSvg = [...document.querySelectorAll("svg")].find(
    (svg) => svg.getAttribute("aria-label") === "Joins over time",
  );
  assert.ok(joinsSvg);
  const joinsLine = joinsSvg.querySelector("polyline");
  assert.equal(joinsLine?.getAttribute("stroke"), "#c9a45c");
  assert.equal(joinsLine?.getAttribute("stroke-width"), "1");
  const hiddenJoins = [...joinsSvg.querySelectorAll("[data-count='hidden']")];
  assert.equal(new Set(hiddenJoins.map((node) => node.getAttribute("cy"))).size, 1);

  const features = [...document.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Features",
  );
  assert.ok(features);
  const featureBar = features.querySelector("rect[data-count]");
  assert.ok(featureBar);
  assert.ok(Number(featureBar.getAttribute("width")) > Number(featureBar.getAttribute("height")));

  const moreHeading = [...document.querySelectorAll("h2")].find(
    (heading) => heading.textContent === "More counts",
  );
  const activeHeading = [...document.querySelectorAll("h2")].find(
    (heading) => heading.textContent === "Active members",
  );
  assert.ok(moreHeading);
  assert.ok(activeHeading);
  assert.notEqual(moreHeading.compareDocumentPosition(activeHeading) & 4, 0);
  const active = activeHeading.closest("section");
  if (!active) throw new Error("Active members is missing.");
  assert.match(active.className, /lg:col-span-6/);
  const activeLabels = [...active.querySelectorAll("text")].map((node) => node.textContent);
  assert.ok(activeLabels.includes("That day"));
  assert.ok(activeLabels.includes("7 days"));
  assert.ok(activeLabels.includes("30 days"));
  assert.equal(active.querySelectorAll("polyline").length, 3);

  const range = document.querySelector("[aria-label='Range']");
  assert.ok(range);
  const seven = [...range.querySelectorAll("button")].find(
    (button) => button.textContent === "7 days",
  );
  assert.ok(seven);
  assert.match(seven.className, /min-h-\[44px\]/);
  await act(async () => {
    seven.click();
  });
  assert.equal(picked, 7);

  const joins = [...document.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Joins",
  );
  assert.ok(joins);
  assert.equal(joins.querySelector("table"), null);
  const tableButtons = [...document.querySelectorAll("button")].filter(
    (button) => button.textContent === "View as table",
  );
  assert.equal(tableButtons.length, 1);
  const tableButton = tableButtons[0];
  assert.equal(tableButton.closest("section"), null);
  assert.equal(tableButton.getAttribute("aria-expanded"), "false");
  assert.match(tableButton.className, /min-h-\[44px\]/);
  await act(async () => {
    tableButton.click();
  });
  assert.equal(tableButton.getAttribute("aria-expanded"), "true");
  assert.equal(tableButton.textContent, "View as chart");
  const table = joins.querySelector("table");
  assert.ok(table);
  assert.equal(joins.querySelector("svg"), null);
  assert.match(table.textContent ?? "", /<5/);
  assert.match(table.textContent ?? "", /6/);
  assert.equal(features.querySelector("svg"), null);
  assert.ok(active.querySelector("table"));

  const posts = [...document.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Posts",
  );
  assert.ok(posts);
  assert.equal(posts.textContent?.includes("Room 21"), false);
  const more = [...posts.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Show the rest"),
  );
  assert.ok(more);
  await act(async () => {
    more.click();
  });
  assert.match(posts.textContent ?? "", /Room 21/);

  const csv = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Download CSV",
  );
  assert.ok(csv);
  await act(async () => {
    csv.click();
  });
  assert.equal(downloaded, true);

  act(() => {
    root.render(
      createElement(StatsView, {
        stats: {
          ...stats,
          days: 7,
          tiles: [
            stats.tiles[0],
            { ...stats.tiles[1], label: "Invites accepted (7 days)" },
            { ...stats.tiles[2], label: "Active rooms (7 days)" },
            { ...stats.tiles[3], label: "Gatherings held (7 days)" },
          ],
        },
        days: 7,
        category: "all",
        onDays: () => {},
        onCategory: () => {},
        onCsv: () => {},
        csvError: "",
      }),
    );
  });
  const ranged = document.body.textContent ?? "";
  assert.match(ranged, /Invites accepted \(7 days\)/);
  assert.match(ranged, /Active rooms \(7 days\)/);
  assert.match(ranged, /Gatherings held \(7 days\)/);
  assert.match(ranged, /▲ 4 vs prior 7 days/);
  assert.match(ranged, /▼ 2 vs prior 7 days/);
  assert.ok(document.querySelector("[aria-label='up 4 versus prior 7 days']"));

  act(() => root.unmount());
  host.remove();
});

test("the category select truncates at phone width and the header link is a 44px target", async () => {
  const { readFileSync } = await import("node:fs");
  const view = readFileSync(new URL("./stats-view.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../routes/admin/stats.tsx", import.meta.url), "utf8");
  assert.match(view, /w-full max-w-full truncate .*sm:w-auto sm:max-w-\[20rem\]/);
  assert.match(view, /title=\{selectedLabel\}/);
  assert.match(route, /<Link to="\/" className="inline-flex min-h-\[44px\] items-center text-sm text-muted">/);
});
