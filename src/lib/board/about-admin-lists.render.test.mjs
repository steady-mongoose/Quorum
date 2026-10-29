// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// About with no authenticator (#115): one "Admin lists" card in place of the five
// lists that wait, no page alerts; Authenticator reset keeps alerts for submits only.
// authenticator; as a fallback, a quiet note per panel with a way to turn it
// on; in-panel load errors; step-up text; a polite region only after Try again.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

// Load undici before happy-dom replaces Event, or Response.json() breaks.
await new Response("{}").json();

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

/** Path -> [status, body]. Anything missing answers 404. */
let routes = {};
const seen = [];
/** While set, every request waits on it, so a test can look before the gate answers. */
let hold = null;
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input), "http://localhost/").pathname;
  seen.push(`${init?.method ?? "GET"} ${path}`);
  if (hold) await hold;
  const [status, body] = routes[path] ?? [404, { error: "Not found." }];
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AboutView } = await import("../../components/board/about-view.tsx");
const { MfaResetQueue } = await import("../../components/board/mfa-ui.tsx");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { useBoard } = await import("./store.ts");

const ENROLL = {
  error: "mfa_required",
  message: "Turn on an authenticator before using this.",
  step: "enroll",
};
const CARD_TEXT =
  "Deletion requests, authenticator resets, the room list, message reports, and the invite list wait until you turn on an authenticator.";
const WAITING = ["Account deletion requests", "Rooms", "Message reports", "Invites", "Authenticator reset"];
const KEPT = ["Roles", "Admin", "CyberTipline queue"];

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
};

