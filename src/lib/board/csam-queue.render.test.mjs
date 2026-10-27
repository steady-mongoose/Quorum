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
const queue = await import("../../components/board/csam-queue.tsx");
const { CsamQueue, NOT_CUSTODIAN, LEGAL_HOLD_OFF_CONFIRM, LEGAL_HOLD_NOTE_LABEL, recordConfirm, grantConfirm } = queue;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};

const hold = (/** @type {Record<string, unknown>} */ over = {}) => ({
  id: "h1", postId: "p1", author: "maria", accountId: "u-maria", incidentAt: 0, retainUntil: 0,
  mediaCount: 1, byteSize: 4, mediaTypes: ["image/jpeg"], status: "prepared", reportId: "",
  legalHold: false, legalHoldNote: "", fileIds: ["m1"], fileHashes: ["ab".repeat(32)],
  reporter: "rae", reportReason: "A child.", ...over,
});

/** @param {any} view */
function fakeApi(view) {
  /** @type {unknown[][]} */
  const calls = [];
  return {
    calls,
    api: {
      load: async () => view,
      file: async (/** @type {unknown[]} */ ...args) => (calls.push(["file", ...args]), { ok: true }),
      legalHold: async (/** @type {unknown[]} */ ...args) => (calls.push(["legalHold", ...args]), { ok: true }),
      custodian: async (/** @type {unknown[]} */ ...args) => (calls.push(["custodian", ...args]), { ok: true }),
      removeFlagged: async (/** @type {unknown[]} */ ...args) => (calls.push(["remove", ...args]), { ok: true }),
      requestRelease: async (/** @type {unknown[]} */ ...args) => (calls.push(["requestRelease", ...args]), { ok: true }),
      confirmRelease: async (/** @type {unknown[]} */ ...args) => (calls.push(["confirmRelease", ...args]), { ok: true }),
    },
  };
}

/** @param {any} api */
async function mount(api) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(CsamQueue, { api })));
  await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

const button = (/** @type {HTMLElement} */ host, /** @type {string} */ text) =>
  /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("button")].find((b) => b.textContent === text));
const dialogConfirm = (/** @type {HTMLElement} */ host) =>
  /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("dialog button")].find((b) => b.textContent !== "Cancel"));

test("a non-custodian admin sees the notice and nothing else", async () => {
  const { api } = fakeApi({ custodian: false, owner: false, reports: [], flags: [], admins: [] });
  const { host, done } = await mount(api);
  assert.ok((host.textContent ?? "").includes(NOT_CUSTODIAN));
  assert.equal(host.querySelectorAll("li").length, 0);
  done();
});

test("the queue shows metadata only: no image, video, link or reveal", async () => {
  const { api } = fakeApi({
    custodian: true, owner: false, reports: [hold()],
    flags: [{ id: "f1", postId: "p2", source: "report", reporter: "rae", reason: "A child.", uploader: "bo", fileIds: ["m2"], at: 0 }],
    admins: [],
  });
  const { host, done } = await mount(api);
  assert.equal(host.querySelectorAll("img, video, picture, canvas, iframe, a").length, 0);
  assert.equal(/reveal|preview|show/i.test(host.textContent ?? ""), false);
  assert.ok((host.textContent ?? "").includes(`sha256 ${"ab".repeat(32)}`));
  assert.ok((host.textContent ?? "").includes("file m2"));
  assert.ok((host.textContent ?? "").includes("Reported by rae"));
  assert.ok((host.textContent ?? "").includes("uploaded by bo"));
  assert.ok((host.textContent ?? "").includes(LEGAL_HOLD_NOTE_LABEL));
  done();
});

