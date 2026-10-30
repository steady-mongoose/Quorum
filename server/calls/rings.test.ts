import assert from "node:assert/strict";
import test from "node:test";
import { createRingStore, MAX_RINGS_PER_RINGER, RING_TTL_MS, RINGER_WINDOW_MS } from "./rings.ts";
import {
  CALLS_TRY_AGAIN,
  DM_CALL_REFUSED,
  handleCalls,
  PICKER_FAILED,
  RING_CAP_ERROR,
  RING_GONE,
  type CallsRuntime,
} from "./routes.ts";
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
  // Not in the call: there is nothing to ring them into, so it is refused.
  const early = await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "Join the call first, then call members.");
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
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  for (let i = 0; i < MAX_RINGS_PER_RINGER; i++) {
    assert.equal(
      (await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: `m${i}` })).status,
      200,
    );
  }
  const over = await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "m11" });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, RING_CAP_ERROR, "the caller is told the ring wasn't sent");
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

test("a non-participant's ring is an error, not a silent ok", async () => {
  const r = rt(["host", "cal"], ["host", "cal", "ada"]);
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  const res = await send(r, "cal", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  assert.equal(res.status, 409, "the call is on, but Cal is not in it");
  assert.equal(((await send(r, "ada", "/api/calls/rings")).body.rings as unknown[]).length, 0);
});

test("S2: a member who blocked the caller is not listed and is not rung (either way)", async () => {
  for (const [id, name] of [
    ["hana", "TEST Hana"],
    ["dee", "TEST Dee"],
    ["ben", "TEST Ben"],
    ["eve", "TEST Eve"],
  ]) {
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $1 || '@example.test', true, now(), now()) on conflict do nothing`,
      [id, name],
    );
  }
  const room = (await db.query<{ id: string }>(`select id from room order by id limit 1`))[0]?.id;
  assert.ok(room, "a seeded room");
  for (const id of ["hana", "dee", "ben", "eve"]) {
    await db.query(
      `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
      [room, id],
    );
  }
  await db.query(`insert into dm_block (blocker_user_id, blocked_user_id) values ('dee', 'hana')`);
  await db.query(`insert into dm_block (blocker_user_id, blocked_user_id) values ('hana', 'eve')`);
  const r = rt(["hana"], ["hana", "dee", "ben", "eve"]);
  await send(r, "hana", `/api/calls/rooms/${room}/join`, "POST", {});
  const picker = await send(r, "hana", `/api/calls/rooms/${room}/ring`);
  const ids = (picker.body.members as { id: string }[]).map((m) => m.id);
  assert.deepEqual(ids, ["ben"], "Dee blocked Hana; Hana blocked Eve");
  for (const to of ["dee", "eve"]) {
    const res = await send(r, "hana", `/api/calls/rooms/${room}/ring`, "POST", { to });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "That member can't join this room's call.", "same as any refusal");
    assert.equal(((await send(r, to, "/api/calls/rings")).body.rings as unknown[]).length, 0);
  }
  assert.equal(
    (await send(r, "hana", `/api/calls/rooms/${room}/ring`, "POST", { to: "ben" })).status,
    200,
  );
});

test("S2: a room call stays open through a decline while other rings are out", async () => {
  const r = rt(["host"], ["host", "ben", "eve"]);
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ben" });
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "eve" });
  const benRing = ((await send(r, "ben", "/api/calls/rings")).body.rings as { id: string }[])[0];
  await send(r, "ben", `/api/calls/rings/${benRing?.id}/decline`, "POST", {});
  const poll = await send(r, "host", "/api/calls/rooms/shop?since=0");
  assert.equal((poll.body.rings as unknown[]).length, 1, "the host hears Ben declined");
  assert.equal(poll.body.ringsOut, true, "Eve is still being rung");
  const eve = await send(r, "eve", "/api/calls/rings");
  assert.equal((eve.body.rings as unknown[]).length, 1, "Eve's ring is untouched");
  assert.equal(
    (eve.body.settled as { how: string }[]).some((o) => o.how === "missed"),
    false,
    "Eve sees no missed call",
  );
  const eveRing = (eve.body.rings as { id: string }[])[0];
  await send(r, "eve", `/api/calls/rings/${eveRing?.id}/decline`, "POST", {});
  const last = await send(r, "host", "/api/calls/rooms/shop?since=0");
  assert.equal(last.body.ringsOut, false, "every ring is resolved");
});

