import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));
process.env.VITE_DEMO = "true";

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1280, height: 900 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLAnchorElement",
  "HTMLDialogElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
]) {
  const value = key === "window" ? window : browser[key];
  if (value === undefined) continue;
  const bind =
    key === "getComputedStyle" ||
    key === "matchMedia" ||
    key === "requestAnimationFrame" ||
    key === "cancelAnimationFrame";
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: bind && typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createRootRoute, createRouter, createMemoryHistory, RouterProvider } = await import(
  "@tanstack/react-router"
);
const { BoardApp } = await import("../../components/board/app.tsx");
const { useBoard } = await import("./store.ts");
const { setGroupOpen } = await import("./group-open.ts");

async function frames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

async function mount() {
  const rootRoute = createRootRoute({ component: () => createElement(BoardApp) });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // Node resolves the router's server build, which skips the Transitioner that seeds this list.
  /** @type {any} */ (router)._rendered ??= [];
  await router.load();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  await frames();
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("signed in: every section gets the plate and scrim, and no band, side or outer art", async () => {
  useBoard.setState({ member: true, me: "Ruth", section: "week" });
  const page = await mount();
  try {
    for (const section of /** @type {const} */ (["week", "rooms", "groups", "find", "messages", "profile", "about"])) {
      await act(async () => {
        useBoard.setState({ section, browsing: true });
      });
      await frames();
      const shell = page.host.querySelector(".shell");
      assert.ok(shell, section);
      assert.equal(shell.getAttribute("data-entered"), "true", section);
      const ground = shell.querySelector(":scope > .plate-ground");
      const scrim = shell.querySelector(":scope > .scrim");
      assert.ok(ground, `${section} plate-ground`);
      assert.ok(scrim, `${section} scrim`);
      assert.equal(ground.getAttribute("aria-hidden"), "true");
      assert.equal(scrim.getAttribute("aria-hidden"), "true");
      for (const gone of [".hero-band.full", ".outer-art", ".with-side", ".side-art"]) {
        assert.equal(page.host.querySelector(gone), null, `${section} has no ${gone}`);
      }
      assert.equal(document.body.dataset.section, section);
    }
  } finally {
    await page.unmount();
  }
});

test("body data-view is room while a room is open and group while a group is open", async () => {
  useBoard.setState({ member: true, me: "Ruth", section: "rooms", browsing: true });
  const page = await mount();
  try {
    assert.equal(document.body.dataset.view, undefined, "browsing rooms");
    await act(async () => {
      useBoard.setState({ browsing: false });
    });
    await frames();
    assert.equal(document.body.dataset.view, "room");
    await act(async () => {
      useBoard.setState({ section: "week", browsing: true });
    });
    await frames();
    assert.equal(document.body.dataset.view, undefined, "removed on leaving the room");
    await act(async () => {
      useBoard.setState({ section: "groups" });
    });
    await frames();
    assert.equal(document.body.dataset.view, undefined, "the Groups list");
    // GroupsView reports its open group through group-open.ts; stand in for opening one.
    await act(async () => setGroupOpen(true));
    await frames();
    assert.equal(document.body.dataset.view, "group");
    await act(async () => setGroupOpen(false));
    await frames();
    assert.equal(document.body.dataset.view, undefined, "removed when the group closes");
  } finally {
    await page.unmount();
    setGroupOpen(false);
  }
  assert.equal(document.body.dataset.view, undefined, "removed on unmount");
});

test("the credit chip is real text naming the plate, Groups and a group included", async () => {
  useBoard.setState({ member: true, me: "Ruth", section: "week", browsing: true });
  const page = await mount();
  try {
    const chip = () => page.host.querySelector("main .pc-credit");
    assert.equal(chip()?.textContent, "Plate: Gustave Doré · Jacob’s Dream · 1866");
    assert.equal(chip()?.getAttribute("aria-hidden"), null);
    await act(async () => {
      useBoard.setState({ section: "rooms", browsing: false });
    });
    await frames();
    assert.equal(chip()?.textContent, "Plate: Gustave Doré · The Sermon on the Mount · 1866");
    await act(async () => {
      useBoard.setState({ section: "groups", browsing: true });
    });
    await frames();
    assert.equal(chip()?.textContent, "Plate: Albrecht Dürer · The Feast of the Rose Garlands · 1506");
    await act(async () => setGroupOpen(true));
    await frames();
    assert.equal(chip()?.textContent, "Plate: Gustave Doré · Ruth and Boaz · 1866");
    await act(async () => setGroupOpen(false));
    await frames();
    assert.equal(chip()?.textContent, "Plate: Albrecht Dürer · The Feast of the Rose Garlands · 1506");
  } finally {
    await page.unmount();
    setGroupOpen(false);
  }
});

test("the door is unchanged: no data-entered, no credit, the door's plate and scrim only", async () => {
  useBoard.setState({ member: false, me: "", localEntry: false });
  const page = await mount();
  try {
    const shell = page.host.querySelector(".shell");
    assert.ok(shell);
    assert.equal(shell.hasAttribute("data-entered"), false);
    assert.equal(shell.querySelectorAll(":scope > .plate-ground").length, 1);
    assert.equal(shell.querySelectorAll(":scope > .scrim").length, 1);
    assert.equal(page.host.querySelector(".pc-credit"), null);
    assert.equal(page.host.querySelector(".pc-head"), null);
    assert.equal(document.body.dataset.view, undefined);
    assert.ok(["landing", "signin"].includes(document.body.dataset.section ?? ""), document.body.dataset.section);
  } finally {
    await page.unmount();
  }
});

// QA #116 B1: text never sits on the art. Every visible text node in main must have an ancestor with a
// solid, opaque background before the walk reaches the plate behind main. The real public sheets load
// in __root.tsx order, plus the Tailwind bg utilities built from the theme's opaque colour tokens.
const { readFileSync } = await import("node:fs");
const readRepo = (/** @type {string} */ path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

function installSheets() {
  const rootSource = readRepo("src/routes/__root.tsx");
  const sheets = [...rootSource.matchAll(/href: "\/([a-z-]+\.css)"/g)].map((m) => readRepo(`public/${m[1]}`));
  const tokens = [...readRepo("src/styles.css").matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)];
  assert.ok(tokens.length > 5, "theme colour tokens");
  const utilities = tokens.map(([, name, hex]) => `.bg-${name}{background-color:${hex}}`).join("");
  const style = document.createElement("style");
  style.textContent = sheets.join("\n") + utilities;
  document.head.append(style);
  return () => style.remove();
}

/** @param {Element} el */
function opaque(el) {
  const colour = getComputedStyle(el).backgroundColor || "";
  if (/^#[0-9a-f]{6}$/i.test(colour)) return true;
  const m = colour.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length === 3 || Number(parts[3]) >= 1;
}

/** @param {Element} el */
function hidden(el) {
  for (let e = /** @type {Element | null} */ (el); e; e = e.parentElement) {
    if (e.classList.contains("sr-only") || e.hasAttribute("hidden")) return true;
    if (e.tagName === "DIALOG" && !(/** @type {HTMLDialogElement} */ (e).open)) return true;
    if (getComputedStyle(e).display === "none") return true;
  }
  return false;
}

/** @param {Element} main */
function textOnTheArt(main) {
  const bare = [];
  let checked = 0;
  const walker = document.createTreeWalker(main, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el || hidden(el)) continue;
    checked++;
    let backed = false;
    for (let e = /** @type {Element | null} */ (el); e && e !== main.parentElement; e = e.parentElement) {
      if (opaque(e)) {
        backed = true;
        break;
      }
    }
    if (!backed) bare.push(`<${el.tagName.toLowerCase()}> "${text.slice(0, 50)}"`);
  }
  return { bare, checked };
}

const signedInPages = /** @type {const} */ ([
  ["week", true],
  ["rooms", true],
  ["rooms", false],
  ["groups", true],
  ["find", true],
  ["messages", true],
  ["profile", true],
  ["civic", true],
  ["about", true],
]);

for (const persona of /** @type {const} */ (["member", "admin"])) {
  test(`every text node in main sits on a solid backing on each inner page (${persona})`, async () => {
    const removeSheets = installSheets();
    const extra = persona === "admin" ? { admin: true, founded: true, steward: true } : { admin: false, founded: false, steward: false };
    useBoard.setState({ member: true, me: "Ruth", section: "week", deskOn: true, remote: false, ...extra });
    const page = await mount();
    try {
      for (const [section, browsing] of signedInPages) {
        await act(async () => {
          useBoard.setState({ section, browsing });
        });
        await frames();
        const main = page.host.querySelector("main");
        assert.ok(main, section);
        const { bare, checked } = textOnTheArt(main);
        const label = `${section}${browsing ? "" : " (a room)"}`;
        assert.ok(checked > 3, `${label}: walked ${checked} text nodes`);
        assert.deepEqual(bare, [], `${label}: text on the art`);
      }
    } finally {
      await page.unmount();
      removeSheets();
    }
  });
}

test("Groups and an open group: every text node sits on a solid backing (server groups)", async () => {
  const removeSheets = installSheets();
  const realFetch = globalThis.fetch;
  const now = Date.now();
  const group = { id: "carpentry", name: "Carpentry", about: "Joinery and the shop.", joined: true, admin: true };
  /** @type {Record<string, unknown>} */
  const replies = {
    "/api/groups": { groups: [group, { id: "garden", name: "Gardening", about: "Beds.", joined: false, admin: false }] },
    "/api/groups/carpentry": {
      group: { ...group, admins: ["Ruth"], canInvite: true, invited: false, invitedBy: "" },
      posts: [{ id: "p1", groupId: "carpentry", author: "Boaz", body: "Dovetails on Saturday.", on: "", at: now, mark: null }],
      marks: [],
      removals: [],
      next: null,
    },
    "/api/group-requests": {
      requests: [{ id: "r1", groupId: "brewing", name: "Brewing", about: "Cider.", by: "Naomi", roomId: "", status: "open", note: "", at: now }],
    },
    "/api/group-appeals": { appeals: [] },
    "/api/groups/carpentry/invites": { invites: [] },
  };
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (/** @type {unknown} */ url) => {
      const body = replies[new URL(String(url), "http://localhost").pathname];
      return new Response(JSON.stringify(body ?? {}), {
        status: body ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }
  );
  useBoard.setState({ member: true, me: "Ruth", section: "groups", browsing: true, remote: true, steward: true, admin: true });
  const page = await mount();
  try {
    await frames();
    await frames();
    const main = () => /** @type {Element} */ (page.host.querySelector("main"));
    assert.match(main().textContent ?? "", /Carpentry/, "the group list loaded");
    let walk = textOnTheArt(main());
    assert.deepEqual(walk.bare, [], "Groups: text on the art");
    const open = [...main().querySelectorAll("button, a")].find((b) => /Carpentry/.test(b.textContent ?? ""));
    assert.ok(open, "a button opens the group");
    await act(async () => /** @type {HTMLElement} */ (open).click());
    await frames();
    await frames();
    assert.equal(document.body.dataset.view, "group");
    assert.match(main().textContent ?? "", /Dovetails on Saturday/, "the group loaded");
    walk = textOnTheArt(main());
    assert.ok(walk.checked > 3);
    assert.deepEqual(walk.bare, [], "a group: text on the art");
  } finally {
    await page.unmount();
    globalThis.fetch = realFetch;
    setGroupOpen(false);
    useBoard.setState({ remote: false, admin: false, steward: false });
    removeSheets();
  }
});
