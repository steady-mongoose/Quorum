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
const { DeletePostControl } = await import("../../components/board/delete-post.tsx");
const { AccountRemovalPanel } = await import("../../components/board/account-removal.tsx");

const widths = [390, 768, 1440];

/** @param {import("react").ReactNode} node */
function mount(node) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("the delete confirm dialog uses the required copy at 390, 768, and 1440", () => {
  for (const width of widths) {
    window.happyDOM.setViewport({ width, height: 900 });
    let deleted = 0;
    const view = mount(
      createElement(DeletePostControl, {
        held: false,
        onDelete: async () => {
          deleted += 1;
          return { ok: true };
        },
      }),
    );
    try {
      assert.equal(window.innerWidth, width);
      const open = view.host.querySelector("button");
      assert.equal(open?.textContent, "Delete");
      assert.match(open?.className ?? "", /min-h-\[44px\]/);
      act(() => open?.click());
      const dialog = document.querySelector("dialog");
      assert.ok(dialog instanceof HTMLDialogElement);
      assert.equal(dialog.querySelector("h2")?.textContent, "Delete this post?");
      assert.match(dialog.textContent ?? "", /It can't be recovered\./);
      assert.equal(dialog.textContent?.includes("undone"), false);
      const buttons = [...dialog.querySelectorAll("button")];
      // Cancel comes first (ConfirmDialog order), then the confirm button.
      assert.equal(buttons[0]?.textContent, "Cancel");
      assert.equal(buttons[1]?.textContent, "Delete");
      assert.match(buttons[1]?.className ?? "", /min-h-\[44px\]/);
      assert.match(buttons[1]?.className ?? "", /text-danger/);
      assert.match(buttons[0]?.className ?? "", /min-h-\[44px\]/);
      act(() => buttons[0]?.click());
      assert.equal(deleted, 0);
      act(() => open?.click());
      const again = document.querySelector("dialog");
      act(() => [...(again?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Delete")?.click());
      assert.equal(deleted, 1);
    } finally {
      view.cleanup();
    }
  }
});

test("a held post does not call delete from the confirm dialog", () => {
  window.happyDOM.setViewport({ width: 390, height: 900 });
  let deleted = 0;
  const view = mount(
    createElement(DeletePostControl, {
      held: true,
      onDelete: async () => {
        deleted += 1;
        return { ok: true };
      },
    }),
  );
  try {
    act(() => view.host.querySelector("button")?.click());
    const dialog = document.querySelector("dialog");
    act(() => [...(dialog?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Delete")?.click());
    assert.equal(deleted, 0);
    assert.match(view.host.textContent ?? "", /This post is held and cannot be deleted\./);
  } finally {
    view.cleanup();
  }
});

test("account deactivation and deletion controls stay 44px at 390, 768, and 1440", () => {
  for (const width of widths) {
    window.happyDOM.setViewport({ width, height: 900 });
    const view = mount(
      createElement(AccountRemovalPanel, {
        deactivated: false,
        deletionRequested: false,
        note: "",
        error: "",
        pending: false,
        onNote() {},
        onDeactivate() {},
        onReactivate() {},
        onRequest() {},
      }),
    );
    try {
      assert.equal(window.innerWidth, width);
      const labels = [...view.host.querySelectorAll("button")].map((button) => button.textContent);
      assert.deepEqual(labels, ["Deactivate account", "Request account deletion"]);
      for (const button of view.host.querySelectorAll("button")) {
        assert.match(button.className, /min-h-\[44px\]/);
      }
      assert.match(view.host.textContent ?? "", /Deactivation hides your profile and posts/);
    } finally {
      view.cleanup();
    }
  }
});
