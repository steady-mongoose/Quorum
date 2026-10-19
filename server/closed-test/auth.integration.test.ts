import assert from "node:assert/strict";
import test from "node:test";
import { pgliteDialect } from "../../src/lib/auth/pglite-dialect.ts";
import { createAccountFactory, readSessionUser } from "../accounts.ts";
import { createClosedAuth } from "../auth.ts";
import { seatFoundingAdmin } from "./store.ts";
import { openTestDb } from "./test-db.ts";
import { createApp } from "../http.ts";

const baseURL = "http://127.0.0.1:8787";
const origin = "http://127.0.0.1:8787";

function cookieHeader(response: Response): string {
  return (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
}

test("Better Auth refuses open signup, seats Josh once, and redeems one invite", async () => {
  const { db, pg, close } = await openTestDb();
  try {
    const auth = createClosedAuth({
      database: { dialect: pgliteDialect(() => pg), type: "postgres" },
      secret: "test-secret-test-secret-test-secret",
      baseURL,
      trustedOrigins: [origin],
    });
    const headers = new Headers({ origin });
    const seat = await seatFoundingAdmin(
      db,
      { envName: "Josh", email: "josh@example.com", password: "correct-horse", headers },
      createAccountFactory(auth, baseURL, "bootstrap"),
    );
    assert.equal(seat.ok, true, seat.ok ? "" : seat.error);
    if (!seat.ok) return;

    const open = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ name: "Pat", email: "pat@example.com", password: "correct-horse" }),
      }),
    );
    assert.equal(open.status, 403);
    assert.match(await open.text(), /invite code/i);

    const app = createApp({
      db,
      origins: [origin],
      now: () => new Date("2026-10-19T12:00:00Z"),
      createUser: createAccountFactory(auth, baseURL, "invite"),
      readSession: (requestHeaders) => readSessionUser(auth, requestHeaders),
      forwardAuth: (request) => auth.handler(request),
    });

    const session = await auth.api.getSession({ headers });
    // The seat response cookie is inside the createUser result, which seat does not return.
    // Sign in as Josh to mint a code.
    assert.equal(session, null);
    const signedIn = await app(
      new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email: "josh@example.com", password: "correct-horse" }),
      }),
    );
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    const joshCookie = cookieHeader(signedIn);
    assert.match(joshCookie, /session/i);

    const minted = await app(
      new Request(`${baseURL}/api/invites`, {
        method: "POST",
        headers: { origin, cookie: joshCookie, "content-type": "application/json" },
        body: JSON.stringify({ maxUses: 1 }),
      }),
    );
    assert.equal(minted.status, 201, await minted.clone().text());
    const mintedBody = (await minted.json()) as { code: string };
    const redeemed = await app(
      new Request(`${baseURL}/api/signup`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Maria",
          email: "maria@example.com",
          password: "correct-horse",
          inviteCode: mintedBody.code,
        }),
      }),
    );
    assert.equal(redeemed.status, 200, await redeemed.clone().text());
    const maria = await readSessionUser(
      auth,
      new Headers({ cookie: cookieHeader(redeemed), origin }),
    );
    assert.equal(maria?.name, "Maria");

    const again = await app(
      new Request(`${baseURL}/api/signup`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Luis",
          email: "luis@example.com",
          password: "correct-horse",
          inviteCode: mintedBody.code,
        }),
      }),
    );
    assert.equal(again.status, 400);

    const log = await app(
      new Request(`${baseURL}/api/invite-log`, { headers: { origin, cookie: joshCookie } }),
    );
    assert.equal(log.status, 200);
    const entries = (
      (await log.json()) as { entries: Array<{ invitedByName: string; invitedName: string }> }
    ).entries;
    assert.deepEqual(
      entries.map((entry) => `${entry.invitedByName}->${entry.invitedName}`),
      ["Josh->Maria"],
    );

    const secondSeat = await seatFoundingAdmin(
      db,
      { envName: "Josh", email: "other@example.com", password: "correct-horse", headers },
      createAccountFactory(auth, baseURL, "bootstrap"),
    );
    assert.equal(secondSeat.ok, false);
    if (!secondSeat.ok) assert.match(secondSeat.error, /already seated|before anyone else/);
  } finally {
    await close();
  }
});
