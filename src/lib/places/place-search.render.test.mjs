import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 390, height: 844 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "MouseEvent",
  "Event",
  "InputEvent",
  "KeyboardEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : browser[key];
  if (value === undefined) continue;
  const bind =
    key === "getComputedStyle" || key === "requestAnimationFrame" || key === "cancelAnimationFrame";
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: bind && typeof value === "function" ? value.bind(window) : value,
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const { createElement, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PlaceSearch } = await import("../../components/board/place-search.tsx");
const { debounce, placeSearchKey, roundNear, isOnMap, placeErrorFor } = await import("./client.ts");

const PLACES = [
  {
    ref: "node/2",
    name: "Grace Bible Church",
    address: "10 Main Street, Brandon, Florida 33511",
    distanceKm: 1,
  },
  { ref: "way/7", name: "Grace Chapel", address: "Valrico, Florida", distanceKm: 4 },
];

/**
 * @param {{ geolocation?: unknown, places?: typeof PLACES, search?: (request: any) => Promise<any> }} [options]
 */
function mount(options = {}) {
  /** @type {{ q: string, near: unknown, nearText: string | undefined }[]} */
  const searches = [];
  /** @type {{ name: string, ref: string | null, address: string }[]} */
  const changes = [];
  /** @param {{ q: string, near?: unknown, nearText?: string }} request */
  const search = async (request) => {
    searches.push({ q: request.q, near: request.near ?? null, nearText: request.nearText });
    if (options.search) return options.search(request);
    return { ok: /** @type {const} */ (true), places: options.places ?? PLACES };
  };
  function Harness() {
    const [value, setValue] = useState({
      name: "",
      ref: /** @type {string | null} */ (null),
      address: "",
    });
    return createElement(PlaceSearch, {
      label: "Church",
      kind: "church",
      value,
      search,
      geolocation: /** @type {any} */ (options.geolocation ?? null),
      /** @param {{ name: string, ref: string | null, address: string }} next */
      onChange: (next) => {
        changes.push(next);
        setValue(next);
      },
    });
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('[role="combobox"]'));
  return {
    host,
    input,
    searches,
    changes,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** @param {HTMLInputElement} input @param {string} value */
async function type(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((done) => setTimeout(done, 340));
  });
}

