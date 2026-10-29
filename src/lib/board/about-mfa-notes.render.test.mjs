// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
// About's four admin panels (#115): no raw mfa_required, a quiet note per panel
// with a way to turn the authenticator on, in-panel load errors, step-up text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const { DeletionRequestQueue } = await import("../../components/board/account-removal.tsx");
const { RoomsManager } = await import("../../components/board/rooms-manager.tsx");
const { DmReportQueue } = await import("../../components/board/dm-report.tsx");
const { InviteTracker } = await import("../../components/board/invite-tracker.tsx");

const ENROLL = {
  error: "mfa_required",
  message: "Turn on an authenticator before using this.",
  step: "enroll",
};
const STEP_UP = { error: "mfa_step_up", message: "Enter a fresh authenticator code for this." };
const LOCKED = { error: "mfa_locked", message: "Too many attempts. Wait and try again." };

const PANELS = [
  {
    name: "Account deletion requests",
    path: "/api/account/deletion-requests",
    ok: { requests: [] },
    loaded: "No open deletion requests.",
    wait: "Account deletion requests wait until you turn on an authenticator.",
    render: (onSetUp) => createElement(DeletionRequestQueue, { onSetUp }),
  },
  {
    name: "Rooms",
    path: "/api/admin/rooms",
    ok: { rooms: [] },
    loaded: "Find a room",
    wait: "The room list waits until you turn on an authenticator.",
    render: (onSetUp) => createElement(RoomsManager, { onSetUp }),
  },
  {
    name: "Message reports",
    path: "/api/admin/dm-reports",
    ok: { reports: [] },
    loaded: "No open message reports.",
    wait: "Message reports wait until you turn on an authenticator.",
    render: (onSetUp) => createElement(DmReportQueue, { onSetUp }),
  },
  {
    name: "Invites",
    path: "/api/admin/invites",
    ok: { invites: [] },
    loaded: "No invites yet.",
    wait: "The invite list waits until you turn on an authenticator.",
    render: (onSetUp) => createElement(InviteTracker, { onSetUp }),
  },
];

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
    alerts: () => [...host.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? ""),
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function button(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

function noteWith(host, text) {
  return [...host.querySelectorAll("p")].find((p) => p.textContent?.includes(text));
}

function count(host, text) {
  return [...host.querySelectorAll("p, span")].filter((n) => n.textContent?.trim() === text).length;
}

for (const panel of PANELS) {
  test(`${panel.name}: nothing flashes before the gate answers`, async () => {
    let release;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    routes = { [panel.path]: [403, ENROLL] };
    const view = await mount(panel.render(() => {}));
    try {
      assert.ok(view.host.querySelector("h2")?.textContent?.includes(panel.name));
      // A closed confirm dialog (Rooms) is not shown, so it does not count.
      const body = [...view.host.querySelectorAll("input, table, ul, button")].filter(
        (node) => !node.closest("dialog"),
      );
      assert.deepEqual(body, [], "no body yet");
      assert.ok(!view.host.textContent.includes(panel.loaded));
      assert.ok(!/Loading/.test(view.host.textContent), "no loading line to swap out");
      hold = null;
      release();
      await flush();
      assert.equal(count(view.host, panel.wait), 1, "then the note");
      assert.equal(view.host.querySelector("input"), null, "and no field behind it");
    } finally {
      hold = null;
      await view.cleanup();
    }
  });

  test(`${panel.name}: a first load that works does not move focus`, async () => {
    routes = { [panel.path]: [200, panel.ok] };
    document.body.focus();
    const view = await mount(panel.render(() => {}));
    try {
      assert.ok(view.host.textContent.includes(panel.loaded));
      assert.notEqual(document.activeElement, view.host.querySelector("h2"));
    } finally {
      await view.cleanup();
    }
  });

  test(`${panel.name}: no authenticator is one quiet note, never the raw code`, async () => {
    routes = { [panel.path]: [403, ENROLL] };
    let opened = 0;
    const view = await mount(
      panel.render(() => {
        opened += 1;
        // Opening You puts the Authenticator heading on the page, as MfaSettings does.
        const heading = document.createElement("h2");
        heading.id = "authenticator";
        heading.tabIndex = -1;
        heading.textContent = "Authenticator";
        document.body.append(heading);
      }),
    );
    try {
      assert.ok(view.host.querySelector("h2")?.textContent?.includes(panel.name), "the panel shows");
      assert.deepEqual(view.alerts(), [], "no alert");
      assert.ok(!view.host.textContent.includes("mfa_required"), "no raw code");
      assert.ok(
        !view.host.textContent.includes("Turn on an authenticator before using this."),
        "the panel's own sentence, not the server's generic one",
      );
      assert.equal(count(view.host, panel.wait), 1, "exactly one note");
      const note = noteWith(view.host, panel.wait);
      assert.equal(note.getAttribute("role"), null, "the note has no role");
      assert.ok(note.className.includes("text-muted"), "muted, not danger");
      assert.equal(button(view.host, "Try again"), undefined, "nothing to retry");
      const setUp = button(note, "Turn it on under You");
      assert.ok(setUp, "a way to turn it on");
      assert.ok(setUp.className.includes("min-h-[44px]"), "44px target");
      await act(async () => setUp.click());
      await flush();
      assert.equal(opened, 1, "opens You");
      assert.equal(document.activeElement?.id, "authenticator", "focus moves to Authenticator");
    } finally {
      document.getElementById("authenticator")?.remove();
      await view.cleanup();
    }
  });

  test(`${panel.name}: a 500 is plain danger text in the panel, with Try again that reloads`, async () => {
    routes = { [panel.path]: [500, { error: "internal_error" }] };
    const view = await mount(panel.render(() => {}));
    try {
      assert.deepEqual(view.alerts(), [], "no alert");
      assert.ok(!view.host.textContent.includes("internal_error"), "no raw code");
      const line = noteWith(view.host, "That did not load.");
      assert.ok(line, "says it did not load");
      assert.equal(line.getAttribute("role"), null);
      assert.ok(line.className.includes("text-danger"), "danger colour");
      assert.equal(button(view.host, "Turn it on under You"), undefined);
      const retry = button(line, "Try again");
      assert.ok(retry?.className.includes("min-h-[44px]"), "44px Try again");
      routes[panel.path] = [200, panel.ok];
      const before = seen.filter((s) => s === `GET ${panel.path}`).length;
      await act(async () => retry.click());
      await flush();
      assert.ok(seen.filter((s) => s === `GET ${panel.path}`).length > before, "Try again reloads");
      assert.ok(!view.host.textContent.includes("That did not load."));
      assert.ok(view.host.textContent.includes(panel.loaded), "the panel loads after Try again");
      const heading = view.host.querySelector("h2");
      assert.equal(heading?.getAttribute("tabindex"), "-1");
      assert.equal(document.activeElement, heading, "focus moves to the panel heading after Try again");
    } finally {
      await view.cleanup();
    }
  });

  test(`${panel.name}: a polite status region is always mounted around the note`, async () => {
    routes = { [panel.path]: [200, panel.ok] };
    const view = await mount(panel.render(() => {}));
    try {
      const region = view.host.querySelector("[data-panel-status]");
      assert.ok(region, "the region is there with nothing to say");
      assert.equal(region.getAttribute("role"), "status");
      assert.equal(region.getAttribute("aria-live"), "polite");
      assert.equal(region.textContent, "");
    } finally {
      await view.cleanup();
    }
    routes = { [panel.path]: [403, ENROLL] };
    const gated = await mount(panel.render(() => {}));
    try {
      const region = gated.host.querySelector("[data-panel-status]");
      assert.ok(region?.textContent?.includes(panel.wait), "the note sits inside the region");
    } finally {
      await gated.cleanup();
    }
  });

  test(`${panel.name}: a Try again that fails again is cleared and set again, so it is announced`, async () => {
    routes = { [panel.path]: [500, { error: "internal_error" }] };
    const view = await mount(panel.render(() => {}));
    try {
      const region = view.host.querySelector("[data-panel-status]");
      assert.ok(region?.textContent?.includes("That did not load."));
      const said = [];
      const watch = new MutationObserver(() => said.push(region.textContent ?? ""));
      watch.observe(region, { childList: true, subtree: true, characterData: true });
      await act(async () => button(region, "Try again").click());
      await flush();
      watch.disconnect();
      assert.equal(view.host.querySelector("[data-panel-status]"), region, "the same region stays mounted");
      assert.ok(said.includes(""), "the region is cleared first");
      assert.ok(said.at(-1)?.includes("That did not load."), "then the same sentence is set again");
      assert.deepEqual(view.alerts(), [], "still no alert");
      assert.equal(document.activeElement, view.host.querySelector("h2"), "focus does not drop to the page");
    } finally {
      await view.cleanup();
    }
  });

  test(`${panel.name}: the heading that takes focus has the team focus ring`, async () => {
    routes = { [panel.path]: [200, panel.ok] };
    const view = await mount(panel.render(() => {}));
    try {
      assert.ok(view.host.querySelector("h2")?.classList.contains("heading-focus-ring"));
    } finally {
      await view.cleanup();
    }
  });

  test(`${panel.name}: step-up and locked keep the server's own sentence`, async () => {
    for (const body of [STEP_UP, LOCKED]) {
      routes = { [panel.path]: [403, body] };
      const view = await mount(panel.render(() => {}));
      try {
        assert.deepEqual(view.alerts(), [], "no alert");
        assert.ok(!view.host.textContent.includes(body.error), "no raw code");
        const line = noteWith(view.host, body.message);
        assert.ok(line, "the server's sentence shows");
        assert.equal(line.getAttribute("role"), null);
        assert.equal(button(view.host, "Turn it on under You"), undefined);
        assert.ok(!view.host.textContent.includes(panel.wait));
      } finally {
        await view.cleanup();
      }
    }
  });
}

test("a bare code with no sentence never reaches the page", async () => {
  routes = { "/api/admin/invites": [403, { error: "forbidden" }] };
  const view = await mount(createElement(InviteTracker));
  try {
    assert.ok(!view.host.textContent.includes("forbidden"));
    assert.ok(view.host.textContent.includes("That did not load."));
  } finally {
    await view.cleanup();
  }
});

test("the Authenticator heading under You can take focus, and About passes the way there", () => {
  const mfa = readFileSync(new URL("../../components/board/mfa-ui.tsx", import.meta.url), "utf8");
  assert.match(mfa, /<h2 id="authenticator" tabIndex=\{-1\}/);
  const about = readFileSync(new URL("../../components/board/about-view.tsx", import.meta.url), "utf8");
  for (const tag of ["DeletionRequestQueue", "RoomsManager", "DmReportQueue", "InviteTracker"]) {
    assert.match(about, new RegExp(`<${tag} onSetUp=\\{onSetUp\\} />`), tag);
  }
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /<AboutView onSetUp=\{\(\) => openSection\("profile"\)\} \/>/);
});

