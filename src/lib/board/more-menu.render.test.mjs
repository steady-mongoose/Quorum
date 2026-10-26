import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/" });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLDialogElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
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
const { DesktopMore } = await import("../../components/board/desktop-more.tsx");
const { SectionTabs } = await import("../../components/board/section-tabs.tsx");

/** @param {boolean} deskOn */
function renderMenus(deskOn) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        "div",
        null,
        createElement(DesktopMore, {
          current: "week",
          deskOn,
          onSelect() {},
        }),
        createElement(SectionTabs, {
          current: "week",
          deskOn,
          onSelect() {},
        }),
      ),
    );
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

/** @param {HTMLDialogElement} dialog */
function itemLabels(dialog) {
  return [...dialog.querySelectorAll("button")].map((button) => button.textContent.replace(/\s+/g, " ").trim());
}

/** @param {string} selector */
async function clickMore(selector) {
  const more = document.querySelector(selector);
  if (!(more instanceof HTMLButtonElement)) throw new Error(`More button missing: ${selector}`);
  await act(async () => {
    more.click();
  });
}

/** @param {string[]} labels */
function openDialog(labels) {
  const dialogs = [...document.querySelectorAll("dialog")];
  assert.equal(dialogs.length, 1, "a closed menu must not leave an empty dialog in front of the open one");
  const dialog = dialogs[0];
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("More dialog missing");
  assert.equal(dialog.open, true);
  assert.equal(dialog.getAttribute("aria-label"), "More");
  const text = dialog.innerText.replace(/\s+/g, " ").trim();
  assert.notEqual(text, "");
  for (const label of labels) assert.equal(text.includes(label), true, text);
  assert.deepEqual(itemLabels(dialog), labels);
  return dialog;
}

test("opening phone More shows Groups, You, and About", async () => {
  const cleanup = renderMenus(false);
  try {
    assert.equal(document.querySelector("dialog"), null);
    await clickMore('nav[aria-label="Primary"] button[aria-haspopup="dialog"]');
    openDialog(["Groups", "You", "About"]);
  } finally {
    cleanup();
  }
});

test("opening phone More includes The desk when it is on", async () => {
  const cleanup = renderMenus(true);
  try {
    await clickMore('nav[aria-label="Primary"] button[aria-haspopup="dialog"]');
    openDialog(["Groups", "You", "The desk", "About"]);
  } finally {
    cleanup();
  }
});

test("opening desktop More shows About, and The desk when it is on", async () => {
  /** @type {Array<[boolean, string[]]>} */
  const cases = [
    [false, ["About"]],
    [true, ["The desk", "About"]],
  ];
  for (const [deskOn, labels] of cases) {
    const cleanup = renderMenus(deskOn);
    try {
      const more = [...document.querySelectorAll("button[aria-haspopup='dialog']")].find(
        (button) => button.closest("nav") === null,
      );
      if (!(more instanceof HTMLButtonElement)) throw new Error("desktop More button missing");
      await act(async () => {
        more.click();
      });
      const dialog = openDialog(labels);
      assert.equal(itemLabels(dialog).includes("Groups"), false);
    } finally {
      cleanup();
    }
  }
});