/** @param {HTMLInputElement} input @param {string} key */
async function press(input, key) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** @param {HTMLElement} element */
async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** @param {HTMLInputElement} input */
function described(input) {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

/** @param {HTMLElement} host */
function visibleText(host) {
  const copy = /** @type {HTMLElement} */ (host.cloneNode(true));
  for (const node of copy.querySelectorAll('[role="status"]')) node.remove();
  return copy.textContent ?? "";
}

/** @param {HTMLElement} host */
function nearestButton(host) {
  return /** @type {HTMLButtonElement | undefined} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent === "List the nearest first")
  );
}

/** @param {HTMLInputElement} input */
async function focus(input) {
  await act(async () => {
    input.focus();
  });
}

test("the field is an ARIA combobox that drives a listbox", async () => {
  const view = mount();
  try {
    const { input, host } = view;
    assert.equal(input.getAttribute("aria-autocomplete"), "list");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    const list = host.querySelector('[role="listbox"]');
    assert.ok(list);
    assert.equal(input.getAttribute("aria-controls"), list.id);
    assert.equal(input.getAttribute("placeholder"), null, "no sample-name placeholder");
    const label = host.querySelector(`label[for="${input.id}"]`);
    assert.equal(label?.textContent, "Church");
  } finally {
    view.unmount();
  }
});

test("two letters do not search; three letters search once after the pause", async () => {
  const view = mount();
  try {
    await focus(view.input);
    await type(view.input, "Gr");
    assert.equal(view.searches.length, 0);
    assert.equal(view.input.getAttribute("aria-expanded"), "false", "the list waits for 3 letters");
    await type(view.input, "Grace");
    assert.equal(view.searches.length, 1);
    assert.equal(view.searches[0]?.q, "Grace");
    assert.equal(view.input.getAttribute("aria-expanded"), "true");
    const options = [...view.host.querySelectorAll('[role="option"]')];
    assert.equal(options.length, 3);
    assert.match(options[0]?.textContent ?? "", /Grace Bible Church/);
    assert.match(options[2]?.textContent ?? "", /Not listed, type it in/);
    const status = view.host.querySelector('[role="status"]');
    assert.equal(
      status?.textContent,
      "2 places found. Use the up and down arrows to choose one.",
    );
    assert.match(view.host.textContent ?? "", /© OpenStreetMap contributors/);
  } finally {
    view.unmount();
  }
});

test("arrow keys move the active option and Enter picks a place on the map", async () => {
  const view = mount();
  try {
    await focus(view.input);
    await type(view.input, "Grace");
    await press(view.input, "ArrowDown");
    const first = view.host.querySelector('[role="option"]');
    assert.equal(view.input.getAttribute("aria-activedescendant"), first?.id);
    assert.equal(first?.getAttribute("aria-selected"), "true");
    await press(view.input, "ArrowDown");
    await press(view.input, "ArrowUp");
    await press(view.input, "Enter");
    assert.deepEqual(view.changes.at(-1), {
      name: "Grace Bible Church",
      ref: "node/2",
      address: "10 Main Street, Brandon, Florida 33511",
    });
    assert.equal(view.input.value, "Grace Bible Church");
    assert.equal(view.input.getAttribute("aria-expanded"), "false");
    const note = described(view.input).find((text) => text.startsWith("On the map"));
    assert.match(note ?? "", /^On the map · 10 Main Street/);
    assert.match(note ?? "", /© OpenStreetMap contributors/);
    const mark = [...view.host.querySelectorAll("span")].find((span) => span.textContent === "On the map");
    assert.match(mark?.className ?? "", /text-\[var\(--gold\)\]/, "the label is gilt");
    assert.equal(/verified/i.test(view.host.textContent ?? ""), false);
    assert.equal(/score|badge|\d+ (places|results)/i.test(visibleText(view.host)), false);
  } finally {
    view.unmount();
  }
});

test("Not listed saves the typed words with no map mark, and Escape closes the list", async () => {
  const view = mount({ places: [] });
  try {
    await focus(view.input);
    await type(view.input, "My home church");
    assert.match(view.host.querySelector('[role="status"]')?.textContent ?? "", /No places found/);
    await press(view.input, "Escape");
    assert.equal(view.input.getAttribute("aria-expanded"), "false");
    await press(view.input, "ArrowDown");
    assert.equal(view.input.getAttribute("aria-expanded"), "true");
    await press(view.input, "Enter");
    assert.deepEqual(view.changes.at(-1), { name: "My home church", ref: null, address: "" });
    assert.equal(/On the map/.test(view.host.textContent ?? ""), false);
  } finally {
    view.unmount();
  }
});

test("typing over a picked place makes it typed again", async () => {
  const view = mount();
  try {
    await focus(view.input);
    await type(view.input, "Grace");
    await press(view.input, "ArrowDown");
    await press(view.input, "Enter");
    await type(view.input, "Grace Bible Church East");
    assert.equal(view.changes.at(-1)?.ref, null);
    assert.equal(/On the map/.test(view.host.textContent ?? ""), false);
  } finally {
    view.unmount();
  }
});

test("focus never asks for location; only the button does, and the point is rounded and not saved", async () => {
  let asked = 0;
  const geolocation = {
    /** @param {(position: { coords: { latitude: number, longitude: number } }) => void} ok */
    getCurrentPosition(ok) {
      asked += 1;
      ok({ coords: { latitude: 27.937812, longitude: -82.285912 } });
    },
  };
  const view = mount({ geolocation });
  try {
    await focus(view.input);
    await type(view.input, "Gra");
    assert.equal(asked, 0, "focusing and typing ask nothing");
    assert.equal(view.searches.at(-1)?.near, null);
    const button = nearestButton(view.host);
    assert.ok(button, "List the nearest first is offered");
    const why = document.getElementById(button.getAttribute("aria-describedby") ?? "none");
    assert.equal(why?.textContent, "Your rough location sorts this list and is not kept.");
    assert.match(button.className, /focus-target/);
    await click(button);
    assert.equal(asked, 1);
    assert.equal(nearestButton(view.host), undefined, "asked once");
    await focus(view.input);
    await type(view.input, "Grace");
    assert.deepEqual(view.searches.at(-1)?.near, { lat: 27.94, lon: -82.29 });
    assert.equal(JSON.stringify(view.changes).includes("27.9"), false, "the point is not saved");
  } finally {
    view.unmount();
  }
});

test("a declined location shows a Near a town or ZIP box that sorts instead", async () => {
  const geolocation = {
    /** @param {unknown} _ok @param {(error: unknown) => void} fail */
    getCurrentPosition(_ok, fail) {
      fail({ code: 1 });
    },
  };
  const view = mount({ geolocation });
  try {
    await focus(view.input);
    const before = [...view.host.querySelectorAll("label")].find((label) =>
      /town or ZIP/.test(label.textContent ?? ""),
    );
    assert.equal(before, undefined, "no box before the member asks");
    const button = nearestButton(view.host);
    assert.ok(button);
    await click(button);
    const near = [...view.host.querySelectorAll("label")].find(
      (label) => label.textContent === "Near a town or ZIP",
    );
    assert.ok(near, "Near a town or ZIP box shown");
    const box = /** @type {HTMLInputElement} */ (
      document.getElementById(near.getAttribute("for") ?? "")
    );
    assert.equal(box.getAttribute("autocomplete"), "off");
    assert.equal(
      document.getElementById(box.getAttribute("aria-describedby") ?? "none")?.textContent,
      "Only used to sort this list. Not kept.",
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(box, "33511");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await focus(view.input);
    await type(view.input, "Grace");
    assert.equal(view.searches.at(-1)?.nearText, "33511");
    assert.equal(view.searches.at(-1)?.near, null);
  } finally {
    view.unmount();
  }
});

test("the field has its hint and the Photon notice tied with aria-describedby", async () => {
  const view = mount();
  try {
    const texts = described(view.input);
    assert.equal(
      texts[0],
      "Start typing the name, then choose your church from the list. If it is not there, choose Not listed.",
    );
    assert.match(texts[1] ?? "", /Photon \(photon\.komoot\.io\)/);
    const label = view.host.querySelector("label");
    const hint = document.getElementById(
      (view.input.getAttribute("aria-describedby") ?? "").split(" ")[0] ?? "",
    );
    assert.ok(label && hint);
    assert.ok(
      label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING &&
        hint.compareDocumentPosition(view.input) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the hint sits between the label and the input",
    );
    assert.match(view.input.className, /focus-target/);
  } finally {
    view.unmount();
  }
});

for (const [status, line] of /** @type {[number, string][]} */ ([
  [503, "Place search is off for now. Choose Not listed to type it in."],
  [401, "Sign in again to search. You can still choose Not listed and type it in."],
])) {
  test(`a ${status} shows its line inside the open list`, async () => {
    const view = mount({
      search: async () => ({ ok: false, error: placeErrorFor(status) }),
    });
    try {
      await focus(view.input);
      await type(view.input, "Grace");
      const pop = view.host.querySelector(".place-pop");
      assert.ok(pop && !pop.hasAttribute("hidden"));
      const first = pop.firstElementChild;
      assert.equal(first?.tagName, "P");
      assert.equal(first?.textContent, line);
      assert.equal(
        [...view.host.querySelectorAll("p")].filter(
          (p) => p.textContent === line && !pop.contains(p) && p.getAttribute("role") !== "status",
        )
          .length,
        0,
        "no copy of the line outside the list, apart from the status region",
      );
      assert.match(view.host.querySelector('[role="status"]')?.textContent ?? "", new RegExp(line.slice(0, 20)));
    } finally {
      view.unmount();
    }
  });
}

test("a slow search shows a visible Searching row and announces it only after a second", async () => {
  /** @type {(value: unknown) => void} */
  let finish = () => undefined;
  const view = mount({
    search: () =>
      new Promise((done) => {
        finish = done;
      }),
  });
  try {
    await focus(view.input);
    await type(view.input, "Grace");
    const pop = view.host.querySelector(".place-pop");
    assert.match(pop?.textContent ?? "", /Searching…/);
    const status = view.host.querySelector('[role="status"]');
    assert.equal(status?.textContent, "", "not announced yet");
    assert.equal(view.host.querySelectorAll('[role="option"]').length, 1);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 1050));
    });
    assert.equal(status?.textContent, "Searching");
    await act(async () => {
      finish({ ok: true, places: PLACES.slice(0, 1) });
    });
    assert.equal(status?.textContent, "1 place found. Use the up and down arrows to choose one.");
    assert.equal(/Searching…/.test(pop?.textContent ?? ""), false);
  } finally {
    view.unmount();
  }
});

