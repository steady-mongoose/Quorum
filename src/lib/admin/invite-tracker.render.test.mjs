import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

await register(new URL("../../../scripts/tsx-loader.mjs", import.meta.url));

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { InviteTrackerTable, usedLabel } = await import("../../components/board/invite-tracker.tsx");

const row = {
  id: "i1", note: "Shop night", room: "shop", createdBy: "Josh", createdAt: 0, expiresAt: 0,
  uses: 2, maxUses: 5, redeemed: true, redeemedAt: 1_760_000_000_000, redeemedBy: "Ann",
  memberEmail: "ann@example.com", lastSignIn: null,
};

test("the invite table is a labelled, focusable scroll region with a caption and padded cells", () => {
  const html = renderToStaticMarkup(createElement(InviteTrackerTable, { rows: [row] }));
  assert.match(html, /role="region"/);
  assert.match(html, /aria-labelledby="invite-tracker-caption"/);
  assert.match(html, /tabindex="0"/i);
  assert.match(html, /<caption id="invite-tracker-caption"[^>]*>Invite codes/);
  assert.equal((html.match(/<t[dh] [^>]*class="px-3 py-2/g) ?? []).length, 14);
});

test("the Used column shows X of Y and there is no Redeemed column", () => {
  assert.equal(usedLabel({ uses: 2, maxUses: 5 }), "2 of 5");
  const html = renderToStaticMarkup(createElement(InviteTrackerTable, { rows: [row] }));
  assert.match(html, />Used</);
  assert.match(html, />2 of 5</);
  assert.equal(html.includes("Redeemed"), false);
});
