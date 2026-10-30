// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// QA r5707768704 S2: the real BoardApp keeps the Sign out ConfirmDialog
// mounted while closed. A closed dialog must not count as open, so a ring
// still focuses the call card and Escape still declines it.
import assert from "node:assert/strict";
import { register } from "node:module";
import nodeTest, { after, afterEach } from "node:test";

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
const { createRoot: makeRoot } = await import("react-dom/client");

/** Each test gets a deadline, so a regression fails the run instead of hanging CI. */
const test = (name, fn) => nodeTest(name, { timeout: 30_000 }, fn);
/** Roots still mounted. afterEach unmounts them even when a test fails part way. */
const mounted = [];
const createRoot = (host) => {
  const root = makeRoot(host);
  mounted.push({ root, host });
  return root;
};
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    try {
      await act(async () => root.unmount());
    } catch {
      // Already unmounted.
    }
    host.remove();
  }
});
// Stop happy-dom's timers so the file's process can exit.
after(async () => {
  try {
    await window.happyDOM.abort();
  } catch {
    // Nothing left to stop.
  }
});
const { BoardApp } = await import("../../components/board/app.tsx");
const { useBoard } = await import("./store.ts");
const { dialogIsOpen, escapeBelongsElsewhere } =
  await import("../../components/board/call-rings.tsx");

const USER = { id: "u-member", name: "TEST Member", email: "member@test.invalid" };

const flush = async () => {
  for (let i = 0; i < 25; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
};

async function waitFor(ok, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("in the real app, a closed Sign out dialog does not block the ring's focus or Escape", async () => {
  localStorage.clear();
  useBoard.setState({ section: "week", me: "", member: false, remote: false, boardError: "" });
  routes = {
    "/api/health": [200, { ok: true }],
    "/api/auth/get-session": [200, { user: USER }],
    "/api/calls/status": [200, { enabled: true, record: false }],
    "/api/calls/rings": [
      200,
      {
        record: false,
        rings: [{ id: "r1", kind: "room", roomId: "shop", fromName: "Josh" }],
        settled: [],
      },
    ],
    "/api/calls/rings/r1/decline": [200, { ok: true, record: false }],
  };
  seen.length = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(BoardApp)));
    await flush();
    await act(async () => useBoard.getState().view(USER.name));
    await flush();

    const signOut = [...document.querySelectorAll("dialog")].find((d) =>
      d.textContent.includes("Stay signed in"),
    );
    assert.ok(signOut, "the Sign out dialog is mounted");
    assert.equal(signOut.open, false, "and closed");
    assert.equal(signOut.hasAttribute("aria-modal"), false, "a closed dialog does not claim modal");
    assert.equal(dialogIsOpen(), false, "no dialog counts as open");
    assert.equal(escapeBelongsElsewhere(document.body), false);

    await waitFor(() => host.querySelector('section[role="region"]'));
    const card = host.querySelector('section[role="region"]');
    assert.ok(card, "the ring shows");
    assert.match(card.textContent, /Josh is calling you into a room call\./);
    await waitFor(() => document.activeElement === card);
    assert.equal(document.activeElement, card, "the ring focuses the card region");
    assert.equal(card.getAttribute("tabindex"), "-1");
    assert.match(card.className, /\bfocus-target\b/);

    routes["/api/calls/rings"] = [
      200,
      { record: false, rings: [], settled: [{ id: "r1", how: "declined" }] },
    ];
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    assert.ok(seen.includes("POST /api/calls/rings/r1/decline"), "Escape declines");
    assert.equal(host.querySelector('section[role="region"]'), null);
  } finally {
    // Unmount even on a failed assertion, so the ring's poll timer cannot keep CI waiting.
    await act(async () => root.unmount());
    host.remove();
  }
});

test("an aria-modal element counts as open only while it is shown", () => {
  const box = document.createElement("div");
  box.setAttribute("aria-modal", "true");
  box.hidden = true;
  document.body.append(box);
  assert.equal(dialogIsOpen(), false, "hidden");
  box.hidden = false;
  box.style.display = "none";
  assert.equal(dialogIsOpen(), false, "display: none");
  box.style.display = "";
  assert.equal(dialogIsOpen(), true, "shown");
  box.remove();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  assert.equal(dialogIsOpen(), false, "a closed <dialog>, even marked modal");
  dialog.setAttribute("open", "");
  assert.equal(dialogIsOpen(), true, "an open <dialog>");
  dialog.remove();
});
