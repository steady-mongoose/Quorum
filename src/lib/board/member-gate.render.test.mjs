import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

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
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemberGate } = await import("../../components/board/member-gate.tsx");
const { MEMBERS_ONLY_POST, MEMBERS_ONLY_INVITE, canPostInRoom } = await import("./member-gate.ts");

/** @param {import("react").ReactNode} node */
function mount(node) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const composer = () =>
  createElement(
    "form",
    { "aria-label": "New post" },
    createElement("textarea", { name: "claim" }),
    createElement("button", { type: "button" }, "Reply"),
  );

test("the line is the server's 403 text plus the invite wording", () => {
  assert.equal(MEMBERS_ONLY_POST, "Only members of this room can post here.");
  assert.equal(
    MEMBERS_ONLY_INVITE,
    "Only members of this room can post here. Ask a member of the room for an invite.",
  );
});

test("a non-member sees the line and no composer or Reply control", () => {
  const allowed = canPostInRoom({
    remote: true,
    member: false,
    admin: false,
    stewardOfRoom: false,
  });
  assert.equal(allowed, false);
  const view = mount(createElement(MemberGate, { allowed }, composer()));
  try {
    assert.equal(view.host.textContent, MEMBERS_ONLY_INVITE);
    assert.equal(view.host.querySelector("form, textarea, button"), null);
    assert.equal(view.host.querySelector("a, button"), null);
  } finally {
    view.cleanup();
  }
});

/** @type {[string, { member: boolean; admin: boolean; stewardOfRoom: boolean }][]} */
const allowedViewers = [
  ["a member", { member: true, admin: false, stewardOfRoom: false }],
  ["a steward of the room", { member: false, admin: false, stewardOfRoom: true }],
  ["an admin", { member: false, admin: true, stewardOfRoom: false }],
];
for (const [who, input] of allowedViewers) {
  test(`${who} sees the composer and Reply, not the line`, () => {
    const allowed = canPostInRoom({ remote: true, ...input });
    assert.equal(allowed, true);
    const view = mount(createElement(MemberGate, { allowed }, composer()));
    try {
      assert.notEqual(view.host.querySelector("textarea"), null);
      assert.equal(view.host.querySelector("button")?.textContent, "Reply");
      assert.equal(view.host.textContent.includes(MEMBERS_ONLY_POST), false);
    } finally {
      view.cleanup();
    }
  });
}

test("room chat shows the members-only line muted and the group picker uses the invite wording", async () => {
  const { readFileSync } = await import("node:fs");
  const chat = readFileSync(new URL("../../components/board/room-chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /note === NOT_IN_ROOM \? "text-sm text-muted" : "text-sm text-danger"/);
  const groups = readFileSync(new URL("../../components/board/groups-view.tsx", import.meta.url), "utf8");
  assert.ok(groups.includes("No rooms yet. Ask a member of a room for an invite."));
});
