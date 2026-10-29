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
  "HTMLHeadingElement",
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

async function mount({ steward = true, onSetUp } = {}) {
  useBoard.setState({ remote: true, steward, admin: false, home: null });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GroupsView, { onSetUp })));
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

const REQUESTS_WAIT = "Group requests wait until you turn on an authenticator.";
const PAGE_WAIT = "Invites and appeals wait until you turn on an authenticator.";
const STEP_UP = { error: "mfa_step_up", message: "Enter your authenticator code first." };
const LOCKED = { error: "mfa_locked", message: "Too many attempts. Wait and try again." };
const DETAIL = {
  group: { ...GROUP, admins: ["Ada"], canInvite: true, invited: false, invitedBy: "" },
  posts: [],
  marks: [],
  removals: [],
  next: null,
};

function section(host, label) {
  return [...host.querySelectorAll("details")].find(
    (node) => node.querySelector("summary")?.textContent?.trim() === label,
  );
}

function h3(host, text) {
  return [...host.querySelectorAll("h3")].find((h) => h.textContent === text);
}

function button(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

function count(host, text) {
  return [...host.querySelectorAll("p, span")].filter((n) => n.textContent?.trim() === text).length;
}

async function openCarpentry(view) {
  const open = button(view.host, "Carpentry");
  assert.ok(open);
  await act(async () => open.click());
  await flush();
}

test("no authenticator: Decide says group requests wait, with a way to turn it on, and no alert", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [403, ENROLL],
  };
  const view = await mount();
  assert.deepEqual(view.alerts(), [], "no page-level alert");
  assert.ok(!view.host.textContent.includes("That did not save."));
  const decide = section(view.host, "Decide");
  assert.ok(decide, "the requests section is shown");
  const note = decide.querySelector("p");
  assert.ok(note?.textContent?.includes(REQUESTS_WAIT));
  assert.equal(note?.getAttribute("role"), null);
  assert.ok(button(decide, "Turn it on under You"));
  assert.ok(view.host.textContent.includes("Carpentry"), "the group list still loads");
  await view.cleanup();
});

test("a 500 on requests is no alert: the note sits inside Decide, in plain text, with Try again", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [500, { error: "oops" }],
  };
  const view = await mount();
  assert.deepEqual(view.alerts(), [], "no alert anywhere");
  const decide = section(view.host, "Decide");
  assert.ok(decide, "Decide stays visible");
  assert.ok(decide.textContent.includes("That did not load."));
  assert.equal(decide.querySelector("p")?.getAttribute("role"), null);
  const retry = button(decide, "Try again");
  assert.ok(retry, "Try again is offered");
  assert.ok(retry.className.includes("min-h-[44px]"));
  assert.ok(button(view.host, "Carpentry"), "the group list still loads");
  routes["/api/group-requests"] = [200, { requests: [] }];
  const before = seen.filter((s) => s === "GET /api/group-requests").length;
  await act(async () => retry.click());
  await flush();
  assert.ok(seen.filter((s) => s === "GET /api/group-requests").length > before, "Try again reloads");
  assert.ok(!view.host.textContent.includes("That did not load."));
  await view.cleanup();
});

test("a failed group list load uses the server's own sentence", async () => {
  routes = { "/api/groups": [429, { error: "Too many requests. Wait a minute." }] };
  const view = await mount();
  assert.deepEqual(view.alerts(), ["Too many requests. Wait a minute."]);
  await view.cleanup();
});

test("a 500 on appeals is no alert: the note sits inside Appeals with Try again", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [200, { requests: [] }],
    "/api/groups/carpentry": [200, DETAIL],
    "/api/group-appeals": [500, { error: "oops" }],
    "/api/groups/carpentry/invites": [200, { invites: [] }],
  };
  const view = await mount();
  await openCarpentry(view);
  assert.deepEqual(view.alerts(), [], "no alert anywhere on the page");
  const appeals = h3(view.host, "Appeals")?.parentElement;
  assert.ok(appeals, "the appeals section stays visible");
  assert.ok(appeals.textContent.includes("That did not load."));
  assert.ok(button(appeals, "Try again"));
  assert.ok(h3(view.host, "Open invites"), "invites are unaffected");
  await view.cleanup();
});

test("a failed invite list load is plain text with no role, and Try again reloads it", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [200, { requests: [] }],
    "/api/groups/carpentry": [200, DETAIL],
    "/api/group-appeals": [200, { appeals: [] }],
    "/api/groups/carpentry/invites": [500, { error: "oops" }],
  };
  const view = await mount();
  await openCarpentry(view);
  assert.deepEqual(view.alerts(), []);
  const invites = view.host.querySelector('[aria-labelledby="group-invite-heading"]');
  assert.ok(invites);
  const line = [...invites.querySelectorAll("p")].find((p) => p.textContent?.includes("That did not load."));
  assert.ok(line, "the error shows in Open invites");
  assert.equal(line.getAttribute("role"), null);
  assert.ok(line.className.includes("text-[#f0b4a4]"), "danger colour");
  const retry = button(line, "Try again");
  assert.ok(retry?.className.includes("min-h-[44px]"));
  routes["/api/groups/carpentry/invites"] = [200, { invites: [] }];
  await act(async () => retry.click());
  await flush();
  assert.ok(!invites.textContent.includes("That did not load."));
  assert.ok(invites.textContent.includes("No open invites."));
  await view.cleanup();
});