test("the person rung sees what became of each ring, in every tab", async () => {
  const r = rt(["host"], ["host", "ada"]);
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const id = ((await send(r, "ada", "/api/calls/rings")).body.rings as { id: string }[])[0]?.id;
  // Tab A chooses Join (dismiss, then join); tab B polls next.
  await send(r, "ada", `/api/calls/rings/${id}/dismiss`, "POST", {});
  const tabB = await send(r, "ada", "/api/calls/rings");
  assert.deepEqual(tabB.body.rings, []);
  assert.deepEqual(tabB.body.settled, [{ id, how: "answered" }], "not a missed call");
  // The caller hangs up on a second ring: that one is a real miss.
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const id2 = ((await send(r, "ada", "/api/calls/rings")).body.rings as { id: string }[])[0]?.id;
  await send(r, "host", "/api/calls/rooms/shop/leave", "POST", {});
  const after = await send(r, "ada", "/api/calls/rings");
  assert.ok(
    (after.body.settled as { id: string; how: string }[]).some(
      (o) => o.id === id2 && o.how === "missed",
    ),
  );
});

test("a ring for a room the person was removed from goes away, with no missed call", async () => {
  const members = new Set(["host", "ada"]);
  const r: CallsRuntime = {
    ...rt(["host"], []),
    roomMember: (async (_db: Db, id: string) =>
      members.has(id) ? { kind: "member" } : { kind: "outsider" }) as never,
  };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const first = await send(r, "ada", "/api/calls/rings");
  const id = (first.body.rings as { id: string }[])[0]?.id;
  assert.ok(id);
  members.delete("ada");
  const after = await send(r, "ada", "/api/calls/rings");
  assert.deepEqual(after.body.rings, []);
  assert.deepEqual(after.body.settled, [{ id, how: "gone" }]);
  // The caller is told in plain words, the same as a decline.
  const poll = await send(r, "host", "/api/calls/rooms/shop?since=0");
  assert.deepEqual(
    (poll.body.rings as { kind: string }[]).map((o) => o.kind),
    ["declined"],
    "the caller's line reads \"Ada isn't available right now.\"",
  );
  assert.equal(poll.body.ringsOut, false);
});

test("S4: Join on a ring another tab's check already dropped is refused, not opened", async () => {
  const members = new Set(["host", "ada"]);
  const r: CallsRuntime = {
    ...rt(["host"], []),
    roomMember: (async (_db: Db, id: string) =>
      members.has(id) ? { kind: "member" } : { kind: "outsider" }) as never,
  };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const id = ((await send(r, "ada", "/api/calls/rings")).body.rings as { id: string }[])[0]?.id;
  assert.ok(id);
  // Tab B's poll drops it (Ada was removed); tab A still shows the prompt.
  members.delete("ada");
  assert.deepEqual((await send(r, "ada", "/api/calls/rings")).body.rings, []);
  members.add("ada");
  const join = await send(r, "ada", `/api/calls/rings/${id}/dismiss`, "POST", {});
  assert.equal(join.status, 409);
  assert.equal(join.body.error, RING_GONE);
  // Declined in another tab, then Join here: refused too.
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const id2 = ((await send(r, "ada", "/api/calls/rings")).body.rings as { id: string }[])[0]?.id;
  assert.ok(id2);
  await send(r, "ada", `/api/calls/rings/${id2}/decline`, "POST", {});
  const join2 = await send(r, "ada", `/api/calls/rings/${id2}/dismiss`, "POST", {});
  assert.equal(join2.status, 409);
  // An unknown id is refused the same way.
  const join3 = await send(r, "ada", "/api/calls/rings/r999999/dismiss", "POST", {});
  assert.equal(join3.status, 409);
});

test("S4: after a failed check, the ring shows again once the check recovers", async () => {
  let state: "clear" | "error" = "error";
  const r: CallsRuntime = { ...rt(["host"], ["host", "ada"]), blockState: async () => state };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const id = (r.rings!.pending("ada", Date.parse("2026-10-27T12:00:00Z"))[0] ?? { id: "" }).id;
  assert.ok(id);
  assert.equal((await send(r, "ada", `/api/calls/rings/${id}/dismiss`, "POST", {})).status, 503);
  state = "clear";
  const back = await send(r, "ada", "/api/calls/rings");
  assert.deepEqual(
    (back.body.rings as { id: string }[]).map((o) => o.id),
    [id],
    "a 503 does not use the ring up",
  );
  assert.equal((await send(r, "ada", `/api/calls/rings/${id}/dismiss`, "POST", {})).status, 200);
});

