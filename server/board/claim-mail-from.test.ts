import assert from "node:assert/strict";
import test from "node:test";
import { sendHoldAlert, sendTextEmail } from "./alert-mail.ts";
import { CLAIM_REPLY_TO, claimFromAddress, claimMail, DEFAULT_CLAIM_FROM, deliverCode, isValidFrom, warnInvalidClaimFrom } from "./claims.ts";

const SAFETY = "Avouch Social Safety <safety@example.com>";
const CLAIM = "Avouch Social <noreply@example.com>";

function capture() {
  const froms: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    froms.push(JSON.parse(String(init?.body)).from);
    return new Response("{}", { status: 200 });
  };
  return { froms, fetchImpl };
}
const mail = { to: "a@example.com", subject: "s", text: "t", idempotencyKey: "k" };

test("claim mail uses RESEND_CLAIM_FROM when it is set", async () => {
  const env = { RESEND_API_KEY: "re_test", RESEND_FROM: SAFETY, RESEND_CLAIM_FROM: CLAIM };
  assert.equal(claimFromAddress(env), CLAIM);
  const { froms, fetchImpl } = capture();
  await sendTextEmail(mail, { env, fetch: fetchImpl }, claimFromAddress(env));
  assert.deepEqual(froms, [CLAIM]);
});

test("claim mail falls back to the fixed noreply sender when RESEND_CLAIM_FROM is unset or blank", async () => {
  assert.equal(DEFAULT_CLAIM_FROM, "Avouch Social <noreply@avouchsocial.com>");
  for (const env of [
    { RESEND_API_KEY: "re_test", RESEND_FROM: SAFETY },
    { RESEND_API_KEY: "re_test", RESEND_FROM: SAFETY, RESEND_CLAIM_FROM: "  " },
    { RESEND_API_KEY: "re_test" },
  ]) {
    assert.equal(claimFromAddress(env), DEFAULT_CLAIM_FROM);
    const { froms, fetchImpl } = capture();
    await sendTextEmail(mail, { env, fetch: fetchImpl }, claimFromAddress(env));
    assert.deepEqual(froms, [DEFAULT_CLAIM_FROM]);
  }
});

test("claim mail never uses RESEND_FROM", () => {
  for (const env of [
    { RESEND_FROM: SAFETY },
    { RESEND_FROM: SAFETY, RESEND_CLAIM_FROM: "" },
    { RESEND_FROM: SAFETY, RESEND_CLAIM_FROM: CLAIM },
  ]) {
    assert.notEqual(claimFromAddress(env), SAFETY);
  }
});

test("the CSAM hold alert always uses RESEND_FROM", async () => {
  const env = {
    RESEND_API_KEY: "re_test",
    ADMIN_ALERT_EMAIL: "josh@example.com",
    RESEND_FROM: SAFETY,
    RESEND_CLAIM_FROM: CLAIM,
  };
  const { froms, fetchImpl } = capture();
  await sendHoldAlert(
    { id: "a1", kind: "csam_hold", holdId: "h", roomId: "r", postId: "p" },
    { env, fetch: fetchImpl },
  );
  assert.deepEqual(froms, [SAFETY]);
});

test("the claim email body lines are in order", () => {
  const { text } = claimMail("Shop Co", "123456");
  const lines = text.split("\n");
  assert.deepEqual(lines.slice(1), [
    "The code is 123456.",
    "It expires in 24 hours.",
    "Enter this code on the page where you asked to claim Shop Co.",
    "If you did not ask, ignore this message.",
  ]);
  assert.match(lines[0], /^Someone asked to claim Shop Co on /);
});

function captureBodies() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  };
  return { bodies, fetchImpl };
}

test("claim-code mail sets reply_to contact@avouchsocial.com", async () => {
  assert.equal(CLAIM_REPLY_TO, "contact@avouchsocial.com");
  const env = { RESEND_API_KEY: "re_test", RESEND_CLAIM_FROM: CLAIM };
  const { bodies, fetchImpl } = captureBodies();
  const sent = await deliverCode(
    { env, fetch: fetchImpl },
    { to: "owner@shop.example", name: "Shop Co", code: "123456", claimId: "c1" },
  );
  assert.deepEqual(sent, { ok: true });
  assert.equal(bodies[0].reply_to, "contact@avouchsocial.com");
  assert.equal(bodies[0].from, CLAIM);
});

test("the CSAM hold alert never has a reply_to", async () => {
  const env = {
    RESEND_API_KEY: "re_test",
    ADMIN_ALERT_EMAIL: "josh@example.com",
    RESEND_FROM: SAFETY,
    RESEND_CLAIM_FROM: CLAIM,
  };
  for (const kind of ["csam_hold", "csam_pending_seal"] as const) {
    const { bodies, fetchImpl } = captureBodies();
    await sendHoldAlert({ id: "a1", kind, holdId: "h", roomId: "r", postId: "p" }, { env, fetch: fetchImpl });
    assert.equal(bodies.length, 1);
    assert.equal("reply_to" in bodies[0], false);
  }
});

test("a malformed RESEND_CLAIM_FROM uses the noreply default and warns at startup", () => {
  assert.equal(isValidFrom(CLAIM), true);
  assert.equal(isValidFrom("noreply@example.com"), true);
  for (const bad of ["noreply", "Avouch <noreply>", "a b@c.com", "<x@y.com", "Name x@y.com>"]) {
    assert.equal(isValidFrom(bad), false, bad);
    assert.equal(claimFromAddress({ RESEND_FROM: SAFETY, RESEND_CLAIM_FROM: bad }), DEFAULT_CLAIM_FROM);
    const logs: string[] = [];
    warnInvalidClaimFrom({ RESEND_CLAIM_FROM: bad }, (m) => logs.push(m));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /RESEND_CLAIM_FROM is not a valid From address/);
  }
  const quiet: string[] = [];
  warnInvalidClaimFrom({}, (m) => quiet.push(m));
  warnInvalidClaimFrom({ RESEND_CLAIM_FROM: CLAIM }, (m) => quiet.push(m));
  assert.equal(quiet.length, 0);
});
