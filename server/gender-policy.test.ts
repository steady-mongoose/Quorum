import assert from "node:assert/strict";
import test from "node:test";
import {
  GENDER_POLICY,
  audienceDecision,
  genderWriteDecision,
  isRoomHost,
  parseAudience,
  parseGender,
} from "./gender-policy.ts";

test("the default is that a member sets a gender once and an admin changes it", () => {
  assert.equal(GENDER_POLICY.GENDER_SET_BY, "self");
  assert.equal(GENDER_POLICY.GENDER_REQUIRES_CONFIRMATION, false);
  assert.equal(GENDER_POLICY.GENDER_CHANGE_BY, "admin");
  assert.equal(GENDER_POLICY.GENDER_CHANGE_ALLOWS_SELF, false);
});

test("audience decisions name the refusal and let a steward override", () => {
  assert.deepEqual(parseGender("man"), "man");
  assert.equal(parseGender("person"), null);
  assert.deepEqual(parseAudience("women"), "women");
  assert.equal(parseAudience("members"), null);

  assert.deepEqual(audienceDecision({ audience: "all", stated: null, confirmed: false, canModerate: false }), {
    allow: true,
    override: false,
  });
  const match = audienceDecision({ audience: "men", stated: "man", confirmed: false, canModerate: false });
  assert.deepEqual(match, { allow: true, override: false });
  const unset = audienceDecision({ audience: "women", stated: null, confirmed: false, canModerate: false });
  assert.equal(unset.allow, false);
  if (unset.allow) return;
  assert.equal(unset.code, "gender-unstated");
  const wrong = audienceDecision({ audience: "men", stated: "woman", confirmed: true, canModerate: false });
  assert.equal(wrong.allow, false);
  if (wrong.allow) return;
  assert.equal(wrong.code, "audience");
  assert.equal(wrong.error, "This room is for men.");
  const override = audienceDecision({ audience: "men", stated: "woman", confirmed: false, canModerate: true });
  assert.deepEqual(override, { allow: true, override: true });

  const waiting = audienceDecision(
    { audience: "men", stated: "man", confirmed: false, canModerate: false },
    { ...GENDER_POLICY, GENDER_REQUIRES_CONFIRMATION: true },
  );
  assert.equal(waiting.allow, false);
  if (waiting.allow) return;
  assert.equal(waiting.code, "gender-unconfirmed");
});

test("a first gender follows who may set it, and no one changes it later", () => {
  const base = {
    actorIsInviter: false,
    actorHasNoInviter: true,
    actorIsSteward: false,
    actorIsAdmin: false,
  };
  const self = genderWriteDecision({
    ...base,
    current: null,
    next: "woman",
    actorIsSubject: true,
  });
  assert.deepEqual(self, { ok: true, kind: "set" });
  const other = genderWriteDecision({
    ...base,
    current: null,
    next: "woman",
    actorIsSubject: false,
    actorIsSteward: true,
    actorHasNoInviter: false,
  });
  assert.equal(other.ok, false);

  const same = genderWriteDecision({
    ...base,
    current: "man",
    next: "man",
    actorIsSubject: true,
  });
  assert.deepEqual(same, { ok: true, kind: "same" });
  const changed = genderWriteDecision({
    ...base,
    current: "man",
    next: "woman",
    actorIsSubject: true,
  });
  assert.equal(changed.ok, false);
  if (changed.ok) return;
  assert.equal(changed.error, "This cannot be changed once it is set.");
  const steward = genderWriteDecision({
    ...base,
    current: "man",
    next: "woman",
    actorIsSubject: false,
    actorIsSteward: true,
    actorHasNoInviter: false,
  });
  assert.equal(steward.ok, false);
  if (steward.ok) return;
  assert.equal(steward.error, "This cannot be changed once it is set.");
  const adminSelf = genderWriteDecision({
    ...base,
    current: "man",
    next: "woman",
    actorIsSubject: true,
    actorIsAdmin: true,
  });
  assert.equal(adminSelf.ok, false);
  if (adminSelf.ok) return;
  assert.equal(adminSelf.error, "This cannot be changed once it is set.");
  const admin = genderWriteDecision({
    ...base,
    current: "man",
    next: "woman",
    actorIsSubject: false,
    actorIsAdmin: true,
  });
  assert.equal(admin.ok, false, "an admin cannot edit a member's gender");

  const invited = {
    GENDER_SET_BY: "inviter" as const,
    GENDER_REQUIRES_CONFIRMATION: false,
    GENDER_CHANGE_BY: "steward" as const,
    GENDER_CHANGE_ALLOWS_SELF: false,
  };
  const bySelf = genderWriteDecision(
    {
      current: null,
      next: "man",
      actorIsSubject: true,
      actorIsInviter: false,
      actorHasNoInviter: false,
      actorIsSteward: false,
      actorIsAdmin: false,
    },
    invited,
  );
  assert.equal(bySelf.ok, false);
  const byInviter = genderWriteDecision(
    {
      current: null,
      next: "man",
      actorIsSubject: false,
      actorIsInviter: true,
      actorHasNoInviter: false,
      actorIsSteward: false,
      actorIsAdmin: false,
    },
    invited,
  );
  assert.deepEqual(byInviter, { ok: true, kind: "set" });
  const founder = genderWriteDecision(
    {
      current: null,
      next: "woman",
      actorIsSubject: true,
      actorIsInviter: false,
      actorHasNoInviter: true,
      actorIsSteward: false,
      actorIsAdmin: false,
    },
    invited,
  );
  assert.deepEqual(founder, { ok: true, kind: "set" });
});

test("the host is the person who created the room, or an admin when it was seeded", () => {
  assert.equal(isRoomHost({ createdBy: "josh", userId: "josh", admin: false }), true);
  assert.equal(isRoomHost({ createdBy: "josh", userId: "ida", admin: true }), false);
  assert.equal(isRoomHost({ createdBy: null, userId: "ida", admin: true }), true);
  assert.equal(isRoomHost({ createdBy: "", userId: "maria", admin: false }), false);
});
