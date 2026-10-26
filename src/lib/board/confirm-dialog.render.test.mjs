import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

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
const { ConfirmDialog } = await import("../../components/board/confirm-dialog.tsx");

const style = document.createElement("style");
style.textContent = [
  readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8"),
  readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8"),
].join("\n");
document.head.append(style);

test("an open confirm dialog stays fixed in the viewport", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(ConfirmDialog, {
        open: true,
        title: "Sign out of Avouch?",
        description: "You can sign in again with your code.",
        confirmLabel: "Sign out",
        cancelLabel: "Stay",
        onConfirm() {},
        onCancel() {},
      }),
    );
  });
  const dialog = document.querySelector("dialog");
  assert.ok(dialog instanceof HTMLDialogElement);
  assert.equal(dialog.open, true);
  const computed = getComputedStyle(dialog);
  assert.equal(computed.position, "fixed");
  assert.equal(computed.marginTop, "auto");
  assert.equal(computed.marginRight, "auto");
  assert.equal(computed.marginBottom, "auto");
  assert.equal(computed.marginLeft, "auto");
  assert.equal(computed.inset === "0" || computed.inset === "0px", true);
  const title = dialog.querySelector("h2");
  assert.match(title?.className ?? "", /text-2xl/);
  act(() => root.unmount());
  host.remove();
});

test("a plate inside a plate does not pull up into the hero", () => {
  const host = document.createElement("div");
  host.innerHTML =
    '<section class="plate" id="outer"><section class="plate" id="inner">Inside</section></section>';
  document.body.append(host);
  const outer = getComputedStyle(document.getElementById("outer"));
  const inner = getComputedStyle(document.getElementById("inner"));
  assert.equal(inner.marginTop === "0" || inner.marginTop === "0px", true);
  assert.equal(outer.marginTop === "0" || outer.marginTop === "0px", false);
  host.remove();
});
