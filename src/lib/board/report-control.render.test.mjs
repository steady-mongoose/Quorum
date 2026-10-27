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

const WIDTHS = [390, 768, 1440];

test("Report is a 44px control with a reason picker at 390, 768, and 1440", () => {
  /** @type {any[]} */
  const sent = [];
  for (const width of WIDTHS) {
    window.happyDOM.setViewport({ width, height: 900 });
    assert.equal(window.innerWidth, width);
    sent.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(ReportControl, {
          onSubmit: async (input) => {
            sent.push(input);
            return { ok: true };
          },
        }),
      );
    });
    try {
      const button = [...host.querySelectorAll("button")].find((item) =>
        item.textContent?.includes("Report"),
      );
      assert.ok(button, String(width));
      assert.match(button.className, /min-h-\[44px\]/);
      act(() => {
        button.click();
      });
      const reasons = [...host.querySelectorAll('input[type="radio"]')];
      assert.equal(reasons.length, 5, String(width));
      for (const reason of reasons) {
        const label = reason.closest("label");
        assert.match(label?.className ?? "", /min-h-\[44px\]/);
      }
      const form = host.querySelector("form");
      assert.ok(form);
      act(() => {
        form.requestSubmit();
      });
      assert.equal(sent.length, 0);
      assert.match(host.textContent ?? "", /Choose a reason/);
      const threat = reasons.find((item) => item instanceof HTMLInputElement && item.value === "threat");
      assert.ok(threat instanceof HTMLInputElement);
      act(() => {
        threat.click();
      });
      act(() => {
        form.requestSubmit();
      });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].reason, "threat");
      assert.equal(window.innerWidth, width);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  }
});

test("Report moves focus to the form, back to the button, and confirms a send", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(ReportControl, {
        label: "Report this message",
        onSubmit: async () => ({ ok: true }),
      }),
    );
  });
  try {
    /** @param {string} selector */
    const el = (selector) => {
      const found = host.querySelector(selector);
      assert.ok(found instanceof HTMLElement, selector);
      return found;
    };
    const trigger = () => el('button[aria-label="Report this message"]');
    act(() => trigger().click());
    const legend = el("legend");
    assert.equal(legend.getAttribute("tabindex"), "-1");
    assert.equal(document.activeElement, legend);
    assert.match(host.textContent ?? "", /Sharing someone's private details/);
    assert.equal(host.textContent?.includes("Doxxing"), false);
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    assert.ok(cancel);
    act(() => cancel.click());
    assert.equal(document.activeElement, trigger());
    assert.equal(host.querySelector('[role="status"]'), null);
    act(() => trigger().click());
    act(() => el('input[value="threat"]').click());
    const form = host.querySelector("form");
    assert.ok(form);
    await act(async () => {
      form.requestSubmit();
    });
    assert.equal(host.querySelector("form"), null);
    assert.equal(document.activeElement, trigger());
    const status = host.querySelector('[role="status"]');
    assert.equal(status?.textContent, "Report sent. A steward will look at it.");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test("Report defaults to the post label", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ReportControl, { onSubmit: async () => ({ ok: true }) }));
  });
  try {
    assert.ok(host.querySelector('button[aria-label="Report this post"]'));
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