test("Record filing confirms with the report number, Cancel focused", async () => {
  const { api, calls } = fakeApi({ custodian: true, owner: false, reports: [hold()], flags: [], admins: [] });
  const { host, done } = await mount(api);
  const input = /** @type {HTMLInputElement} */ (host.querySelector("input"));
  const setter = /** @type {(this: HTMLInputElement, v: string) => void} */ (
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  );
  act(() => { setter.call(input, "123456"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => button(host, "Record filing").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(recordConfirm("123456")));
  assert.equal(document.activeElement?.textContent, "Cancel");
  assert.deepEqual(calls, []);
  act(() => dialogConfirm(host).click());
  await flush();
  assert.deepEqual(calls, [["file", "h1", "123456"]]);
  done();
});

test("turning off a legal hold and naming a custodian both confirm first", async () => {
  const { api, calls } = fakeApi({
    custodian: true, owner: true, reports: [hold({ legalHold: true, legalHoldNote: "FBI, case 9" })], flags: [],
    admins: [{ id: "ann", name: "Ann", custodian: false }],
  });
  const { host, done } = await mount(api);
  act(() => button(host, "Turn off legal hold").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(LEGAL_HOLD_OFF_CONFIRM));
  act(() => dialogConfirm(host).click());
  await flush();
  act(() => button(host, "Make custodian").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(grantConfirm("Ann")));
  act(() => dialogConfirm(host).click());
  await flush();
  assert.deepEqual(calls, [["legalHold", "h1", false, ""], ["custodian", "ann", true]]);
  done();
});

test("design review: file list wraps, buttons name the post, note error is tied, focus moves", async () => {
  const { api, calls } = fakeApi({
    custodian: true, owner: false, reports: [hold()],
    flags: [{ id: "f1", postId: "p2", source: "report", reporter: "rae", reason: "A child.", uploader: "bo", fileIds: ["m2"], at: 0 }],
    admins: [],
  });
  const { host, done } = await mount(api);
  for (const list of host.querySelectorAll("ul.font-mono")) assert.ok(list.className.includes("break-all"));
  assert.equal(button(host, "Record filing").getAttribute("aria-label"), "Record filing for post p1");
  assert.equal(button(host, "Preserve and remove").getAttribute("aria-label"), "Preserve and remove post p2");
  assert.equal(button(host, "Turn on legal hold").getAttribute("aria-label"), "Turn on legal hold for post p1");

  act(() => button(host, "Turn on legal hold").click());
  await flush();
  const note = /** @type {HTMLInputElement} */ (host.querySelector("#csam-note-h1"));
  const errorId = note.getAttribute("aria-describedby");
  assert.ok(errorId);
  assert.equal(note.getAttribute("aria-invalid"), "true");
  assert.equal(host.querySelector(`#${errorId}`)?.textContent, queue.LEGAL_HOLD_NOTE_ERROR);
  assert.deepEqual(calls, []);

  act(() => button(host, "Preserve and remove").click());
  await flush();
  act(() => dialogConfirm(host).click());
  await flush();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  assert.deepEqual(calls, [["remove", "f1"]]);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.equal(document.activeElement?.id, "csam-queue-heading");
  done();
});

test("Release flag needs a written reason, stays blind, and a pending release needs a confirm", async () => {
  const base = { id: "f1", postId: "p2", source: "report", reporter: "rae", reason: "A child.", uploader: "bo", fileIds: ["m2"], at: 0 };
  const { api, calls } = fakeApi({ custodian: true, owner: false, reports: [], flags: [{ ...base, releaseRequestedBy: "", releaseReason: "", releaseRequestedByMe: false }], admins: [] });
  const { host, done } = await mount(api);
  assert.equal(host.querySelectorAll("img, video, picture, canvas, iframe, a").length, 0);
  const release = button(host, "Release flag");
  assert.equal(release.getAttribute("aria-label"), "Release flag on post p2");
  assert.ok(release.className.includes("min-h-[44px]"));
  assert.equal(host.querySelector("#csam-release-hint-f1")?.textContent, queue.RELEASE_REASON_HINT);
  assert.equal(
    host.querySelector("#csam-release-f1")?.getAttribute("aria-describedby"),
    "csam-release-hint-f1",
    "the hint is always tied to the box",
  );
  act(() => release.click());
  await flush();
  const box = /** @type {HTMLTextAreaElement} */ (host.querySelector("#csam-release-f1"));
  assert.equal(box.getAttribute("aria-describedby"), "csam-release-hint-f1 csam-release-error-f1");
  assert.equal(host.querySelector("#csam-release-error-f1")?.textContent, queue.RELEASE_REASON_ERROR);
  assert.deepEqual(calls, []);
  const setter = /** @type {(this: HTMLTextAreaElement, v: string) => void} */ (
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
  );
  act(() => { setter.call(box, "Scanner matched a stock photo of a cat."); box.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => button(host, "Release flag").click());
  await flush();
  assert.deepEqual(calls, [["requestRelease", "f1", "Scanner matched a stock photo of a cat."]]);
  assert.equal(host.querySelector('[role="status"]')?.textContent, queue.RELEASE_REQUESTED);
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  assert.equal(document.activeElement?.id, "csam-queue-heading", "focus is kept in the queue");
  done();

  const mine = fakeApi({ custodian: true, owner: false, reports: [], flags: [{ ...base, releaseRequestedBy: "Ann", releaseReason: "Scanner matched a stock photo of a cat.", releaseRequestedByMe: true }], admins: [] });
  const own = await mount(mine.api);
  assert.ok((own.host.textContent ?? "").includes(queue.RELEASE_MINE));
  assert.equal([...own.host.querySelectorAll("button")].some((b) => b.textContent === "Confirm release"), false);
  own.done();

  const second = fakeApi({ custodian: true, owner: false, reports: [], flags: [{ ...base, releaseRequestedBy: "Ann", releaseReason: "Scanner matched a stock photo of a cat.", releaseRequestedByMe: false }], admins: [] });
  const view = await mount(second.api);
  assert.ok((view.host.textContent ?? "").includes("Ann asked to release this flag"));
  assert.ok(button(view.host, "Confirm release").className.includes("min-h-[44px]"));
  act(() => button(view.host, "Confirm release").click());
  await flush();
  assert.ok((view.host.textContent ?? "").includes(queue.RELEASE_CONFIRM));
  assert.equal(document.activeElement?.textContent, "Cancel");
  assert.deepEqual(second.calls, []);
  act(() => dialogConfirm(view.host).click());
  await flush();
  assert.deepEqual(second.calls, [["confirmRelease", "f1"]]);
  view.done();
});
