import assert from "node:assert/strict";
import test from "node:test";
import { createRingStore, RING_TTL_MS } from "./rings.ts";
import { handleCalls, type CallsRuntime } from "./routes.ts";
import { readCallsConfig } from "./config.ts";
import { createCallStore } from "./store.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";

test("ring store: expiry, dismiss only by target, answer, evict", () => {
  const s = createRingStore();
  const r = s.ring({ roomId: "shop", from: "host", fromName: "Host", to: "ada" }, 0);
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
