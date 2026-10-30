// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

// Load undici before happy-dom replaces Event, or Response.json() breaks.
await new Response("{}").json();

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/" });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "navigator",
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

const posts = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "POST") posts.push(url);
  const body = url.endsWith("/api/calls/status")
    ? { enabled: true, record: false }
    : url.endsWith("/api/calls/rings")
      ? { record: false, rings: [{ id: "r1", roomId: "shop", fromName: "Josh" }] }
      : { ok: true, record: false };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { CallRings, focusRoomCall, CALL_STARTING_TEXT } =
  await import("../../components/board/call-rings.tsx");

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};

test("incoming call prompt: live status, Join and Decline, no autofocus, Escape declines", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const gone = [];
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        {
          value: {
            ...EMPTY_SERVER_SESSION,
            configured: true,
            mode: "live",
            user: { id: "ada", name: "Ada" },
          },
        },
        createElement(CallRings, { onGo: (id) => gone.push(id) }),
      ),
    );
  });
  await flush();
  const banner = host.querySelector("section");
  assert.ok(banner, "banner renders");
  assert.equal(banner.getAttribute("role"), "status");
  assert.equal(banner.getAttribute("aria-live"), "assertive");
  assert.equal(banner.querySelector("p").textContent, "Josh is calling you to a room call.");
  assert.equal(banner.getAttribute("aria-label"), "Incoming call");
  assert.match(
    banner.className,
    /bottom-\[calc\(var\(--tabbar-h,64px\)\+env\(safe-area-inset-bottom\)\+0\.75rem\)\]/,
  );
  assert.match(banner.className, /md:bottom-6/);
  assert.ok(!banner.contains(document.activeElement), "no autofocus");
  const buttons = [...banner.querySelectorAll("button")];
  assert.deepEqual(
    buttons.map((b) => b.textContent),
    ["Join", "Decline"],
  );
  assert.match(buttons[0].className, /btn-primary/, "Join is the main action");
  assert.doesNotMatch(buttons[1].className, /btn-primary/);

  await act(async () => {
    banner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  assert.equal(host.querySelector("section"), null);
  assert.ok(posts.some((url) => url.endsWith("/api/calls/rings/r1/decline")));
  assert.deepEqual(gone, []);
  await act(async () => root.unmount());
});

async function mountBanner(onGo = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        SessionContext.Provider,
        {
          value: {
            ...EMPTY_SERVER_SESSION,
            configured: true,
            mode: "live",
            user: { id: "ada", name: "Ada" },
          },
        },
        createElement(CallRings, { onGo }),
      ),
    );
  });
  await flush();
  const banner = host.querySelector("section");
  assert.ok(banner);
  return { host, root, banner };
}

async function enterFrom(banner, from) {
  from.focus();
  const into = banner.querySelector("button");
  into.focus();
  into.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: from }));
  into.dispatchEvent(new FocusEvent("focus", { relatedTarget: from }));
}

test("Decline returns focus to where it came from", async () => {
  const before = document.createElement("button");
  before.textContent = "Elsewhere";
  document.body.append(before);
  const { root, banner } = await mountBanner();
  await act(async () => enterFrom(banner, before));
  const notNow = [...banner.querySelectorAll("button")].find((b) => b.textContent === "Decline");
  await act(async () => notNow.click());
  await flush();
  assert.equal(document.activeElement, before);
  await act(async () => root.unmount());
  before.remove();
});

test("Escape falls back to #main when the old target is gone", async () => {
  const main = document.createElement("main");
  main.id = "main";
  main.tabIndex = -1;
  document.body.append(main);
  const before = document.createElement("button");
  document.body.append(before);
  const { root, banner } = await mountBanner();
  await act(async () => enterFrom(banner, before));
  before.remove();
  await act(async () => {
    banner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  assert.equal(document.activeElement, main);
  await act(async () => root.unmount());
  main.remove();
});

async function waitFor(ok, ms = 2000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

test("Join skips the focus return and lands on the call's Join button", async () => {
  const before = document.createElement("button");
  document.body.append(before);
  const heading = document.createElement("h1");
  heading.id = "room-heading";
  heading.tabIndex = -1;
  let join = null;
  const { root, banner } = await mountBanner(() => {
    // Stand-in for app.tsx: navigate, then the room renders and the Join
    // button shows up a little later, once calls status answers.
    document.body.append(heading);
    setTimeout(() => {
      join = document.createElement("button");
      join.id = "room-call-join";
      document.body.append(join);
    }, 30);
    requestAnimationFrame(() => focusRoomCall());
  });
  await act(async () => enterFrom(banner, before));
  const go = [...banner.querySelectorAll("button")].find((b) => b.textContent === "Join");
  await act(async () => go.click());
  await waitFor(() => document.activeElement?.id === "room-call-join");
  assert.notEqual(document.activeElement, before, "no return to the old element");
  assert.ok(join);
  assert.equal(document.activeElement, join);
  await act(async () => root.unmount());
  for (const node of [before, heading, join]) node?.remove();
});

test("focusRoomCall falls back to the room heading", async () => {
  const heading = document.createElement("h1");
  heading.id = "room-heading";
  heading.tabIndex = -1;
  const status = document.createElement("p");
  status.id = "room-call-status";
  status.setAttribute("role", "status");
  document.body.append(heading, status);
  document.body.focus();
  focusRoomCall(20);
  await waitFor(() => document.activeElement === heading);
  assert.equal(document.activeElement, heading);
  assert.equal(status.textContent, CALL_STARTING_TEXT);
  heading.remove();
  status.remove();
});

test("focusRoomCall leaves a user who has already moved focus", async () => {
  const heading = document.createElement("h1");
  heading.id = "room-heading";
  heading.tabIndex = -1;
  const elsewhere = document.createElement("button");
  document.body.append(heading, elsewhere);
  document.body.focus();
  focusRoomCall();
  setTimeout(() => elsewhere.focus(), 10);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(document.activeElement, elsewhere);
  heading.remove();
  elsewhere.remove();
});
