import assert from "node:assert/strict";
import test from "node:test";
import { pgliteDialect } from "../../src/lib/auth/pglite-dialect.ts";
import {
  createAccountFactory,
  createCredentialAccount,
  createSignIn,
  readSessionUser,
} from "../accounts.ts";
import { createClosedAuth } from "../auth.ts";
import { createApp } from "../http.ts";
import { seatFoundingAdmin } from "./store.ts";
import { openTestDb } from "./test-db.ts";

const baseURL = "http://127.0.0.1:8787";
const origin = "http://127.0.0.1:8787";
const sharedIp = "203.0.113.9";

function cookieHeader(response: Response): string {
  return (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
}

test("the sign-in after signup is not stopped by the per-IP sign-in cap", async () => {
  const { db, pg, close } = await openTestDb();
  try {
    const auth = createClosedAuth({
      database: { dialect: pgliteDialect(() => pg), type: "postgres" },
      secret: "test-secret-test-secret-test-secret",
      baseURL,
      trustedOrigins: [origin],
    });
    const seat = await seatFoundingAdmin(
      db,
      {
        envName: "Josh",
        email: "josh@example.test",
        password: "correct-horse",
        headers: new Headers({ origin }),
      },
      createAccountFactory(auth, baseURL, "bootstrap"),
    );
    assert.equal(seat.ok, true);
    const app = createApp({
      db,
      origins: [origin],
      now: () => new Date("2026-10-19T12:00:00Z"),
      createAccount: createCredentialAccount(),
      signIn: createSignIn(auth, baseURL),
      readSession: (requestHeaders) => readSessionUser(auth, requestHeaders),
      forwardAuth: (request) => auth.handler(request),
    });
    const signedIn = await app(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email: "josh@example.test", password: "correct-horse" }),
      }),
    );
    assert.equal(signedIn.status, 200);
    const minted = await app(
      new Request(`${baseURL}/api/invites`, {
        method: "POST",
        headers: { origin, cookie: cookieHeader(signedIn), "content-type": "application/json" },
        body: JSON.stringify({ maxUses: 5 }),
      }),
    );
    assert.equal(minted.status, 201);
    const { code } = (await minted.json()) as { code: string };

    // Everyone at one event shares the Wi-Fi address. Spend the router's
    // five sign-ins a minute for that address first.
    let capped = false;
    for (let index = 0; index < 7; index += 1) {
      const attempt = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", "x-avouch-client-ip": sharedIp },
          body: JSON.stringify({ email: `nobody${index}@example.test`, password: "wrong-horse" }),
        }),
      );
      if (attempt.status === 429) capped = true;
    }
    assert.equal(capped, true, "the router cap is in force for the shared address");

    const redeemed = await app(
      new Request(`${baseURL}/api/signup`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "x-avouch-client-ip": sharedIp },
        body: JSON.stringify({
          name: "Nora",
          email: "nora@example.test",
          password: "correct-horse",
          inviteCode: code,
        }),
      }),
    );
    assert.equal(redeemed.status, 200, await redeemed.clone().text());
    const nora = await readSessionUser(
      auth,
      new Headers({ cookie: cookieHeader(redeemed), origin }),
    );
    assert.equal(nora?.name, "Nora", "the new member lands signed in");
  } finally {
    await close();
  }
});
