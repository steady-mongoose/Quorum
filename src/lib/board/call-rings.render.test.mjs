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
const { CallRings } = await import("../../components/board/call-rings.tsx");

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};

test("incoming call banner: polite status, ghost buttons, no autofocus, Escape dismisses", async () => {
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
  assert.equal(banner.getAttribute("aria-live"), "polite");
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
    ["Go to the call", "Not now"],
  );
  assert.equal(buttons[0].className, buttons[1].className, "both use the same ghost style");

  await act(async () => {
    banner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  assert.equal(host.querySelector("section"), null);
  assert.ok(posts.some((url) => url.endsWith("/api/calls/rings/r1/dismiss")));
  assert.deepEqual(gone, []);
  await act(async () => root.unmount());
});
