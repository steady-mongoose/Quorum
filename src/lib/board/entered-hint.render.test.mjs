// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// An expired live session must clear avouch-entered. The next load, with the
// saved board still saying member, opens on the account door.
import assert from "node:assert/strict";
import { register } from "node:module";
import nodeTest, { after, afterEach } from "node:test";

delete process.env.VITE_DEMO;

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

await new Response("{}").json();

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1280, height: 800 });
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
// happy-dom keeps a Max-Age=0 cookie in the jar. This one drops it, as a browser does.
const jar = new Map();
Object.defineProperty(document, "cookie", {
  configurable: true,
  get() {
    return [...jar].map(([name, body]) => `${name}=${body}`).join("; ");
  },
  set(value) {
    const [pair, ...attrs] = String(value).split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const body = pair.slice(eq + 1);
    const maxAge = attrs.find((attr) => attr.toLowerCase().startsWith("max-age="));
    if (maxAge && Number(maxAge.split("=")[1]) <= 0) jar.delete(name);
    else jar.set(name, body);
  },
});
if (typeof globalThis.indexedDB === "undefined") {
  const later = (result) => {
    const request = { result, error: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const store = {
    get: () => later(undefined),
    put: () => later(undefined),
    delete: () => later(undefined),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() {
      return { objectStore: () => store };
    },
    close() {},
  };
  globalThis.indexedDB = { open: () => later(db) };
}
const warn = console.warn;
console.warn = (...args) => {
  if (String(args[0]).includes("useRouter must be used inside")) return;
  warn(...args);
};

/** Path -> [status, body], or a function that returns that pair. */
let routes = {};
globalThis.fetch = async (input) => {
  const path = new URL(String(input), "http://localhost/").pathname;
  const answer = routes[path] ?? [404, { error: "Not found." }];
  const [status, body] = typeof answer === "function" ? await answer() : answer;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const { createElement, act } = await import("react");
const { createRoot: makeRoot } = await import("react-dom/client");
const test = (name, fn) => nodeTest(name, { timeout: 30_000 }, fn);
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
after(async () => {
  try {
    await window.happyDOM.abort();
  } catch {
    // Nothing left to stop.
  }
});

const { BoardApp } = await import("../../components/board/app.tsx");
const { useBoard } = await import("./store.ts");
const { cookieSaysEntered } = await import("./entered-hint.ts");

function rememberMember() {
  localStorage.setItem(
    "the-board-v1",
    JSON.stringify({ state: { member: true, me: "Ada" }, version: 8 }),
  );
}

/** In-memory board as a fresh document would be, then the saved member on disk. */
function freshMember() {
  useBoard.setState({
    member: false,
    localEntry: false,
    me: "",
    remote: false,
    boardLoaded: false,
    homeCounty: null,
  });
  rememberMember();
}

async function renderApp() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BoardApp)));
  return host;
}

async function unmountAll() {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
}

async function waitFor(ok, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await act(async () => new Promise((r) => setTimeout(r, 10)));
  assert.equal(ok(), true);
}

function shellEntered(host) {
  return host.querySelector(".shell")?.getAttribute("data-entered") === "true";
}

test("an expired live session clears avouch-entered and the next load stays on the door", async () => {
  delete process.env.VITE_DEMO;
  localStorage.clear();
  jar.clear();
  document.cookie = "avouch-entered=1";
  freshMember();
  routes = {
    "/api/health": [200, { ok: true }],
    "/api/auth/get-session": [200, {}],
  };
  const host = await renderApp();
  await waitFor(() => !cookieSaysEntered(document.cookie) && host.textContent.includes("Sign in"));
  assert.equal(shellEntered(host), false, "the expired session is the account door");
  assert.match([...jar.keys()].join(" "), /^(?!.*avouch-entered)/);

  await unmountAll();

  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  routes = {
    "/api/health": () => gate.then(() => [200, { ok: true }]),
    "/api/auth/get-session": [200, {}],
  };
  jar.clear();
  freshMember();
  const again = await renderApp();
  await waitFor(() => useBoard.getState().member === true);
  assert.equal(shellEntered(again), false, "saved membership does not flash the signed-in shell");
  assert.equal(again.querySelector(".topnav"), null);
  release();
  await waitFor(() => again.textContent.includes("Sign in"));
  assert.equal(shellEntered(again), false);
  assert.equal(cookieSaysEntered(document.cookie), false);
});
