import assert from "node:assert/strict";
import test from "node:test";
import { sendHoldAlert, sendTextEmail } from "./alert-mail.ts";
import { claimFromAddress, DEFAULT_CLAIM_FROM } from "./claims.ts";

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
