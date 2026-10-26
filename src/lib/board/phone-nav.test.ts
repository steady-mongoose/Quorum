import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MORE_ENTRIES,
  PHONE_TABS,
  desktopNav,
  moreEntries,
  moreTabCurrent,
} from "./phone-nav.ts";

test("Groups is one More entry and not a sixth phone tab", () => {
  assert.deepEqual(
    PHONE_TABS.map((item) => item.label),
    ["This week", "Rooms", "Find", "Messages"],
  );
  assert.equal(PHONE_TABS.length + 1, 5);
  assert.equal(
    PHONE_TABS.map((item) => item.id as string).includes("groups"),
    false,
  );
  assert.equal(moreEntries(true)[0]?.id, "groups");
  assert.equal(moreEntries(true)[0]?.label, "Groups");
  assert.deepEqual(
    moreEntries(true).map((item) => item.id),
    ["groups", "profile", "civic", "about"],
  );
  assert.equal(
    moreEntries(false).some((item) => item.id === "groups"),
    true,
  );
  assert.equal(
    moreEntries(false).some((item) => item.id === "civic"),
    false,
  );
  assert.equal(moreTabCurrent("groups"), true);
  assert.equal(moreTabCurrent("rooms"), false);
  assert.equal(
    desktopNav(true).some((item) => item.id === "groups"),
    true,
  );
  assert.equal(MORE_ENTRIES.filter((item) => item.id === "groups").length, 1);

  const app = readFileSync(new URL("../../components/board/app.tsx", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("../../components/board/section-tabs.tsx", import.meta.url), "utf8");
  assert.match(app, /SectionTabs/);
  assert.match(app, /className="topnav"/);
  assert.match(tabs, /aria-label="More"/);
  assert.match(tabs, /PHONE_TABS\.map/);
  assert.equal(app.includes('{ id: "groups", label: "Groups", icon: Users }'), false);
});
