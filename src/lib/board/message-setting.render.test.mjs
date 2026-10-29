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
  "HTMLInputElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
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

/**
 * A fake API. GET returns the stored choice. Each POST is recorded with its
 * keepalive flag and answered when the test releases it (or at once).
 */
function fakeApi({ hold = false } = {}) {
  /** @type {{ messageFrom: string, keepalive: boolean, release: () => void }[]} */
  const posts = [];
  let stored = "rooms";
  /** @type {(value?: unknown) => void} */
  let loaded = () => {};
  const loading = new Promise((resolve) => (loaded = resolve));
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
      const json = (/** @type {unknown} */ body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      assert.match(String(url), /\/api\/dm\/settings$/);
      if (init.method !== "POST") {
        await loading;
        return json({ messageFrom: stored });
      }
      const { messageFrom } = JSON.parse(String(init.body));
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => (release = () => resolve(undefined)));
      posts.push({ messageFrom, keepalive: init.keepalive === true, release });
      if (hold) await gate;
      stored = messageFrom;
      return json({ messageFrom });
    }
  );
  return { posts, load: () => loaded() };
}

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MessageSetting } = await import("../../components/board/message-setting.tsx");

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(MessageSetting)));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
/** @param {Element} host */
const radios = (host) =>
  /** @type {HTMLInputElement[]} */ ([...host.querySelectorAll('input[type="radio"]')]);
/** @param {Element} host @param {string} value */
function arrowTo(host, value) {
  const radio = radios(host).find((item) => item.value === value);
  assert.ok(radio, value);
  act(() => {
    radio.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    radio.click();
  });
}
/** @param {Element} host @param {string} value */
function clickOn(host, value) {
  const radio = radios(host).find((item) => item.value === value);
  assert.ok(radio, value);
  act(() => radio.click());
}

test("radios are dimmed only while the setting loads", async () => {
  const api = fakeApi({ hold: true });
  const view = mount();
  assert.ok(radios(view.host).every((radio) => radio.getAttribute("aria-disabled") === "true"));
  api.load();
  await settle();
  assert.ok(radios(view.host).every((radio) => !radio.hasAttribute("aria-disabled")));

  // A save in flight does not dim them; a second choice waits and saves after it.
  clickOn(view.host, "conversations");
  await settle();
  assert.deepEqual(
    api.posts.map((post) => post.messageFrom),
    ["conversations"],
  );
  assert.ok(radios(view.host).every((radio) => !radio.hasAttribute("aria-disabled")));
  clickOn(view.host, "none");
  await settle();
  assert.equal(api.posts.length, 1, "the second choice waits for the first save");
  assert.equal(radios(view.host).find((radio) => radio.checked)?.value, "none");
  await act(async () => api.posts[0]?.release());
  await settle();
  assert.deepEqual(
    api.posts.map((post) => post.messageFrom),
    ["conversations", "none"],
  );
  await act(async () => api.posts[1]?.release());
  await settle();
  assert.match(
    view.host.querySelector('[role="status"]')?.textContent ?? "",
    /No one can message you/,
  );
  view.unmount();
});

test("an arrow-key choice still pending is saved, with keepalive, when the view goes away", async () => {
  const api = fakeApi();
  api.load();
  const view = mount();
  await settle();
  arrowTo(view.host, "none");
  await settle();
  assert.equal(api.posts.length, 0, "arrow keys wait for the member to settle");
  view.unmount();
  await settle();
  assert.deepEqual(
    api.posts.map(({ messageFrom, keepalive }) => ({ messageFrom, keepalive })),
    [{ messageFrom: "none", keepalive: true }],
  );
});

test("an arrow-key choice still pending is saved, with keepalive, when the page is hidden", async () => {
  const api = fakeApi();
  api.load();
  const view = mount();
  await settle();
  arrowTo(view.host, "conversations");
  await settle();
  assert.equal(api.posts.length, 0);
  await act(async () => {
    window.dispatchEvent(new window.Event("pagehide"));
  });
  await settle();
  assert.deepEqual(
    api.posts.map(({ messageFrom, keepalive }) => ({ messageFrom, keepalive })),
    [{ messageFrom: "conversations", keepalive: true }],
  );
  // Nothing is left pending, so leaving now sends nothing more.
  view.unmount();
  await settle();
  assert.equal(api.posts.length, 1);
  // After unmount the pagehide listener is gone.
  await act(async () => {
    window.dispatchEvent(new window.Event("pagehide"));
  });
  assert.equal(api.posts.length, 1);
});

test("arrow keys save once, after the pause", async () => {
  const api = fakeApi();
  api.load();
  const view = mount();
  await settle();
  arrowTo(view.host, "conversations");
  arrowTo(view.host, "none");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  await settle();
  assert.deepEqual(
    api.posts.map((post) => post.messageFrom),
    ["none"],
  );
  view.unmount();
});
