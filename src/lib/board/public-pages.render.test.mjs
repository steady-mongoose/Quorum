import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { GlobalWindow } = await import("happy-dom");
const window = new GlobalWindow({ url: "http://localhost/about", width: 390, height: 844 });
const browser = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLAnchorElement",
  "Node",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
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
const { LEGAL_NOTICE_PLACEHOLDER, LEGAL_NOTICE_UPDATED } =
  await import("../../components/board/legal-notice.tsx");

/**
 * @param {import("@tanstack/react-router").AnyRoute} route
 */
function renderRoute(route) {
  const Page = route.options.component;
  if (typeof Page !== "function") throw new Error(`no page on ${route.id}`);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Page));
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

function footerLinks() {
  return ["/about", "/privacy", "/terms"].map((href) => {
    const link = document.querySelector(`footer a[href="${href}"]`);
    assert.ok(link instanceof HTMLAnchorElement, href);
    assert.match(link.className, /inline-flex/);
    assert.match(link.className, /min-h-\[44px\]/);
    assert.match(link.className, /items-center/);
    return link;
  });
}

test("about renders signed out, with no account", async () => {
  const { Route } = await import("../../routes/about.tsx");
  const cleanup = renderRoute(Route);
  try {
    const text = document.body.textContent ?? "";
    assert.match(text, /What we stand for/);
    assert.match(text, /Avouch Social exists so you can see what is happening in your community/);
    assert.match(text, /Josh files that report by hand/);
    assert.equal(text.includes("Invite someone"), false);
    assert.equal(text.includes("Your name, as it appears on your posts"), false);
    assert.equal(text.includes("Clear the board"), false);
    assert.equal(text.includes("Export first"), false);
    assert.equal(text.includes("Clear it"), false);
    assert.equal(text.includes("Keep it"), false);
    assert.equal(text.includes("Put the board back"), false);
    assert.equal(document.querySelector('input[placeholder="Your name"]'), null);
    assert.equal(document.querySelector("dialog"), null);
    assert.equal(document.querySelector("#sign-in"), null);
    footerLinks();
  } finally {
    cleanup();
  }
});

test("the member about page still shows the You section", async () => {
  const { AboutView } = await import("../../components/board/about-view.tsx");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(AboutView));
  });
  try {
    const text = document.body.textContent ?? "";
    assert.match(text, /What we stand for/);
    assert.match(text, /Your name, as it appears on your posts/);
    assert.ok(document.querySelector('input[placeholder="Your name"]'));
    assert.match(text, /Clear the board/);
    assert.match(text, /Export first/);
    assert.match(text, /Josh files that report by hand/);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test("privacy and terms render the placeholder signed out", async () => {
  const { Route: privacyRoute } = await import("../../routes/privacy.tsx");
  const privacy = renderRoute(privacyRoute);
  try {
    assert.equal((document.body.textContent ?? "").includes("Placeholder"), false);
    assert.match(document.body.textContent ?? "", /We are finishing this notice\./);
    assert.match(
      document.body.textContent ?? "",
      new RegExp(LEGAL_NOTICE_UPDATED.replace(".", "\\.")),
    );
    assert.match(document.body.textContent ?? "", /Privacy/);
    assert.equal(
      /we collect|personal data|liability|governing law/i.test(document.body.textContent ?? ""),
      false,
    );
    footerLinks();
  } finally {
    privacy();
  }

  const { Route: termsRoute } = await import("../../routes/terms.tsx");
  const terms = renderRoute(termsRoute);
  try {
    assert.equal((document.body.textContent ?? "").includes("Placeholder"), false);
    assert.equal(document.body.textContent?.includes(LEGAL_NOTICE_PLACEHOLDER), true);
    assert.equal(document.body.textContent?.includes(LEGAL_NOTICE_UPDATED), true);
    assert.match(document.body.textContent ?? "", /Terms/);
    assert.equal(
      /we collect|personal data|liability|governing law/i.test(document.body.textContent ?? ""),
      false,
    );
    footerLinks();
  } finally {
    terms();
  }
});
