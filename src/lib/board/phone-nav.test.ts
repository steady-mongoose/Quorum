import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DESKTOP_NAV,
  MORE_ROW_PX,
  MORE_TAB,
  PHONE_TABS,
  TAB_SLOT_PX,
  TOUCH_MIN_PX,
  desktopNav,
  meetsTouchFloor,
  moreEntries,
  moreSheetBackdropTap,
  moreSheetDismisses,
  moreTabCurrent,
  tabAriaCurrent,
} from "./phone-nav.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the phone bar is five slots: This week, Rooms, Find, Messages, More", () => {
  assert.deepEqual(
    PHONE_TABS.map((item) => item.label),
    ["This week", "Rooms", "Find", "Messages"],
  );
  assert.equal(MORE_TAB.label, "More");
  assert.equal(PHONE_TABS.length + 1, 5);
  assert.equal(PHONE_TABS.some((item) => item.id === "civic"), false);
  assert.equal(PHONE_TABS.some((item) => item.id === "profile"), false);
  assert.equal(PHONE_TABS.some((item) => item.id === "about"), false);
});

test("More holds You, The desk only when opted in, and About", () => {
  assert.deepEqual(
    moreEntries(false).map((item) => item.label),
    ["You", "About"],
  );
  assert.deepEqual(
    moreEntries(true).map((item) => item.label),
    ["You", "The desk", "About"],
  );
  assert.equal(moreEntries(false).some((item) => item.id === "civic"), false);
});

test("You, The desk, and About mark the More tab current", () => {
  assert.equal(moreTabCurrent("profile"), true);
  assert.equal(moreTabCurrent("civic"), true);
  assert.equal(moreTabCurrent("about"), true);
  assert.equal(moreTabCurrent("week"), false);
  assert.equal(moreTabCurrent("rooms"), false);
  assert.equal(moreTabCurrent("find"), false);
  assert.equal(moreTabCurrent("messages"), false);
  assert.equal(tabAriaCurrent(true), "page");
  assert.equal(tabAriaCurrent(false), undefined);
});

test("the desktop list hides The desk until it is turned on", () => {
  assert.equal(desktopNav(false).some((item) => item.id === "civic"), false);
  assert.deepEqual(
    desktopNav(true).map((item) => item.id),
    DESKTOP_NAV.map((item) => item.id),
  );
});

test("tab slots and More rows stay at or above the 44px floor", () => {
  assert.equal(TOUCH_MIN_PX, 44);
  assert.equal(meetsTouchFloor(TAB_SLOT_PX), true);
  assert.equal(meetsTouchFloor(MORE_ROW_PX), true);
  assert.ok(TAB_SLOT_PX >= 44);
  assert.ok(MORE_ROW_PX >= 44);
  const fluid = source("../../../public/fluid.css");
  assert.match(fluid, /\.tabbar\{[^}]*display:flex/);
  assert.match(fluid, /flex:1/);
  assert.match(fluid, /min-height:max\(44px,56px\)/);
  assert.match(fluid, /min-width:44px/);
  assert.match(fluid, /font-size:12px/);
  assert.match(fluid, /font-weight:500/);
  assert.match(fluid, /width:24px;height:24px/);
  assert.match(fluid, /border-top:2px solid var\(--gold\)/);
  assert.match(fluid, /color:var\(--fg\)/);
  assert.match(fluid, /color:var\(--muted\)/);
  assert.match(fluid, /env\(safe-area-inset-bottom\)/);
  assert.match(fluid, /\.more-row\{[^}]*min-height:max\(44px,48px\)/);
});

test("a backdrop tap and a downward swipe close More; a row press does not", () => {
  assert.equal(
    moreSheetBackdropTap({
      targetIsDialog: true,
      clientX: 10,
      clientY: 10,
      top: 400,
      right: 390,
      bottom: 700,
      left: 0,
    }),
    true,
  );
  assert.equal(
    moreSheetBackdropTap({
      targetIsDialog: false,
      clientX: 40,
      clientY: 500,
      top: 400,
      right: 390,
      bottom: 700,
      left: 0,
    }),
    false,
  );
  assert.equal(moreSheetDismisses(0, 48), true);
  assert.equal(moreSheetDismisses(0, 47), false);
  assert.equal(moreSheetDismisses(80, 48), false);
  assert.equal(moreSheetDismisses(0, -60), false);
});

test("the phone bar and the sheet use the agreed names and the 44px floor", () => {
  const tabs = source("../../components/board/section-tabs.tsx");
  const app = source("../../components/board/app.tsx");
  const profile = source("../../components/board/profile-view.tsx");
  const store = source("./store.ts");
  const themes = source("./themes.ts");
  const emblem = source("../../components/board/emblem.tsx");
  assert.match(tabs, /aria-label="Primary"/);
  assert.match(tabs, /aria-haspopup="dialog"/);
  assert.match(tabs, /aria-current=\{tabAriaCurrent/);
  assert.match(tabs, /dialog\.showModal\(\)/);
  assert.match(tabs, /onCancel/);
  assert.match(tabs, /event\.target === event\.currentTarget/);
  assert.match(tabs, /moreSheetDismisses/);
  assert.match(tabs, /minHeight: `max\(\$\{TOUCH_MIN_PX\}px, \$\{MORE_ROW_PX\}px\)`/);
  assert.equal(tabs.includes("badge"), false);
  assert.match(profile, /Optional: coordinated calls to local officials\./);
  assert.match(profile, /Show The desk/);
  assert.match(profile, /min-h-\[44px\]/);
  assert.match(store, /deskOn: false/);
  assert.match(store, /deskOn: state\.deskOn/);
  assert.match(app, /<Emblem theme=\{theme\.id\} size="header" \/>/);
  assert.match(themes, /id: "appeal"/);
  assert.match(themes, /id: "gadsden"/);
  assert.match(emblem, /appeal-to-heaven\.svg/);
  assert.match(emblem, /gadsden\.svg/);
  assert.match(emblem, /jerusalem-cross\.svg/);
});
