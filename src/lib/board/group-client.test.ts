import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchGroupAppeals,
  fetchGroupInvites,
  fetchGroupRequests,
  GROUP_LOAD_FAILED,
  GROUP_MFA_NEEDED,
  GROUP_SAVE_FAILED,
  groupFailure,
  parseGroupDetail,
  parseGroupList,
  postGroup,
  runByLine,
} from "./group-client.ts";

const zeta = {
  id: "zeta",
  name: "Zeta",
  about: "Last on purpose.",
  joined: false,
  admin: false,
  score: 99,
  likes: 40,
  reshares: 12,
};

const alpha = {
  id: "alpha",
  name: "Alpha",
  about: "First in the alphabet.",
  joined: true,
  admin: true,
  algorithm: "hot",
};

test("the group list keeps server order and drops rank fields", () => {
  const groups = parseGroupList({ groups: [zeta, alpha] });
  assert.ok(groups);
  if (!groups) return;
  assert.deepEqual(
    groups.map((group) => group.id),
    ["zeta", "alpha"],
  );
  assert.equal("score" in groups[0], false);
  assert.equal("likes" in groups[0], false);
  assert.equal("reshares" in groups[1], false);
  assert.equal(groups[1]?.joined, true);
  assert.equal(parseGroupList({ groups: [{ ...alpha, id: "Alpha" }] }), null);
});

test("a group page keeps post order and the admin names in the order given", () => {
  const detail = parseGroupDetail({
    group: { ...alpha, admins: ["Zoe", "Ada"], score: 3 },
    posts: [
      {
        id: "newer",
        groupId: "alpha",
        author: "Ada",
        body: "Second in the list.",
        on: "",
        at: 20,
        mark: null,
        score: 8,
      },
      {
        id: "older",
        groupId: "alpha",
        author: "Zoe",
        body: "First in the list.",
        on: "2026-10-01",
        at: 10,
        mark: "sloppy",
      },
    ],
    marks: [],
    removals: [],
    next: null,
  });
  assert.ok(detail);
  if (!detail) return;
  assert.deepEqual(
    detail.posts.map((post) => post.id),
    ["newer", "older"],
  );
  assert.deepEqual(detail.group.admins, ["Zoe", "Ada"]);
  assert.equal("score" in detail.posts[0], false);
  assert.equal(runByLine(detail.group.admins), "Run by Zoe and Ada");
  assert.equal(runByLine(["Ada"]), "Run by Ada");
  assert.equal(runByLine(["Ada", "Ben", "Cy"]), "Run by Ada, Ben, and Cy");
  assert.equal(runByLine([]), "");
  assert.equal(parseGroupDetail({ ...detail, posts: [{ id: "x" }] }), null);
});

