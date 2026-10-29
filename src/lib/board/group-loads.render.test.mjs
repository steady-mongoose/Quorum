// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
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
const { useBoard } = await import("./store.ts");
const { GroupsView } = await import("../../components/board/groups-view.tsx");

const ENROLL = {
  error: "mfa_required",
  message: "Turn on an authenticator before using this.",
  step: "enroll",
};
const GROUP = { id: "carpentry", name: "Carpentry", about: "Wood.", joined: true, admin: true };

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
};

async function mount() {
  useBoard.setState({ remote: true, steward: true, admin: false, home: null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GroupsView)));
  await flush();
  return {
    host,
    alerts: () => [...host.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? ""),
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("an authenticator gate on the requests load is a quiet note in Decide, not a page alert", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [403, ENROLL],
  };
  const view = await mount();
  assert.deepEqual(view.alerts(), [], "no page-level alert");
  assert.ok(!view.host.textContent.includes("That did not save."));
  const decide = [...view.host.querySelectorAll("details")].find((node) =>
    node.querySelector("summary")?.textContent?.includes("Decide"),
  );
  assert.ok(decide, "the requests section is shown");
  const note = decide.querySelector("p");
  assert.equal(note?.textContent, "Turn on an authenticator before using this.");
  assert.equal(note?.getAttribute("role"), null);
  assert.ok(view.host.textContent.includes("Carpentry"), "the group list still loads");
  await view.cleanup();
});

test("any other failed requests load says it did not load, never that it did not save", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [500, { error: "oops" }],
  };
  const view = await mount();
  assert.deepEqual(view.alerts(), ["That did not load."]);
  await view.cleanup();
});

test("a failed group list load uses the server's own sentence", async () => {
  routes = { "/api/groups": [429, { error: "Too many requests. Wait a minute." }] };
  const view = await mount();
  assert.deepEqual(view.alerts(), ["Too many requests. Wait a minute."]);
  await view.cleanup();
});

test("on a group page, gated appeals and invites loads are quiet notes in their sections", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [200, { requests: [] }],
    "/api/groups/carpentry": [
      200,
      {
        group: { ...GROUP, admins: ["Ada"], canInvite: true, invited: false, invitedBy: "" },
        posts: [],
        marks: [],
        removals: [],
        next: null,
      },
    ],
    "/api/group-appeals": [403, ENROLL],
    "/api/groups/carpentry/invites": [403, ENROLL],
  };
  const view = await mount();
  const open = [...view.host.querySelectorAll("button")].find((b) => b.textContent === "Carpentry");
  assert.ok(open);
  await act(async () => open.click());
  await flush();
  assert.ok(seen.includes("GET /api/group-appeals"));
  assert.ok(seen.includes("GET /api/groups/carpentry/invites"));
  assert.deepEqual(view.alerts(), [], "no alert anywhere on the page");
  const headings = [...view.host.querySelectorAll("h3")];
  const appeals = headings.find((h) => h.textContent === "Appeals")?.parentElement;
  assert.ok(appeals, "the appeals section is shown");
  assert.ok(appeals.textContent.includes("Turn on an authenticator before using this."));
  const invites = view.host.querySelector('[aria-labelledby="group-invite-heading"]');
  assert.ok(invites?.textContent.includes("Turn on an authenticator before using this."));
  await view.cleanup();
});
