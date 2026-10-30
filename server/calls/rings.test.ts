import assert from "node:assert/strict";
import test from "node:test";
import { createRingStore, MAX_RINGS_PER_RINGER, RING_TTL_MS, RINGER_WINDOW_MS } from "./rings.ts";
import { handleCalls, type CallsRuntime } from "./routes.ts";
import { readCallsConfig } from "./config.ts";
import { createCallStore } from "./store.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";

test("ring store: expiry, dismiss only by target, answer, evict", () => {
  const s = createRingStore();
  const r = s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 0);
  assert.ok(r);
  assert.equal(s.pending("ada", 1).length, 1);
  assert.equal(s.pending("bob", 1).length, 0);
  assert.equal(s.dismiss("bob", r.id), false);
  assert.equal(s.dismiss("ada", r.id), true);
  s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 0);
  s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 10);
  assert.equal(s.pending("ada", 20).length, 1, "a repeat ring replaces the old one");
  assert.equal(s.pending("ada", 10 + RING_TTL_MS + 1).length, 0, "rings expire");
  s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 0);
  s.answer("ada", "shop");
  assert.equal(s.pending("ada", 1).length, 0);
  s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 0);
  s.evict("host");
  assert.equal(s.pending("ada", 1).length, 0);
});

let db: Db;
let close: () => Promise<void>;
test.before(async () => {
  const o = await openTestDb();
  db = o.db;
  close = o.close;
});
test.after(async () => close());

function rt(hosts: string[], members: string[]): CallsRuntime {
  return {
    config: readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.example.com:3478" }),
    store: createCallStore(),
    rings: createRingStore(),
    now: () => new Date("2026-10-27T12:00:00Z"),
    canRing: async (_db, id) => hosts.includes(id),
    roomMember: (async (_db: Db, id: string) =>
      members.includes(id) ? { kind: "member" } : { kind: "outsider" }) as never,
  };
}

async function send(r: CallsRuntime, user: string, path: string, method = "GET", body?: unknown) {
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleCalls(r, db, request, new URL(request.url), { id: user, name: user });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("only a host or steward can ring, and only a room member", async () => {
  const r = rt(["host"], ["host", "ada", "bob"]);
  assert.equal((await send(r, "bob", "/api/calls/rooms/shop/ring")).body.canRing, false);
  assert.equal(
    (await send(r, "bob", "/api/calls/rooms/shop/ring", "POST", { to: "ada" })).status,
    403,
  );
  assert.equal(
    (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "eve" })).status,
    409,
  );
  assert.equal(
    (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "host" })).status,
    400,
  );
  assert.equal(
    (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" })).status,
    200,
  );
  // Nobody in the call yet: the ring has nothing to join, so it isn't shown.
  assert.equal(((await send(r, "ada", "/api/calls/rings")).body.rings as unknown[]).length, 0);
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  assert.equal(
    (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" })).status,
    200,
  );
  const inbox = await send(r, "ada", "/api/calls/rings");
  const rings = inbox.body.rings as { id: string; roomId: string; fromName: string }[];
  assert.equal(rings.length, 1);
  assert.equal(rings[0]?.roomId, "shop");
  assert.equal(inbox.body.record, false);
  assert.equal((await send(r, "bob", "/api/calls/rings")).body.rings instanceof Array, true);
  assert.equal(((await send(r, "bob", "/api/calls/rings")).body.rings as unknown[]).length, 0);
  await send(r, "ada", `/api/calls/rings/${rings[0]?.id}/dismiss`, "POST", {});
  assert.equal(((await send(r, "ada", "/api/calls/rings")).body.rings as unknown[]).length, 0);
});

test("rings are off with the CALLS flag", async () => {
  const r = { ...rt(["host"], ["host", "ada"]), config: readCallsConfig({}) };
  const res = await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  assert.notEqual(res.status, 200);
});