async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  await flush();
  return {
    host,
    alerts: () =>
      [...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent ?? "").filter((t) => t.trim()),
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const headings = (host) => [...host.querySelectorAll("h2")].map((h) => h.textContent?.trim());
const buttons = (host, text) => [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);

function about(mfa, onSetUp = () => {}) {
  useBoard.setState({ remote: true, admin: true });
  return createElement(
    SessionContext.Provider,
    { value: { ...EMPTY_SERVER_SESSION, mode: "live", mfa } },
    createElement(AboutView, { onSetUp }),
  );
}

const GATED = {
  "/api/mfa/reset": [403, ENROLL],
  "/api/account/deletion-requests": [403, ENROLL],
  "/api/admin/rooms": [403, ENROLL],
  "/api/admin/dm-reports": [403, ENROLL],
  "/api/admin/invites": [403, ENROLL],
};

test("no authenticator: one Admin lists card, one button, no alerts, the five lists absent", async () => {
  routes = { ...GATED };
  seen.length = 0;
  let opened = 0;
  const view = await mount(
    about("enroll", () => {
      opened += 1;
      const heading = document.createElement("h2");
      heading.id = "authenticator";
      heading.tabIndex = -1;
      document.body.append(heading);
    }),
  );
  try {
    const all = headings(view.host);
    assert.equal(all.filter((h) => h === "Admin lists").length, 1, "one card");
    for (const name of WAITING) assert.ok(!all.includes(name), `${name} is not rendered`);
    for (const name of KEPT) assert.ok(all.includes(name), `${name} still shows`);
    assert.ok(view.host.querySelector('a[href="/admin/stats"]'), "Stats still shows");
    assert.ok(all.indexOf("Admin lists") > all.indexOf("Roles"), "in place of the first admin-only panel");
    assert.ok(all.indexOf("Admin lists") < all.indexOf("Admin"));
    const card = view.host.querySelector('section[aria-labelledby="admin-lists-heading"]');
    assert.ok(card?.className.includes("bg-surface"), "a solid card");
    const text = [...card.querySelectorAll("p")].find((p) => p.textContent?.trim() === CARD_TEXT);
    assert.ok(text, "the card says what waits");
    assert.equal(text.getAttribute("role"), null, "no role on static text");
    assert.equal(text.closest("[aria-live], [role]"), null);
    assert.ok(text.className.includes("text-muted"));
    const setUp = buttons(view.host, "Turn it on under You");
    assert.equal(setUp.length, 1, "exactly one Turn it on under You");
    assert.ok(setUp[0].className.includes("min-h-[44px]"), "44px target");
    assert.deepEqual(view.alerts(), [], "zero role=alert");
    assert.ok(!view.host.textContent.includes("Turn on an authenticator before using this."));
    assert.ok(!view.host.textContent.includes("Archive and delete are coming soon."));
    for (const path of Object.keys(GATED)) {
      assert.ok(!seen.includes(`GET ${path}`), `${path} is not asked for`);
    }
    await act(async () => setUp[0].click());
    await flush();
    assert.equal(opened, 1, "opens You");
    assert.equal(document.activeElement?.id, "authenticator", "focus moves to Authenticator");
  } finally {
    document.getElementById("authenticator")?.remove();
    await view.cleanup();
  }
});

test("with an authenticator: no card, and every admin panel shows", async () => {
  routes = {
    "/api/mfa/reset": [200, { resets: [] }],
    "/api/account/deletion-requests": [200, { requests: [] }],
    "/api/admin/rooms": [200, { rooms: [] }],
    "/api/admin/dm-reports": [200, { reports: [] }],
    "/api/admin/invites": [200, { invites: [] }],
  };
  const view = await mount(about("ok"));
  try {
    const all = headings(view.host);
    assert.ok(!all.includes("Admin lists"));
    for (const name of [...WAITING, ...KEPT]) assert.ok(all.includes(name), `${name} shows`);
    assert.equal(buttons(view.host, "Turn it on under You").length, 0);
  } finally {
    await view.cleanup();
  }
});

test("Authenticator reset: a gated load is the panel's quiet note with no role", async () => {
  routes = { "/api/mfa/reset": [403, ENROLL] };
  const view = await mount(createElement(MfaResetQueue));
  try {
    assert.deepEqual(view.alerts(), [], "no alert on open");
    const note = view.host.querySelector("[data-panel-note]");
    assert.ok(note?.textContent?.includes("Authenticator resets wait until you turn on an authenticator."));
    assert.equal(note.querySelector("[data-panel-status]").textContent, "", "not announced on open");
    assert.ok(note.className.includes("text-muted"));
    assert.ok(!view.host.textContent.includes("Turn on an authenticator before using this."));
    assert.equal(buttons(view.host, "Turn it on under You").length, 1);
    assert.equal(view.host.querySelector("h2")?.className.includes("focus-target"), true);
  } finally {
    await view.cleanup();
  }
});

test("Authenticator reset: a failed load is danger text with Try again, no role and no raw code", async () => {
  routes = { "/api/mfa/reset": [500, { error: "internal_error" }] };
  const view = await mount(createElement(MfaResetQueue));
  try {
    assert.deepEqual(view.alerts(), [], "no alert on open");
    const note = view.host.querySelector("[data-panel-note]");
    assert.ok(note?.textContent?.includes("That did not load."));
    assert.ok(note.className.includes("text-danger"));
    assert.ok(!view.host.textContent.includes("internal_error"));
    routes["/api/mfa/reset"] = [200, { resets: [] }];
    await act(async () => buttons(view.host, "Try again")[0].click());
    await flush();
    assert.ok(view.host.textContent.includes("No resets are waiting."));
    assert.equal(document.activeElement, view.host.querySelector("h2"));
  } finally {
    await view.cleanup();
  }
});

test("Authenticator reset: a submit error still raises an alert", async () => {
  routes = {
    "/api/mfa/reset": [200, { resets: [] }],
    "/api/mfa/reset/request": [400, { error: "bad_request", message: "That account was not found." }],
  };
  const view = await mount(createElement(MfaResetQueue));
  try {
    assert.deepEqual(view.alerts(), []);
    const form = view.host.querySelector("form");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    assert.deepEqual(view.alerts(), ["That account was not found."]);
  } finally {
    await view.cleanup();
  }
});