test("S3: a block either way mid-ring cancels the ring, and Join from the prompt is refused", async () => {
  for (const [id, name] of [
    ["kit", "TEST Kit"],
    ["lou", "TEST Lou"],
    ["max", "TEST Max"],
  ]) {
    await db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $1 || '@example.test', true, now(), now()) on conflict do nothing`,
      [id, name],
    );
  }
  // Lou (rung) blocks Kit (caller) mid-ring: the next /rings poll drops it.
  const r = rt(["kit"], ["kit", "lou", "max"]);
  await send(r, "kit", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "kit", "/api/calls/rooms/shop/ring", "POST", { to: "lou" });
  const lou = await send(r, "lou", "/api/calls/rings");
  const louId = (lou.body.rings as { id: string }[])[0]?.id;
  assert.ok(louId);
  await db.query(`insert into dm_block (blocker_user_id, blocked_user_id) values ('lou', 'kit')`);
  const louAfter = await send(r, "lou", "/api/calls/rings");
  assert.deepEqual(louAfter.body.rings, [], "the callee's own block cancels the ring");
  assert.deepEqual(louAfter.body.settled, [{ id: louId, how: "gone" }], "no missed call");
  const told = await send(r, "kit", "/api/calls/rooms/shop?since=0");
  assert.deepEqual(
    (told.body.rings as { kind: string }[]).map((o) => o.kind),
    ["declined"],
    "the caller hears the same words as a decline",
  );

  // Kit (caller) blocks Max mid-ring, and Max presses Join on a prompt still showing.
  await send(r, "kit", "/api/calls/rooms/shop/ring", "POST", { to: "max" });
  const max = await send(r, "max", "/api/calls/rings");
  const maxId = (max.body.rings as { id: string }[])[0]?.id;
  assert.ok(maxId);
  await db.query(`insert into dm_block (blocker_user_id, blocked_user_id) values ('kit', 'max')`);
  const join = await send(r, "max", `/api/calls/rings/${maxId}/dismiss`, "POST", {});
  assert.equal(join.status, 409, "Join from the prompt is refused");
  assert.equal(join.body.error, RING_GONE);
  assert.equal(RING_GONE, "That call isn't available anymore.");
  assert.deepEqual((await send(r, "max", "/api/calls/rings")).body.rings, []);
});

test("S3: a block check that fails hides the ring (fail closed) and refuses Join in plain words", async () => {
  const r: CallsRuntime = { ...rt(["host"], ["host", "ada"]), blockState: async () => "error" };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  const seen = await send(r, "ada", "/api/calls/rings");
  assert.deepEqual(seen.body.rings, [], "not shown while it can't be checked");
  assert.deepEqual(seen.body.settled, [], "and not reported as missed");
  const id = (r.rings!.pending("ada", Date.parse("2026-10-27T12:00:00Z"))[0] ?? { id: "" }).id;
  assert.ok(id, "the ring is kept for the next check");
  const join = await send(r, "ada", `/api/calls/rings/${id}/dismiss`, "POST", {});
  assert.equal(join.status, 503);
  assert.equal(join.body.error, CALLS_TRY_AGAIN);
  const poll = await send(r, "host", "/api/calls/rooms/shop?since=0");
  assert.deepEqual(poll.body.rings, [], "the caller is told nothing yet");
});

test("S4: a picker whose block check fails says so plainly and lists no one", async () => {
  const r: CallsRuntime = {
    ...rt(["host"], ["host", "ada"]),
    ringable: async () => {
      throw new Error('relation "dm_block" does not exist');
    },
  };
  const res = await send(r, "host", "/api/calls/rooms/shop/ring");
  assert.equal(res.status, 503);
  assert.equal(res.body.error, PICKER_FAILED);
  assert.equal(PICKER_FAILED, "We couldn't load who you can call. Try again in a moment.");
  assert.deepEqual(res.body.members, [], "fail closed");
  assert.equal(res.body.canRing, false);
  assert.doesNotMatch(JSON.stringify(res.body), /relation|dm_block|does not exist/);
});

test("S4: an unexpected database error never reaches the person as raw text", async () => {
  const r: CallsRuntime = {
    ...rt(["host"], ["host", "ada"]),
    memberName: async () => {
      throw new Error('relation "user" does not exist');
    },
  };
  await send(r, "host", "/api/calls/rooms/shop/join", "POST", {});
  const res = await send(r, "host", "/api/calls/rooms/shop/ring", "POST", { to: "ada" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, CALLS_TRY_AGAIN);
  assert.doesNotMatch(JSON.stringify(res.body), /relation|does not exist/);
});

test("DM call: refusal wording, and the ring cap says the ring wasn't sent", async () => {
  const refused: CallsRuntime = { ...dmRt(), dmMember: async () => ({ kind: "outsider" }) };
  const no = await send(refused, "ada", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(no.status, 403);
  assert.equal(no.body.error, DM_CALL_REFUSED);
  assert.equal(DM_CALL_REFUSED, "This member isn't taking messages right now.");

  const r = dmRt();
  const store = r.rings!;
  for (let i = 0; i < MAX_RINGS_PER_RINGER; i++) {
    store.ring(
      { roomId: "shop", from: "ada", fromName: "Ada", to: `m${i}` },
      Date.parse("2026-10-27T12:00:00Z"),
    );
  }
  const joined = await send(r, "ada", `/api/calls/dm/${thread}/join`, "POST", { ring: true });
  assert.equal(joined.status, 200, "the call still opens");
  assert.equal(joined.body.ringing, false);
  assert.equal(joined.body.ringError, RING_CAP_ERROR);
  assert.equal(((await send(r, "ben", "/api/calls/rings")).body.rings as unknown[]).length, 0);
});
