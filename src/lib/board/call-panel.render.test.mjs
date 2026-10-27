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

let joinReply = { record: false, selfId: "ada", cursor: 0, peers: [], iceServers: [] };
globalThis.fetch = async (input) => {
  const url = String(input);
  const body = url.endsWith("/api/calls/status")
    ? { enabled: true, record: false }
    : url.endsWith("/join")
      ? joinReply
      : { record: false, peers: [], signals: [], cursor: 0 };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const track = (kind) => ({ kind, enabled: true, stop() {} });
let media = "camera-denied";
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    async getUserMedia(c) {
      if (media === "mic-denied") throw new Error("NotAllowedError");
      if (c.video) throw new Error("NotAllowedError");
      const tracks = [track("audio")];
      return { getTracks: () => tracks, getVideoTracks: () => [], getAudioTracks: () => tracks };
    },
  },
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CallPanel } = await import("../../components/board/room-call.tsx");

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};

function mount(extra = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(CallPanel, {
        callKey: "dm:t1",
        basePath: "/api/calls/dm/t1",
        selfId: "ada",
        label: "Call with Bob",
        note: "Not recorded.",
        joinLabel: "Join the call",
        ...extra,
      }),
    );
  });
  const button = (text) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  return { host, root, button };
}

test("camera denied: sound only, camera button disabled, Mute focused, Join focused after leave", async () => {
  media = "camera-denied";
  const { host, root, button } = mount();
  await act(async () => button("Join the call").click());
  await flush();
  const mute = button("Mute");
  const cam = button("Camera unavailable");
  assert.ok(mute && cam, "fixed labels");
  assert.equal(document.activeElement, mute, "Mute focused when live");
  assert.equal(cam.disabled, true);
  assert.equal(cam.getAttribute("aria-pressed"), "true");
  assert.match(host.textContent, /Your camera isn't available, so you joined with sound only\./);
  assert.equal(host.querySelector("video"), null, "no self-view with the camera off");
  const live = host.querySelector('[aria-live="polite"]');
  assert.equal(live.textContent, "Your camera is off. Your microphone is on.");

  await act(async () => mute.click());
  assert.equal(button("Mute").getAttribute("aria-pressed"), "true");
  assert.equal(live.textContent, "You're muted and your camera is off.");

  await act(async () => button("Leave call").click());
  await flush();
  assert.equal(document.activeElement, button("Join the call"), "Join focused after leave");
  await act(async () => root.unmount());
});

test("mic denied shows the settings copy", async () => {
  media = "mic-denied";
  const { host, root, button } = mount();
  await act(async () => button("Join the call").click());
  await flush();
  assert.match(
    host.textContent,
    /Avouch can't use your microphone\. Allow it in your browser's site settings, then choose Join the call again\./,
  );
  await act(async () => root.unmount());
});

test("DM panel has Close before joining", async () => {
  let closed = 0;
  const { root, button } = mount({ onClose: () => closed++ });
  assert.ok(button("Close"));
  await act(async () => button("Close").click());
  assert.equal(closed, 1);
  await act(async () => root.unmount());
});

test("the Join button takes the id a ring focuses", async () => {
  const { root, button } = mount({ joinId: "room-call-join" });
  assert.equal(button("Join the call").id, "room-call-join");
  await act(async () => root.unmount());
});
