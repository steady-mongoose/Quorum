// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// The real BoardApp and ServerSessionProvider (#117, QA r5707232658 S1/S3):
// turning the authenticator on or off reads the session's MFA phase again, but
// for the same person that must not replace the user, show the loading screen,
// reload the board, or unmount the panel; and a 401 on that read must not sign
// the person out on screen.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

// Load undici before happy-dom replaces Event, or Response.json() breaks.
await new Response("{}").json();

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 390, height: 844 });
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
  "HTMLDetailsElement",
  "HTMLHeadingElement",
  "HTMLDialogElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "navigator",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
]) {
  const value = key === "window" ? window : browser[key];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// BoardApp mounts without a router here; navigation is not part of this test.
const warn = console.warn;
console.warn = (...args) => {
  if (String(args[0]).includes("useRouter must be used inside")) return;
  warn(...args);
};

/** Path -> [status, body]. Anything missing answers 404. */
let routes = {};
const seen = [];
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input), "http://localhost/").pathname;
  seen.push(`${init?.method ?? "GET"} ${path}`);
  const [status, body] = routes[path] ?? [404, { error: "Not found." }];
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BoardApp } = await import("../../components/board/app.tsx");
const { useBoard } = await import("./store.ts");

const USER = { id: "u-member", name: "TEST Member", email: "member@test.invalid" };
const CODES = Array.from({ length: 10 }, (_, i) => `rc-${i}-abcd`);

const flush = async () => {
  for (let i = 0; i < 25; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
};

const buttons = (host, text) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);

function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Mount BoardApp signed in, open You, and watch for the loading screen or the panel leaving. */
async function mountApp() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BoardApp)));
  await flush();
  await act(async () => useBoard.getState().view(USER.name));
  await flush();
  const panel = () => host.querySelector("h2#authenticator");
  assert.ok(panel(), "the Authenticator panel is on You");
  const events = { loading: 0, unmounted: 0 };
  const observer = new MutationObserver(() => {
    if (host.textContent.includes("Checking the server.")) events.loading++;
    if (!panel()) events.unmounted++;
  });
  observer.observe(host, { childList: true, subtree: true, characterData: true });
  return {
    host,
    events,
    async cleanup() {
      observer.disconnect();
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function reset(sessionPhase) {
  localStorage.clear();
  useBoard.setState({ section: "week", me: "", member: false, remote: false, boardError: "" });
  routes = {
    "/api/health": [200, { ok: true }],
    "/api/auth/get-session": [200, { user: USER, ...sessionPhase }],
  };
  seen.length = 0;
}

const boardLoads = () => seen.filter((line) => line === "GET /api/board").length;

async function enroll(view) {
  routes["/api/mfa/status"] = [200, { required: false, enrolled: false, pending: false, recoveryRemaining: 0, mfa: "ok" }];
  routes["/api/mfa/enroll/start"] = [200, { secret: "ABCDEFGHIJKLMNOP", otpauth: "otpauth://totp/x", modules: [[1, 0], [0, 1]] }];
  await act(async () => buttons(view.host, "Turn on authenticator")[0].click());
  await flush();
  const input = view.host.querySelector('input[autocomplete="one-time-code"]');
  assert.ok(input, "the code field shows");
  await act(async () => typeInto(input, "123456"));
  routes["/api/mfa/enroll/confirm"] = [200, { recoveryCodes: CODES }];
  routes["/api/mfa/status"] = [200, { required: false, enrolled: true, pending: false, recoveryRemaining: 10, mfa: "ok" }];
}

test("App: turning the authenticator on keeps the recovery codes mounted, with no loading screen and no board reload", async () => {
  reset({ mfa: "ok", mfaEnrolled: false });
  const view = await mountApp();
  try {
    await enroll(view);
    routes["/api/auth/get-session"] = [200, { user: { ...USER }, mfa: "ok", mfaEnrolled: true }];
    const before = boardLoads();
    seen.length = 0;
    view.events.loading = 0;
    view.events.unmounted = 0;
    await act(async () => buttons(view.host, "Confirm code")[0].click());
    await flush();
    assert.ok(seen.includes("GET /api/auth/get-session"), "the phase was read again");
    assert.equal(boardLoads(), 0, `no extra GET /api/board (had ${before} on load)`);
    assert.equal(view.events.loading, 0, "the loading screen never showed");
    assert.equal(view.events.unmounted, 0, "the Authenticator panel never unmounted");
    for (const code of CODES) assert.ok(view.host.textContent.includes(code), `${code} stays on screen`);
    assert.equal(buttons(view.host, "Continue").length, 1, "the save-codes step is still there");
  } finally {
    await view.cleanup();
  }
});

test("App: turning the authenticator off keeps 'Authenticator is off.' on screen", async () => {
  reset({ mfa: "ok", mfaEnrolled: true });
  routes["/api/mfa/status"] = [200, { required: false, enrolled: true, pending: false, recoveryRemaining: 10, mfa: "ok" }];
  const view = await mountApp();
  try {
    const input = view.host.querySelector('input[autocomplete="one-time-code"]');
    assert.ok(input, "the turn-off field shows");
    await act(async () => typeInto(input, "123456"));
    routes["/api/mfa/disable"] = [200, { ok: true }];
    routes["/api/mfa/status"] = [200, { required: false, enrolled: false, pending: false, recoveryRemaining: 0, mfa: "ok" }];
    routes["/api/auth/get-session"] = [200, { user: { ...USER }, mfa: "ok", mfaEnrolled: false }];
    seen.length = 0;
    view.events.loading = 0;
    view.events.unmounted = 0;
    await act(async () => buttons(view.host, "Turn off authenticator")[0].click());
    await flush();
    assert.ok(seen.includes("GET /api/auth/get-session"), "the phase was read again");
    assert.equal(boardLoads(), 0, "no extra GET /api/board");
    assert.equal(view.events.loading, 0, "the loading screen never showed");
    assert.equal(view.events.unmounted, 0, "the Authenticator panel never unmounted");
    assert.ok(view.host.textContent.includes("Authenticator is off."), "the notice stays");
  } finally {
    await view.cleanup();
  }
});

test("App: a 401 on the refreshed session does not sign out on screen and keeps the codes", async () => {
  reset({ mfa: "ok", mfaEnrolled: false });
  const view = await mountApp();
  try {
    await enroll(view);
    routes["/api/auth/get-session"] = [401, { error: "Unauthorized" }];
    seen.length = 0;
    view.events.unmounted = 0;
    await act(async () => buttons(view.host, "Confirm code")[0].click());
    await flush();
    assert.ok(seen.includes("GET /api/auth/get-session"), "the phase was read again");
    assert.equal(view.events.unmounted, 0, "the Authenticator panel never unmounted");
    assert.ok(view.host.querySelector("h2#authenticator"), "still signed in on screen");
    for (const code of CODES) assert.ok(view.host.textContent.includes(code), `${code} stays on screen`);
  } finally {
    await view.cleanup();
  }
});
