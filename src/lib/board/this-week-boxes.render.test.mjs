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
const { ClaimsPanel, ListingPicker, CLAIM_NOT_SENT } = await import("../../components/board/claims-queue.tsx");
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
  assert.equal(host.querySelectorAll(".pc-card .pc-card, .plate .pc-card").length, 0, "no card inside a card");
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
    /There is no town room for ZIP 33598 yet\. Ask for one with Request a new place/,
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
    /<section className="plate plate--hero pc-head flex flex-col gap-2">\s*<Kicker>This week<\/Kicker>\s*<h1 className="illum font-display text-4xl text-balance text-fg lg:text-5xl">/,
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
  // Since #116 merged, the v3 rule, pc-h and --pc-gilt live once, in public/page-craft.css (loaded on every page).
  const craft = readFileSync(new URL("../../../public/page-craft.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.pc-rule|\.pc-h|--pc-gilt:/);
  assert.match(craft, /\.pc-rule\{[^}]*width:min\(15rem,70%\);[^}]*height:1px;[^}]*var\(--pc-gilt\)/);
  assert.match(craft, /\.pc-rule::before\{[^}]*width:7px;[^}]*height:7px;[^}]*rotate\(45deg\)/);
  assert.match(craft, /:root\{[^}]*--pc-gilt:#c9a45c;/);
  assert.match(craft, /\[data-palette="parchment"\] \[data-section\]\{--pc-gilt:#6f5420;/);
  assert.match(craft, /\.pc-h\{[^}]*font-variant-caps:all-small-caps;[^}]*color:var\(--pc-gilt\)/);
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
  const status = [...host.querySelectorAll('[role="status"]')].find((el) =>
    /Request sent/.test(el.textContent ?? ""),
  );
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

// QA #123 (reviews 5706899294 and 5706946168 on 885183b): S3 and S4 items.

/** Picks the first listing matching `query` and returns the submit button. @param {Element} host @param {string} query */
async function pickListing(host, query) {
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  await type(input, query);
  act(() => /** @type {HTMLElement} */ (host.querySelector('[role="option"]')).click());
  await flush();
  return /** @type {HTMLButtonElement} */ (host.querySelector('button[type="submit"]'));
}

/** Swaps fetch so claim POSTs go through `onPost`; reads still get the queue. @param {(init: RequestInit) => Promise<Response>} onPost */
function withPost(onPost) {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) =>
      init?.method === "POST" ? onPost(init) : real(url, init)
  );
  return () => {
    globalThis.fetch = real;
  };
}

test("qa S3: the polite hint is one live region from the start, so 1-8 match counts are announced", async () => {
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  const region = document.getElementById(input.getAttribute("aria-describedby") ?? "");
  assert.equal(region?.getAttribute("aria-live"), "polite");
  assert.equal(region?.textContent, "Start typing, then choose your listing from the list.");
  for (const [query, said] of [
    ["grace", "1 listing matches. Use the up and down arrows to choose."],
    ["hillsborough", "2 listings match. Use the up and down arrows to choose."],
  ]) {
    await type(input, query);
    // Same node, new text: a screen reader announces a change inside an existing live region,
    // not a region that is mounted with its text already in it.
    assert.equal(document.getElementById(input.getAttribute("aria-describedby") ?? ""), region);
    assert.equal(region?.textContent, said);
  }
  done();
});

test("qa S3: Tab away or a click outside closes the list and sets aria-expanded false", async () => {
  const outside = document.createElement("button");
  document.body.append(outside);
  const { host, done } = await mount(createElement(ClaimsPanel));
  const input = /** @type {HTMLInputElement} */ (host.querySelector('input[role="combobox"]'));
  act(() => input.focus());
  await type(input, "hillsborough");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  act(() => outside.focus());
  await flush();
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(/** @type {HTMLElement} */ (host.querySelector('[role="listbox"]')).hidden, true);
  assert.equal(input.hasAttribute("aria-activedescendant"), false);
  // Coming back opens it again, and an option still picks (its mousedown keeps focus in the field).
  act(() => input.focus());
  await flush();
  assert.equal(input.getAttribute("aria-expanded"), "true");
  const option = /** @type {HTMLElement} */ (host.querySelector('[role="option"]'));
  const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    option.dispatchEvent(down);
  });
  assert.equal(down.defaultPrevented, true);
  act(() => option.click());
  await flush();
  assert.match(host.textContent ?? "", /Your listingGrace Bible Church of Brandon/);
  outside.remove();
  done();
});

