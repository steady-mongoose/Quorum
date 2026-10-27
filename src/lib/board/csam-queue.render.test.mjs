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
const { CsamQueue, NOT_CUSTODIAN, LEGAL_HOLD_NOTE_LABEL, recordConfirm, grantConfirm } = queue;

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};

const hold = (/** @type {Record<string, unknown>} */ over = {}) => ({
  id: "h1", postId: "p1", author: "maria", accountId: "u-maria", incidentAt: 0, retainUntil: 0,
  mediaCount: 1, byteSize: 4, mediaTypes: ["image/jpeg"], status: "prepared", reportId: "",
  legalHold: false, legalHoldNote: "", fileIds: ["m1"], fileHashes: ["ab".repeat(32)],
  reporter: "rae", reportReason: "A child.", releasedAt: null, releaseLawyer: "", releaseReference: "", ...over,
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
      releaseHold: async (/** @type {unknown[]} */ ...args) => (calls.push(["releaseHold", ...args]), { ok: true }),
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

test("a legal hold has no off switch, and naming a custodian confirms first", async () => {
  const { api, calls } = fakeApi({
    custodian: true, owner: true, reports: [hold({ legalHold: true, legalHoldNote: "FBI, case 9" })], flags: [],
    admins: [{ id: "ann", name: "Ann", custodian: false }],
  });
  const { host, done } = await mount(api);
  assert.equal(button(host, "Turn off legal hold"), undefined, "only a lawyer-signed release ends a hold");
  act(() => button(host, "Make custodian").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(grantConfirm("Ann")));
  act(() => dialogConfirm(host).click());
  await flush();
  assert.deepEqual(calls, [["custodian", "ann", true]]);
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

test("there is no Release flag; a flag can only be preserved and removed", async () => {
  const { api } = fakeApi({
    custodian: true, owner: false, reports: [],
    flags: [{ id: "f1", postId: "p2", source: "report", reporter: "rae", reason: "A child.", uploader: "bo", fileIds: ["m2"], at: 0 }],
    admins: [],
  });
  const { host, done } = await mount(api);
  assert.equal(/release/i.test(host.textContent ?? ""), false);
  assert.equal(host.querySelectorAll("textarea").length, 0);
  done();
});

test("a filed hold is released only with a lawyer's name and reference, confirmed and announced", async () => {
  const { api, calls } = fakeApi({
    custodian: true, owner: false, reports: [hold({ status: "filed", reportId: "123456" })], flags: [], admins: [],
  });
  const { host, done } = await mount(api);
  const release = button(host, "Release hold");
  assert.equal(release.getAttribute("aria-label"), "Release hold for post p1");
  assert.ok(release.className.includes("min-h-[44px]"));
  assert.equal(host.querySelector("#csam-release-hint-h1")?.textContent, queue.RELEASE_HINT);
  assert.match(queue.RELEASE_HINT, /ends the legal hold/);
  assert.match(queue.releaseConfirm("A", "B"), /stay sealed and are purged when the one-year preservation ends/);
  for (const id of ["#csam-lawyer-h1", "#csam-lawyer-ref-h1"]) {
    const input = /** @type {HTMLElement} */ (host.querySelector(id));
    assert.equal(input.getAttribute("aria-required"), "true");
    assert.ok(input.className.includes("min-h-[44px]"));
    assert.ok((input.closest("label")?.textContent ?? "").includes("(required)"));
    const hint = /** @type {Node} */ (host.querySelector("#csam-release-hint-h1"));
    assert.ok(hint.compareDocumentPosition(input) & 4, "the hint comes before the inputs");
  }
  act(() => release.click());
  await flush();
  const lawyer = /** @type {HTMLInputElement} */ (host.querySelector("#csam-lawyer-h1"));
  const ref = /** @type {HTMLInputElement} */ (host.querySelector("#csam-lawyer-ref-h1"));
  assert.equal(lawyer.getAttribute("aria-describedby"), "csam-release-hint-h1 csam-release-error-h1");
  assert.equal(host.querySelector("#csam-release-error-h1")?.textContent, queue.RELEASE_FIELDS_ERROR);
  assert.deepEqual(calls, []);
  const setter = /** @type {(this: HTMLInputElement, v: string) => void} */ (
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  );
  act(() => { setter.call(lawyer, "Dana Reyes"); lawyer.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { setter.call(ref, "DR-2026-114"); ref.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => button(host, "Release hold").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(queue.releaseConfirm("Dana Reyes", "DR-2026-114")));
  assert.deepEqual(calls, []);
  act(() => dialogConfirm(host).click());
  await flush();
  assert.deepEqual(calls, [["releaseHold", "h1", "Dana Reyes", "DR-2026-114"]]);
  assert.equal(host.querySelector('[role="status"]')?.textContent, queue.RELEASE_DONE);
  done();

  const unfiled = fakeApi({ custodian: true, owner: false, reports: [hold()], flags: [], admins: [] });
  const view = await mount(unfiled.api);
  assert.equal(button(view.host, "Release hold"), undefined, "a hold not yet reported to NCMEC cannot be released");
  view.done();
});

test("a chat flag shows the line's id, room and time, never its text", async () => {
  const { api } = fakeApi({
    custodian: true, owner: false, reports: [],
    flags: [{
      id: "f9", postId: "", source: "report", reporter: "rae", reason: "Member report r1", uploader: "bo", fileIds: [],
      at: 0, chatMessageId: "c42", chatRoomId: "shop", chatAt: Date.UTC(2026, 9, 19, 12),
    }],
    admins: [],
  });
  const { host, done } = await mount(api);
  const text = host.textContent ?? "";
  assert.match(text, /chat line c42/);
  assert.match(text, /Room shop/);
  assert.match(text, /sent /);
  assert.equal(/\bbo\b/.test(text), false, "never names who sent the line");
  assert.equal(/sent by|uploaded by/.test(text), false);
  assert.equal(/post\s*$/.test(text), false);
  const remove = /** @type {HTMLButtonElement} */ (host.querySelector('[aria-label="Preserve and remove chat line c42"]'));
  assert.ok(remove.className.includes("min-h-[44px]"));
  act(() => remove.click());
  await flush();
  assert.ok((host.textContent ?? "").includes(queue.REMOVE_FLAGGED_CHAT_CONFIRM));
  assert.equal((host.textContent ?? "").includes(queue.REMOVE_FLAGGED_CONFIRM), false);
  act(() => dialogConfirm(host).click());
  await flush();
  assert.equal(host.querySelector('[role="status"]')?.textContent, queue.REMOVE_FLAGGED_CHAT_DONE);
  done();
});
