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
const { AgeStep } = await import("../../components/board/age-step.tsx");
const { addAgeRequiredHandler, noteAgeRequired } = await import("../api-base.ts");
const { parseAgeConfirmed } = await import("../account-result.ts");
const { readFileSync } = await import("node:fs");
const { SessionContext, EMPTY_SERVER_SESSION } = await import("../server-session-state.ts");
const { AGE_INVITE_ERROR, AGE_INVITE_LABEL, AGE_SIGNUP_ERROR, AGE_SIGNUP_LABEL, AGE_STEP_BODY, AGE_STEP_TITLE } =
  await import("./age.ts");
const { useState } = await import("react");

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

test("after a mint the invite box is unticked again, and the code is focused and scrolled clear of the tab bar", async () => {
  /** @type {any[]} */
  const sent = [];
  const session = {
    ...EMPTY_SERVER_SESSION,
    mode: /** @type {const} */ ("live"),
    configured: true,
    user: { id: "josh", name: "Josh", email: "josh@example.com" },
    createInvite: async (/** @type {any} */ input) => {
      sent.push(input);
      return { ok: true, code: `CODE000${sent.length}` };
    },
  };
  const proto = /** @type {any} */ (window.HTMLElement.prototype);
  const original = proto.scrollIntoView;
  /** @type {Array<{ id: string, options: unknown }>} */
  const scrolled = [];
  proto.scrollIntoView = function (/** @type {unknown} */ options) {
    scrolled.push({ id: this.id, options });
  };
  setWidth(390);
  const view = render(
    createElement(SessionContext.Provider, {
      value: /** @type {any} */ (session),
      children: createElement(ServerInvite),
    }),
  );
  try {
    const box = view.host.querySelector('input[type="checkbox"]');
    assert.ok(box instanceof HTMLInputElement);
    assert.match(box.className, /\bcheck-gilt\b/);
    assert.equal(box.className.includes("size-5"), false);
    assert.equal(box.getAttribute("aria-describedby"), null, "no pointer to a missing error");
    const button = [...view.host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Make a code"),
    );
    assert.ok(button);
    act(() => {
      box.click();
    });
    await act(async () => {
      button.click();
    });
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    });
    assert.equal(sent.length, 1);
    assert.equal(box.checked, false, "one confirmation covers one code");
    const code = view.host.querySelector("#invite-code");
    assert.ok(code instanceof HTMLElement);
    assert.equal(code.textContent, "CODE0001");
    assert.equal(code.getAttribute("tabindex"), "-1");
    assert.match(code.className, /scroll-mb-\[calc\(var\(--tabbar-h,64px\)\+env\(safe-area-inset-bottom\)\+16px\)\]/);
    assert.equal(document.activeElement, code);
    assert.match(code.className, /\bminted-code\b/, "the focused code shows the team ring");
    assert.deepEqual(scrolled.at(-1), { id: "invite-code", options: { block: "nearest" } });

    // A second code needs a second tick.
    await act(async () => {
      button.click();
    });
    assert.equal(sent.length, 1);
    assert.equal(view.host.querySelector("#invite-age-error")?.textContent, AGE_INVITE_ERROR);
    assert.equal(document.activeElement, box);
  } finally {
    proto.scrollIntoView = original;
    view.cleanup();
  }
});

/** @param {Element | null} label */
function after(label) {
  return label?.nextElementSibling ?? null;
}