test("group controls meet the review: 44px, alerts, equal appeal buttons", () => {
  const view = readFileSync(new URL("../../components/board/groups-view.tsx", import.meta.url), "utf8");
  const week = readFileSync(new URL("../../components/board/week-view.tsx", import.meta.url), "utf8");
  const bits = readFileSync(new URL("../../components/quorum/bits.tsx", import.meta.url), "utf8");
  assert.match(week, /inline-flex min-h-\[44px\] items-center rounded-sm bg-raised px-3/);
  assert.match(bits, /export const btn =\n {2}"inline-flex min-h-\[44px\]/);
  assert.match(view, /min-h-\[44px\]/);
  // Groups are joined by invite (0045): no open Join toggle on the list.
  assert.equal(/aria-pressed=\{group\.joined\}/.test(view), false);
  assert.equal(view.includes('"Join"'), false);
  assert.match(view, /Leave group/);
  assert.match(view, /Accept invite/);
  assert.match(view, /Revoke invite/);
  assert.match(view, /role="alert"/);
  assert.match(view, /text-\[#f0b4a4\]/);
  assert.match(view, /<legend>Remove for<\/legend>/);
  assert.match(view, /Why this should be lifted/);
  assert.match(view, /btnGhost[\s\S]*Upheld/);
  assert.match(view, /btnGhost[\s\S]*Lifted/);
  assert.match(view, /text-\[0\.8125rem\]/);
  assert.match(view, /runByLine\(/);
  assert.match(view, /ConfirmDialog/);
  assert.equal(view.includes("text-xs"), false);
  assert.equal(view.includes("text-signal"), false);
  assert.equal(view.includes("Admin:"), false);
  assert.equal(/\blikes?\b|\bscore\b|\breshare\b|\balgorithm\b/i.test(view), false);
});

function answer(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("a failed load says it did not load; only a failed save says it did not save", async () => {
  const realFetch = globalThis.fetch;
  try {
    answer(500, { error: "oops" });
    assert.deepEqual(await fetchGroupRequests(), { ok: false, error: GROUP_LOAD_FAILED });
    assert.deepEqual(await fetchGroupAppeals(), { ok: false, error: GROUP_LOAD_FAILED });
    assert.deepEqual(await fetchGroupInvites("carpentry"), { ok: false, error: GROUP_LOAD_FAILED });
    assert.deepEqual(await postGroup("/api/groups/carpentry/leave", {}), {
      ok: false,
      error: GROUP_SAVE_FAILED,
    });
    assert.equal(GROUP_LOAD_FAILED, "That did not load.");
    assert.equal(GROUP_SAVE_FAILED, "That did not save.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an authenticator 403 on a load keeps the server's sentence and is flagged", async () => {
  const realFetch = globalThis.fetch;
  try {
    answer(403, {
      error: "mfa_required",
      message: "Turn on an authenticator before using this.",
      step: "enroll",
    });
    for (const loaded of [
      await fetchGroupRequests(),
      await fetchGroupAppeals(),
      await fetchGroupInvites("carpentry"),
    ]) {
      assert.deepEqual(loaded, {
        ok: false,
        error: "Turn on an authenticator before using this.",
        mfa: "enroll",
      });
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("groupFailure reads the server's sentence from error, then message, then falls back", () => {
  assert.deepEqual(groupFailure({ error: "That group is not here." }, "x"), {
    error: "That group is not here.",
  });
  assert.deepEqual(groupFailure({ error: "rate", message: "Wait a minute, then try again." }, "x"), {
    error: "Wait a minute, then try again.",
  });
  assert.deepEqual(groupFailure({ error: "oops" }, "fallback here"), { error: "fallback here" });
  assert.deepEqual(groupFailure(null, "fallback here"), { error: "fallback here" });
  assert.deepEqual(groupFailure({ error: "banned" }, "x"), { error: "You are barred from that group." });
  assert.deepEqual(groupFailure({ error: "mfa_required" }, "x"), { error: GROUP_MFA_NEEDED, mfa: "enroll" });
  assert.deepEqual(
    groupFailure(
      { error: "mfa_required", message: "Enter the authenticator code to finish signing in." },
      "x",
    ),
    { error: "Enter the authenticator code to finish signing in.", mfa: "verify" },
  );
  assert.deepEqual(
    groupFailure(
      { error: "mfa_required", message: "Turn on an authenticator before using this.", step: "enroll" },
      "x",
    ),
    { error: GROUP_MFA_NEEDED, mfa: "enroll" },
  );
  assert.deepEqual(
    groupFailure({ error: "mfa_step_up", message: "Enter your authenticator code first." }, "x"),
    { error: "Enter your authenticator code first.", mfa: "verify" },
  );
  assert.deepEqual(
    groupFailure({ error: "mfa_locked", message: "Too many attempts. Wait and try again." }, "x"),
    { error: "Too many attempts. Wait and try again.", mfa: "verify" },
  );
});

test("the enroll fallback is the server's own authenticator wording", () => {
  const store = readFileSync(new URL("../../../server/mfa/store.ts", import.meta.url), "utf8");
  assert.ok(store.includes(`"${GROUP_MFA_NEEDED}"`));
});
