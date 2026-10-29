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

test("the credit chip is real text naming the plate, and Groups has none yet", async () => {
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
    assert.equal(chip(), null, "Groups waits for its v3 plate");
    await act(async () => setGroupOpen(true));
    await frames();
    assert.equal(chip(), null, "a group waits for its v3 plate");
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
