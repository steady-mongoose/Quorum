import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ALERT_EMAIL_TIMEOUT_MS, sendHoldAlert } from "./alert-mail.ts";
import type { HoldAlert } from "./csam.ts";

const alert: HoldAlert = {
  id: "alert-1",
  kind: "csam_pending_seal",
  holdId: "hold-1",
  roomId: "shop",
  postId: "post-1",
};

const claim = "Sharpened the chisels in the shop on Thursday afternoon.";

function configured(partial: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    RESEND_API_KEY: "re_test",
    ADMIN_ALERT_EMAIL: "josh@example.com",
    RESEND_FROM: "Avouch Social <alerts@example.com>",
    ...partial,
  };
}

test("a hold alert email is skipped when Resend is not configured", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  await sendHoldAlert(alert, { fetch: fetchImpl, env: {} });
  await sendHoldAlert(alert, { fetch: fetchImpl, env: configured({ RESEND_API_KEY: "" }) });
  await sendHoldAlert(alert, { fetch: fetchImpl, env: configured({ ADMIN_ALERT_EMAIL: "  " }) });
  await sendHoldAlert(alert, { fetch: fetchImpl, env: configured({ RESEND_FROM: "" }) });
  assert.equal(calls, 0);
});

test("a hold alert email posts metadata to Resend and does not throw", async () => {
  const bodies: string[] = [];
  const keys: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer re_test");
    keys.push(headers.get("idempotency-key") ?? "");
    bodies.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  };
  await sendHoldAlert(alert, { fetch: fetchImpl, env: configured() });
  await sendHoldAlert({ ...alert, kind: "csam_hold" }, { fetch: fetchImpl, env: configured() });
  assert.equal(keys[0], "csam-admin-alert/alert-1");
  assert.equal(keys[1], "csam-admin-alert/alert-1");
  const first = JSON.parse(bodies[0] ?? "{}") as {
    from: string;
    to: string[];
    subject: string;
    text: string;
  };
  assert.equal(first.from, "Avouch Social <alerts@example.com>");
  assert.deepEqual(first.to, ["josh@example.com"]);
  assert.match(first.subject, /^Avouch Social: .*encryption key/);
  assert.match(first.text, /Hold: hold-1/);
  assert.equal(first.text.includes(claim), false);
  const second = JSON.parse(bodies[1] ?? "{}") as { subject: string; text: string };
  assert.match(second.subject, /^Avouch Social: .*CyberTipline/);
  assert.equal(second.text.includes(claim), false);

  const errors: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  try {
    await sendHoldAlert(alert, {
      fetch: async () => new Response("no", { status: 500 }),
      env: configured(),
    });
    await sendHoldAlert(alert, {
      fetch: async () => {
        throw new Error("network down");
      },
      env: configured(),
    });
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0] ?? "", /csam-alert-email-failed/);
  assert.match(errors[0] ?? "", /hold-1/);
  assert.match(errors[1] ?? "", /network down/);
});

test("a hold alert email stops when Resend does not answer", async () => {
  assert.ok(ALERT_EMAIL_TIMEOUT_MS >= 2_000 && ALERT_EMAIL_TIMEOUT_MS <= 10_000);
  let sawSignal = false;
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      sawSignal = true;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const errors: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  const keep = setInterval(() => undefined, 10);
  try {
    await sendHoldAlert(alert, { fetch: fetchImpl, env: configured(), timeoutMs: 20 });
  } finally {
    clearInterval(keep);
    console.error = original;
  }
  assert.equal(sawSignal, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /csam-alert-email-failed/);
});

test("a removal evicts the call, then sends the hold alert without waiting", () => {
  const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const dropped = source.indexOf("await dropObjectKeys(input.store ?? null, publicKeys)");
  const evicted = source.indexOf("evictCallMember(post.author_user_id)");
  const sent = source.indexOf("scheduleHoldAlert(alert)");
  assert.ok(dropped > 0);
  assert.ok(evicted > dropped);
  assert.ok(sent > evicted);
  assert.equal(source.includes("await sendHoldAlert"), false);
  assert.match(source, /setImmediate/);
});