test("the team focus ring is one rule: #f0e7d3 on dark, #1f1912 on parchment, 2px offset", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const dark = css.match(/\.heading-focus-ring:focus\s*\{([^}]*)\}/);
  assert.ok(dark, "one shared rule");
  assert.match(dark[1], /outline:\s*2px solid #f0e7d3/);
  assert.match(dark[1], /outline-offset:\s*2px/);
  assert.match(css, /\[data-palette="parchment"\] \.heading-focus-ring:focus\s*\{\s*outline-color:\s*#1f1912/);
  const mfa = readFileSync(new URL("../../components/board/mfa-ui.tsx", import.meta.url), "utf8");
  assert.match(mfa, /<h2 id="authenticator" tabIndex=\{-1\} className="heading-focus-ring /);
});

test("a member's report keeps its wording; the admin queue says did not load or did not save", async () => {
  const { reportDmMessage, listDmReports, closeDmReport } = await import("../e2ee/dm-report-api.ts");
  routes = {
    "/api/dm/messages/m1/report": [500, {}],
    "/api/admin/dm-reports": [500, {}],
    "/api/admin/dm-reports/r1/close": [500, {}],
  };
  assert.equal((await reportDmMessage("m1", { reason: "threat", note: "", sharedText: "" })).error, "That did not go through.");
  assert.equal((await listDmReports()).error, "That did not load.");
  assert.equal((await closeDmReport("r1", "resolved")).error, "That did not save.");
});