test("the list carries the phone-safe class and the links carry the house ring", async () => {
  const view = mount();
  try {
    await focus(view.input);
    await type(view.input, "Grace");
    const pop = /** @type {HTMLElement} */ (view.host.querySelector(".place-pop"));
    assert.ok(pop);
    assert.match(pop.className, /top-full|bottom-full/);
    await press(view.input, "ArrowDown");
    await press(view.input, "Enter");
    const links = [...view.host.querySelectorAll("a")];
    // One credit link, under the field; the popup and the pick show the credit as text.
    assert.equal(links.length, 1);
    for (const link of links) assert.match(link.className, /focus-target/);
  } finally {
    view.unmount();
  }
});

test("the list CSS keeps it short and clear of the tabbar", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  assert.match(css, /--tabbar-h:57px/);
  const rule = /\.place-pop\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /max-height:min\(18rem,40dvh\)/);
  assert.match(rule, /scroll-margin-bottom:calc\(var\(--tabbar-h,57px\)/);
});

test("debounce runs once after the last call, and cancel drops it", async () => {
  /** @type {string[]} */
  const ran = [];
  const run = debounce((/** @type {string} */ word) => ran.push(word), 30);
  run("G");
  run("Gr");
  run("Gra");
  await new Promise((done) => setTimeout(done, 60));
  assert.deepEqual(ran, ["Gra"]);
  run("Grace");
  run.cancel();
  await new Promise((done) => setTimeout(done, 60));
  assert.deepEqual(ran, ["Gra"]);
});

