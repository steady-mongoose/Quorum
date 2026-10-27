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
  "HTMLInputElement",
  "HTMLFormElement",
  "HTMLTextAreaElement",
  "SubmitEvent",
  "InputEvent",
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
const { DmReportControl, DmReportQueue } = await import("../../components/board/dm-report.tsx");
const copy = await import("../e2ee/dm-report.ts");

/** @param {any} element */
function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}
/** @param {Element} host @param {string} text */
function button(host, text) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  assert.ok(found, text);
  return /** @type {HTMLButtonElement} */ (found);
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

test("reporting a message: a reason is required, the text is shared only when ticked, and CSAM never shares it", async () => {
  /** @type {any[]} */
  const sent = [];
  const send = async (/** @type {string} */ id, /** @type {any} */ input) => {
    sent.push({ id, ...input });
    return /** @type {const} */ ({ ok: true, value: { id: "r1" } });
  };
  const view = mount(createElement(DmReportControl, { messageId: "m1", text: "I know where you live.", send }));
  try {
    act(() => button(view.host, copy.DM_REPORT_BUTTON).click());
    const form = /** @type {HTMLFormElement} */ (view.host.querySelector("form"));
    assert.ok(form);
    const radios = /** @type {HTMLInputElement[]} */ ([...view.host.querySelectorAll('input[type="radio"]')]);
    assert.equal(radios.length, 5);
    assert.equal(document.activeElement, radios[0], "focus starts on the first reason");
    const buttons = [...form.querySelectorAll("button")].map((item) => item.textContent);
    assert.deepEqual(buttons, ["Cancel", "Send the report"], "Cancel comes first");

    act(() => form.requestSubmit());
    assert.equal(sent.length, 0);
    const alert = view.host.querySelector('[role="alert"]');
    assert.equal(alert?.textContent, copy.DM_REPORT_REASON_ERROR);

    const threat = radios.find((item) => item.value === "threat");
    act(() => threat?.click());
    const share = /** @type {HTMLInputElement} */ (view.host.querySelector('input[type="checkbox"]'));
    assert.equal(share.checked, false, "sharing starts off");
    act(() => form.requestSubmit());
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].reason, "threat");
    assert.equal(sent[0].sharedText, "", "nothing is shared unless ticked");
    assert.equal(view.host.querySelector('[role="status"]')?.textContent, copy.DM_REPORT_SENT);
  } finally {
    view.cleanup();
  }

  const second = mount(createElement(DmReportControl, { messageId: "m2", text: "secret words", send }));
  try {
    act(() => button(second.host, copy.DM_REPORT_BUTTON).click());
    const form = /** @type {HTMLFormElement} */ (second.host.querySelector("form"));
    const radios = /** @type {HTMLInputElement[]} */ ([...second.host.querySelectorAll('input[type="radio"]')]);
    act(() => radios.find((item) => item.value === "porn")?.click());
    act(() => /** @type {HTMLInputElement} */ (second.host.querySelector('input[type="checkbox"]')).click());
    act(() => radios.find((item) => item.value === "csam")?.click());
    assert.equal(second.host.querySelector('input[type="checkbox"]'), null, "CSAM hides the share box");
    assert.match(second.host.textContent ?? "", new RegExp(copy.DM_REPORT_CSAM_HINT.slice(0, 30)));
    act(() => form.requestSubmit());
    await flush();
    assert.equal(sent[1].reason, "csam");
    assert.equal(sent[1].sharedText, "");
  } finally {
    second.cleanup();
  }
});

test("the admin message-report queue shows shared text and closes a report", async () => {
  /** @type {string[]} */
  const closed = [];
  const rows = [
    { id: "a", reason: "csam", note: "", sharedText: "", reporterName: "Ann", reportedName: "Ben", messageSentAt: 1, messageKept: true, at: 1 },
    { id: "b", reason: "threat", note: "Scary", sharedText: "I know where you live.", reporterName: "Ann", reportedName: "Ben", messageSentAt: 1, messageKept: false, at: 2 },
  ];
  const view = mount(
    createElement(DmReportQueue, /** @type {any} */ ({
      load: async () => ({ ok: true, value: rows }),
      close: async (/** @type {string} */ id) => {
        closed.push(id);
        return { ok: true, value: { ok: true } };
      },
    })),
  );
  try {
    await flush();
    const items = view.host.querySelectorAll("li");
    assert.equal(items.length, 2);
    assert.equal(items[0]?.querySelector("blockquote"), null, "no text for CSAM");
    assert.equal(items[1]?.querySelector("blockquote")?.textContent, "I know where you live.");
    assert.match(items[1]?.textContent ?? "", /The message has been deleted/);
    assert.equal(/\d+ (likes|reports)/.test(view.host.textContent ?? ""), false);
    act(() => button(/** @type {Element} */ (items[1]), "Dismiss").click());
    await flush();
    assert.deepEqual(closed, ["b"]);
    assert.equal(view.host.querySelectorAll("li").length, 1);
  } finally {
    view.cleanup();
  }
});

test("design review: Cancel returns focus, Send uses aria-disabled, queue buttons name the report, closing announces", async () => {
  /** @type {(value: any) => void} */
  let finish = () => {};
  const view = mount(
    createElement(DmReportControl, /** @type {any} */ ({
      messageId: "m1",
      text: "hi",
      send: () => new Promise((resolve) => { finish = resolve; }),
    })),
  );
  try {
    act(() => button(view.host, copy.DM_REPORT_BUTTON).click());
    await flush();
    act(() => button(view.host, "Cancel").click());
    await flush();
    assert.equal(document.activeElement?.textContent, copy.DM_REPORT_BUTTON);

    act(() => button(view.host, copy.DM_REPORT_BUTTON).click());
    await flush();
    const radio = /** @type {HTMLInputElement} */ (view.host.querySelector('input[type="radio"]'));
    act(() => radio.click());
    const send = button(view.host, "Send the report");
    act(() => { /** @type {HTMLFormElement} */ (view.host.querySelector("form")).requestSubmit(); });
    await flush();
    assert.equal(send.disabled, false);
    assert.equal(send.getAttribute("aria-disabled"), "true");
    finish({ ok: true, value: { id: "r1" } });
    await flush();
  } finally {
    view.cleanup();
  }

  const rows = [
    { id: "a", reason: "threat", note: "", sharedText: "", reporterName: "Ann", reportedName: "Ben", messageSentAt: 1, messageKept: true, at: 1 },
    { id: "b", reason: "threat", note: "", sharedText: "", reporterName: "Cal", reportedName: "Dee", messageSentAt: 1, messageKept: true, at: 2 },
  ];
  const queue = mount(
    createElement(DmReportQueue, /** @type {any} */ ({
      load: async () => ({ ok: true, value: rows }),
      close: async () => ({ ok: true, value: { ok: true } }),
    })),
  );
  try {
    await flush();
    const names = [...queue.host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "");
    assert.equal(new Set(names).size, 4, "every button has its own name");
    assert.ok(names.some((name) => name.startsWith("Dismiss: Cal's report about Dee")));
    assert.ok(names.some((name) => name.startsWith("Mark resolved: Ann's report about Ben")));
    const dismiss = [...queue.host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Dismiss: Cal"));
    act(() => /** @type {HTMLButtonElement} */ (dismiss).click());
    await flush();
    assert.equal(queue.host.querySelector('[role="status"]')?.textContent, "Report closed.");
    assert.equal(document.activeElement?.textContent?.trim(), "Message reports");
  } finally {
    queue.cleanup();
  }
});
