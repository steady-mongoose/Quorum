import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_NAME } from "./model.ts";
import {
  boardExportDocument,
  canClearBoard,
  clearPhraseMatches,
  localBoardOwner,
} from "./store.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("only an admin or an owner can clear the board", () => {
  assert.equal(canClearBoard({ admin: false, owner: false }), false);
  assert.equal(canClearBoard({ admin: true, owner: false }), true);
  assert.equal(canClearBoard({ admin: false, owner: true }), true);
  assert.equal(canClearBoard({ admin: true, owner: true }), true);
  assert.equal(localBoardOwner({ founded: false }), false);
  assert.equal(localBoardOwner({ founded: true }), true);
});

test("clear stays disabled until the board name or CLEAR is typed", () => {
  assert.equal(clearPhraseMatches("", APP_NAME), false);
  assert.equal(clearPhraseMatches("   ", APP_NAME), false);
  assert.equal(clearPhraseMatches("clear the board", APP_NAME), false);
  assert.equal(clearPhraseMatches("CLEARED", APP_NAME), false);
  assert.equal(clearPhraseMatches("Avouch", APP_NAME), false);
  assert.equal(clearPhraseMatches("CLEAR", APP_NAME), true);
  assert.equal(clearPhraseMatches(" clear ", APP_NAME), true);
  assert.equal(clearPhraseMatches("Clear", APP_NAME), true);
  assert.equal(clearPhraseMatches(APP_NAME, APP_NAME), true);
  assert.equal(clearPhraseMatches("avouch social", APP_NAME), true);
  assert.equal(clearPhraseMatches(`  ${APP_NAME}  `, APP_NAME), true);
});

test("export is a JSON snapshot of the board and has no engagement fields", () => {
  const json = boardExportDocument({
    me: "Josh",
    profile: { household: "the McMullins", parish: "Epiphany", trade: "" },
    rooms: [{ id: "shop", name: "The Shop" }],
    posts: [
      {
        id: "p1",
        room: "shop",
        type: "did",
        claim: "Sharpened the chisels.",
        reason: "Tom checked them.",
        on: "2026-10-20",
        next: "",
        came: [],
        named: "",
        author: "Josh",
        at: 1,
        parentId: null,
        closed: false,
        mark: null,
        removed: false,
      },
    ],
    cards: [],
    threads: [],
    messages: [],
    invites: [{ code: "shop-abc", cardId: "card-1", by: "Josh", at: 2, redeemedBy: "" }],
    bans: [{ id: "ban-1", author: "Dale", reason: "threat", until: 3, strikes: 1, at: 2 }],
    markLog: [],
    removals: [],
    appeals: [],
    reports: [
      {
        id: "report-1",
        postId: "p1",
        room: "shop",
        author: "Dale",
        accountId: "",
        incidentAt: 2,
        retainUntil: 3,
        mediaCount: 0,
        byteSize: 0,
        mediaTypes: [],
        status: "prepared",
        reportId: "",
        filedAt: null,
        filedBy: "",
      },
    ],
  });
  const saved = JSON.parse(json) as {
    name: string;
    me: string;
    posts: { id: string }[];
    rooms: { id: string }[];
    invites: { code: string }[];
    bans: { id: string }[];
    reports: { id: string }[];
  };
  assert.equal(saved.name, APP_NAME);
  assert.equal(saved.me, "Josh");
  assert.equal(saved.posts[0]?.id, "p1");
  assert.equal(saved.rooms[0]?.id, "shop");
  assert.equal(saved.invites[0]?.code, "shop-abc");
  assert.equal(saved.bans[0]?.id, "ban-1");
  assert.equal(saved.reports[0]?.id, "report-1");
  assert.equal(/\b(likes?|reshares?|scores?)\b/i.test(json), false);
});

test("the clear control is gated, typed, and offers export before the wipe", () => {
  const about = source("../../components/board/about-view.tsx");
  const app = source("../../components/board/app.tsx");
  const dialog = source("../../components/board/confirm-dialog.tsx");
  assert.match(about, /canClearBoard\(\{ admin, owner: localBoardOwner/);
  assert.match(about, /\{mayClear \?/);
  assert.match(about, /!clearPhraseMatches\(clearPhrase, APP_NAME\)/);
  assert.match(about, /Export first/);
  assert.match(about, /invites, bans, marks, removals, appeals, and\s+reports/);
  assert.match(about, /downloadBoardExport\(boardSnapshot\(\)\)/);
  assert.match(about, /reports: csamReports/);
  assert.match(about, /clearLocalBoard\(\)/);
  assert.match(about, /undoClearBoard\(\)/);
  assert.match(about, /Type \{APP_NAME\} or CLEAR/);
  assert.match(app, /undoClearBoard\(\)/);
  assert.match(dialog, /disabled=\{confirmDisabled\}/);
  assert.match(dialog, /min-h-\[44px\]/);
});