test("the door checks every field in one pass, puts each message by its field, and announces only the first", () => {
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
      const toggle = () =>
        [...view.host.querySelectorAll("button")].find(
          (button) =>
            button.textContent?.includes("I have a code") ||
            button.textContent?.includes("I already have an account"),
        );
      act(() => {
        toggle()?.click();
      });
      const form = view.host.querySelector("form");
      assert.ok(form);
      /** @param {string} selector */
      const input = (selector) => {
        const node = view.host.querySelector(selector);
        assert.ok(node instanceof HTMLInputElement, selector);
        return node;
      };
      const name = input("#sign-up-name");
      const email = input("#sign-in-email");
      const password = input("#sign-in-password");
      const code = input("#invite-code");
      const box = input('input[type="checkbox"]');
      assert.match(box.className, /\bcheck-gilt\b/);
      assert.equal(box.getAttribute("aria-describedby"), null);

      // Everything empty: four messages, each beside its field, one alert, focus on the name.
      act(() => {
        form.requestSubmit();
      });
      assert.equal(sent.length, 0, String(width));
      const nameError = view.host.querySelector("#sign-up-name-error");
      const signError = view.host.querySelector("#sign-in-error");
      const codeError = view.host.querySelector("#invite-code-error");
      const ageError = view.host.querySelector("#age-error");
      assert.equal(after(name.closest("label")), nameError, "name message under the name");
      assert.equal(after(password.closest("label")), signError, "sign message directly under Password");
      assert.equal(after(code.closest("label")), codeError, "code message under the code");
      assert.equal(after(box.closest("label")), ageError, "age message under the box");
      assert.equal(nameError?.textContent, "Enter your name.");
      assert.equal(ageError?.textContent, AGE_SIGNUP_ERROR);
      const alerts = [...form.querySelectorAll('[role="alert"]')];
      assert.deepEqual(alerts, [nameError], "only the first problem is announced");
      assert.equal(document.activeElement, name);
      assert.equal(name.getAttribute("aria-describedby"), "sign-up-name-error");
      assert.equal(box.getAttribute("aria-describedby"), "age-error");
      for (const field of [name, email, password, code, box]) {
        assert.equal(field.getAttribute("aria-invalid"), "true", field.id || field.type);
      }

      // Name filled, the rest empty: the sign message is now the one announced, and email gets focus.
      act(() => {
        setValue(name, "Maria");
      });
      act(() => {
        form.requestSubmit();
      });
      assert.deepEqual([...form.querySelectorAll('[role="alert"]')], [view.host.querySelector("#sign-in-error")]);
      assert.equal(document.activeElement, email);

      // Only the box left: the age message is announced and the box gets focus.
      act(() => {
        setValue(email, "maria@example.com");
        setValue(password, "correct-horse");
        setValue(code, "ABCDEFGH");
      });
      act(() => {
        form.requestSubmit();
      });
      assert.deepEqual([...form.querySelectorAll('[role="alert"]')], [view.host.querySelector("#age-error")]);
      assert.equal(document.activeElement, box);
      assert.equal(sent.length, 0);

      // The mode toggle clears the age error.
      act(() => {
        toggle()?.click();
      });
      act(() => {
        toggle()?.click();
      });
      assert.equal(view.host.querySelector("#age-error"), null);
      assert.equal(input('input[type="checkbox"]').getAttribute("aria-invalid"), null);
    } finally {
      view.cleanup();
    }
  }
});

test("in sign-in mode the empty message sits directly under Password", () => {
  const session = { ...EMPTY_SERVER_SESSION, mode: /** @type {const} */ ("live"), configured: true };
  const view = render(
    createElement(SessionContext.Provider, {
      value: /** @type {any} */ (session),
      children: createElement(AccountDoor),
    }),
  );
  try {
    const form = view.host.querySelector("form");
    assert.ok(form);
    act(() => {
      form.requestSubmit();
    });
    const password = view.host.querySelector("#sign-in-password");
    const signError = view.host.querySelector("#sign-in-error");
    assert.ok(signError);
    assert.equal(password?.closest("label")?.nextElementSibling, signError);
    assert.equal(signError.getAttribute("role"), "alert");
  } finally {
    view.cleanup();
  }
});

/**
 * A stand-in for the app: the step shows while ageConfirmed is false and the
 * session's confirmAge flips it, the way ServerSessionProvider does. When
 * log.hold is set, confirmAge and signOut wait on it.
 * @param {{ log: { calls: unknown[], signOuts: number[], hold?: Promise<void> } }} props
 */
function AgeHarness({ log }) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const session = {
    ...EMPTY_SERVER_SESSION,
    mode: /** @type {const} */ ("live"),
    configured: true,
    user: { id: "ada", name: "Ada", email: "ada@example.com" },
    ageConfirmed,
    confirmAge: async (/** @type {boolean} */ adult) => {
      log.calls.push(adult);
      if (log.hold) await log.hold;
      setAgeConfirmed(true);
      return { ok: true };
    },
    signOut: async () => {
      log.signOuts.push(1);
      if (log.hold) await log.hold;
    },
  };
  return createElement(SessionContext.Provider, {
    value: /** @type {any} */ (session),
    children: ageConfirmed
      ? createElement(
          "main",
          { id: "main", tabIndex: -1 },
          createElement("h1", { id: "hall", tabIndex: -1 }, "The hall"),
        )
      : createElement(AgeStep),
  });
}

