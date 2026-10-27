import assert from "node:assert/strict";
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
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLLabelElement",
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
const { ReportControl } = await import("../../components/board/report-control.tsx");
const { ReportQueueList, rowLabel } = await import("../../components/board/moderation-queue.tsx");

/** @param {string} id @param {string} reason @param {string} name */
const row = (id, reason, name) => ({
  id,
  roomId: "r",
  subjectKind: "post",
  subjectId: `p-${id}`,
  reason,
  note: "",
  at: 1,
  reporterName: name,
  excerpt: "",
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/** @param {any[]} rows @param {(id: string, r: "resolved" | "dismissed") => Promise<string>} onClose */
function mount(rows, onClose) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ReportQueueList, { initial: rows, onClose }));
  });
  return { host, root };
}

test("rowLabel names the reason and the reporter, or just the reason", () => {
  assert.equal(rowLabel({ reason: "threat", reporterName: "Ana" }), "Threat of violence, reported by Ana");
  assert.equal(rowLabel({ reason: "threat", reporterName: "" }), "Threat of violence");
});

test("each action has a unique accessible name", () => {
  const { host, root } = mount(
    [row("a", "threat", "Ana"), row("b", "threat", "Ben"), row("c", "doxxing", "")],
    async () => "",
  );
  const labels = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes("Mark resolved: Threat of violence, reported by Ana"));
  assert.ok(labels.includes("Dismiss: Threat of violence, reported by Ben"));
  assert.ok(labels.includes("Dismiss: Sharing someone's private details"));
  act(() => root.unmount());
  host.remove();
});

test("resolving moves focus to the next row and announces it", async () => {
  const { host, root } = mount([row("a", "threat", "Ana"), row("b", "porn", "Ben")], async () => "");
  act(() => {
    /** @type {HTMLButtonElement} */ (host.querySelector("li button")).click();
  });
  await flush();
  assert.equal(host.querySelectorAll("li").length, 1);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Mark resolved: Pornography, reported by Ben");
  assert.equal(host.querySelector('[role="status"]')?.textContent, "Report marked resolved.");
  act(() => root.unmount());
  host.remove();
});

test("dismissing the last row focuses the Reports heading", async () => {
  const { host, root } = mount([row("a", "threat", "Ana")], async () => "");
  act(() => {
    /** @type {HTMLButtonElement} */ (host.querySelectorAll("li button")[1]).click();
  });
  await flush();
  assert.equal(host.querySelectorAll("li").length, 0);
  assert.equal(document.activeElement?.tagName, "H2");
  assert.equal(document.activeElement?.textContent, "Reports");
  assert.equal(host.querySelector('[role="status"]')?.textContent, "Report dismissed.");
  act(() => root.unmount());
  host.remove();
});

test("a failed close keeps the row, shows the error, and announces nothing", async () => {
  const { host, root } = mount([row("a", "threat", "Ana")], async () => "Could not close it.");
  act(() => {
    /** @type {HTMLButtonElement} */ (host.querySelector("li button")).click();
  });
  await flush();
  assert.equal(host.querySelectorAll("li").length, 1);
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "Could not close it.");
  assert.equal(host.querySelector('[role="status"]')?.textContent, "");
  act(() => root.unmount());
  host.remove();
});
