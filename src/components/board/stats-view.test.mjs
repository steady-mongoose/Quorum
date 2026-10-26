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

const stats = /** @type {import("../../lib/board/stats.ts").StatsPayload} */ ({
  asOf: "2026-10-25",
  tiles: [
    { id: "dau", label: "On that day", value: "<5" },
    { id: "wau", label: "In 7 days", value: 6 },
    { id: "mau", label: "In 30 days", value: 12 },
    { id: "joins", label: "Joins, 30 days", value: "<5" },
  ],
  joins: [
    { date: "2026-10-20", count: "<5" },
    { date: "2026-10-21", count: 6 },
  ],
  active: [{ date: "2026-10-25", dau: "<5", wau: 6, mau: 12 }],
  roll: [{ date: "2026-10-20", roll: "<5", attendance: 6 }],
  rooms: {
    weeks: [{ week: "2026-10-19", posts: 6, gatherings: "<5" }],
    rows: [{ week: "2026-10-19", room: "The Shop", posts: "<5", gatherings: "<5" }],
    steady: "<5",
  },
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
  act(() => {
    root.render(
      createElement(StatsView, { stats, onCsv: () => (downloaded = true), csvError: "" }),
    );
  });
  const text = document.body.textContent ?? "";
  assert.match(text, /On that day/);
  assert.match(text, /In 7 days/);
  assert.match(text, /In 30 days/);
  assert.match(text, /Joins, 30 days/);
  assert.match(text, /<5/);
  assert.match(text, /Most used: Board/);
  assert.match(text, /no RSVP count/);
  assert.equal(text.includes("Lovelace"), false);

  const fills = [...document.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill"));
  assert.ok(fills.length > 0);
  assert.equal(
    fills.every((fill) => fill === "#c9a45c"),
    true,
  );
  const suppressed = [...document.querySelectorAll("rect")].filter(
    (rect) => rect.getAttribute("opacity") === "0.45",
  );
  assert.ok(suppressed.length > 1);
  const heights = new Set(suppressed.map((rect) => rect.getAttribute("height")));
  assert.equal(heights.size, 1);

  const joins = [...document.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "Joins",
  );
  assert.ok(joins);
  const table = joins.querySelector("table");
  assert.ok(table);
  assert.equal(hiddenAncestor(table), true);
  const tableButton = [...joins.querySelectorAll("button")].find(
    (button) => button.textContent === "Table",
  );
  assert.ok(tableButton);
  assert.match(tableButton.className, /min-h-\[44px\]/);
  await act(async () => {
    tableButton.click();
  });
  assert.equal(hiddenAncestor(table), false);
  assert.equal(hiddenAncestor(joins.querySelector("svg")), true);
  assert.match(table.textContent ?? "", /<5/);
  assert.match(table.textContent ?? "", /6/);

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

/** @param {Element | null} element */
function hiddenAncestor(element) {
  let node = element;
  while (node) {
    if (node instanceof HTMLElement && node.hidden) return true;
    node = node.parentElement;
  }
  return false;
}
