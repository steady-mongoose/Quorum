// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";

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
    assert.equal(county?.textContent, "The County: going 13\u00a0· came 10 times\u00a0· write-ups 6");
    // No line can wrap to start with "·" (review 5713515017, low 1): every "·" follows a no-break space.
    for (const summary of host.querySelectorAll("summary")) assert.doesNotMatch(summary.textContent ?? "", /[^\u00a0]·/);
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
    // Only a special event takes RSVPs (Josh via CoS, Oct 30 12:47 PM ET).
    special: true,
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
    assert.equal(line?.textContent, "Only members who said they were going can mark “I went”.");
    assert.doesNotMatch(started.host.textContent ?? "", /going first/);
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

test("'I went' and 'I'll be there' share one row height: items-center and min-h 44px on both (low 2)", async () => {
  useBoard.setState({ rollCall: {} });
  const row = await mount(createElement(MeetingRow, { card: card({}), shown: true, ...rowProps }));
  try {
    const buttons = [...row.host.querySelectorAll("button")];
    const went = buttons.find((b) => b.textContent === "I went");
    const rsvp = buttons.find((b) => b.textContent === "I'll be there");
    assert.ok(went && rsvp);
    for (const b of [went, rsvp]) assert.match(b.className, /min-h-\[44px\]/);
    const shared = went.parentElement;
    assert.ok(shared?.contains(rsvp));
    assert.match(shared.className, /items-center/);
    // The RSVP control adds no top margin of its own inside this row.
    const wrap = rsvp.parentElement?.parentElement;
    assert.equal(wrap?.parentElement, shared);
    assert.doesNotMatch(wrap.className, /\bmt-3\b/);
  } finally {
    await row.unmount();
  }
});

const { createRootRoute, createRouter, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router");

/** A host's row has links (the invite note), so it mounts inside a router. @param {unknown} element */
async function mountRouted(element) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  /** @type {any} */ (router)._rendered ??= [];
  await router.load();
  return mount(createElement(RouterProvider, { router }));
}

test("a host gets no 'I went' and no going-first line they could not act on (low 3)", async () => {
  useBoard.setState({ rollCall: {} });
  for (const next of ["2026-10-28", "2099-01-01"]) {
    const row = await mountRouted(
      createElement(MeetingRow, { card: card({ next }), shown: true, ...rowProps, me: "Dale", steward: false }),
    );
    try {
      const buttons = [...row.host.querySelectorAll("button")];
      assert.equal(buttons.some((b) => /I went|You've been|I'll be there/.test(b.textContent ?? "")), false);
      // The host's state: they record who came in the write-up.
      assert.ok(buttons.some((b) => b.textContent?.trim() === "Write it up"));
      assert.doesNotMatch(row.host.textContent ?? "", /going first|Only members who said|can mark “I went”/);
      assert.equal(row.host.querySelector("[aria-describedby]")?.textContent?.includes("I went") ?? false, false);
    } finally {
      await row.unmount();
    }
  }
});

// ---- Josh's card answers via CoS, Oct 30 12:47 PM ET ----

const { AddCard } = await import("../../components/board/find-view.tsx");
const { RsvpControl } = await import("../../components/board/rsvp-control.tsx");
const label = (host, text) => [...host.querySelectorAll("label")].find((l) => (l.textContent ?? "").includes(text));

