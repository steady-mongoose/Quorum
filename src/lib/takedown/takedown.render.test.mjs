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
  "HTMLTextAreaElement",
  "HTMLLabelElement",
  "HTMLDialogElement",
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
const { TakedownPage, GOOD_FAITH_STATEMENT } = await import("../../components/takedown/takedown-page.tsx");
const { TakedownQueue, REMOVE_CONFIRM, DECLINE_CONFIRM } = await import("../../components/takedown/takedown-queue.tsx");
const { countdownLabel, isUrgent } = await import("./countdown.ts");

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
};

/** @param {HTMLElement} host @param {string} label */
function input(host, label) {
  const found = [...host.querySelectorAll("label")].find((el) => el.textContent?.includes(label));
  assert.ok(found, label);
  return /** @type {HTMLInputElement} */ (found.querySelector("input, textarea"));
}

test("countdown text and urgency", () => {
  const now = 0;
  assert.equal(countdownLabel(48 * 3600_000, now), "48 h 0 min left");
  assert.equal(countdownLabel(40 * 60_000, now), "40 min left");
  assert.equal(countdownLabel(-(2 * 3600_000 + 10 * 60_000), now), "Overdue by 2 h 10 min");
  assert.equal(isUrgent(13 * 3600_000, now), false);
  assert.equal(isUrgent(11 * 3600_000, now), true);
});

test("the public page explains the process and shows the request ID after sending", async () => {
  /** @type {any[]} */
  const sent = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(TakedownPage, {
        submit: async (body) => {
          sent.push(body);
          return { ok: true, id: "TD-ABCDEFGHJK", mailed: true };
        },
      }),
    );
  });
  assert.match(host.textContent ?? "", /Within 48 hours/);
  assert.ok((host.textContent ?? "").includes(GOOD_FAITH_STATEMENT));
  for (const [label, value] of [
    ["Your name", "Rae"],
    ["Email for our reply", "rae@example.com"],
    ["Link to the image", "https://avouchsocial.com/m/1"],
    ["Signature", "Rae"],
  ]) {
    input(host, label).value = value;
  }
  input(host, "good faith").checked = true;
  act(() => {
    /** @type {HTMLFormElement} */ (host.querySelector("form")).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].goodFaith, true);
  assert.equal(sent[0].signature, "Rae");
  assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /TD-ABCDEFGHJK/);
  assert.match(host.textContent ?? "", /emailed it to you/);
  act(() => root.unmount());
  host.remove();
});

test("an error from the server is shown and the form stays", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(TakedownPage, {
        submit: async () => /** @type {const} */ ({ ok: false, error: "Enter your name." }),
      }),
    );
  });
  act(() => {
    /** @type {HTMLFormElement} */ (host.querySelector("form")).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "Enter your name.");
  assert.ok(host.querySelector("form"));
  act(() => root.unmount());
  host.remove();
});

test("the admin queue shows each open request with its countdown", async () => {
  const now = Date.UTC(2026, 9, 27, 12);
  /** @param {string} id @param {number} hoursLeft @returns {any} */
  const row = (id, hoursLeft) => ({
    id,
    requesterName: "Rae",
    requesterEmail: "rae@example.com",
    requesterPhone: "",
    contentUrl: "",
    description: "In the shop room.",
    signature: "Rae",
    status: "open",
    removedCount: 0,
    decisionNote: "",
    createdAt: now,
    dueAt: now + hoursLeft * 3600_000,
  });
  /** @type {any[]} */
  const removed = [];
  /** @type {any} */
  const api = {
    list: async () => ({ ok: true, rows: [row("TD-AAAAAAAAAA", 40), row("TD-BBBBBBBBBB", -1)] }),
    remove: async (/** @type {string} */ id, /** @type {string[]} */ media, /** @type {string} */ note) => {
      removed.push({ id, media, note });
      return "";
    },
    decline: async () => "",
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(TakedownQueue, { api, now }));
  });
  await flush();
  const counts = [...host.querySelectorAll("[data-countdown]")].map((el) => el.textContent);
  assert.deepEqual(counts, ["40 h 0 min left", "Overdue by 1 h 0 min"]);
  const buttons = [...host.querySelectorAll("button")];
  assert.ok(buttons.some((b) => b.getAttribute("aria-label") === "Remove files for TD-AAAAAAAAAA"));
  act(() => root.unmount());
  host.remove();
});

test("a field error focuses that input and ties it to the alert; the done message is focused", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let reply = /** @type {any} */ ({ ok: false, error: "Enter an email address we can reply to.", field: "email" });
  act(() => {
    root.render(createElement(TakedownPage, { submit: async () => reply }));
  });
  const form = /** @type {HTMLFormElement} */ (host.querySelector("form"));
  const submit = () =>
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  const button = /** @type {HTMLButtonElement} */ (host.querySelector('button[type="submit"]'));
  assert.equal(button.disabled, false);
  submit();
  await flush();
  const email = input(host, "Email for our reply");
  const alert = /** @type {HTMLElement} */ (host.querySelector('[role="alert"]'));
  assert.equal(document.activeElement, email);
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(email.getAttribute("aria-describedby"), alert.id);
  assert.equal(input(host, "Your name").getAttribute("aria-invalid"), null);
  reply = { ok: true, id: "TD-ABCDEFGHJK", mailed: true };
  submit();
  await flush();
  assert.equal(document.activeElement?.textContent, "Request received");
  assert.match(
    host.textContent ?? "",
    /Keep it somewhere safe\. You'll need it if you write to us\. An Avouch admin will review\s+your request within 48 hours and email you what we did\./,
  );
  act(() => root.unmount());
  host.remove();
});

test("queue actions confirm first with Cancel focused, then focus moves on", async () => {
  const now = Date.UTC(2026, 9, 27, 12);
  /** @param {string} id @returns {any} */
  const row = (id) => ({
    id, requesterName: "Rae", requesterEmail: "r@example.com", requesterPhone: "", contentUrl: "x",
    description: "", signature: "Rae", status: "open", removedCount: 0, decisionNote: "",
    createdAt: now, dueAt: now + 3600_000,
  });
  let rows = [row("TD-A"), row("TD-B")];
  /** @type {string[]} */
  const calls = [];
  /** @type {any} */
  const api = {
    list: async () => ({ ok: true, rows }),
    remove: async (/** @type {string} */ id) => {
      calls.push(`remove ${id}`);
      rows = rows.filter((r) => r.id !== id);
      return "";
    },
    decline: async (/** @type {string} */ id) => {
      calls.push(`decline ${id}`);
      rows = rows.filter((r) => r.id !== id);
      return "";
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(TakedownQueue, { api, now })));
  await flush();
  const byLabel = (/** @type {string} */ label) =>
    /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label));
  act(() => byLabel("Remove files for TD-A").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(REMOVE_CONFIRM));
  assert.equal(document.activeElement?.textContent, "Cancel");
  assert.deepEqual(calls, []);
  const confirmButton = () =>
    /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("dialog button")].find((b) => b.textContent !== "Cancel"));
  act(() => confirmButton().click());
  await flush();
  await flush();
  assert.deepEqual(calls, ["remove TD-A"]);
  assert.equal(document.activeElement, byLabel("Remove files for TD-B"));
  act(() => byLabel("Close TD-B without removing").click());
  await flush();
  assert.ok((host.textContent ?? "").includes(DECLINE_CONFIRM));
  act(() => confirmButton().click());
  await flush();
  await flush();
  assert.deepEqual(calls, ["remove TD-A", "decline TD-B"]);
  assert.equal(document.activeElement?.id, "takedown-heading");
  act(() => root.unmount());
  host.remove();
});