test("the age step lands on its heading with no alert, and an unticked Continue sends nothing", async () => {
  for (const width of WIDTHS) {
    setWidth(width);
    /** @type {{ calls: unknown[], signOuts: number[] }} */
    const log = { calls: [], signOuts: [] };
    const view = render(createElement(AgeHarness, { log }));
    try {
      const heading = view.host.querySelector("h1");
      assert.ok(heading instanceof HTMLElement);
      assert.equal(heading.textContent, AGE_STEP_TITLE);
      assert.equal(heading.getAttribute("tabindex"), "-1");
      assert.equal(document.activeElement, heading, "focus starts on the heading");
      assert.equal(view.host.querySelector('[role="alert"]'), null, "no alert on load");
      assert.ok(view.host.textContent?.includes(AGE_STEP_BODY));
      const box = view.host.querySelector('input[type="checkbox"]');
      assert.ok(box instanceof HTMLInputElement);
      assert.equal(box.checked, false);
      assert.match(box.className, /\bcheck-gilt\b/);
      assert.equal(box.getAttribute("aria-describedby"), null);
      const label = box.closest("label");
      assert.match(label?.textContent ?? "", new RegExp(AGE_SIGNUP_LABEL));
      assert.match(label?.className ?? "", /min-h-\[44px\]/);
      const buttons = [...view.host.querySelectorAll("button")];
      assert.deepEqual(
        buttons.map((b) => b.textContent),
        ["Continue", "Sign out"],
        "no skip",
      );
      for (const button of buttons) assert.match(button.className, /min-h-\[44px\]/);

      const form = view.host.querySelector("form");
      assert.ok(form);
      await act(async () => {
        form.requestSubmit();
      });
      assert.equal(log.calls.length, 0);
      const error = view.host.querySelector("#age-step-error");
      assert.equal(error?.getAttribute("role"), "alert");
      assert.equal(error?.textContent, AGE_SIGNUP_ERROR);
      assert.equal(label?.nextElementSibling, error);
      assert.equal(box.getAttribute("aria-invalid"), "true");
      assert.equal(box.getAttribute("aria-describedby"), "age-step-error");
      assert.equal(document.activeElement, box);
    } finally {
      view.cleanup();
    }
  }
});

test("a ticked Continue sends true once and the step is gone; Sign out signs out", async () => {
  /** @type {{ calls: unknown[], signOuts: number[] }} */
  const log = { calls: [], signOuts: [] };
  const view = render(createElement(AgeHarness, { log }));
  try {
    const signOut = [...view.host.querySelectorAll("button")].find((b) => b.textContent === "Sign out");
    assert.ok(signOut);
    await act(async () => {
      signOut.click();
    });
    assert.equal(log.signOuts.length, 1);
    assert.equal(log.calls.length, 0, "signing out confirms nothing");

    const box = view.host.querySelector('input[type="checkbox"]');
    assert.ok(box instanceof HTMLInputElement);
    act(() => {
      box.click();
    });
    const form = view.host.querySelector("form");
    assert.ok(form);
    await act(async () => {
      form.requestSubmit();
    });
    assert.deepEqual(log.calls, [true]);
    assert.equal(view.host.querySelector("#age-step"), null, "never shown again");
    const hall = view.host.querySelector("#hall");
    assert.ok(hall);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(document.activeElement, hall, "focus lands on the view's heading");
  } finally {
    view.cleanup();
  }
});

