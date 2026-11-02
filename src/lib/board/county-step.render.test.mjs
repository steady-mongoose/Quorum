// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// The real BoardApp against a stubbed server: the county question comes after the
// board has loaded, holds the app until it is answered, and asks only when it should.
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
const posted = [];
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input), "http://localhost/").pathname;
  seen.push(`${init?.method ?? "GET"} ${path}`);
  if (init?.method === "POST" && path === "/api/county") posted.push(JSON.parse(init.body));
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

const USER = { id: "u-member", name: "TEST Member", email: "member@test.invalid" };

const board = (me) => ({
  me: {
    member: true,
    steward: false,
    admin: false,
    council: false,
    councilChair: false,
    stewardRooms: [],
    ban: null,
    gender: null,
    genderConfirmed: false,
    ...me,
  },
  genderPolicy: { setBy: "self", requiresConfirmation: false, changeBy: "admin" },
  rooms: [],
  posts: [],
  marks: [],
  removals: [],
  bans: [],
  appeals: [],
  csamReports: [],
  pages: [],
});

const flush = async () => {
  for (let i = 0; i < 25; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
};

async function waitFor(ok, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

async function open(me, status = 200) {
  localStorage.clear();
  useBoard.getState().disconnectRemote();
  useBoard.setState({ section: "week", me: "", member: false, remote: false, boardError: "" });
  routes = {
    "/api/health": [200, { ok: true }],
    "/api/auth/get-session": [200, { user: USER }],
    "/api/calls/status": [200, { enabled: false, record: false }],
    "/api/board": status === 200 ? [200, board(me)] : [status, { error: "The board did not load." }],
    "/api/county": [200, { county: "polk" }],
  };
  seen.length = 0;
  posted.length = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(BoardApp)));
  await flush();
  return host;
}

const step = (host) => host.querySelector("h1")?.textContent === "Which county is home?";
const switcher = (host) => host.querySelector(".mast-county-button");

test("a member with no county answers once, and the app opens in that county", async () => {
  const host = await open({ homeCounty: null, countiesOn: true });
  await waitFor(() => step(host));
  assert.equal(step(host), true, "the question shows");
  assert.equal(host.querySelector(".topnav"), null, "the app waits behind it");
  assert.equal(switcher(host), null);
  const buttons = [...host.querySelectorAll("main button")].map((b) => b.textContent);
  assert.deepEqual(buttons, ["Hillsborough", "Polk", "Manatee", "Pinellas"]);

  const polk = [...host.querySelectorAll("main button")].find((b) => b.textContent === "Polk");
  await act(async () => polk.click());
  await waitFor(() => switcher(host));
  assert.deepEqual(posted, [{ county: "polk" }]);
  assert.equal(step(host), false, "the question is gone");
  assert.ok(host.querySelector(".topnav"), "the app is open");
  assert.equal(switcher(host).textContent, "Polk");
  assert.equal(useBoard.getState().homeCounty, "polk");
});

test("a refused save keeps the question up and says so", async () => {
  const host = await open({ homeCounty: null, countiesOn: true });
  await waitFor(() => step(host));
  routes["/api/county"] = [500, { error: "Your county was not saved." }];
  const first = host.querySelector("main button");
  await act(async () => first.click());
  await waitFor(() => host.querySelector('[role="alert"]'));
  assert.match(host.querySelector('[role="alert"]').textContent, /not saved/);
  assert.equal(step(host), true);
});

test("a member with a county is not asked", async () => {
  const host = await open({ homeCounty: "manatee", countiesOn: true });
  await waitFor(() => switcher(host));
  assert.equal(step(host), false);
  assert.equal(switcher(host).textContent, "Manatee");
  assert.deepEqual(posted, []);
});

test("the switcher is the site's own menu: every county reads, the choice saves nothing", async () => {
  const host = await open({ homeCounty: "manatee", countiesOn: true });
  await waitFor(() => switcher(host));
  assert.equal(host.querySelector(".mast-county select"), null, "no browser-drawn list");
  assert.equal(host.querySelector(".county-menu"), null, "closed until asked");

  await act(async () => switcher(host).click());
  const menu = host.querySelector("dialog.county-menu");
  assert.ok(menu?.open, "the menu opens");
  assert.equal(switcher(host).getAttribute("aria-expanded"), "true");
  const rows = [...menu.querySelectorAll("button")];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["Hillsborough", "Polk", "Manatee", "Pinellas"],
  );
  const current = menu.querySelector('[aria-current="true"]');
  assert.equal(current.textContent, "Manatee");
  assert.equal(document.activeElement, current, "focus lands on the county in view");

  await act(async () =>
    current.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  assert.equal(document.activeElement.textContent, "Pinellas");

  await act(async () => rows[1].click());
  assert.equal(host.querySelector(".county-menu"), null, "a choice closes it");
  assert.equal(switcher(host).textContent, "Polk");
  assert.equal(document.activeElement, switcher(host), "focus returns to the button");
  assert.equal(useBoard.getState().county, "polk");
  assert.equal(useBoard.getState().homeCounty, "manatee", "looking is not moving");
  assert.deepEqual(posted, []);
});

test("Escape closes the county menu and changes nothing", async () => {
  const host = await open({ homeCounty: "manatee", countiesOn: true });
  await waitFor(() => switcher(host));
  await act(async () => switcher(host).click());
  const menu = host.querySelector("dialog.county-menu");
  await act(async () => menu.dispatchEvent(new Event("cancel", { cancelable: true })));
  assert.equal(host.querySelector(".county-menu"), null);
  assert.equal(switcher(host).textContent, "Manatee");
  assert.equal(document.activeElement, switcher(host));
});

test("before the migration there is no question and no switcher", async () => {
  const host = await open({ homeCounty: null, countiesOn: false });
  await waitFor(() => host.querySelector(".topnav"));
  assert.ok(host.querySelector(".topnav"), "the app opens as it did");
  assert.equal(step(host), false);
  assert.equal(switcher(host), null);
});

test("a board that did not load does not trap the member behind the question", async () => {
  const host = await open({ homeCounty: null, countiesOn: true }, 500);
  await waitFor(() => seen.includes("GET /api/board"));
  await flush();
  assert.equal(step(host), false);
});