test("client helpers round the point, key the cache by words, and check references", () => {
  assert.deepEqual(roundNear({ lat: 27.937812, lon: -82.285912 }), { lat: 27.94, lon: -82.29 });
  assert.equal(
    placeSearchKey({ q: " Grace ", kind: "church", near: null }),
    placeSearchKey({ q: "grace", kind: "church", near: null }),
  );
  assert.equal(isOnMap({ name: "A", ref: "node/1", address: "" }), true);
  assert.equal(isOnMap({ name: "A", ref: null, address: "" }), false);
  assert.equal(placeErrorFor(502), "Place search is not answering. Choose Not listed to type it in.");
  assert.equal(
    placeErrorFor(503, "api-unavailable"),
    "Place search is not answering. Choose Not listed to type it in.",
  );
});

test("the account church is saved with PATCH /api/profile, and a typed church clears the place", async () => {
  const { saveAccountChurch } = await import("./client.ts");
  /** @type {{ url: string, method: string, body: unknown }[]} */
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (/** @type {any} */ url, /** @type {any} */ init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: JSON.parse(init?.body ?? "null") });
      return new Response(
        JSON.stringify({ profile: { church: "Grace Bible Church", churchPlace: { ref: "node/2", address: "10 Main Street" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
  );
  try {
    const saved = await saveAccountChurch("Grace Bible Church", { ref: "node/2", address: "10 Main Street" });
    assert.deepEqual(saved, {
      ok: true,
      church: { name: "Grace Bible Church", place: { ref: "node/2", address: "10 Main Street" } },
    });
    await saveAccountChurch("My home church", null);
    assert.deepEqual(calls.map((call) => [call.url, call.method, call.body]), [
      // Only the reference goes up; the server fills in the name and address.
      ["/api/profile", "PATCH", { church: "Grace Bible Church", churchPlace: { ref: "node/2" } }],
      ["/api/profile", "PATCH", { church: "My home church", churchPlace: null }],
    ]);
  } finally {
    globalThis.fetch = real;
  }
});

test("the OpenStreetMap link sits outside the listbox and popup, and Tab reaches it", async () => {
  const view = mount();
  try {
    await focus(view.input);
    await type(view.input, "Grace");
    assert.equal(view.input.getAttribute("aria-expanded"), "true");
    const links = [...view.host.querySelectorAll("a")].filter(
      (a) => a.getAttribute("href") === "https://www.openstreetmap.org/copyright",
    );
    assert.equal(links.length, 1, "one credit link");
    const link = links[0];
    assert.equal(link.getAttribute("tabindex"), null, "in the normal Tab order");
    assert.equal(link.closest('[role="listbox"]'), null);
    assert.equal(link.closest(".place-pop"), null);
    const listbox = view.host.querySelector('[role="listbox"]');
    for (const child of [...(listbox?.children ?? [])]) {
      assert.equal(child.getAttribute("role"), "option", "the listbox holds only options");
    }
    // The next focusable element after the field is the credit link.
    const focusables = [...view.host.querySelectorAll("input, a, button")].filter(
      (el) => el.getAttribute("tabindex") !== "-1" && !el.closest("[hidden]"),
    );
    assert.equal(focusables[focusables.indexOf(view.input) + 1], link);
    // The popup still shows the credit as text while it is open.
    const pop = view.host.querySelector(".place-pop");
    assert.match(pop?.textContent ?? "", /© OpenStreetMap contributors/);
    // The copy is honest about what the server holds in memory.
    assert.match(view.host.textContent ?? "", /in memory only/);
    assert.match(view.host.textContent ?? "", /never keeps your location/);
  } finally {
    view.unmount();
  }
});
