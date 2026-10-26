import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/" });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLSelectElement",
  "HTMLOptionElement",
  "HTMLInputElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
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
const { GenderPrompt, RoomAudienceEditor, RoomAudienceMark } = await import(
  "../../components/board/audience.tsx"
);

/**
 * @param {import("react").ReactElement} element
 */
function render(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

test("a room shows a plain men or women label, and the member can state a gender", async () => {
  const men = render(createElement(RoomAudienceMark, { audience: "men" }));
  assert.equal(document.body.textContent?.includes("Men only"), true);
  assert.equal(/\blikes?\b|\bscore\b|\balgorithm\b/i.test(document.body.textContent ?? ""), false);
  men();

  const women = render(createElement(RoomAudienceMark, { audience: "women" }));
  assert.equal(document.body.textContent?.includes("Women only"), true);
  women();

  const open = render(createElement(RoomAudienceMark, { audience: "all" }));
  assert.equal(document.body.textContent?.includes("Men only"), false);
  assert.equal(document.body.textContent?.includes("Women only"), false);
  open();

  /** @type {string[]} */
  const stated = [];
  const prompt = render(
    createElement(GenderPrompt, {
      onSet(gender) {
        stated.push(gender);
      },
    }),
  );
  assert.match(document.body.textContent ?? "", /Say whether you are a man or a woman/);
  const man = [...document.querySelectorAll("button")].find((button) => button.textContent === "I am a man");
  if (!(man instanceof HTMLButtonElement)) throw new Error("The prompt has no way to say man.");
  await act(async () => {
    man.click();
  });
  assert.deepEqual(stated, ["man"]);
  prompt();

  /** @type {string[]} */
  const saved = [];
  const editor = render(
    createElement(RoomAudienceEditor, {
      audience: "all",
      onSave(audience) {
        saved.push(audience);
      },
    }),
  );
  const select = document.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("The host has no audience choice.");
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ["Everyone", "Men only", "Women only"],
  );
  await act(async () => {
    select.value = "women";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Save");
  if (!(save instanceof HTMLButtonElement)) throw new Error("The host cannot save the audience.");
  await act(async () => {
    save.click();
  });
  assert.deepEqual(saved, ["women"]);
  editor();

  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(room, /RoomAudienceMark/);
  assert.match(room, /RoomAudienceEditor/);
  assert.match(app, /GenderGate/);
  assert.equal(/\blikes?\b|\bscore\b|\balgorithm\b/i.test(room), false);
});
