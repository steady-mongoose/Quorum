import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1440, height: 900 });
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
const { AccountRemovalPanel, DeletionRequestQueue } = await import("../../components/board/account-removal.tsx");
const copy = await import("./account-copy.ts");

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

/** @param {any} element */
function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

test("the member copy says plainly that posts are erased, with the exceptions", () => {
  const view = mount(createElement(AccountRemovalPanel, /** @type {any} */ ({
    deactivated: false, deletionRequested: false, note: "", error: "", pending: false,
    onNote() {}, onDeactivate() {}, onReactivate() {}, onRequest() {},
  })));
  try {
    const text = view.host.textContent ?? "";
    assert.ok(text.includes(copy.DELETION_REQUEST_COPY));
    assert.match(copy.DELETION_REQUEST_COPY, /your posts are erased/);
    assert.match(copy.DELETION_REQUEST_COPY, /under a hold or an open report are kept/);
    assert.equal(text.includes("It does not delete"), false);
  } finally {
    view.cleanup();
  }
});

test("an admin completes a request through a confirm dialog with Cancel first and focused", async () => {
  /** @type {string[]} */
  const completed = [];
  const view = mount(createElement(DeletionRequestQueue, /** @type {any} */ ({
    load: async () => ({ ok: true, requests: [{ id: "d1", userId: "u1", name: "Maria", note: "", at: 0 }] }),
    complete: async (/** @type {string} */ id) => (completed.push(id), { ok: true, erased: 3, kept: 1 }),
  })));
  try {
    await flush();
    const open = /** @type {HTMLButtonElement} */ ([...view.host.querySelectorAll("button")].find((b) => b.textContent === "Complete"));
    assert.equal(open.getAttribute("aria-label"), "Complete Maria's deletion request");
    assert.match(open.className, /min-h-\[44px\]/);
    assert.ok((view.host.textContent ?? "").includes("A member asked for their account to be deleted. Completing a request erases that member's posts and closes the account. Posts under a hold or an open report are kept until that is finished."));
    act(() => open.click());
    await flush();
    const dialog = /** @type {HTMLElement} */ (view.host.querySelector("dialog"));
    assert.ok((dialog.textContent ?? "").includes("Erase Maria's posts and close the account?"));
    assert.ok((dialog.textContent ?? "").includes(copy.COMPLETE_DELETION_BODY));
    const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent);
    assert.deepEqual(buttons, ["Cancel", "Erase posts and close account"]);
    assert.equal(document.activeElement?.textContent, "Cancel");
    assert.deepEqual(completed, []);
    act(() => /** @type {HTMLButtonElement} */ ([...dialog.querySelectorAll("button")][1]).click());
    await flush();
    await flush();
    assert.deepEqual(completed, ["d1"]);
    assert.equal(view.host.querySelector('[role="status"]')?.textContent, "Done. 3 posts erased, 1 kept for a hold or open report.");
    assert.equal(document.activeElement?.textContent?.trim(), "Account deletion requests");
  } finally {
    view.cleanup();
  }
});
