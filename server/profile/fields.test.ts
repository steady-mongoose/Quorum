import assert from "node:assert/strict";
import test from "node:test";
import { ageOn, birthdateError, parseBirthdate } from "./age.ts";
import { parseInterests } from "./interests.ts";
import { parseHttpsUrl, parseLinks } from "./links.ts";
import {
  ADMINS_ONLY_LATER,
  ANONYMOUS_LATER,
  adminsOnlyVisibilityEnabled,
  profileAnonymousEnabled,
} from "./permissions.ts";
import { parseLocation, TOWNS } from "./towns.ts";
import { PROFILE_EXPORT_COLUMNS, fieldVisible } from "./view.ts";

const now = new Date("2026-10-19T15:00:00Z");

test("age is 18 on the birthday and 17 the day before", () => {
  assert.equal(ageOn("2008-10-19", now), 18);
  assert.equal(ageOn("2008-10-20", now), 17);
  assert.equal(birthdateError("2008-10-19", now), null);
  assert.equal(birthdateError("2008-10-20", now), "You must be 18.");
  assert.equal(parseBirthdate("1990-02-31"), null);
  assert.equal(parseBirthdate("1899-01-01"), null);
});

test("links accept https and refuse other schemes", () => {
  assert.equal(parseHttpsUrl("https://example.com/path").ok, true);
  const upper = parseHttpsUrl("HTTPS://Example.com/A");
  assert.equal(upper.ok && upper.url, "https://example.com/A");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "vbscript:msgbox(1)",
    "file:///tmp/a",
    "http://example.com",
    "https://user:pass@example.com",
  ]) {
    const parsed = parseHttpsUrl(url);
    assert.equal(parsed.ok, false, url);
  }
  const many = parseLinks(
    Array.from({ length: 6 }, (_, index) => ({ url: `https://example.com/${index}` })),
  );
  assert.equal(many.ok, false);
  const five = parseLinks([{ url: "https://example.com/a", label: "Shop" }]);
  assert.equal(five.ok, true);
});

test("towns are the fixed list plus Elsewhere", () => {
  assert.equal(parseLocation({ county: "hillsborough", town: "brandon" }).ok, true);
  assert.equal(parseLocation({ county: "hillsborough", town: "bradenton" }).ok, false);
  const elsewhere = parseLocation({ town: "elsewhere" });
  assert.equal(elsewhere.ok && elsewhere.town, "elsewhere");
  assert.equal(
    TOWNS.some((town) => town.county === "pinellas" && town.id === "st-petersburg"),
    true,
  );
  assert.equal(parseInterests(["books", "books", "nope"]).ok, false);
  assert.equal(parseInterests(["books", "lifting"]).ok, true);
});

test("admins-only visibility and the anonymous flag wait for permissions 0025", () => {
  assert.equal(adminsOnlyVisibilityEnabled(), false);
  assert.equal(profileAnonymousEnabled(), false);
  assert.match(ADMINS_ONLY_LATER, /0025/);
  assert.match(ANONYMOUS_LATER, /0025/);
  assert.equal(PROFILE_EXPORT_COLUMNS.includes("birthdate" as never), false);
  assert.equal(
    fieldVisible({ level: "members", self: false, viewerIsAdmin: false, sharesRoom: false }),
    true,
  );
  assert.equal(
    fieldVisible({ level: "shared", self: false, viewerIsAdmin: false, sharesRoom: false }),
    false,
  );
  assert.equal(
    fieldVisible({ level: "shared", self: false, viewerIsAdmin: false, sharesRoom: true }),
    true,
  );
  assert.equal(
    fieldVisible({ level: "private", self: false, viewerIsAdmin: true, sharesRoom: true }),
    false,
  );
  assert.equal(
    fieldVisible({ level: "private", self: true, viewerIsAdmin: false, sharesRoom: false }),
    true,
  );
  assert.equal(
    fieldVisible({ level: "admins", self: false, viewerIsAdmin: false, sharesRoom: true }),
    false,
  );
  assert.equal(
    fieldVisible({ level: "admins", self: false, viewerIsAdmin: true, sharesRoom: false }),
    true,
  );
});
