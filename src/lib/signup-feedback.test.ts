import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inviteLimitMessage, SIGNED_UP_NO_SESSION_MESSAGE } from "./account-result.ts";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the invite limit message says what happened and how to invite a group", () => {
  const message = inviteLimitMessage(null);
  assert.match(message, /five codes a minute/);
  assert.match(message, /Wait a minute/);
  assert.match(message, /up to 20/);
  assert.match(inviteLimitMessage(240), /Wait 4 minutes/);
});

test("a 429 from /api/invites returns the limit message", () => {
  const api = source("./account-api.ts");
  assert.match(api, /response\.status === 429\)[\s\S]{0,40}inviteLimitMessage\(response\.retryAfter\)/);
});

test("signup without a session tells the person their account exists", () => {
  assert.match(SIGNED_UP_NO_SESSION_MESSAGE, /account was created/);
  const session = source("./server-session.tsx");
  assert.match(session, /code: SIGNED_UP_NO_SESSION/);
  const door = source("../components/board/account-door.tsx");
  assert.match(door, /result\.code === SIGNED_UP_NO_SESSION/);
  assert.match(door, /role="alert"/);
  const invite = source("../components/board/server-invite.tsx");
  assert.match(invite, /role="alert"/);
});