test("no authenticator on a group page: one note, and no invite form, open invites or appeals", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [200, { requests: [] }],
    "/api/groups/carpentry": [200, DETAIL],
    "/api/group-appeals": [403, ENROLL],
    "/api/groups/carpentry/invites": [403, ENROLL],
  };
  const view = await mount();
  await openCarpentry(view);
  assert.deepEqual(view.alerts(), [], "no alert anywhere on the page");
  assert.equal(count(view.host, PAGE_WAIT), 1, "exactly one note");
  assert.ok(!view.host.textContent.includes("Turn on an authenticator before using this."));
  assert.equal(view.host.querySelector('[aria-labelledby="group-invite-heading"]'), null);
  assert.equal(h3(view.host, "Invite a member"), undefined);
  assert.equal(h3(view.host, "Open invites"), undefined);
  assert.equal(h3(view.host, "Appeals"), undefined);
  assert.equal(
    [...view.host.querySelectorAll("button")].filter((b) => b.textContent === "Turn it on under You").length,
    1,
  );
  await view.cleanup();
});

test("Turn it on under You calls onSetUp and focuses the Authenticator heading", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [403, ENROLL],
  };
  let calls = 0;
  let heading = null;
  const view = await mount({
    onSetUp: () => {
      calls += 1;
      // You opens later, the way the app switches sections.
      setTimeout(() => {
        heading = document.createElement("h2");
        heading.id = "authenticator";
        heading.tabIndex = -1;
        heading.textContent = "Authenticator";
        document.body.append(heading);
      }, 20);
    },
  });
  const go = button(section(view.host, "Decide"), "Turn it on under You");
  assert.ok(go);
  await act(async () => go.click());
  await act(async () => new Promise((r) => setTimeout(r, 200)));
  assert.equal(calls, 1);
  assert.ok(heading);
  assert.equal(document.activeElement, heading, "focus lands on #authenticator");
  heading.remove();
  await view.cleanup();
});

test("the Authenticator heading under You is a focus target", async () => {
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(new URL("../../components/board/mfa-ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /<h2 id="authenticator" tabIndex=\{-1\}/);
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /<GroupsView onSetUp=\{\(\) => openSection\("profile"\)\} \/>/);
});

for (const [name, body] of [
  ["step-up", STEP_UP],
  ["locked", LOCKED],
]) {
  test(`a ${name} refusal keeps the server's own sentence, with no set-up button`, async () => {
    routes = {
      "/api/groups": [200, { groups: [GROUP] }],
      "/api/group-requests": [403, body],
      "/api/groups/carpentry": [200, DETAIL],
      "/api/group-appeals": [403, body],
      "/api/groups/carpentry/invites": [403, body],
    };
    const view = await mount();
    const decide = section(view.host, "Decide");
    assert.ok(decide?.textContent.includes(body.message));
    assert.ok(!decide.textContent.includes(REQUESTS_WAIT));
    assert.equal(button(decide, "Turn it on under You"), undefined);
    await openCarpentry(view);
    assert.deepEqual(view.alerts(), []);
    assert.ok(h3(view.host, "Appeals")?.parentElement.textContent.includes(body.message));
    const invites = view.host.querySelector('[aria-labelledby="group-invite-heading"]');
    assert.ok(invites?.textContent.includes(body.message), "the invite section stays, with the sentence");
    assert.ok(!view.host.textContent.includes(PAGE_WAIT));
    await view.cleanup();
  });
}

test("a plain member's own requests are headed Your requests, not Decide", async () => {
  routes = {
    "/api/groups": [200, { groups: [GROUP] }],
    "/api/group-requests": [
      200,
      {
        requests: [
          {
            id: "r1",
            groupId: "brewing",
            name: "Brewing",
            about: "Beer.",
            by: "Ruth",
            roomId: "town",
            status: "open",
            note: "",
            at: 1,
          },
        ],
      },
    ],
  };
  const view = await mount({ steward: false });
  assert.ok(section(view.host, "Your requests"), "members see Your requests");
  assert.equal(section(view.host, "Decide"), undefined);
  await view.cleanup();
  const steward = await mount({ steward: true });
  assert.ok(section(steward.host, "Decide"), "stewards still see Decide");
  await steward.cleanup();
});
