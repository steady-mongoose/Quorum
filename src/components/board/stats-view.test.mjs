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
  assert.equal(text.includes("Lovelace"), false);
  const up = document.querySelector("[aria-label='up 4 versus prior 30 days']");
  assert.ok(up);
  assert.match(document.body.innerHTML, /text-danger/);
  assert.match(document.body.innerHTML, /border-danger/);

  const bars = [...document.querySelectorAll("rect[data-count]")];
  assert.ok(bars.length > 0);
  assert.equal(
    bars.every((rect) => rect.getAttribute("fill") === "#c9a45c"),
    true,
  );
  assert.equal(
    bars.every((rect) => !rect.getAttribute("opacity") || rect.getAttribute("opacity") === "1"),
    true,
  );
  const grids = [...document.querySelectorAll("rect[stroke='#857c6f']")];
  assert.ok(grids.length >= 3);
  const axis = [...document.querySelectorAll("text")].map((node) => node.getAttribute("font-size"));
  assert.ok(axis.includes("12"));
  const hiddenBars = bars.filter((rect) => rect.getAttribute("data-count") === "hidden");
  assert.ok(hiddenBars.length > 1);
  const heights = new Set(
    hiddenBars
      .filter((rect) => rect.closest("svg")?.getAttribute("aria-label") === "Joins over time")
      .map((rect) => rect.getAttribute("height")),
  );
  assert.equal(heights.size, 1);

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
  const tableButton = [...joins.querySelectorAll("button")].find(
    (button) => button.textContent === "View as table",
  );
  assert.ok(tableButton);
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

  const posts = [...document.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Posts",
  );
  assert.ok(posts);
  const postsToggle = [...posts.querySelectorAll("button")].find(
    (button) => button.textContent === "View as table",
  );
  assert.ok(postsToggle);
  await act(async () => {
    postsToggle.click();
  });
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

  act(() => root.unmount());
  host.remove();
});
