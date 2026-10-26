import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_ALLOWED_METHODS,
  CLAIM_STEWARD_TRUST_MIN,
  roleAtLeast,
  roleLevel,
  stewardReviewSufficient,
} from "./claim-policy.ts";
import { emailOnOrgDomain, parseListingsCsv } from "./listings.ts";

test("site code is the first claim method and domain email is second", () => {
  assert.deepEqual(CLAIM_ALLOWED_METHODS.slice(0, 2), ["site_code", "domain_email"]);
  assert.equal(CLAIM_ALLOWED_METHODS[0], "site_code");
  assert.equal(CLAIM_STEWARD_TRUST_MIN, "admin");
});

test("trust follows the existing role order and not a score", () => {
  assert.equal(roleLevel({ owner: false, admin: false, steward: false }), "member");
  assert.equal(roleLevel({ owner: false, admin: false, steward: true }), "steward");
  assert.equal(roleLevel({ owner: false, admin: true, steward: true }), "admin");
  assert.equal(roleLevel({ owner: true, admin: true, steward: true }), "owner");
  assert.equal(roleAtLeast("steward", "admin"), false);
  assert.equal(roleAtLeast("admin", "admin"), true);
  assert.equal(roleAtLeast("owner", "admin"), true);
  assert.equal(stewardReviewSufficient("member"), false);
  assert.equal(stewardReviewSufficient("steward"), false);
  assert.equal(stewardReviewSufficient("admin"), true);
  assert.equal(stewardReviewSufficient("owner"), true);
});

test("an org email matches the source host, including a www host", () => {
  assert.equal(emailOnOrgDomain("pastor@grace.example", "https://grace.example/about"), true);
  assert.equal(emailOnOrgDomain("pastor@grace.example", "https://www.grace.example/about"), true);
  assert.equal(emailOnOrgDomain("pastor@gmail.com", "https://grace.example/about"), false);
  assert.equal(emailOnOrgDomain("pastor@example", "https://evil.grace.example/about"), false);
});

test("csv listings keep only the imported columns", () => {
  const parsed = parseListingsCsv(
    "name,town,county,category,source_url\nGrace Hall,Brandon,Hillsborough,Church,https://grace.example/about\n",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.listings[0], {
    name: "Grace Hall",
    town: "Brandon",
    county: "Hillsborough",
    category: "Church",
    sourceUrl: "https://grace.example/about",
    status: "unclaimed",
  });
});