test("Josh 2 (app): a gathering that is not a special event shows no RSVP, no 'I went', no roll call and no going list", async () => {
  useBoard.setState({ rollCall: {}, stewardRooms: [] });
  const plain = await mount(createElement(MeetingRow, { card: card({ special: false }), shown: true, ...rowProps }));
  try {
    const text = plain.host.textContent ?? "";
    assert.doesNotMatch(text, /I'll be there|You're going|I went|You've been|Mark who came|going: |has been: /);
  } finally {
    await plain.unmount();
  }
  const special = await mount(createElement(MeetingRow, { card: card({}), shown: true, ...rowProps }));
  try {
    assert.match(special.host.textContent ?? "", /I'll be there/);
    assert.match(special.host.textContent ?? "", /I went/);
  } finally {
    await special.unmount();
  }
  // The control itself draws nothing for a gathering that is not special.
  const bare = await mount(createElement(RsvpControl, { card: card({ special: false }), going: false, onToggle: () => {} }));
  try {
    assert.equal(bare.host.innerHTML, "");
  } finally {
    await bare.unmount();
  }
});

test("Josh 1 (app): the host has a 'This is a special event' checkbox on the card and in the add form; nobody else does", async () => {
  const patches = [];
  const updateCard = useBoard.getState().updateCard;
  useBoard.setState({ rollCall: {}, stewardRooms: [], updateCard: (id, patch) => patches.push([id, patch]) });
  try {
    const row = await mountRouted(
      createElement(MeetingRow, { card: card({ special: false }), shown: true, ...rowProps, me: "Dale", steward: false }),
    );
    try {
      const box = label(row.host, "This is a special event")?.querySelector("input");
      assert.ok(box);
      assert.equal(box.type, "checkbox");
      assert.equal(box.checked, false);
      await act(async () => box.click());
      assert.deepEqual(patches.at(-1), ["0123456789abcdef01234567", { special: true }]);
    } finally {
      await row.unmount();
    }
    const steward = await mount(createElement(MeetingRow, { card: card({}), shown: true, ...rowProps }));
    try {
      assert.equal(label(steward.host, "This is a special event"), undefined);
    } finally {
      await steward.unmount();
    }
    const form = await mount(createElement(AddCard, { me: "Dale" }));
    try {
      const box = label(form.host, "This is a special event")?.querySelector("input");
      assert.ok(box);
      assert.equal(box.checked, false, "off unless the host ticks it");
    } finally {
      await form.unmount();
    }
  } finally {
    useBoard.setState({ updateCard });
  }
});

const { formatDate } = await import("./model.ts");
const rules = await import("./rsvp-rules.ts");
const { SpecialEventToggle, StewardDateControl } = await import("../../components/board/find-view.tsx");
const typeDate = async (input, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
};
const buttonNamed = (host, text) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

test("Design M1: the steward date control: label, aria-disabled guard, 'Save new date', status on success", async () => {
  const calls = [];
  const changeDate = useBoard.getState().changeDate;
  useBoard.setState({ rollCall: {}, stewardRooms: ["shop"], changeDate: async (id, next) => (calls.push([id, next]), { ok: true }) });
  try {
    const row = await mount(createElement(MeetingRow, { card: card({ special: false }), shown: true, ...rowProps }));
    try {
      const label = [...row.host.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Change the date"));
      assert.ok(label, "Change the date");
      assert.match(label.className, /flex-col/);
      assert.match(label.className, /text-fg/);
      const input = label.querySelector("input");
      assert.equal(input.type, "date");
      assert.match(input.className, /min-h-\[44px\]/);
      assert.match(input.className, /sm:max-w-xs/);
      const save = buttonNamed(row.host, "Save new date");
      assert.ok(save);
      assert.equal(save.hasAttribute("disabled"), false, "never native disabled");
      assert.equal(save.getAttribute("aria-disabled"), "true");
      assert.match(save.className, /min-h-\[44px\]/);
      await act(async () => save.click());
      assert.deepEqual(calls, [], "the guard holds while unchanged");
      await typeDate(input, "2026-11-07");
      assert.equal(save.getAttribute("aria-disabled"), null);
      await act(async () => save.click());
      assert.deepEqual(calls, [["0123456789abcdef01234567", "2026-11-07"]]);
      const status = row.host.querySelector('form [role="status"]');
      assert.equal(status?.textContent, `Date changed to ${formatDate("2026-11-07")}. The host will see it on the card.`);
      assert.equal(row.host.querySelector('form [role="alert"]'), null);
    } finally {
      await row.unmount();
    }
    // No date yet: "Set a date".
    const none = await mount(createElement(MeetingRow, { card: card({ special: false, next: "" }), shown: true, ...rowProps }));
    try {
      assert.ok([...none.host.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Set a date")));
    } finally {
      await none.unmount();
    }
    // Not a steward of this room: no control.
    useBoard.setState({ stewardRooms: ["county"] });
    const other = await mount(createElement(MeetingRow, { card: card({}), shown: true, ...rowProps, steward: false, me: "Tom" }));
    try {
      assert.equal(buttonNamed(other.host, "Save new date"), undefined);
    } finally {
      await other.unmount();
    }
  } finally {
    useBoard.setState({ changeDate, stewardRooms: [] });
  }
});

test("Design M1: a refused date shows inline as role=alert and the field goes back to the card's date", async () => {
  const changeDate = useBoard.getState().changeDate;
  useBoard.setState({ changeDate: async () => ({ ok: false, error: "You can't change this gathering." }) });
  try {
    const view = await mount(createElement(StewardDateControl, { card: card({ next: "2026-10-31" }) }));
    try {
      const input = view.host.querySelector('input[type="date"]');
      await typeDate(input, "2026-11-07");
      await act(async () => buttonNamed(view.host, "Save new date").click());
      assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "You can't change this gathering.");
      assert.match(view.host.querySelector('[role="alert"]')?.className ?? "", /text-danger/);
      assert.equal(input.value, "2026-10-31");
      assert.equal(view.host.querySelector('[role="status"]')?.textContent, "");
    } finally {
      await view.unmount();
    }
  } finally {
    useBoard.setState({ changeDate });
  }
});

const hostCard = (over) => card({ host: "Dale", seeing: "host", ...over });

test("Design H1: unticking with anyone going asks first on a solid card; Keep it special keeps it and returns focus", async () => {
  assert.equal(rules.UNTICK_SPECIAL, "delete", "defaults to the delete copy, which matches the server");
  const patches = [];
  const updateCard = useBoard.getState().updateCard;
  useBoard.setState({ specialRefused: {}, updateCard: (id, patch) => patches.push([id, patch]) });
  try {
    const view = await mount(createElement(SpecialEventToggle, { card: hostCard({ going: ["Ann"], wentBy: ["Dale"] }) }));
    try {
      const box = view.host.querySelector('input[type="checkbox"]');
      await act(async () => box.click());
      assert.deepEqual(patches, [], "nothing is sent before the host confirms");
      const group = view.host.querySelector('[role="group"]');
      assert.ok(group);
      assert.match(group.className, /bg-surface/);
      assert.doesNotMatch(group.className, /blur/);
      const labelled = view.host.ownerDocument.getElementById(group.getAttribute("aria-labelledby"));
      assert.equal(labelled?.textContent, rules.UNTICK_SPECIAL_COPY.delete.confirm);
      assert.equal(
        rules.UNTICK_SPECIAL_COPY.delete.confirm,
        "Turn off special event? This removes who said they're going and who came for this gathering. It can't be undone.",
      );
      const keep = buttonNamed(view.host, "Keep it special");
      assert.equal(view.host.ownerDocument.activeElement, keep, "focus on Keep it special");
      for (const b of [keep, buttonNamed(view.host, "Turn it off")]) assert.match(b.className, /min-h-\[44px\]/);
      await act(async () => keep.click());
      assert.equal(view.host.querySelector('[role="group"]'), null);
      assert.equal(view.host.ownerDocument.activeElement, box, "focus back on the box");
      assert.deepEqual(patches, []);
      // Turn it off: sent, and the status line says what happened.
      await act(async () => box.click());
      await act(async () => buttonNamed(view.host, "Turn it off").click());
      assert.deepEqual(patches, [["0123456789abcdef01234567", { special: false }]]);
      assert.equal(view.host.querySelector('[role="status"]')?.textContent, rules.UNTICK_SPECIAL_COPY.delete.done);
      assert.equal(rules.UNTICK_SPECIAL_COPY.delete.done, "This is no longer a special event. Its RSVPs and who came were removed.");
    } finally {
      await view.unmount();
    }
    // Someone marked as came (not the host's own lister mark) also asks first.
    patches.length = 0;
    const marked = await mount(createElement(SpecialEventToggle, { card: hostCard({ going: [], wentBy: ["Dale", "Ann"] }) }));
    try {
      await act(async () => marked.host.querySelector('input[type="checkbox"]').click());
      assert.ok(marked.host.querySelector('[role="group"]'));
      assert.deepEqual(patches, []);
    } finally {
      await marked.unmount();
    }
  } finally {
    useBoard.setState({ updateCard });
  }
});

test("Design H1: with nobody going or marked, untick and tick go straight through, each with a role=status line", async () => {
  const patches = [];
  const updateCard = useBoard.getState().updateCard;
  useBoard.setState({ specialRefused: {}, updateCard: (id, patch) => patches.push([id, patch]) });
  try {
    const view = await mount(createElement(SpecialEventToggle, { card: hostCard({ going: [], wentBy: ["Dale"] }) }));
    try {
      await act(async () => view.host.querySelector('input[type="checkbox"]').click());
      assert.equal(view.host.querySelector('[role="group"]'), null);
      assert.deepEqual(patches.at(-1), ["0123456789abcdef01234567", { special: false }]);
      assert.equal(view.host.querySelector('[role="status"]')?.textContent, "This is no longer a special event.");
    } finally {
      await view.unmount();
    }
    const off = await mount(createElement(SpecialEventToggle, { card: hostCard({ special: false, going: [] }) }));
    try {
      await act(async () => off.host.querySelector('input[type="checkbox"]').click());
      assert.deepEqual(patches.at(-1), ["0123456789abcdef01234567", { special: true }]);
      assert.equal(off.host.querySelector('[role="status"]')?.textContent, "This is now a special event. Members can say they're going.");
    } finally {
      await off.unmount();
    }
  } finally {
    useBoard.setState({ updateCard });
  }
});

test("Design H1: the hide copy is ready behind the one constant", () => {
  assert.equal(
    rules.UNTICK_SPECIAL_COPY.hide.confirm,
    "Turn off special event? This hides who said they're going and who came. Tick it again to bring them back.",
  );
  assert.ok(rules.UNTICK_SPECIAL_COPY.hide.done.length > 0);
  // One line to switch: the constant is declared once.
  const source = readFileSync(new URL("./rsvp-rules.ts", import.meta.url), "utf8");
  assert.equal(source.match(/export const UNTICK_SPECIAL: UntickSpecial = "(delete|hide)";/g)?.length, 1);
});

test("Design L1, L2: the special-event box in the add form and on the card is 44px and described by its hint", async () => {
  const HINT = "Members can say they're going, and you or a steward can mark who came. Other gatherings don't take RSVPs.";
  assert.equal(rules.SPECIAL_HINT, HINT);
  const form = await mount(createElement(AddCard, { me: "Dale" }));
  try {
    const special = label(form.host, "This is a special event");
    assert.equal(special.textContent?.trim(), "This is a special event");
    assert.match(special.className, /min-h-\[44px\]/);
    const input = special.querySelector("input");
    assert.equal(form.host.ownerDocument.getElementById(input.getAttribute("aria-describedby"))?.textContent, HINT);
    assert.match(label(form.host, "New people welcome").className, /min-h-\[44px\]/);
  } finally {
    await form.unmount();
  }
  useBoard.setState({ specialRefused: {} });
  const view = await mount(createElement(SpecialEventToggle, { card: hostCard({}) }));
  try {
    const input = view.host.querySelector('input[type="checkbox"]');
    assert.match(input.closest("label").className, /min-h-\[44px\]/);
    assert.equal(view.host.ownerDocument.getElementById(input.getAttribute("aria-describedby"))?.textContent, HINT);
    assert.equal([...view.host.querySelectorAll("p")].filter((p) => p.textContent === HINT).length, 1, "rendered once");
  } finally {
    await view.unmount();
  }
});

test("Design L3, L4: a refused or not-ready tick shows role=alert on the card, and the status line stays quiet", async () => {
  useBoard.setState({ specialRefused: { "0123456789abcdef01234567": "Special events are not ready yet. Try again later." } });
  const view = await mount(createElement(SpecialEventToggle, { card: hostCard({ special: false }) }));
  try {
    assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "Special events are not ready yet. Try again later.");
    assert.equal(view.host.querySelector('input[type="checkbox"]').checked, false);
  } finally {
    await view.unmount();
    useBoard.setState({ specialRefused: {} });
  }
});