test("qa S3: a double submit sends one POST, with a Sending… state, and no 'already open' after success", async () => {
  /** @type {(value: Response) => void} */
  let release = () => {};
  let posts = 0;
  const restore = withPost(() => {
    posts += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const { host, done } = await mount(createElement(ClaimsPanel));
  const button = await pickListing(host, "grace");
  act(() => button.click());
  await flush();
  assert.equal(button.textContent, "Sending…");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.disabled, false, "aria-disabled, so it keeps focus");
  const sendingStatus = /** @type {HTMLElement} */ (button.parentElement?.querySelector('[role="status"].sr-only'));
  assert.equal(sendingStatus.getAttribute("aria-live"), "polite");
  assert.equal(sendingStatus.textContent, "Sending your request…");
  act(() => button.click());
  act(() => /** @type {HTMLFormElement} */ (button.form).requestSubmit());
  await flush();
  assert.equal(posts, 1, "the second click and Enter send nothing");
  await act(async () => {
    release(
      new Response(JSON.stringify({ claim: {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  await flush();
  assert.equal(posts, 1);
  assert.equal(button.textContent, "Request the claim");
  assert.equal(button.hasAttribute("aria-busy"), false);
  assert.equal(sendingStatus.textContent, "", "the same status node empties once sent");
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.match(host.textContent ?? "", /The claim is open\./);
  assert.doesNotMatch(host.textContent ?? "", /already open/);
  restore();
  done();
});

test("qa S3: a network failure says the request did not send, never 'api-unavailable'", async () => {
  const restore = withPost(async () => {
    throw new TypeError("Failed to fetch");
  });
  const { host, done } = await mount(createElement(ClaimsPanel));
  const button = await pickListing(host, "grace");
  act(() => button.click());
  await flush();
  const alert = host.querySelector('[role="alert"]');
  assert.equal(alert?.textContent, "Your request did not send. Try again in a moment.");
  assert.equal(CLAIM_NOT_SENT, alert?.textContent);
  assert.doesNotMatch(host.textContent ?? "", /api-unavailable/);
  assert.equal(button.textContent, "Request the claim", "the button is usable again");
  assert.equal(button.hasAttribute("aria-busy"), false);
  restore();
  done();
});

test("qa S3: a server error with words still shows those words", async () => {
  const restore = withPost(
    async () =>
      new Response(JSON.stringify({ error: "A claim for that listing is already open." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
  );
  const { host, done } = await mount(createElement(ClaimsPanel));
  const button = await pickListing(host, "grace");
  act(() => button.click());
  await flush();
  assert.equal(host.querySelector('[role="alert"]')?.textContent, "A claim for that listing is already open.");
  restore();
  done();
});

test("qa S3: an empty week with no side column renders no empty grid under the phone card", () => {
  const week = readFileSync(new URL("../../components/board/week-view.tsx", import.meta.url), "utf8");
  // The grid (and its gap-8 row) exists only when it has something to show.
  assert.match(week, /\{week\.length > 0 \|\| hasSide \? \(\s*<div\s+className=\{cn\(\s*"week-columns grid gap-8"/);
  // The phone card itself is unchanged.
  assert.match(
    week,
    /<section className="plate plate--hero pc-head flex flex-col gap-2">\s*<Kicker>This week<\/Kicker>/,
  );
});

/** WCAG relative luminance contrast. @param {string} a @param {string} b */
function contrast(a, b) {
  const lum = (/** @type {string} */ hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("qa S3: the Home tier labels (pc-h, which replaced .list-label) are at least 4.5:1 in both palettes", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const craft = readFileSync(new URL("../../../public/page-craft.css", import.meta.url), "utf8");
  const art = readFileSync(new URL("../../../public/backgrounds.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /list-label/);
  const ink = /:root\{[^}]*--pc-gilt:(#[0-9a-f]{6});/.exec(craft)?.[1];
  const parchment = /\[data-palette="parchment"\] \[data-section\]\{--pc-gilt:(#[0-9a-f]{6});/.exec(craft)?.[1];
  assert.ok(ink && parchment);
  /** @param {string} block */
  const grounds = (block) =>
    ["--bg", "--surface", "--card", "--card-raised"].map((name) => {
      const hit = new RegExp(`${name}:(#[0-9a-f]{6})`).exec(block)?.[1];
      assert.ok(hit, name);
      return /** @type {string} */ (hit);
    });
  const inkBlock = art.slice(0, art.indexOf('[data-palette="parchment"]{'));
  const parchBlock = art.slice(art.indexOf('[data-palette="parchment"]{'));
  for (const ground of grounds(inkBlock)) assert.ok(contrast(ink, ground) >= 4.5, `Ink & Bone ${ground}`);
  for (const ground of grounds(parchBlock)) assert.ok(contrast(parchment, ground) >= 4.5, `Parchment ${ground}`);
});

test("qa S4: the gold rule and labels follow the palette (--pc-gilt), not the fixed --color-gilt", () => {
  for (const file of ["week-view.tsx", "home-view.tsx", "claims-queue.tsx"]) {
    const src = readFileSync(new URL(`../../components/board/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /gilt|#c9a45c/i, file);
  }
  const css = readFileSync(new URL("../../../public/page-craft.css", import.meta.url), "utf8");
  for (const rule of [".pc-rule{", ".pc-rule::before{", ".pc-h{"]) {
    const block = css.slice(css.indexOf(rule), css.indexOf("}", css.indexOf(rule)));
    assert.match(block, /var\(--pc-gilt\)/, rule);
    assert.doesNotMatch(block, /--color-gilt/, rule);
  }
});

test("qa S4: a queue reload that rebuilds the picked listing does not move focus to Change", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  const root = createRoot(host);
  const props = (/** @type {any} */ picked) => ({
    choices: listings,
    picked,
    query: "",
    onQuery: () => {},
    onPick: () => {},
  });
  act(() => root.render(createElement(ListingPicker, props({ ...listings[0] }))));
  await flush();
  const change = [...host.querySelectorAll("button")].find((b) => b.textContent === "Change");
  assert.equal(document.activeElement, change, "a fresh pick focuses Change");
  act(() => elsewhere.focus());
  // reload(): same id, new object.
  act(() => root.render(createElement(ListingPicker, props({ ...listings[0] }))));
  await flush();
  assert.equal(document.activeElement, elsewhere);
  // A different listing is a real change and does move focus.
  act(() => root.render(createElement(ListingPicker, props({ ...listings[1] }))));
  await flush();
  assert.equal(document.activeElement?.textContent, "Change");
  act(() => root.unmount());
  host.remove();
  elsewhere.remove();
});

test("qa S4: the ZIP note's Request a new place is a button that opens the form on Kind", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home })));
  const { host, done } = await mount(createElement(HomePanel));
  const note = /** @type {HTMLElement} */ (host.querySelector("#place-zip-note"));
  const ask = /** @type {HTMLButtonElement} */ (note.querySelector("button"));
  assert.ok(ask, "the note holds a button");
  assert.equal(ask.type, "button");
  assert.equal(ask.textContent, "Ask for one with Request a new place");
  assert.equal(ask.getAttribute("aria-controls"), "request-place-form");
  assert.equal(ask.getAttribute("aria-expanded"), "false");
  assert.match(ask.className, /min-h-\[44px\]/);
  const form = /** @type {HTMLFormElement} */ (host.querySelector("#request-place-form"));
  assert.equal(form.hidden, true);
  act(() => ask.click());
  await flush();
  assert.equal(form.hidden, false);
  assert.equal(ask.getAttribute("aria-expanded"), "true");
  const kind = /** @type {HTMLSelectElement} */ (form.querySelector("select"));
  assert.equal(document.activeElement, kind);
  assert.equal(kind.value, "town");
  done();
});

test("design #123: Home and claims blocks sit on card pc-card, one material with the page heads", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home })));
  const homeMount = await mount(createElement(HomePanel));
  const intro = /** @type {HTMLElement} */ (homeMount.host.querySelector('[aria-labelledby="home-h"]'));
  assert.equal(intro.className, "card pc-card flex flex-col gap-4 p-4 sm:p-5");
  assert.equal(
    homeMount.host.querySelector('[aria-labelledby="place-h"]')?.className,
    "card pc-card grid gap-4 p-4 sm:p-5 sm:grid-cols-2",
  );
  assert.equal(
    homeMount.host.querySelector("#request-place-form")?.className,
    "card pc-card mt-3 grid gap-3 p-4 sm:p-5 sm:grid-cols-2",
  );
  assert.equal(homeMount.host.querySelectorAll(".plate").length, 0, "no plain .plate left on Home");
  homeMount.done();
  const claims = await mount(createElement(ClaimsPanel));
  assert.equal(
    claims.host.querySelector('[aria-labelledby="claim-h"]')?.className,
    "card pc-card flex flex-col gap-4 p-4 sm:p-5",
  );
  assert.equal(claims.host.querySelectorAll(".plate").length, 0);
  claims.done();
  const queue = readFileSync(new URL("../../components/board/claims-queue.tsx", import.meta.url), "utf8");
  assert.match(queue, /<section className="card pc-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="queue-h">/);
  assert.match(queue, /aria-disabled:not-aria-busy:opacity-50 aria-busy:opacity-75/);
});

test("design #123: a queue that fails to load is a polite status, not an alert", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (
    async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } })
  );
  const { host, done } = await mount(createElement(ClaimsPanel));
  assert.equal(host.querySelector('[role="alert"]'), null);
  const status = [...host.querySelectorAll('[role="status"]')].find((el) =>
    /claims queue is not available yet/.test(el.textContent ?? ""),
  );
  assert.ok(status, "the load failure is a status");
  globalThis.fetch = real;
  done();
});

test("design #123: a page head rule clears the h1 descenders, within the page-craft budget", async () => {
  const css = readFileSync(new URL("../../../public/page-craft.css", import.meta.url), "utf8");
  assert.match(css, /\[data-entered\] \.pc-head h1\+\.pc-rule\{margin-top:\.5rem\}/);
  const { gzipSync } = await import("node:zlib");
  assert.ok(gzipSync(css, { level: 9 }).length < 3072);
});

// Josh (Oct 30, 7:57 AM ET): "some buttons" did nothing on Save. Save place kept his ZIP and
// congregation on the server, but said nothing on success, so a Save with no town room looked dead.

/** @param {Element} host @param {RegExp} name */
const buttonNamed = (host, name) =>
  /** @type {HTMLButtonElement} */ ([...host.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "")));
/** @param {Element} host @param {RegExp} text */
const statusWith = (host, text) =>
  [...host.querySelectorAll('[role="status"]')].find((el) => text.test(el.textContent ?? ""));
/** @param {Element} host */
const placeForm = (host) => /** @type {HTMLFormElement} */ (host.querySelector('form[aria-labelledby="place-h"]'));

test("save feedback: Save place with no town room says Saved in a status, and posts once", async () => {
  /** @type {any[]} */
  const sent = [];
  /** @type {(value: any) => void} */
  let finish = () => {};
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home,
        savePlace: (/** @type {any} */ body) => {
          sent.push(body);
          return new Promise((resolve) => (finish = resolve));
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  const form = placeForm(host);
  const status = form.querySelector('[role="status"]');
  assert.ok(status, "the place status is mounted before the first Save");
  act(() => form.requestSubmit());
  await flush();
  const busy = buttonNamed(host, /Saving…/);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.equal(busy.getAttribute("aria-disabled"), "true", "busy Save stays in the tab order");
  assert.equal(busy.disabled, false);
  assert.match(busy.className, /aria-busy:opacity-75/);
  assert.match(busy.className, /aria-disabled:not-aria-busy:opacity-70/);
  act(() => form.requestSubmit());
  await flush();
  assert.equal(sent.length, 1, "a second tap while saving does not post again");
  assert.deepEqual(sent[0], { zip: "33598", congregationId: "grace" });
  await act(async () => finish({ ok: true }));
  await flush();
  assert.equal(
    status?.textContent,
    "Saved. ZIP 33598, Grace Bible Church of Brandon.",
  );
  assert.ok(buttonNamed(host, /^Save place$/), "the button is back to Save place");
  await type(/** @type {HTMLInputElement} */ (host.querySelector("#place-zip")), "33511");
  assert.equal(status?.textContent, "", "editing clears the old Saved");
  done();
});

test("save feedback: a refused Save place shows the server's reason in the status", async () => {
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({ home, savePlace: async () => ({ ok: false, error: "Enter a five-digit ZIP." }) }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => placeForm(host).requestSubmit());
  await flush();
  assert.equal(placeForm(host).querySelector('[role="alert"]')?.textContent, "Enter a five-digit ZIP.");
  assert.equal(placeForm(host).querySelector('[role="status"]')?.textContent, "", "the status is only for Saved");
  done();
});

test("save feedback: a barred account and a dropped connection are said in words, not silence", async () => {
  act(() => useBoard.setState(/** @type {any} */ ({ home, savePlace: async () => ({ ok: false, error: "banned" }) })));
  let mounted = await mount(createElement(HomePanel));
  act(() => placeForm(mounted.host).requestSubmit());
  await flush();
  assert.equal(
    placeForm(mounted.host).querySelector('[role="alert"]')?.textContent,
    "This account is barred from the board.",
  );
  mounted.done();
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home,
        savePlace: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ),
  );
  mounted = await mount(createElement(HomePanel));
  act(() => placeForm(mounted.host).requestSubmit());
  await flush();
  assert.equal(
    placeForm(mounted.host).querySelector('[role="alert"]')?.textContent,
    "Your place was not saved. Check your connection and try again.",
  );
  assert.ok(buttonNamed(mounted.host, /^Save place$/), "Save place works again after a failure");
  mounted.done();
});

test("save feedback: Request room that cannot reach the server says so", async () => {
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home,
        requestRoom: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Request a new place$/).click());
  await flush();
  act(() => /** @type {HTMLFormElement} */ (host.querySelector("#request-place-form")).requestSubmit());
  await flush();
  assert.match(
    host.querySelector('#request-place-form [role="alert"]')?.textContent ?? "",
    /^Your request was not sent\. Check your connection and try again\.$/,
  );
  done();
});

test("save feedback: Leave says which room you left, after the row is gone", async () => {
  const joinedHome = {
    ...home,
    sections: [{ tier: "joined", label: "Joined", rooms: [{ id: "grace-room", name: "Grace Bible Church of Brandon" }] }],
  };
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home: joinedHome,
        leaveRoom: async () => {
          useBoard.setState(/** @type {any} */ ({ home: { ...joinedHome, sections: [] } }));
          return { ok: true };
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Leave$/).click());
  await flush();
  assert.equal(host.querySelector("li.room-row"), null);
  const left = statusWith(host, /^You left Grace Bible Church of Brandon\.$/);
  assert.ok(left);
  assert.equal(document.activeElement, left?.querySelector("p"), "focus moves to the note");
  assert.equal(left?.querySelector("p")?.getAttribute("tabindex"), "-1");
  act(() => placeForm(host).requestSubmit());
  await flush();
  assert.equal(statusWith(host, /You left/), undefined, "another action clears the note");
  done();
});

test("save feedback: Approve says it was approved, since its buttons go away", async () => {
  const request = { id: "r1", kind: "town", name: "Riverview", state: "FL", status: "open", by: "Ann", note: "" };
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        admin: true,
        home: { ...home, requests: [request] },
        decideRoom: async () => {
          // The admin's reload lists only open requests and their own (QA #132 S2): this one drops out.
          useBoard.setState(/** @type {any} */ ({ home: { ...home, requests: [] } }));
          return { ok: true };
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Approve$/).click());
  await flush();
  assert.equal(buttonNamed(host, /^Approve$/), undefined);
  assert.equal(host.querySelector("details"), null, "the whole Decide block is gone");
  const approved = statusWith(host, /^Approved\.$/);
  assert.ok(approved, "the outcome stays at Home level after the reload");
  assert.equal(document.activeElement, approved?.querySelector("p"), "focus moves to it");
  act(() => placeForm(host).requestSubmit());
  await flush();
  assert.equal(statusWith(host, /^Approved\.$/), undefined, "another action clears it");
  act(() => useBoard.setState(/** @type {any} */ ({ admin: false })));
  done();
});

test("save feedback: Saved copy for every ZIP and congregation mix (Design #132 M2)", async () => {
  const { placeSavedText } = await import("../../components/board/home-view.tsx");
  const church = "Grace Bible Church of Brandon";
  assert.equal(placeSavedText({ zip: "33598", congregationName: church }), "Saved. ZIP 33598, Grace Bible Church of Brandon.");
  assert.equal(placeSavedText({ zip: "33598", congregationName: "" }), "Saved. ZIP 33598, no congregation.");
  assert.equal(placeSavedText({ zip: "", congregationName: church }), "Saved. No ZIP, Grace Bible Church of Brandon.");
  assert.equal(placeSavedText({ zip: " ", congregationName: "" }), "Saved. You have no ZIP or congregation set.");
});

test("save feedback: Leave, Request room and Refuse show busy; only the pressed decision is busy", async () => {
  const request = { id: "r2", kind: "town", name: "Riverview", state: "FL", status: "open", by: "Ann", note: "" };
  /** @type {(value: any) => void} */
  let finish = () => {};
  let calls = 0;
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        admin: true,
        home: { ...home, requests: [request] },
        decideRoom: () => {
          calls += 1;
          return new Promise((resolve) => (finish = resolve));
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Refuse$/).click());
  await flush();
  const refuse = buttonNamed(host, /^Refusing…$/);
  assert.ok(refuse, "the pressed button says Refusing…");
  assert.equal(refuse.getAttribute("aria-disabled"), "true");
  const approve = buttonNamed(host, /^Approve$/);
  assert.equal(refuse.getAttribute("aria-busy"), "true");
  assert.equal(approve.hasAttribute("aria-busy"), false, "Approve is not busy");
  assert.equal(approve.getAttribute("aria-disabled"), "true", "Approve waits");
  assert.match(approve.className, /aria-disabled:not-aria-busy:opacity-70/);
  act(() => approve.click());
  await flush();
  assert.equal(calls, 1, "the waiting button does nothing");
  await act(async () => finish({ ok: false, error: "Name the room's first steward." }));
  await flush();
  assert.equal(buttonNamed(host, /^Approve$/).hasAttribute("aria-disabled"), false);
  assert.match(host.textContent ?? "", /Name the room's first steward\./);
  act(() => useBoard.setState(/** @type {any} */ ({ admin: false })));
  done();
  const home2 = readFileSync(new URL("../../components/board/home-view.tsx", import.meta.url), "utf8");
  for (const label of ["Saving…", "Sending…", "Leaving…"]) assert.ok(home2.includes(label));
  assert.equal((home2.match(/busyLook/g) ?? []).length >= 6, true, "Save place, Request room, Leave, Approve, Refuse");
});

test("save feedback: Leave stays busy and posts once on a double tap", async () => {
  const joinedHome = {
    ...home,
    sections: [{ tier: "joined", label: "Joined", rooms: [{ id: "g", name: "Grace" }] }],
  };
  /** @type {(value: any) => void} */
  let finish = () => {};
  let calls = 0;
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home: joinedHome,
        leaveRoom: () => {
          calls += 1;
          return new Promise((resolve) => (finish = resolve));
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Leave$/).click());
  await flush();
  const leaving = buttonNamed(host, /^Leaving…$/);
  assert.equal(leaving.getAttribute("aria-busy"), "true");
  assert.equal(leaving.getAttribute("aria-disabled"), "true");
  act(() => leaving.click());
  await flush();
  assert.equal(calls, 1);
  await act(async () => finish({ ok: false, error: "You are this room's last steward." }));
  await flush();
  assert.match(host.querySelector("li.room-row [role=\"alert\"]")?.textContent ?? "", /last steward/);
  done();
});

test("save feedback: a save the server kept but the reload missed says Saved, plus Reload", async () => {
  act(() =>
    useBoard.setState(/** @type {any} */ ({ home, savePlace: async () => ({ ok: true, reloadFailed: true }) })),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => placeForm(host).requestSubmit());
  await flush();
  assert.equal(
    placeForm(host).querySelector('[role="status"]')?.textContent,
    "Saved. ZIP 33598, Grace Bible Church of Brandon. Reload the page to see the change.",
  );
  assert.equal(placeForm(host).querySelector('[role="alert"]'), null, "not shown as a failure");
  done();
});

test("save feedback: store placeCall keeps a save ok when the Home reload throws or fails", async () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  // The reload is inside its own try, after the save result is known.
  assert.match(
    store,
    /if \(!saved\.ok\) return \{ ok: false, error: saved\.error \};\s*\/\/[^\n]*\n[^\n]*\n\s*try \{[\s\S]*?if \(!\(await pullHome\(\)\)\) fresh = false;[\s\S]*?catch \{\s*return \{ ok: true, reloadFailed: true \};/,
  );
});

test("save feedback: rejoining the room you left retires 'You left X.'", async () => {
  const room = { id: "g", name: "Grace" };
  const joined = { ...home, sections: [{ tier: "joined", label: "Joined", rooms: [room] }] };
  act(() =>
    useBoard.setState(
      /** @type {any} */ ({
        home: joined,
        leaveRoom: async () => {
          useBoard.setState(/** @type {any} */ ({ home: { ...joined, sections: [] } }));
          return { ok: true };
        },
      }),
    ),
  );
  const { host, done } = await mount(createElement(HomePanel));
  act(() => buttonNamed(host, /^Leave$/).click());
  await flush();
  assert.ok(statusWith(host, /^You left Grace\.$/));
  act(() => useBoard.setState(/** @type {any} */ ({ home: joined })));
  await flush();
  assert.equal(statusWith(host, /You left/), undefined);
  done();
});

test("save feedback: a proxy 502 with no JSON gets the connection hint, worded per action", async () => {
  const { apiBoardClient } = await import("./api.ts");
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (
    async () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })
  );
  try {
    assert.deepEqual(await apiBoardClient.savePlace({ zip: "33598", congregationId: "" }), {
      ok: false,
      error: "Your place was not saved. Check your connection and try again.",
    });
    const sent = await apiBoardClient.requestRoom({ kind: "town", name: "Riverview", state: "FL" });
    assert.equal(sent.ok, false);
    assert.equal(!sent.ok && sent.error, "Your request was not sent. Check your connection and try again.");
    const left = await apiBoardClient.leaveRoom("g");
    assert.equal(!left.ok && left.error, "That room was not left. Check your connection and try again.");
    const decided = await apiBoardClient.decideRoom("r1", { decision: "approved", note: "", stewardEmail: "", inviterEmail: "" });
    assert.equal(!decided.ok && decided.error, "That decision was not saved. Check your connection and try again.");
  } finally {
    globalThis.fetch = real;
  }
  globalThis.fetch = /** @type {any} */ (
    async () => new Response(JSON.stringify({ error: "Enter a five-digit ZIP." }), { status: 400 })
  );
  try {
    const refused = await apiBoardClient.savePlace({ zip: "1", congregationId: "" });
    assert.equal(!refused.ok && refused.error, "Enter a five-digit ZIP.", "a server reason is kept as is");
  } finally {
    globalThis.fetch = real;
  }
  globalThis.fetch = /** @type {any} */ (
    async () => {
      throw new TypeError("Failed to fetch");
    }
  );
  try {
    const dropped = await apiBoardClient.savePlace({ zip: "33598", congregationId: "" });
    assert.equal(!dropped.ok && dropped.error, "Your place was not saved. Check your connection and try again.");
  } finally {
    globalThis.fetch = real;
  }
  const { settleSave } = await import("../../components/board/home-view.tsx");
  assert.deepEqual(
    await settleSave(async () => {
      throw new TypeError("Failed to fetch");
    }, "Your request was not sent."),
    { ok: false, error: "Your request was not sent. Check your connection and try again." },
  );
});
