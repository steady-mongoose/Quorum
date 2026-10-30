// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 390, height: 900 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLDetailsElement",
  "HTMLTextAreaElement",
  "HTMLLabelElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Design #126 r5712986677: M1 (headers that hold at 390px), M2 (unnamed rooms), L1 (why "I went" is not open).
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Tables } = await import("../../components/board/rsvp-summary-panel.tsx");
const { MeetingRow } = await import("../../components/board/find-view.tsx");
const { suppressSummary } = await import(new URL("../../../server/board/rsvp-summary.ts", import.meta.url).href);
const { sortSummaryRooms, UNNAMED_ROOM } = await import("./rsvp-summary-view.ts");
const { useBoard } = await import("./store.ts");

/** @param {unknown} element */
async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return { host, unmount: () => act(async () => root.unmount()) };
}

const raw = [
  {
    roomId: "shop",
    name: "The Shop",
    members: 40,
    gatherings: [
      { gatheringId: "g1", date: "2026-10-12", going: 9, came: 7, writeUps: 3 },
      { gatheringId: "g2", date: "2026-10-19", going: 3, came: 2, writeUps: 2 },
      { gatheringId: "g3", date: "2026-10-26", going: 6, came: 5, writeUps: 1 },
    ],
    weeks: [
      { week: "2026-10-12", writeUps: 3 },
      { week: "2026-10-19", writeUps: 2 },
      { week: "2026-10-26", writeUps: 1 },
    ],
  },
  {
    roomId: "county",
    name: "The County",
    members: 60,
    gatherings: [{ gatheringId: "g4", date: "2026-10-28", going: 13, came: 10, writeUps: 6 }],
    weeks: [{ week: "2026-10-26", writeUps: 6 }],
  },
  { roomId: "r-zz", name: "", members: 30, gatherings: [{ gatheringId: "g5", date: "2026-10-20", going: 8, came: 6, writeUps: 0 }], weeks: [] },
  { roomId: "r-aa", name: "", members: 30, gatherings: [{ gatheringId: "g6", date: "2026-10-21", going: 7, came: 5, writeUps: 0 }], weeks: [] },
];

test("after the real hiding step, no count under 5 is visible; headers read 'Times came' and hold on one line", async () => {
  const summary = suppressSummary(raw, 5);
  const { host, unmount } = await mount(createElement(Tables, { summary }));
  try {
    // Every visible number is 0 or at least 5.
    const visible = [...host.querySelectorAll("td, summary, p")]
      .map((el) => el.textContent ?? "")
      .join(" ")
      .replace(/hidden to protect privacy/g, "")
      .replace(/Oct \d+, 2026/g, "")
      .replace(/Unnamed room \d/g, "");
    for (const match of visible.matchAll(/\b(\d+)\b/g)) {
      const value = Number(match[1]);
      assert.ok(value === 0 || value >= 5, `visible count ${value}`);
    }
    const heads = [...host.querySelectorAll("thead th")];
    const came = heads.filter((th) => /Times/.test(th.textContent ?? ""));
    assert.ok(came.length > 0);
    for (const th of came) {
      assert.equal(th.querySelector('[aria-hidden="true"]')?.textContent, "Times came");
      assert.equal(th.querySelector(".sr-only")?.textContent, "Times members came");
      assert.equal(th.querySelector("abbr"), null);
    }
    for (const th of heads.filter((th) => th.className.includes("text-right"))) {
      assert.match(th.className, /whitespace-nowrap/);
    }
    // Summary lines: "going 13 · came 10 times · write-ups 6".
    const county = [...host.querySelectorAll("summary")].find((s) => (s.textContent ?? "").startsWith("The County"));
    assert.equal(county?.textContent, "The County: going 13 · came 10 times · write-ups 6");
    // A hidden "came" reads "came Hidden", never "came Hidden times".
    for (const s of host.querySelectorAll("summary")) assert.doesNotMatch(s.textContent ?? "", /Hidden(hidden to protect privacy)? times/);
  } finally {
    await unmount();
  }
});

