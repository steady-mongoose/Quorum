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
const { debounce, placeSearchKey, roundNear, isVerified } = await import("./client.ts");

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
 * @param {{ geolocation?: unknown, places?: typeof PLACES }} [options]
 */
function mount(options = {}) {
  /** @type {{ q: string, near: unknown, nearText: string | undefined }[]} */
  const searches = [];
  /** @type {{ name: string, ref: string | null, address: string }[]} */
  const changes = [];
  /** @param {{ q: string, near?: unknown, nearText?: string }} request */
  const search = async (request) => {
    searches.push({ q: request.q, near: request.near ?? null, nearText: request.nearText });
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
    await type(view.input, "Grace");
    assert.equal(view.searches.length, 1);
    assert.equal(view.searches[0]?.q, "Grace");
    assert.equal(view.input.getAttribute("aria-expanded"), "true");
    const options = [...view.host.querySelectorAll('[role="option"]')];
    assert.equal(options.length, 3);
    assert.match(options[0]?.textContent ?? "", /Grace Bible Church/);
    assert.match(options[2]?.textContent ?? "", /Not listed, type it in/);
    const status = view.host.querySelector('[role="status"]');
    assert.match(status?.textContent ?? "", /Places found/);
    assert.match(view.host.textContent ?? "", /© OpenStreetMap contributors/);
  } finally {
    view.unmount();
  }
});

test("arrow keys move the active option and Enter picks a verified place", async () => {
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
    const note = document.getElementById(view.input.getAttribute("aria-describedby") ?? "none");
    assert.match(note?.textContent ?? "", /^Verified place · 10 Main Street/);
    assert.match(note?.textContent ?? "", /© OpenStreetMap contributors/);
    assert.equal(/score|badge|\d+ (places|results)/i.test(view.host.textContent ?? ""), false);
  } finally {
    view.unmount();
  }
});

test("Not listed saves the typed words as unverified, and Escape closes the list", async () => {
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
    assert.equal(/Verified place/.test(view.host.textContent ?? ""), false);
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
    assert.equal(/Verified place/.test(view.host.textContent ?? ""), false);
  } finally {
    view.unmount();
  }
});

test("location is asked on focus, rounded, and used only to sort", async () => {
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
    assert.equal(asked, 0, "nothing is asked before the field is focused");
    await focus(view.input);
    assert.equal(asked, 1);
    await type(view.input, "Grace");
    assert.deepEqual(view.searches[0]?.near, { lat: 27.94, lon: -82.29 });
    assert.equal(JSON.stringify(view.changes).includes("27.9"), false, "the point is not saved");
  } finally {
    view.unmount();
  }
});

test("a declined location shows a city or ZIP box that sorts instead", async () => {
  const geolocation = {
    /** @param {unknown} _ok @param {(error: unknown) => void} fail */
    getCurrentPosition(_ok, fail) {
      fail({ code: 1 });
    },
  };
  const view = mount({ geolocation });
  try {
    await focus(view.input);
    const near = [...view.host.querySelectorAll("label")].find((label) =>
      /city or ZIP/.test(label.textContent ?? ""),
    );
    assert.ok(near, "city or ZIP box shown");
    const box = /** @type {HTMLInputElement} */ (
      document.getElementById(near.getAttribute("for") ?? "")
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
  assert.equal(isVerified({ name: "A", ref: "node/1", address: "" }), true);
  assert.equal(isVerified({ name: "A", ref: null, address: "" }), false);
});