test("per-ringer cap, then it resets after the window", () => {
  const s = createRingStore();
  for (let i = 0; i < MAX_RINGS_PER_RINGER; i++) {
    assert.ok(s.ring({ roomId: "shop", from: "host", fromName: "Host", to: `m${i}` }, i));
  }
  assert.equal(s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "late" }, 100), null);
  assert.ok(
    s.ring({ roomId: "shop", from: "other", fromName: "Other", to: "late" }, 100),
    "per ringer",
  );
  assert.ok(
    s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "late" }, RINGER_WINDOW_MS + 100),
  );
  assert.equal(s.ringerCount(), 1, '"other" aged out of the window');
  s.pending("nobody", 3 * RINGER_WINDOW_MS);
  assert.equal(s.ringerCount(), 0, "idle ringers are swept");
});

test("the ring route answers 429 past the per-ringer cap", async () => {
  const members = ["host", ...Array.from({ length: 12 }, (_, i) => `m${i}`)];
  const r = rt(["host"], members);
  for (let i = 0; i < MAX_RINGS_PER_RINGER; i++) {
    assert.equal(
      (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: `m${i}` })).status,
      200,
    );
  }
  const over = await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "m11" });
  assert.equal(over.status, 429);
});

test("mint only after the membership check; a ban or leave releases TURN", async () => {
  const minted: string[] = [];
  const released: string[] = [];
  const ice = Object.assign(
    async (_c: unknown, owner: { userId: string; session: string }) => {
      minted.push(`${owner.userId}@${owner.session}`);
      return [];
    },
    { release: (userId: string, prefix?: string) => released.push(`${userId}:${prefix ?? "*"}`) },
  ) as unknown as NonNullable<CallsRuntime["ice"]>;
  const banned = new Set<string>();
  const r: CallsRuntime = {
    ...rt([], ["ada"]),
    ice,
    roomMember: (async (_db: Db, id: string) =>
      banned.has(id)
        ? { kind: "banned", ban: { reason: "x", until: null } }
        : id === "ada"
          ? { kind: "member" }
          : { kind: "outsider" }) as never,
  };
  assert.equal((await send(r, "ada", "/api/calls/rooms/shop/join", "POST", {})).status, 200);
  assert.deepEqual(minted, ["ada@shop#1"]);
  await send(r, "ada", "/api/calls/rooms/shop?since=0");
  assert.deepEqual(minted, ["ada@shop#1", "ada@shop#1"], "polls reuse the session key");
  banned.add("ada");
  assert.equal((await send(r, "ada", "/api/calls/rooms/shop?since=0")).status, 403);
  assert.equal(minted.length, 2, "no mint for a banned member");
  assert.deepEqual(released, ["ada:*"]);
  assert.equal((await send(r, "eve", "/api/calls/rooms/shop/join", "POST", {})).status, 403);
  assert.equal(minted.length, 2, "no mint for an outsider");
  assert.deepEqual(released, ["ada:*", "eve:shop#"]);
});

test("decline tells the caller once; an unanswered ring tells them it was missed", () => {
  const s = createRingStore();
  const r = s.ring(
    {
      kind: "dm",
      key: "dm:t",
      roomId: "t",
      from: "ada",
      fromName: "Ada",
      to: "ben",
      toName: "Ben",
    },
    0,
  );
  assert.ok(r);
  assert.deepEqual(s.outcomes("ada", "dm:t", 1), []);
  assert.equal(s.decline("eve", r.id, 1), false, "only the person rung can decline");
  assert.equal(s.decline("ben", r.id, 1), true);
  assert.deepEqual(s.pending("ben", 2), []);
  assert.deepEqual(s.outcomes("ben", "dm:t", 2), [], "the person rung is not told");
  assert.deepEqual(s.outcomes("ada", "dm:t", 2), [{ kind: "declined", to: "ben", name: "Ben" }]);
  assert.deepEqual(s.outcomes("ada", "dm:t", 3), [], "told once");

  s.ring(
    {
      kind: "dm",
      key: "dm:t",
      roomId: "t",
      from: "ada",
      fromName: "Ada",
      to: "ben",
      toName: "Ben",
    },
    10,
  );
  assert.deepEqual(s.outcomes("ada", "dm:t", 10 + RING_TTL_MS + 1), [
    { kind: "missed", to: "ben", name: "Ben" },
  ]);

  const d = s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ben" }, 0);
  assert.ok(d);
  assert.equal(s.dismiss("ben", d.id), true);
  assert.deepEqual(s.outcomes("host", "shop", 1), [], "a quiet dismiss says nothing");

  s.ring({ kind: "dm", key: "dm:t", roomId: "t", from: "ada", fromName: "Ada", to: "ben" }, 0);
  s.cancel("dm:t");
  assert.deepEqual(s.pending("ben", 1), [], "a call with nobody left takes its rings with it");
  assert.deepEqual(s.outcomes("ada", "dm:t", RING_TTL_MS + 5), [], "and no missed note");
});

