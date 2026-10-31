import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 1440, height: 900 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** @type {{ status: number, body: unknown }} */
let membersReply = { status: 200, body: { members: [], rollCall: true } };
globalThis.fetch = async () =>
  new Response(JSON.stringify(membersReply.body), {
    status: membersReply.status,
    headers: { "content-type": "application/json" },
  });

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RollCallPicker, WhoCame } = await import("../../components/board/roll-call.tsx");
const { useBoard } = await import("./store.ts");
const { rollChoices } = await import("./room-members.ts");

const root = fileURLToPath(new URL("../../..", import.meta.url));
/** @param {string} path */
const source = (path) => readFileSync(`${root}/${path}`, "utf8");

const room = /** @type {any} */ ({ id: "shop", name: "The Shop", options: ["roll_call", "members"] });
/** @param {string} name */
const row = (name) => ({ id: name, name, joinedOn: "", lastPostedOn: "", attended: [] });

/** @param {import("react").ReactNode} node */
async function mount(node) {
  const host = document.createElement("div");
  document.body.append(host);
  const view = createRoot(host);
  await act(async () => {
    view.render(node);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return {
    host,
    cleanup() {
      act(() => view.unmount());
      host.remove();
    },
  };
}

/** @param {HTMLElement} host */
const picked = (host) => [...host.querySelectorAll("label")].map((item) => item.textContent);

test("a non-admin host picks from the room's members and never sees who is going", async () => {
  useBoard.setState({ remote: true, admin: false, me: "Hank" });
  membersReply = { status: 200, body: { members: [row("Iris"), row("Hank"), row("Abe")], rollCall: true } };
  const view = await mount(
    createElement(RollCallPicker, { room, going: ["Secret Sam"], came: [], onToggle() {} }),
  );
  assert.deepEqual(picked(view.host), ["Abe", "Iris"]);
  assert.equal(view.host.textContent.includes("Secret Sam"), false);
  assert.match(view.host.textContent, /Who came, from the room's members\./);
  assert.equal(view.host.textContent.includes("said they would"), false);
  view.cleanup();
});

test("an admin keeps the going names, merged into the members", async () => {
  useBoard.setState({ remote: true, admin: true, me: "Josh" });
  membersReply = { status: 200, body: { members: [row("Iris")], rollCall: true } };
  const view = await mount(
    createElement(RollCallPicker, { room, going: ["Abe", "Iris"], came: [], onToggle() {} }),
  );
  assert.deepEqual(picked(view.host), ["Abe", "Iris"]);
  view.cleanup();
});

test("a room that takes roll with its member list off says so instead of picking", async () => {
  useBoard.setState({ remote: true, admin: false, me: "Hank" });
  membersReply = { status: 404, body: { error: "This room does not show its member list." } };
  const view = await mount(createElement(RollCallPicker, { room, going: [], came: [], onToggle() {} }));
  assert.deepEqual(picked(view.host), []);
  assert.match(view.host.textContent, /This room does not show its member list\./);
  view.cleanup();
});

test("the local demo picks from the people it has, without the server", async () => {
  membersReply = { status: 500, body: { error: "The demo must not call this." } };
  useBoard.setState({
    remote: false,
    admin: false,
    me: "Hank",
    posts: [
      {
        id: "p1",
        room: "shop",
        type: "did",
        claim: "Sharpened the chisels.",
        reason: "",
        on: "",
        next: "",
        came: [],
        named: "",
        author: "Iris",
        at: 1,
        parentId: null,
        closed: false,
        mark: null,
        removed: false,
        media: [],
      },
    ],
  });
  const view = await mount(createElement(RollCallPicker, { room, going: [], came: [], onToggle() {} }));
  assert.deepEqual(picked(view.host), ["Iris"]);
  view.cleanup();
});

test("rollChoices leaves out the host and keeps going names from a non-admin", () => {
  const members = ["Zeb", "Amos", "Hank"];
  assert.deepEqual(rollChoices({ members, going: ["Sam"], admin: false, me: "Hank" }), [
    "Amos",
    "Zeb",
  ]);
  assert.deepEqual(rollChoices({ members, going: ["Sam"], admin: true, me: "Hank" }), [
    "Amos",
    "Sam",
    "Zeb",
  ]);
});

test("the card shows who came only where the room takes roll", async () => {
  const post = /** @type {any} */ ({ came: ["Hank", "Iris"], named: "Iris" });
  const on = await mount(createElement(WhoCame, { post, rollCall: true }));
  assert.match(on.host.textContent, /There: Hank, Iris\./);
  assert.match(on.host.textContent, /Mentioned: Iris\./);
  on.cleanup();
  const off = await mount(createElement(WhoCame, { post, rollCall: false }));
  assert.equal(off.host.textContent, "");
  off.cleanup();
});

test("the room card and the Find write-up both follow the room's roll option", () => {
  const roomView = source("src/components/board/room-view.tsx");
  assert.match(roomView, /roomIncludes\(roomById\(post\.room, state\.rooms\), "roll_call"\)/);
  assert.match(roomView, /<WhoCame post=\{post\} rollCall=\{rollCall\} \/>/);
  assert.equal(roomView.includes("There: "), false);
  assert.match(roomView, /\{rollCall \? \(\s*<RollCallPicker/);
  assert.equal(roomView.includes("said they would"), false);

  const findView = source("src/components/board/find-view.tsx");
  assert.match(findView, /const rollCall = roomIncludes\(room, "roll_call"\);/);
  assert.match(findView, /const present = happened && rollCall \? came : \[\];/);
  assert.match(findView, /\{rollCall \? \(\s*<RollCallPicker/);
  assert.equal(findView.includes("card.going.map"), false);
});
