import assert from "node:assert/strict";
import test from "node:test";
import {
  RESERVED_FACTOR_KINDS,
  mfaExempt,
  phaseFor,
  privilegedPath,
  roleRequiresMfa,
  stepUpAction,
} from "./policy.ts";

test("passkeys are reserved and TOTP is the live factor", () => {
  assert.deepEqual(RESERVED_FACTOR_KINDS, ["passkey"]);
});

test("step-up covers role grants, claim approval, and export", () => {
  assert.equal(stepUpAction("/api/access", "POST"), "role-grant");
  assert.equal(
    stepUpAction("/api/claims/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/decide", "POST"),
    "claim-approval",
  );
  assert.equal(stepUpAction("/api/admin/export", "GET"), "data-export");
  assert.equal(stepUpAction("/api/admin/stats.csv", "GET"), "data-export");
  assert.equal(stepUpAction("/api/board", "GET"), null);
});

test("a required role without an authenticator is enrollment, and a second step is a challenge", () => {
  assert.equal(phaseFor({ required: true, enrolled: false, verified: false }), "enroll");
  assert.equal(phaseFor({ required: true, enrolled: true, verified: false }), "challenge");
  assert.equal(phaseFor({ required: false, enrolled: true, verified: true }), "ok");
  assert.equal(phaseFor({ required: false, enrolled: false, verified: false }), "ok");
  assert.equal(
    roleRequiresMfa({
      member: true,
      steward: true,
      admin: false,
      owner: false,
      stewardRooms: ["shop"],
    }),
    true,
  );
  assert.equal(
    roleRequiresMfa({
      member: true,
      steward: false,
      admin: false,
      owner: false,
      stewardRooms: [],
    }),
    false,
  );
});

test("enrollment is allowed during the grace period and the hall is not", () => {
  assert.equal(mfaExempt("/api/mfa/enroll/start", "POST"), true);
  assert.equal(mfaExempt("/api/mfa/challenge", "POST"), true);
  assert.equal(mfaExempt("/api/auth/get-session", "GET"), true);
  assert.equal(mfaExempt("/api/board", "GET"), false);
  assert.equal(privilegedPath("/api/bans", "POST"), true);
  assert.equal(privilegedPath("/api/board", "GET"), false);
});