test("unnamed rooms read 'Unnamed room 1', 'Unnamed room 2' after the named ones, never an id", async () => {
  assert.equal(UNNAMED_ROOM, "Unnamed room");
  const order = sortSummaryRooms(raw).map((room) => room.name);
  assert.deepEqual(order, ["The County", "The Shop", "Unnamed room 1", "Unnamed room 2"]);
  // Stable: the same numbers whatever order the server sent.
  assert.deepEqual(sortSummaryRooms([...raw].reverse()).map((room) => [room.roomId, room.name]), [
    ["county", "The County"],
    ["shop", "The Shop"],
    ["r-aa", "Unnamed room 1"],
    ["r-zz", "Unnamed room 2"],
  ]);
  // One unnamed room has no number.
  assert.deepEqual(sortSummaryRooms([raw[2]]).map((room) => room.name), ["Unnamed room"]);
  const { host, unmount } = await mount(createElement(Tables, { summary: suppressSummary(raw, 5) }));
  try {
    assert.doesNotMatch(host.textContent ?? "", /r-aa|r-zz/);
    assert.match(host.textContent ?? "", /Unnamed room 1: going/);
  } finally {
    await unmount();
  }
});

/** @param {Record<string, unknown>} over */
function card(over) {
  return {
    id: "0123456789abcdef01234567",
    room: "shop",
    kind: "meeting",
    name: "Lathe night",
    place: "The shop",
    time: "7:00 PM",
    host: "Dale",
    next: "2026-10-28",
    lastFour: [],
    wentBy: [],
    going: ["Ann", "Ben"],
    seeing: "steward",
    pinned: false,
    unverified: false,
    firstTimer: false,
    slots: [],
    book: "",
    pages: "",
    ...over,
  };
}
const rowProps = { me: "Sam", steward: true, peers: new Set(), clear: new Map(), onRemove: () => {} };

test("'I went' says why it is not open in a visible line the button is described by, not a tooltip", async () => {
  useBoard.setState({ rollCall: {} });
  // Started, but Sam has not said going.
  const started = await mount(createElement(MeetingRow, { card: card({}), shown: true, ...rowProps }));
  try {
    const button = [...started.host.querySelectorAll("button")].find((b) => b.textContent === "I went");
    assert.ok(button);
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(button.getAttribute("title"), null);
    const id = button.getAttribute("aria-describedby");
    assert.ok(id);
    const line = started.host.ownerDocument.getElementById(id);
    assert.equal(line?.tagName, "P");
    assert.equal(line?.className.includes("sr-only"), false);
    assert.match(line?.textContent ?? "", /Say you’re going first/);
    // The steward's Mark who came is offered on a gathering that has started.
    assert.ok([...started.host.querySelectorAll("button")].some((b) => b.textContent === "Mark who came"));
  } finally {
    await started.unmount();
  }
  // Not started yet.
  const later = await mount(createElement(MeetingRow, { card: card({ next: "2099-01-01" }), shown: true, ...rowProps }));
  try {
    const button = [...later.host.querySelectorAll("button")].find((b) => b.textContent === "I went");
    const line = later.host.ownerDocument.getElementById(button?.getAttribute("aria-describedby") ?? "");
    assert.match(line?.textContent ?? "", /once the gathering has started/);
  } finally {
    await later.unmount();
  }
  // Open: no reason line, no describedby.
  const open = await mount(createElement(MeetingRow, { card: card({ going: ["Ann", "Sam"] }), shown: true, ...rowProps }));
  try {
    const button = [...open.host.querySelectorAll("button")].find((b) => b.textContent === "I went");
    assert.equal(button?.getAttribute("aria-describedby"), null);
    assert.equal(button?.getAttribute("aria-disabled"), null);
  } finally {
    await open.unmount();
  }
});
