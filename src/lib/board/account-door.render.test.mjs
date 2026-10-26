import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

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
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "SubmitEvent",
  "InputEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = key === "window" ? window : browser[key];
  if (value === undefined) continue;
  const bind =
    key === "getComputedStyle" || key === "requestAnimationFrame" || key === "cancelAnimationFrame";
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: bind && typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AccountDoor, SIGN_IN_EMPTY_ERROR, SIGN_IN_MISMATCH_ERROR } =
  await import("../../components/board/account-door.tsx");
const { EMPTY_SERVER_SESSION, SessionContext } = await import("../../lib/server-session-state.ts");

/**
 * @param {import("../../lib/server-session-state.ts").ServerSession} session
 */
function renderDoor(session) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(SessionContext.Provider, { value: session }, createElement(AccountDoor)),
    );
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

/** @param {HTMLInputElement} input @param {string} value */
function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submitForm() {
  const form = document.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("sign-in form missing");
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}

/** The alert sits above the submit button and is exposed as an alert. */
function announced() {
  const alert = document.querySelector('[role="alert"]');
  const submit = document.querySelector('button[type="submit"]');
  assert.ok(alert instanceof HTMLElement);
  assert.ok(submit instanceof HTMLButtonElement);
  assert.match(alert.className, /text-sm/);
  assert.match(alert.className, /text-danger/);
  assert.equal(alert.tagName, "P");
  assert.ok(
    (alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    "the alert is announced above the submit button",
  );
  return alert.textContent ?? "";
}

test("an empty sign-in is announced above the button", async () => {
  const cleanup = renderDoor({ ...EMPTY_SERVER_SESSION, mode: "live", configured: true });
  try {
    assert.equal(document.body.textContent?.includes("There is no open sign-up"), false);
    assert.equal(document.body.textContent?.includes("Enter the code your host gave you."), false);
    const email = document.querySelector("#sign-in-email");
    const password = document.querySelector("#sign-in-password");
    assert.ok(email instanceof HTMLInputElement);
    assert.ok(password instanceof HTMLInputElement);
    assert.equal(email.required, true);
    assert.equal(password.required, true);
    await submitForm();
    assert.equal(announced(), SIGN_IN_EMPTY_ERROR);
    assert.equal(email.getAttribute("aria-invalid"), "true");
    assert.equal(password.getAttribute("aria-invalid"), "true");
    assert.equal(email.getAttribute("aria-describedby"), "sign-in-error");
  } finally {
    cleanup();
  }
});

test("a wrong email and password is announced above the button", async () => {
  let calls = 0;
  const cleanup = renderDoor({
    ...EMPTY_SERVER_SESSION,
    mode: "live",
    configured: true,
    signIn: async () => {
      calls += 1;
      return { ok: false, message: "Invalid email or password" };
    },
  });
  try {
    const email = document.querySelector("#sign-in-email");
    const password = document.querySelector("#sign-in-password");
    assert.ok(email instanceof HTMLInputElement);
    assert.ok(password instanceof HTMLInputElement);
    await act(async () => {
      setInput(email, "person@example.com");
      setInput(password, "not-the-password");
    });
    await submitForm();
    assert.equal(calls, 1);
    assert.equal(announced(), SIGN_IN_MISMATCH_ERROR);
    assert.equal(email.getAttribute("aria-invalid"), "true");
    assert.equal(password.getAttribute("aria-invalid"), "true");
  } finally {
    cleanup();
  }
});

test("code mode names the host's code and links the terms", async () => {
  const cleanup = renderDoor({ ...EMPTY_SERVER_SESSION, mode: "live", configured: true });
  try {
    const toggle = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("I have a code"),
    );
    assert.ok(toggle instanceof HTMLButtonElement);
    await act(async () => {
      toggle.click();
    });
    assert.match(document.body.textContent ?? "", /Enter the code your host gave you\./);
    assert.match(
      document.body.textContent ?? "",
      /By creating an account you agree to the Terms and Privacy notice\./,
    );
    const intro = [...document.querySelectorAll("p")].find((node) =>
      node.textContent?.includes("Enter the code your host gave you."),
    );
    assert.match(intro?.className ?? "", /text-base/);
    assert.match(intro?.className ?? "", /text-muted/);
    assert.equal((intro?.className ?? "").includes("sm:text-sm"), false);
    const terms = document.querySelector('a[href="/terms"]');
    const privacy = document.querySelector('a[href="/privacy"]');
    assert.equal(terms?.textContent, "Terms");
    assert.equal(privacy?.textContent, "Privacy notice");
    assert.match(terms?.className ?? "", /py-1/);
    assert.match(privacy?.className ?? "", /py-1/);
    const code = document.querySelector("#invite-code");
    assert.ok(code instanceof HTMLInputElement);
    assert.equal(code.required, true);
  } finally {
    cleanup();
  }
});
