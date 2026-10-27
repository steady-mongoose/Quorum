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
const { AudienceChoice, GenderPrompt, RoomAudienceEditor, RoomAudienceMark } = await import(
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
  assert.equal(document.body.textContent?.includes("Audience:"), true);
  assert.equal(document.querySelector(".sr-only")?.textContent, "Audience: ");
  assert.match(document.body.innerHTML, /border-muted/);
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
  let dismissed = 0;
  const prompt = render(
    createElement(GenderPrompt, {
      onSet(gender) {
        stated.push(gender);
      },
      onDismiss() {
        dismissed += 1;
      },
    }),
  );
  const promptText = document.body.textContent ?? "";
  assert.match(promptText, /To open men's and women's rooms/);
  assert.match(promptText, /We ask only so you can enter them/);
  assert.match(promptText, /an admin can change it for you/);
  assert.match(document.body.innerHTML, /<fieldset[^>]*class="[^"]*plate/);
  assert.match(document.body.innerHTML, /<legend[^>]*class="[^"]*illum/);
  const man = [...document.querySelectorAll("button")].find((button) => button.textContent === "I'm a man");
  const later = [...document.querySelectorAll("button")].find((button) => button.textContent === "Not now");
  if (!(man instanceof HTMLButtonElement)) throw new Error("The prompt has no way to say man.");
  if (!(later instanceof HTMLButtonElement)) throw new Error("The prompt has no way to wait.");
  await act(async () => {
    later.click();
    man.click();
  });
  assert.equal(dismissed, 1);
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
  assert.equal(document.querySelector("select"), null);
  const womenRadio = [...document.querySelectorAll("input[type=radio]")].find(
    (input) => input instanceof HTMLInputElement && input.value === "women",
  );
  if (!(womenRadio instanceof HTMLInputElement)) throw new Error("The host has no audience choice.");
  assert.match(document.body.textContent ?? "", /Only members who've said they're women can join/);
  const row = womenRadio.closest("label");
  assert.match(row?.className ?? "", /min-h-11/);
  await act(async () => {
    womenRadio.click();
  });
  const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Save");
  if (!(save instanceof HTMLButtonElement)) throw new Error("The host cannot save the audience.");
  await act(async () => {
    save.click();
  });
  assert.deepEqual(saved, ["women"]);
  editor();

  /** @type {string[]} */
  const picked = [];
  const choice = render(
    createElement(AudienceChoice, {
      legend: "Who can be in this room",
      name: "create-room-audience",
      value: "all",
      onChange(audience) {
        picked.push(audience);
      },
    }),
  );
  const menOption = [...document.querySelectorAll("input[type=radio]")].find(
    (input) => input instanceof HTMLInputElement && input.value === "men",
  );
  if (!(menOption instanceof HTMLInputElement)) throw new Error("Creating a room has no audience choice.");
  await act(async () => {
    menOption.click();
  });
  assert.deepEqual(picked, ["men"]);
  choice();

  const room = readFileSync(new URL("../../components/board/room-view.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../../components/board/audience.tsx", import.meta.url), "utf8");
  assert.match(room, /RoomAudienceMark/);
  assert.match(room, /RoomAudienceEditor/);
  assert.match(room, /RoomHoldPlate/);
  assert.equal(app.includes("GenderGate"), false);
  // The admin form that edited another member's gender is gone. A change goes
  // through an admin-reviewed correction request.
  assert.equal(form.includes("Set as man"), false);
  assert.equal(form.includes("MemberGenderForm"), false);
  assert.match(form, /That room is not here/);
  assert.equal(/\blikes?\b|\bscore\b|\balgorithm\b/i.test(room), false);
  assert.equal(/\btext-danger\b/.test(room.match(/held[\s\S]{0,800}/)?.[0] ?? ""), false);
});
