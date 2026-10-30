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
  desktopMore,
  desktopMoreCurrent,
  desktopNav,
  meetsTouchFloor,
  menuFocusIndex,
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
  const phoneIds = PHONE_TABS.map((item) => item.id as string);
  assert.equal(phoneIds.includes("civic"), false);
  assert.equal(phoneIds.includes("profile"), false);
  assert.equal(phoneIds.includes("about"), false);
});

test("More holds Groups, You, The desk only when opted in, and About", () => {
  assert.deepEqual(
    moreEntries(false).map((item) => item.label),
    ["Groups", "You", "About"],
  );
  assert.deepEqual(
    moreEntries(true).map((item) => item.label),
    ["Groups", "You", "The desk", "About"],
  );
  assert.equal(moreEntries(false).some((item) => item.id === "groups"), true);
  assert.equal(moreEntries(false).some((item) => item.id === "civic"), false);
  assert.equal(
    PHONE_TABS.map((item) => item.id as string).includes("groups"),
    false,
  );
});

test("Groups, You, The desk, and About mark the More tab current", () => {
  assert.equal(moreTabCurrent("groups"), true);
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

test("the desktop header is six items, and More holds The desk and About", () => {
  assert.deepEqual(
    DESKTOP_NAV.map((item) => item.id),
    ["week", "rooms", "groups", "find", "messages", "profile"],
  );
  const headerIds = DESKTOP_NAV.map((item) => item.id as string);
  assert.equal(headerIds.includes("civic"), false);
  assert.equal(headerIds.includes("about"), false);
  assert.deepEqual(
    desktopNav(false).map((item) => item.id),
    DESKTOP_NAV.map((item) => item.id),
  );
  assert.deepEqual(
    desktopNav(true).map((item) => item.id),
    DESKTOP_NAV.map((item) => item.id),
  );
  assert.deepEqual(
    desktopMore(false).map((item) => item.label),
    ["About"],
  );
  assert.deepEqual(
    desktopMore(true).map((item) => item.label),
    ["The desk", "About"],
  );
  assert.equal(desktopMoreCurrent("civic"), true);
  assert.equal(desktopMoreCurrent("about"), true);
  assert.equal(desktopMoreCurrent("groups"), false);
  assert.equal(desktopMoreCurrent("profile"), false);
  assert.equal(desktopMoreCurrent("week"), false);
  assert.equal(menuFocusIndex(0, 2, "ArrowDown"), 1);
  assert.equal(menuFocusIndex(1, 2, "ArrowDown"), 0);
  assert.equal(menuFocusIndex(0, 2, "ArrowUp"), 1);
  assert.equal(menuFocusIndex(-1, 2, "ArrowDown"), 0);
  assert.equal(menuFocusIndex(-1, 2, "ArrowUp"), 1);
  assert.equal(menuFocusIndex(1, 2, "Home"), 0);
  assert.equal(menuFocusIndex(0, 2, "End"), 1);
  assert.equal(menuFocusIndex(0, 2, "Tab"), null);
  assert.equal(menuFocusIndex(0, 0, "ArrowDown"), null);

  const more = source("../../components/board/desktop-more.tsx");
  const app = source("../../components/board/app.tsx");
  assert.match(more, /aria-haspopup="dialog"/);
  assert.match(more, /aria-expanded=\{open\}/);
  assert.match(more, /aria-current=\{tabAriaCurrent\(active\)\}/);
  assert.match(more, /menuFocusIndex/);
  assert.match(more, /moreRef\.current\?\.focus\(\)/);
  assert.match(more, /\[aria-current="page"\]/);
  assert.match(more, /onCancel/);
  assert.match(app, /flex-nowrap/);
  assert.match(app, /<DesktopMore/);
  assert.match(app, /max-\[1099px\]:hidden/);
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
  assert.match(fluid, /font-size:min\(\.75rem,15px\)/);
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
  assert.match(app, /<AppealMark \/>/);
  assert.equal(app.includes('size="header"'), false);
  const markAt = app.indexOf("<AppealMark />");
  const nameAt = app.indexOf("{APP_NAME}");
  assert.ok(markAt > -1 && nameAt > markAt);
  // Signed in, the tagline was cut off beside the nav, so it shows only signed out.
  assert.match(app, /\{entered \? null : <p className="mast-tagline">\{TAGLINE\}<\/p>\}/);
  assert.equal(app.includes("lg:whitespace-nowrap"), false);
  const css = source("../../../public/fluid.css");
  assert.match(css, /\.mast\{[^}]*padding-block:0\.75rem/);
  assert.match(css, /@media \(max-width:1279px\)\{[^}]*\.mast\[data-entered="true"\] \.mast-tagline\{display:none\}/);
  assert.match(css, /--flag-h:clamp\(36px,4\.5vw,56px\)/);
  assert.match(css, /\.mast-flag\{[^}]*height:var\(--flag-h\)/);
  assert.match(emblem, /src="\/flags\/appeal-to-heaven-gold\.svg"/);
  assert.match(emblem, /className="mast-flag"/);
  const svg = source("../../../public/flags/appeal-to-heaven-gold.svg");
  assert.equal(svg.includes("clipPath"), false);
  assert.equal(svg.includes("clip-path"), false);
  const box = svg.match(/viewBox="([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+)"/);
  assert.ok(box);
  assert.ok(Number(box[3]) < 400 && Number(box[3]) > 200);
  assert.ok(Number(box[4]) < 450 && Number(box[4]) > 300);
  assert.match(themes, /id: "appeal"/);
  assert.match(themes, /id: "gadsden"/);
  assert.match(emblem, /appeal-to-heaven\.svg/);
  assert.match(emblem, /gadsden\.svg/);
  assert.match(emblem, /jerusalem-cross\.svg/);
  assert.equal(app.includes('{ id: "groups", label: "Groups", icon: Users }'), false);
  assert.match(tabs, /groups: Users/);
});