test("a 403 age_required from any route brings the step back; other answers do not", async () => {
  let hits = 0;
  const stop = addAgeRequiredHandler(() => {
    hits += 1;
  });
  try {
    await noteAgeRequired(new Response(JSON.stringify({ error: "age_required" }), { status: 403 }));
    assert.equal(hits, 1);
    await noteAgeRequired(new Response(JSON.stringify({ error: "mfa_required" }), { status: 403 }));
    await noteAgeRequired(new Response(JSON.stringify({ error: "age_required" }), { status: 400 }));
    await noteAgeRequired(new Response("not json", { status: 403 }));
    assert.equal(hits, 1);
  } finally {
    stop();
  }
  assert.equal(parseAgeConfirmed({ user: {}, ageConfirmed: false }), false);
  assert.equal(parseAgeConfirmed({ user: {}, ageConfirmed: true }), true);
  assert.equal(parseAgeConfirmed({ user: {} }), true);
  assert.equal(parseAgeConfirmed(null), true);
  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  assert.match(app, /const ageDue = server\.mode === "live" && Boolean\(server\.user\) && !server\.ageConfirmed;/);
  assert.match(app, /\{ageDue \? <AgeStep \/> : null\}/);
  assert.match(app, /\{!entered && !ageDue && <Door \/>\}/);
});

test("a pending Continue keeps focus, says busy, and sends once; Sign out ignores a double tap", async () => {
  /** @type {() => void} */
  let release = () => {};
  /** @type {{ calls: unknown[], signOuts: number[], hold?: Promise<void> }} */
  const log = {
    calls: [],
    signOuts: [],
    hold: new Promise((resolve) => {
      release = () => resolve(undefined);
    }),
  };
  const view = render(createElement(AgeHarness, { log }));
  try {
    const box = view.host.querySelector('input[type="checkbox"]');
    assert.ok(box instanceof HTMLInputElement);
    act(() => {
      box.click();
    });
    const buttons = [...view.host.querySelectorAll("button")];
    const next = buttons.find((b) => b.textContent === "Continue");
    const out = buttons.find((b) => b.textContent === "Sign out");
    assert.ok(next && out);
    assert.equal(next.hasAttribute("disabled"), false);
    assert.equal(next.getAttribute("aria-disabled"), null);
    const form = view.host.querySelector("form");
    assert.ok(form);
    next.focus();
    await act(async () => {
      form.requestSubmit();
    });
    assert.equal(next.getAttribute("aria-disabled"), "true");
    assert.equal(next.getAttribute("aria-busy"), "true");
    assert.equal(next.hasAttribute("disabled"), false, "not disabled, so focus does not drop");
    assert.equal(document.activeElement, next);
    await act(async () => {
      form.requestSubmit();
    });
    assert.deepEqual(log.calls, [true], "a second submit while pending sends nothing");

    await act(async () => {
      out.click();
    });
    await act(async () => {
      out.click();
    });
    assert.equal(log.signOuts.length, 1, "a double tap signs out once");
    assert.equal(out.getAttribute("aria-disabled"), "true");
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  } finally {
    view.cleanup();
  }
});