const thread = "11111111-2222-3333-4444-555555555555";

function dmRt(): CallsRuntime {
  return {
    config: readCallsConfig({ CALLS: "on", CALLS_STUN_URLS: "stun:stun.example.com:3478" }),
    store: createCallStore(),
    rings: createRingStore(),
    now: () => new Date("2026-10-27T12:00:00Z"),
    dmMember: async () => ({ kind: "member" }),
    dmOther: async (_db, id) =>
      id === "ada" ? { id: "ben", name: "Ben" } : { id: "ada", name: "Ada" },
  };
}

test("starting a DM call rings the other person; Decline tells the caller", async () => {
  const r = dmRt();
  const joined = await send(r, "ada", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.ringing, true);
  const inbox = await send(r, "ben", "/api/calls/rings");
  assert.deepEqual(inbox.body.rings, [{ id: "r1", kind: "dm", threadId: thread, fromName: "ada" }]);
  assert.equal(((await send(r, "ada", "/api/calls/rings")).body.rings as unknown[]).length, 0);

  assert.equal((await send(r, "ben", "/api/calls/rings/r1/decline", "POST", {})).status, 200);
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 0);
  const poll = await send(r, "ada", `/api/calls/dm/${thread}?since=0`);
  assert.deepEqual(poll.body.rings, [{ kind: "declined", to: "ben", name: "Ben" }]);
  const again = await send(r, "ada", `/api/calls/dm/${thread}?since=0`);
  assert.deepEqual(again.body.rings, []);
});

test("a rejoin does not ring again, and the other person joining answers the ring", async () => {
  const r = dmRt();
  const rejoin = await send(r, "ada", `/api/calls/dm/${thread}/join`, "POST", {});
  assert.equal(rejoin.body.ringing, false);
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 0);
  await send(r, "ada", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 1);
  const answer = await send(r, "ben", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(answer.body.ringing, false, "someone is already there, so no ring back");
  assert.equal((answer.body.peers as unknown[]).length, 1);
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 0);
  const poll = await send(r, "ada", `/api/calls/dm/${thread}?since=0`);
  assert.deepEqual(poll.body.rings, [], "an answered ring is not a decline");
});

test("hanging up before an answer takes the ring away", async () => {
  const r = dmRt();
  await send(r, "ada", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 1);
  await send(r, "ada", `/api/calls/dm/${thread}/leave`, "POST", {});
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 0);
});

test("a room ring that is declined names the member for the ringer", async () => {
  const r = { ...rt(["host"], ["host", "ada"]), memberName: async () => "Ada Lovelace" };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const inbox = await send(r, "ada", "/api/calls/rings");
  const rings = inbox.body.rings as { id: string; kind: string; roomId: string }[];
  assert.equal(rings[0]?.kind, "room");
  assert.equal(rings[0]?.roomId, "shop");
  await send(r, "ada", `/api/calls/rings/${rings[0]?.id}/decline`, "POST", {});
  const poll = await send(r, "host", "/api/calls/rooms/shop?since=0");
  assert.deepEqual(poll.body.rings, [{ kind: "declined", to: "ada", name: "Ada Lovelace" }]);
});
