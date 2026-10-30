// @ts-nocheck -- happy-dom render test; DOM globals are installed at runtime.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/", width: 390, height: 900 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLDetailsElement",
  "HTMLTextAreaElement",
  "HTMLLabelElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
]) {
  const value = key === "window" ? window : browser[key];
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: typeof value === "function" ? value.bind(window) : value,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listings = [
  {
    id: "l1",
    name: "Grace Bible Church of Brandon",
    town: "Brandon",
    county: "Hillsborough",
    category: "",
    sourceUrl: "https://grace.example/",
    status: "unclaimed",
  },
  {
    id: "l2",
    name: "Riverview Shop Night",
    town: "Riverview",
    county: "Hillsborough",
    category: "",
    sourceUrl: "",
    status: "unclaimed",
  },
];
/** @type {string[]} */
const posted = [];
globalThis.fetch = /** @type {any} */ (
  async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
    if (init?.method === "POST") posted.push(String(init.body));
    return new Response(
      JSON.stringify({
        methods: ["site_code", "domain_email", "steward_review"],
        claims: [],
        log: [],
        listings,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
);

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ClaimsPanel } = await import("../../components/board/claims-queue.tsx");
const { HomePanel } = await import("../../components/board/home-view.tsx");
const { useBoard } = await import("./store.ts");
const { readFileSync } = await import("node:fs");

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

/** @param {any} element */
async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  await flush();
  return {
    host,
    done() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** @param {HTMLInputElement} input @param {string} value */
async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flush();
}

/** @param {Element} host */
const submit = (host) =>
  /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Request the claim"))
  );

test("claim: one search field shows matching listings as you type, with name and town", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  assert.equal(host.querySelectorAll("select").length, 0, "no separate listing select");
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  assert.ok(input, "search is a combobox");
  assert.match(host.textContent ?? "", /Search for your church or group by name or town/);
  assert.equal(input.getAttribute("aria-expanded"), "false");
  await type(input, "grace");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  const options = [...host.querySelectorAll('[role="listbox"] [role="option"]')];
  assert.equal(options.length, 1);
  assert.match(options[0]?.textContent ?? "", /Grace Bible Church of Brandon/);
  assert.match(options[0]?.textContent ?? "", /Brandon, Hillsborough/);
  done();
});

test("claim: nothing matching says so and points at Request a new place", async () => {
  let asked = 0;
  const { host, done } = await mount(
    createElement(ClaimsPanel, { onNotListed: () => (asked += 1) }),
  );
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "zzz");
  assert.match(host.textContent ?? "", /No listing matches "zzz"\. Not listed\?/);
  const ask = [...host.querySelectorAll("button")].find((b) =>
    /Request a new place/.test(b.textContent ?? ""),
  );
  assert.ok(ask);
  act(() => ask.click());
  assert.equal(asked, 1);
  done();
});

test("claim: picking a listing shows it with Change, and Change brings the search back", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  assert.equal(submit(host).getAttribute("aria-disabled"), "true", "submit says it is not ready");
  assert.equal(submit(host).disabled, false, "but stays in the tab order");
  assert.match(host.textContent ?? "", /Find and choose your listing first\./);
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "river");
  const option = /** @type {HTMLElement} */ (host.querySelector('[role="option"]'));
  act(() => option.click());
  await flush();
  assert.equal(host.querySelector('input[role="combobox"]'), null);
  assert.match(host.textContent ?? "", /Your listingRiverview Shop Night/);
  assert.equal(submit(host).hasAttribute("aria-disabled"), false, "submit ready once chosen");
  assert.doesNotMatch(host.textContent ?? "", /Find and choose your listing first\./);
  const change = /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Change")
  );
  assert.ok(change);
  act(() => change.click());
  await flush();
  assert.ok(host.querySelector('input[role="combobox"]'));
  assert.equal(submit(host).getAttribute("aria-disabled"), "true");
  done();
});

test("claim: keyboard picks with arrow and Enter", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "hillsborough");
  assert.match(input.getAttribute("aria-activedescendant") ?? "", /-0$/, "first match highlighted");
  act(() => {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  assert.match(input.getAttribute("aria-activedescendant") ?? "", /-1$/);
  act(() => {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await flush();
  assert.match(host.textContent ?? "", /Your listingRiverview Shop Night/);
  done();
});

test("claim: proof options are whole-card labels with a real radio, a hint, and no sample address", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const cards = [...host.querySelectorAll("label.proof-option")];
  assert.equal(cards.length, 3);
  for (const card of cards) {
    const radio = /** @type {HTMLInputElement} */ (card.querySelector('input[type="radio"]'));
    assert.ok(radio, "real radio inside the card");
    assert.match(radio.className, /size-5/);
    assert.equal(card.querySelectorAll("span.text-sm").length, 1, "one hint line");
  }
  assert.doesNotMatch(host.innerHTML, /pastor@|yourchurch|@example/);
  const third = /** @type {HTMLInputElement} */ (cards[2]?.querySelector("input"));
  assert.equal(third.checked, false);
  act(() => /** @type {HTMLElement} */ (cards[2]).click());
  await flush();
  const again = [...host.querySelectorAll("label.proof-option")];
  assert.equal(/** @type {HTMLInputElement} */ (again[2]?.querySelector("input")).checked, true);
  assert.match(again[2]?.className ?? "", /border-fg/);
  assert.doesNotMatch(again[0]?.className ?? "", /border-fg/);
  done();
});

test("claim: no drop cap, no repeated kicker, and a plain step label", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  assert.equal(host.querySelectorAll(".illum").length, 0);
  assert.equal(host.querySelectorAll(".kicker").length, 0);
  assert.match(host.textContent ?? "", /Step 1 of 2: Find your listing/);
  assert.match(host.textContent ?? "", /Claim your church or group/);
  done();
});

