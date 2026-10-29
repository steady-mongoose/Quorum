import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

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
  "HTMLLabelElement",
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

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AccountDoor } = await import("../../components/board/account-door.tsx");
const { ServerInvite } = await import("../../components/board/server-invite.tsx");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { AGE_INVITE_ERROR, AGE_INVITE_LABEL, AGE_SIGNUP_ERROR, AGE_SIGNUP_LABEL } = await import("./age.ts");

const WIDTHS = [390, 768, 1440];

/** @param {number} width */
function setWidth(width) {
  window.happyDOM.setViewport({ width, height: 900 });
  assert.equal(window.innerWidth, width);
}

/** @param {import("react").ReactNode} node */
function render(node) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * @param {HTMLInputElement} input
 * @param {string} value
 */
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("signup shows an unticked 18+ checkbox at 390, 768, and 1440 and will not send without it", () => {
  /** @type {any[]} */
  const sent = [];
  const session = {
    ...EMPTY_SERVER_SESSION,
    mode: /** @type {const} */ ("live"),
    configured: true,
    signUp: async (/** @type {any} */ input) => {
      sent.push(input);
      return { ok: true };
    },
  };
  for (const width of WIDTHS) {
    setWidth(width);
    sent.length = 0;
    const view = render(
      createElement(SessionContext.Provider, {
        value: /** @type {any} */ (session),
        children: createElement(AccountDoor),
      }),
    );
    try {
      const switcher = [...view.host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("I have a code"),
      );
      assert.ok(switcher, String(width));
      act(() => {
        switcher.click();
      });
      const box = view.host.querySelector('input[type="checkbox"]');
      assert.ok(box instanceof HTMLInputElement, String(width));
      assert.equal(box.checked, false, String(width));
      const label = box.closest("label");
      assert.match(label?.textContent ?? "", new RegExp(AGE_SIGNUP_LABEL));
      assert.match(label?.className ?? "", /min-h-\[44px\]/);
      assert.equal(view.host.textContent?.includes("you agree"), false);
      const form = view.host.querySelector("form");
      assert.ok(form);
      const code = view.host.querySelector("#invite-code");
      assert.ok(code instanceof HTMLInputElement);
      act(() => {
        for (const [selector, value] of [
          ["#sign-up-name", "Maria"],
          ["#sign-in-email", "maria@example.com"],
          ["#sign-in-password", "correct-horse"],
        ]) {
          const field = view.host.querySelector(selector);
          assert.ok(field instanceof HTMLInputElement, selector);
          setValue(field, value);
        }
        setValue(code, "ABCDEFGH");
      });
      act(() => {
        form.requestSubmit();
      });
      assert.equal(sent.length, 0, String(width));
      const ageError = view.host.querySelector("#age-error");
      assert.equal(ageError?.getAttribute("role"), "alert");
      assert.equal(ageError?.textContent, AGE_SIGNUP_ERROR);
      assert.equal(label?.nextElementSibling, ageError, "the error sits right after the checkbox label");
      assert.equal(box.getAttribute("aria-invalid"), "true");
      assert.equal(box.getAttribute("aria-describedby"), "age-error");
      assert.equal(document.activeElement, box);
      act(() => {
        box.click();
      });
      act(() => {
        form.requestSubmit();
      });
      assert.equal(sent.length, 1, String(width));
      assert.equal(sent[0].adult, true);
      assert.equal(window.innerWidth, width);
    } finally {
      view.cleanup();
    }
  }
});

test("the invite form requires the inviter's 18+ attestation at each width", () => {
  /** @type {any[]} */
  const sent = [];
  const session = {
    ...EMPTY_SERVER_SESSION,
    mode: /** @type {const} */ ("live"),
    configured: true,
    user: { id: "josh", name: "Josh", email: "josh@example.com" },
    createInvite: async (/** @type {any} */ input) => {
      sent.push(input);
      return { ok: true, code: "ABCDEFGH" };
    },
  };
  for (const width of WIDTHS) {
    setWidth(width);
    sent.length = 0;
    const view = render(
      createElement(SessionContext.Provider, {
        value: /** @type {any} */ (session),
        children: createElement(ServerInvite),
      }),
    );
    try {
      const box = view.host.querySelector('input[type="checkbox"]');
      assert.ok(box instanceof HTMLInputElement);
      assert.equal(box.checked, false);
      const label = box.closest("label");
      assert.match(label?.textContent ?? "", new RegExp(AGE_INVITE_LABEL));
      assert.match(label?.className ?? "", /min-h-\[44px\]/);
      assert.equal(view.host.textContent?.includes("you agree"), false);
      assert.equal(window.innerWidth, width);
      const button = [...view.host.querySelectorAll("button")].find((item) =>
        item.textContent?.includes("Make a code"),
      );
      assert.ok(button);
      act(() => {
        button.click();
      });
      assert.equal(sent.length, 0);
      const inviteError = view.host.querySelector("#invite-age-error");
      assert.equal(inviteError?.getAttribute("role"), "alert");
      assert.equal(inviteError?.textContent, AGE_INVITE_ERROR);
      assert.equal(label?.nextElementSibling, inviteError);
      assert.equal(box.getAttribute("aria-invalid"), "true");
      assert.equal(box.getAttribute("aria-describedby"), "invite-age-error");
      assert.equal(document.activeElement, box);
      act(() => {
        box.click();
      });
      assert.equal(view.host.querySelector("#invite-age-error"), null);
      act(() => {
        button.click();
      });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].attestAdult, true);
    } finally {
      view.cleanup();
    }
  }
});
