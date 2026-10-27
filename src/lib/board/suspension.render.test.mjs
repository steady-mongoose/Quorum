import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1440, height: 900 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window", "document", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLDialogElement",
  "Node", "Element", "DocumentFragment", "MutationObserver", "Event", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame",
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
const ui = await import("../../components/board/suspension.tsx");

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};
const wait = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

/** @param {any} over */
function fakeApi(over = {}) {
  /** @type {unknown[][]} */
  const calls = [];
  /** @type {any[]} */
  let reviews = over.reviews ?? [];
  return {
    calls,
    api: {
      own: async () => ({ suspended: false }),
      appeal: async (/** @type {unknown[]} */ ...args) => (calls.push(["appeal", ...args]), { ok: true }),
      reviews: async () => ({ reviews }),
      decide: async (/** @type {string} */ id, /** @type {string} */ decision) => {
        calls.push(["decide", id, decision]);
        reviews = reviews.filter((row) => row.id !== id);
        return { ok: true };
      },
    },
  };
}

/** @param {any} element */
async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}
const button = (/** @type {HTMLElement} */ host, /** @type {string} */ text) =>
  /** @type {HTMLButtonElement | undefined} */ ([...host.querySelectorAll("button")].find((b) => b.textContent === text));
const dialogConfirm = (/** @type {HTMLElement} */ host) =>
  /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("dialog button")].find((b) => b.textContent !== "Cancel"));

test("a pornography suspension: focused h1, the explanation, the compromise-only line and Appeal", async () => {
  const { api, calls } = fakeApi();
  const { host, done } = await mount(
    createElement(/** @type {any} */ (ui.SuspendedNotice), { api, suspension: { suspended: true, reason: "porn", postId: "p1", appealable: true } }),
  );
  const h1 = host.querySelector("h1");
  assert.equal(h1?.textContent, ui.SUSPENDED_TITLE);
  assert.equal(document.activeElement, h1);
  assert.ok(host.querySelector('[role="status"]'));
  const text = host.textContent ?? "";
  assert.ok(text.includes(ui.suspendedExplanation("porn", false)));
  assert.ok(text.includes("under the rule on pornography"));
  assert.ok(text.includes(ui.APPEAL_INTRO));
  assert.ok(text.includes(ui.PORN_APPEAL_LINE));
  const appeal = button(host, "Appeal");
  assert.ok(appeal && appeal.className.includes("min-h-[44px]"));
  act(() => appeal.click());
  await flush();
  assert.equal(host.querySelectorAll('textarea[aria-required="true"]').length, 2, "reason and the proof of takeover");
  act(() => button(host, "Send appeal")?.click());
  await flush();
  assert.ok(host.querySelector('[role="alert"]'));
  assert.deepEqual(calls, []);
  done();
});

test("a CSAM suspension says it can't be appealed and shows no button", async () => {
  const { api } = fakeApi();
  const { host, done } = await mount(
    createElement(/** @type {any} */ (ui.SuspendedNotice), { api, suspension: { suspended: true, reason: "csam", postId: "p1", appealable: false } }),
  );
  assert.ok((host.textContent ?? "").includes(ui.CSAM_NO_APPEAL));
  assert.equal(host.querySelectorAll("button").length, 0);
  assert.equal(host.querySelector(".text-danger"), null, "no red on the notice");
  done();
});

test("the admin queue: 44px buttons, danger close with Cancel focused, no clear for CSAM, focus and announce", async () => {
  const { api, calls } = fakeApi({
    reviews: [
      { id: "r1", userId: "u1", name: "Maria", reason: "porn", requestedBy: "Tom", roomId: "shop", own: false, at: 0 },
      { id: "r2", userId: "u2", name: "Bo", reason: "csam", requestedBy: "Tom", roomId: "shop", own: false, at: 0 },
      { id: "r3", userId: "me", name: "Ada", reason: "porn", requestedBy: "Tom", roomId: "shop", own: true, at: 0 },
    ],
  });
  const { host, done } = await mount(createElement(/** @type {any} */ (ui.BanReviewQueue), { api }));
  const heading = host.querySelector("h2#ban-review-heading");
  assert.equal(heading?.textContent, "Suspensions to review");
  const close = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Close account");
  const clear = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Clear and restore");
  assert.equal(close.length, 2);
  assert.equal(clear.length, 1, "CSAM can't be cleared and your own case has no buttons");
  for (const b of [...close, ...clear]) assert.ok(b.className.includes("min-h-[44px]"));
  assert.equal(close[0]?.getAttribute("aria-label"), "Close account for Maria");
  assert.ok((host.textContent ?? "").includes(ui.OWN_CASE));
  act(() => close[0]?.click());
  await flush();
  assert.ok((host.textContent ?? "").includes(ui.closeConfirm("Maria")));
  assert.equal(document.activeElement?.textContent, "Cancel");
  act(() => dialogConfirm(host).click());
  await flush();
  await wait();
  assert.deepEqual(calls, [["decide", "r1", "closed"]]);
  assert.equal(host.querySelector('.sr-only[role="status"]')?.textContent, ui.ACCOUNT_CLOSED);
  assert.equal(document.activeElement, host.querySelector("h2#ban-review-heading"));
  done();
});

test("clearing announces Suspension lifted.", async () => {
  const { api, calls } = fakeApi({
    reviews: [{ id: "r1", userId: "u1", name: "Maria", reason: "threat", requestedBy: "Tom", roomId: "shop", own: false, at: 0 }],
  });
  const { host, done } = await mount(createElement(/** @type {any} */ (ui.BanReviewQueue), { api }));
  act(() => button(host, "Clear and restore")?.click());
  await flush();
  assert.ok((host.textContent ?? "").includes(ui.clearConfirm("Maria")));
  act(() => dialogConfirm(host).click());
  await flush();
  await wait();
  assert.deepEqual(calls, [["decide", "r1", "cleared"]]);
  assert.equal(host.querySelector('.sr-only[role="status"]')?.textContent, ui.SUSPENSION_LIFTED);
  done();
});