const home = {
  zip: "33598",
  townId: null,
  townName: "",
  congregationId: "grace",
  congregations: [{ id: "grace", name: "Grace Bible Church of Brandon" }],
  sections: [
    {
      tier: "congregation",
      label: "Your congregation",
      rooms: [{ id: "grace-room", name: "Grace Bible Church of Brandon" }],
    },
    { tier: "region", label: "Farther out", rooms: [{ id: "hills", name: "Hillsborough County" }] },
  ],
  requests: [],
  accessLog: [],
};

test("home: rooms are link rows inside one card, not bordered boxes like fields", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home })));
  const { host, done } = await mount(createElement(HomePanel));
  const rows = [...host.querySelectorAll("li.room-row")];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.doesNotMatch(row.className, /\bborder\b|rounded-lg|bg-surface/);
    const open = /** @type {HTMLButtonElement} */ (row.querySelector("button"));
    assert.match(open.className, /underline/);
  }
  assert.equal(host.querySelectorAll(".plate .plate").length, 0, "no card inside a card");
  assert.equal(host.querySelectorAll(".illum").length, 0);
  assert.match(host.textContent ?? "", /Your rooms, nearest first/);
  assert.doesNotMatch(host.textContent ?? "", /Nothing here is ranked/);
  done();
});

test("home: Save place is a normal-size button on its own row, and the ZIP note says what to do", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home })));
  const { host, done } = await mount(createElement(HomePanel));
  const save = /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Save place")
  );
  assert.match(save.className, /justify-self-start/);
  assert.match(save.className, /sm:w-auto/);
  assert.match(save.className, /sm:col-span-2/);
  assert.match(
    host.querySelector("#place-zip-note")?.textContent ?? "",
    /There is no town room for ZIP 33598 yet\. You can ask for one with Request a new place\./,
  );
  const request = /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Request a new place")
  );
  assert.match(request.className, /w-fit/);
  assert.match(request.className, /min-h-\[44px\]/);
  done();
});

test("week: the This week plate keeps its phone look, spans the desktop width, and uses the v3 rule and pc-h", () => {
  const week = readFileSync(
    new URL("../../components/board/week-view.tsx", import.meta.url),
    "utf8",
  );
  // Josh (Oct 29, 7:51 PM): keep the drop cap, the kicker and the phone size; a larger desktop heading.
  assert.match(
    week,
    /<section className="plate plate--hero flex flex-col gap-2">\s*<Kicker>This week<\/Kicker>\s*<h1 className="illum font-display text-4xl text-balance text-fg lg:text-5xl">/,
  );
  // Design #123: the desktop title matches every other page head (lg:text-5xl, never 6xl).
  assert.doesNotMatch(week, /text-6xl/);
  // v3's 1px gilt rule with the diamond sits right after the title, desktop only (the phone card is unchanged).
  assert.match(week, /<\/h1>\s*\{\/\*[^*]*\*\/\}\s*<div className="pc-rule hidden lg:block" aria-hidden="true" \/>/);
  // The plate comes before the two-column grid, so the side column cannot halve it on a desktop.
  assert.ok(week.indexOf("plate plate--hero") < week.indexOf('"week-columns grid gap-8"'));
  assert.match(week, /week\.length === 0 && "max-lg:hidden"/);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  // No 3px gold top border, no .week-hero and no .list-label.
  assert.doesNotMatch(css, /week-hero|list-label|border-top: 3px/);
  assert.doesNotMatch(week, /week-hero/);
  assert.match(css, /\.pc-rule \{[^}]*width: min\(15rem, 70%\);[^}]*height: 1px;[^}]*var\(--pc-gilt\)/);
  assert.match(css, /\.pc-rule::before \{[^}]*width: 7px;[^}]*height: 7px;[^}]*rotate\(45deg\)/);
  assert.match(css, /:root \{\s*--pc-gilt: #c9a45c;\s*\}/);
  assert.match(css, /\[data-palette="parchment"\] \[data-section\] \{\s*--pc-gilt: #6f5420;\s*\}/);
  assert.match(css, /\.pc-h \{[^}]*font-variant-caps: all-small-caps;[^}]*color: var\(--pc-gilt\)/);
  // The kicker the phone shows is unchanged; list labels use their own readable style.
  assert.match(
    css,
    /\.kicker \{[^}]*font-variant-caps: all-small-caps;[^}]*font-size: 0\.8125rem;/,
  );
  const home = readFileSync(
    new URL("../../components/board/home-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(home, /<h3 className="pc-h">\{section\.label\}<\/h3>/);
  assert.equal(home.includes("tracking-widest"), false);
  assert.equal(home.includes("illum"), false);
});

/** @param {Element} el @param {string} key */
function press(el, key) {
  act(() => {
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("picker (1): submitting before a pick shows the error and focuses search, not a disabled button", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const button = submit(host);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.getAttribute("aria-describedby"), "claim-submit-hint");
  const before = posted.length;
  act(() => button.click());
  await flush();
  assert.equal(posted.length, before, "nothing was sent");
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "Find and choose your listing first.");
  assert.equal(document.activeElement, host.querySelector('input[role="combobox"]'));
  done();
});

test("picker (2): the polite hint says how many listings match and how to choose", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  const hint = () => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;
  await type(input, "hillsborough");
  assert.equal(hint(), "2 listings match. Use the up and down arrows to choose.");
  await type(input, "grace");
  assert.equal(hint(), "1 listing matches. Use the up and down arrows to choose.");
  done();
});

test("picker (3): the first match is highlighted, and Enter picks the highlighted one", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "hillsborough");
  const first = host.querySelector('[role="option"]');
  assert.equal(input.getAttribute("aria-activedescendant"), first?.id);
  assert.equal(first?.getAttribute("aria-selected"), "true");
  press(input, "Enter");
  await flush();
  assert.match(host.textContent ?? "", /Your listingGrace Bible Church of Brandon/);
  done();
});