/**
 * The body of the first rule whose selector is exactly `selector`, with spaces collapsed.
 * @param {string} css
 * @param {string} selector
 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} is defined`);
  return (match[1] ?? "").replace(/\s+/g, " ").trim();
}

test(".check-gilt is pinned: gilt box, fill, invalid border, team ring, and the system box in forced colors", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const base = ruleBody(css, ".check-gilt");
  assert.match(base, /appearance: none;/);
  assert.match(base, /border: 2px solid var\(--color-line-strong, #8a7a62\);/);
  const ticked = ruleBody(css, ".check-gilt:checked");
  assert.match(ticked, /background: #c9a45c;/);
  assert.match(ticked, /border-color: #c9a45c;/);
  assert.match(ruleBody(css, ".check-gilt::before"), /background: #1f1912;/);
  assert.match(ruleBody(css, ".check-gilt:checked::before"), /transform: scale\(1\);/);
  assert.match(ruleBody(css, '.check-gilt[aria-invalid="true"]'), /border-color: #f0b4a4;/);
  const ring = ruleBody(css, ".check-gilt:focus-visible");
  assert.match(ring, /outline: 2px solid #f0e7d3;/);
  assert.match(ring, /outline-offset: 2px;/);
  const forced = /@media \(forced-colors: active\)\s*\{\s*\.check-gilt\s*\{([^}]*)\}/.exec(css);
  assert.ok(forced, "a forced-colors fallback exists");
  assert.match(forced[1] ?? "", /appearance: auto;/);
  const minted = ruleBody(css, ".minted-code:focus");
  assert.match(minted, /outline: 2px solid #f0e7d3;/);
  assert.match(minted, /outline-offset: 2px;/);
});

test("the phone tab bar height is defined for things that must clear it", () => {
  const css = readFileSync(new URL("../../../public/fluid.css", import.meta.url), "utf8");
  const phone = css.indexOf("@media (max-width:767px){\n  /* The tab bar");
  assert.ok(phone > -1);
  assert.match(css.slice(phone, phone + 200), /:root\{--tabbar-h:57px\}/);
});

test("an admin with no authenticator ticks the box, presses Continue, and is through to the app (real server, no dead end)", async () => {
  const { randomUUID } = await import("node:crypto");
  // By file URL, so Node strips the server's types itself (the TSX loader only takes src/).
  const { createApp } = await import(new URL("../../../server/http.ts", import.meta.url).href);
  const { openTestDb } = await import(new URL("../../../server/closed-test/test-db.ts", import.meta.url).href);
  const { confirmAgeServer } = await import("../account-api.ts");
  const { db, close } = await openTestDb({ ageUnconfirmed: true });
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Josh', 'admin@example.com', true, now(), now())`,
    [id],
  );
  // An admin from before the 18+ check, with no authenticator on yet.
  await db.query(`insert into member_role (user_id, is_admin) values ($1, true)`, [id]);
  const app = createApp({
    db,
    origins: ["http://localhost"],
    now: () => new Date("2026-10-30T11:00:00Z"),
    createAccount: async () => ({ id: randomUUID() }),
    signIn: async () => ({ ok: false }),
    readSession: async () => ({ id, name: "Josh", email: "admin@example.com" }),
    forwardAuth: async () => new Response("no", { status: 404 }),
  });
  /** @type {string[]} */
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      sent.push(`${init?.method ?? "GET"} ${url.pathname}`);
      const headers = new Headers(init?.headers);
      headers.set("origin", "http://localhost");
      return app(new Request(`http://127.0.0.1:8787${url.pathname}`, { ...init, headers }));
    }
  );

  function AdminHarness() {
    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const session = {
      ...EMPTY_SERVER_SESSION,
      mode: /** @type {const} */ ("live"),
      configured: true,
      user: { id, name: "Josh", email: "admin@example.com" },
      mfa: /** @type {const} */ ("enroll"),
      mfaEnrolled: false,
      ageConfirmed,
      confirmAge: async (/** @type {boolean} */ adult) => {
        const result = await confirmAgeServer(adult);
        if (result.ok) setAgeConfirmed(true);
        return result;
      },
    };
    return createElement(SessionContext.Provider, {
      value: /** @type {any} */ (session),
      children: ageConfirmed
        ? createElement("main", { id: "main", tabIndex: -1 }, createElement("h1", { id: "hall", tabIndex: -1 }, "The hall"))
        : createElement(AgeStep),
    });
  }

  try {
    for (const width of [390, 1280]) {
      setWidth(width);
      await db.query(`update "user" set age_confirmed_at = null where id = $1`, [id]);
      sent.length = 0;
      const view = render(createElement(AdminHarness));
      try {
        const box = view.host.querySelector('input[type="checkbox"]');
        assert.ok(box instanceof HTMLInputElement);
        act(() => {
          box.click();
        });
        const form = view.host.querySelector("form");
        assert.ok(form);
        await act(async () => {
          form.requestSubmit();
          await new Promise((resolve) => setTimeout(resolve, 200));
        });
        assert.deepEqual(sent, ["POST /api/age/confirm"]);
        assert.doesNotMatch(
          view.host.textContent ?? "",
          /Turn on an authenticator before using this/,
          `${width}: no dead end`,
        );
        assert.equal(view.host.querySelector("#age-step"), null, `${width}: the step is gone`);
        assert.ok(view.host.querySelector("#hall"), `${width}: through to the app`);
        const stored = await db.query(`select age_confirmed_at from "user" where id = $1`, [id]);
        assert.notEqual(/** @type {any} */ (stored[0])?.age_confirmed_at, null);
      } finally {
        view.cleanup();
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    await close();
  }
});
