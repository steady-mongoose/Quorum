import assert from "node:assert/strict";
import test from "node:test";
import { handleCalls, type CallsRuntime } from "./routes.ts";
import { readCallsConfig } from "./config.ts";
import { createCallStore } from "./store.ts";
import type { Db } from "../db.ts";
import type { DmCallCheck } from "./dm-membership.ts";
import { dmCallMember } from "./dm-membership.ts";
import { openTestDb } from "../closed-test/test-db.ts";

const thread = "11111111-2222-3333-4444-555555555555";
const sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
let testDb: Db;
let closeDb: () => Promise<void>;
test.before(async () => {
  const opened = await openTestDb();
  testDb = opened.db;
  closeDb = opened.close;
});
test.after(async () => {
  await closeDb();
});

function runtime(allowed: Record<string, DmCallCheck["kind"]>): CallsRuntime {
  return {
    config: readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.example.com:3478" }),
    store: createCallStore(),
    now: () => new Date("2026-10-27T12:00:00Z"),
    dmMember: async (_db, userId) => ({ kind: allowed[userId] ?? "bad-room" }) as DmCallCheck,
  };
}

function req(path: string, method = "GET", body?: unknown) {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function send(
  rt: CallsRuntime,
  user: string | null,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const request = req(path, method, body);
  const res = await handleCalls(
    rt,
    testDb,
    request,
    new URL(request.url),
    user ? { id: user, name: user } : null,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("dm calls are off when the flag is off", async () => {
  const rt = runtime({ ada: "member" });
  rt.config = readCallsConfig({});
  const res = await send(rt, "ada", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(res.status, 404);
});

test("two thread members can join, signal, and poll; never recorded", async () => {
  const rt = runtime({ ada: "member", bo: "member" });
  const a = await send(rt, "ada", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(a.status, 200);
  assert.equal(a.body.record, false);
  const b = await send(rt, "bo", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(b.status, 200);
  assert.deepEqual(
    (b.body.peers as Array<{ id: string }>).map((p) => p.id),
    ["ada"],
  );
  const sig = await send(rt, "bo", `/api/calls/dm/${thread}/signal`, "POST", {
    to: "ada",
    kind: "offer",
    payload: { type: "offer", sdp },
  });
  assert.equal(sig.status, 200);
  const poll = await send(rt, "ada", `/api/calls/dm/${thread}?since=${a.body.cursor as number}`);
  assert.equal(poll.status, 200);
  assert.equal((poll.body.signals as unknown[]).length, 1);
  assert.equal(JSON.stringify(poll.body).includes('"record":true'), false);
});

test("a third person cannot join a dm call even if the check passed", async () => {
  const rt = runtime({ ada: "member", bo: "member", cy: "member" });
  await send(rt, "ada", `/api/calls/dm/${thread}/join`, "POST", {});
  await send(rt, "bo", `/api/calls/dm/${thread}/join`, "POST", {});
  const cy = await send(rt, "cy", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(cy.status, 409);
});

test("outsiders, banned members, and strangers are refused", async () => {
  const rt = runtime({ out: "outsider", gone: "bad-room" });
  assert.equal((await send(rt, null, `/api/calls/dm/${thread}/join`, "POST", {})).status, 401);
  const out = await send(rt, "out", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(out.status, 403);
  assert.match(String(out.body.error), /meeting/);
  assert.equal((await send(rt, "gone", `/api/calls/dm/${thread}/join`, "POST", {})).status, 404);
  assert.equal((await send(rt, "out", `/api/calls/dm/not-a-thread/join`, "POST", {})).status, 404);
});

test("a dm call and a room call never share a slot", async () => {
  const rt = runtime({ ada: "member" });
  await send(rt, "ada", `/api/calls/dm/${thread}/join`, "POST", {});
  // The dm key cannot be reached through the room path.
  const res = await send(rt, "ada", `/api/calls/rooms/dm:${thread}/join`, "POST", {});
  assert.equal(res.status, 404);
});

test("dmCallMember hides threads the caller is not in", async () => {
  const db = {
    query: async () => [{ user_a: "ada", user_b: "bo" }],
  } as unknown as Db;
  const now = new Date();
  assert.equal((await dmCallMember(db, "cy", thread, now)).kind, "bad-room");
  assert.equal((await dmCallMember(db, "ada", "bad", now)).kind, "bad-room");
  const broken = { query: async () => Promise.reject(new Error("down")) } as unknown as Db;
  assert.equal((await dmCallMember(broken, "ada", thread, now)).kind, "unavailable");
});