test("picker (4): Escape closes an open list, then clears the field once the list is closed", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "grace");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  press(input, "Escape");
  await flush();
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(input.value, "grace");
  press(input, "Escape");
  await flush();
  assert.equal(input.value, "");
  done();
});

test("picker (5): proof cards name the radio by its title, describe it by its hint, and ring the whole card", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const cards = [...host.querySelectorAll("label.proof-option")];
  assert.equal(cards.length, 3);
  for (const card of cards) {
    const radio = /** @type {HTMLInputElement} */ (card.querySelector('input[type="radio"]'));
    assert.equal(radio.hasAttribute("style"), false, "no inline border-radius");
    const title = document.getElementById(radio.getAttribute("aria-labelledby") ?? "");
    const hint = document.getElementById(radio.getAttribute("aria-describedby") ?? "");
    assert.ok(title && hint);
    assert.equal(title.className, "text-base text-fg");
    assert.equal(hint.className, "text-sm text-muted");
    assert.notEqual(title.textContent, hint.textContent);
    assert.match(card.className, /has-\[:focus-visible\]:outline-2/);
    assert.match(card.className, /has-\[:focus-visible\]:outline-offset-2/);
  }
  assert.equal(
    document.getElementById(
      cards[0]?.querySelector("input")?.getAttribute("aria-labelledby") ?? "",
    )?.textContent,
    "Add a code to your website",
  );
  done();
});

test("request (6): Request a new place is a real button that opens the form, focuses Kind, and confirms", async () => {
  /** @type {any[]} */
  const sent = [];
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home,
        requestRoom: async (/** @type {any} */ body) => {
          sent.push(body);
          return { ok: true };
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  assert.equal(host.querySelector("details > summary")?.textContent?.includes("Request a new place") ?? false, false);
  const request = /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Request a new place")
  );
  assert.equal(request.type, "button");
  assert.equal(request.getAttribute("aria-expanded"), "false");
  assert.equal(request.getAttribute("aria-controls"), "request-place-form");
  const form = /** @type {HTMLFormElement} */ (host.querySelector("#request-place-form"));
  assert.equal(form.hidden, true);
  act(() => request.click());
  await flush();
  assert.equal(request.getAttribute("aria-expanded"), "true");
  assert.equal(form.hidden, false);
  assert.equal(document.activeElement, form.querySelector("select"), "focus on Kind");
  const name = /** @type {HTMLInputElement} */ (form.querySelectorAll("input")[0]);
  await type(name, "Riverview");
  act(() => form.requestSubmit());
  await flush();
  assert.equal(sent.length, 1);
  const status = host.querySelector('[role="status"]');
  assert.equal(status?.textContent, "Request sent. An admin will look at it.");
  assert.equal(document.activeElement, status?.querySelector("p"));
  done();
});

test("request (6): Not listed in the claim picker opens Request a new place on its first field", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home })));
  const { host, done } = await mount(createElement(HomePanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, "zzz");
  const ask = /** @type {HTMLButtonElement} */ (
    [...host.querySelectorAll("button")].find((b) => /Ask for it with Request a new place/.test(b.textContent ?? ""))
  );
  act(() => ask.click());
  await flush();
  const form = /** @type {HTMLFormElement} */ (host.querySelector("#request-place-form"));
  assert.equal(form.hidden, false);
  assert.equal(document.activeElement, form.querySelector("select"));
  done();
});
