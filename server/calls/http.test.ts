import assert from "node:assert/strict";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import { readCallsConfig } from "./config.ts";
import { CALLS_LIMIT } from "../rate-limit.ts";
import { createCallStore } from "./store.ts";

const secret = "b".repeat(40);
const sdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";

function enabledConfig() {
  return readCallsConfig({
    CALLS: "on",
    CALLS_STUN_URLS: "stun:turn.example.com:3478",
    CALLS_TURN_URLS: "turn:turn.example.com:3478?transport=udp",
    CALLS_TURN_SECRET: secret,
  });
}

function watching(db: Db) {
  const queries: string[] = [];
  const wrapped: Db = {
    async query<T>(text: string, params?: unknown[]) {
      queries.push(text);
      return db.query<T>(text, params);
    },
    transaction: (fn) => db.transaction(fn),
  };
  return { queries, db: wrapped };
}

function handler(db: Db, calls: AppDeps["calls"]) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => new Date("2026-10-21T12:00:00Z"),
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: headers.get("x-user-name") ?? "Josh", email: "josh@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
    calls,
  });
}

async function user(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, id, `${id}@example.com`],
  );
}

async function stand(db: Db, userId: string, roomId: string) {
  await db.query(
    `insert into room_member (room_id, user_id) values ($1, $2) on conflict do nothing`,
    [roomId, userId],
  );
}

function call(
  path: string,
  init: { method?: string; user?: string; name?: string; body?: unknown } = {},
) {
  const headers = new Headers();
  if (init.user) headers.set("x-user-id", init.user);
  if (init.name) headers.set("x-user-name", init.name);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

test("calls stay hidden until the flag is on, and the status never records", async () => {
  const { db, close } = await openTestDb();
  try {
    const app = handler(db, undefined);
    const status = await app(call("/api/calls/status"));
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false, record: false });
    await user(db, "ada");
    await stand(db, "ada", "shop");
    const join = await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", body: {} }),
    );
    assert.equal(join.status, 404);
    assert.equal(JSON.stringify(await join.json()).includes('record":true'), false);
  } finally {
    await close();
  }
});

test("only a signed-in member can join, and an admin who has not stood there cannot", async () => {
  const { db, close } = await openTestDb();
  const seen = watching(db);
  try {
    const app = handler(seen.db, {
      config: enabledConfig(),
      store: createCallStore(),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });
    const anon = await app(call("/api/calls/rooms/shop/join", { method: "POST", body: {} }));
    assert.equal(anon.status, 401);

    await user(db, "ada");
    await user(db, "boss");
    await stand(db, "ada", "shop");
    await db.query(`insert into member_role (user_id, is_admin) values ('boss', true)`);

    const outsider = await app(
      call("/api/calls/rooms/shop/join", {
        method: "POST",
        user: "boss",
        name: "Boss",
        body: { name: "Ada" },
      }),
    );
    assert.equal(outsider.status, 403);
    assert.deepEqual(await outsider.json(), {
      error: "You have not stood in that room.",
      record: false,
    });
    assert.equal(
      seen.queries.some((sql) => sql.toLowerCase().includes("member_active_days")),
      false,
    );

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let joinedBody: {
      selfId?: string;
      peers?: { name?: string }[];
      iceServers?: { credential?: string; urls?: string }[];
      record?: boolean;
    };
    try {
      const joined = await app(
        call("/api/calls/rooms/shop/join", {
          method: "POST",
          user: "ada",
          name: "Ada",
          body: { name: "Impostor" },
        }),
      );
      assert.equal(joined.status, 200);
      joinedBody = (await joined.json()) as typeof joinedBody;
    } finally {
      console.log = original;
    }
    assert.equal(joinedBody.selfId, "ada");
    assert.equal(joinedBody.record, false);
    assert.equal(JSON.stringify(joinedBody).includes(secret), false);
    assert.equal(JSON.stringify(joinedBody).includes("Impostor"), false);
    const turn = joinedBody.iceServers?.find((server) => server.credential);
    assert.ok(turn?.credential);
    assert.equal(logs.join("").includes(secret), false);
    assert.equal(logs.join("").includes(turn.credential ?? "missing"), false);

    const otherRoom = await app(
      call("/api/calls/rooms/county/join", { method: "POST", user: "ada", body: {} }),
    );
    assert.equal(otherRoom.status, 403);
    const roomWrites = seen.queries.filter((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes("ratelimit")) return false;
      if (lower.includes("member_active_days") || lower.includes("stats_daily")) return false;
      return !lower.trim().startsWith("select");
    });
    assert.deepEqual(roomWrites, []);
    assert.equal(
      seen.queries.some((sql) => sql.includes("room_member")),
      true,
    );
  } finally {
    await close();
  }
});

test("members exchange one offer, and someone outside the room cannot read it", async () => {
  const { db, close } = await openTestDb();
  try {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const app = handler(db, {
      config: enabledConfig(),
      store: createCallStore(),
      now: () => new Date(now),
    });
    await user(db, "ada");
    await user(db, "bob");
    await user(db, "cara");
    await stand(db, "ada", "shop");
    await stand(db, "bob", "shop");
    await stand(db, "cara", "county");
    await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", name: "Ada", body: {} }),
    );
    const bobJoined = await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "bob", name: "Bob", body: {} }),
    );
    const bobBody = (await bobJoined.json()) as {
      peers: { id: string; name: string; generation: number }[];
    };
    assert.equal(bobBody.peers[0]?.name, "Ada");
    assert.equal(bobBody.peers[0]?.generation, 1);

    const sent = await app(
      call("/api/calls/rooms/shop/signal", {
        method: "POST",
        user: "bob",
        body: { to: "ada", kind: "offer", payload: { type: "offer", sdp, note: "drop" } },
      }),
    );
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { ok: true, record: false });

    const adaPoll = await app(call("/api/calls/rooms/shop?since=0", { user: "ada" }));
    const adaBody = (await adaPoll.json()) as {
      signals: { from: string; kind: string; payload: Record<string, unknown> }[];
      record: boolean;
    };
    assert.equal(adaBody.record, false);
    assert.equal(adaBody.signals.length, 1);
    assert.equal(adaBody.signals[0]?.from, "bob");
    assert.deepEqual(adaBody.signals[0]?.payload, { type: "offer", sdp });
    assert.equal(JSON.stringify(adaBody).includes("note"), false);

    const bobPoll = await app(call("/api/calls/rooms/shop?since=0", { user: "bob" }));
    const bobSignals = (await bobPoll.json()) as { signals: unknown[] };
    assert.equal(bobSignals.signals.length, 0);

    const cara = await app(call("/api/calls/rooms/shop?since=0", { user: "cara" }));
    assert.equal(cara.status, 403);
    const caraBody = JSON.stringify(await cara.json());
    assert.equal(caraBody.includes(sdp), false);
    assert.equal(caraBody.includes("v=0"), false);

    await user(db, "dale");
    await stand(db, "dale", "shop");
    const waiting = await app(call("/api/calls/rooms/shop?since=0", { user: "dale" }));
    assert.equal(waiting.status, 409);

    await app(call("/api/calls/rooms/shop/leave", { method: "POST", user: "bob", body: {} }));
    const after = await app(call("/api/calls/rooms/shop?since=0", { user: "bob" }));
    assert.equal(after.status, 409);

    const down = handler(
      {
        query: async () => {
          throw new Error("relation room_member does not exist");
        },
        transaction: async (fn) => fn(db),
      },
      { config: enabledConfig(), store: createCallStore(), now: () => new Date(now) },
    );
    const unavailable = await down(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", body: {} }),
    );
    assert.equal(unavailable.status, 503);
  } finally {
    await close();
  }
});

test("a removed member is dropped from the call on the next request", async () => {
  const { db, close } = await openTestDb();
  try {
    const app = handler(db, {
      config: enabledConfig(),
      store: createCallStore(),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });
    await user(db, "ada");
    await user(db, "bob");
    await stand(db, "ada", "shop");
    await stand(db, "bob", "shop");
    await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", name: "Ada", body: {} }),
    );
    await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "bob", name: "Bob", body: {} }),
    );
    await db.query(`delete from room_member where user_id = $1`, ["ada"]);
    const removed = await app(call("/api/calls/rooms/shop?since=0", { user: "ada" }));
    assert.equal(removed.status, 403);
    const bob = await app(call("/api/calls/rooms/shop?since=0", { user: "bob" }));
    const body = (await bob.json()) as { peers: { id: string }[]; record: boolean };
    assert.equal(body.record, false);
    assert.equal(
      body.peers.some((peer) => peer.id === "ada"),
      false,
    );
    const again = await app(
      call("/api/calls/rooms/shop/signal", {
        method: "POST",
        user: "ada",
        body: { to: "bob", kind: "ice", payload: { candidate: "candidate:1" } },
      }),
    );
    assert.equal(again.status, 403);
  } finally {
    await close();
  }
});

test("join, leave, and poll are limited per member", async () => {
  const { db, close } = await openTestDb();
  try {
    const app = handler(db, {
      config: enabledConfig(),
      store: createCallStore(),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });
    await user(db, "ada");
    await stand(db, "ada", "shop");
    const joined = await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", name: "Ada", body: {} }),
    );
    assert.equal(joined.status, 200);
    for (let i = 1; i < CALLS_LIMIT.max; i += 1) {
      const polled = await app(call("/api/calls/rooms/shop?since=0", { user: "ada" }));
      assert.equal(polled.status, 200);
    }
    const blocked = await app(call("/api/calls/rooms/shop?since=0", { user: "ada" }));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "10");
    const body = (await blocked.json()) as { error: string; record: boolean };
    assert.equal(body.record, false);
    assert.match(body.error, /Too many attempts/);
    const left = await app(
      call("/api/calls/rooms/shop/leave", { method: "POST", user: "ada", body: {} }),
    );
    assert.equal(left.status, 429);
  } finally {
    await close();
  }
});

test("a barred member cannot join a call, even with a membership row", async () => {
  const { db, close } = await openTestDb();
  try {
    const app = handler(db, {
      config: enabledConfig(),
      store: createCallStore(),
      now: () => new Date("2026-10-21T12:00:00Z"),
    });
    await user(db, "ada");
    await user(db, "bob");
    await stand(db, "ada", "shop");
    await stand(db, "bob", "shop");
    const joined = await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", name: "Ada", body: {} }),
    );
    assert.equal(joined.status, 200);
    await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "bob", name: "Bob", body: {} }),
    );
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, created_at)
       values ($1, 'ada', 'Ada', 'threat', 'Tom', 1, $2, $3)`,
      ["ban-ada", new Date("2026-11-20T12:00:00Z"), new Date("2026-10-21T12:00:00Z")],
    );
    const again = await app(
      call("/api/calls/rooms/shop/join", { method: "POST", user: "ada", name: "Ada", body: {} }),
    );
    assert.equal(again.status, 403);
    const body = (await again.json()) as {
      error?: string;
      record?: boolean;
      ban?: { reason?: string };
    };
    assert.equal(body.error, "banned");
    assert.equal(body.record, false);
    assert.equal(body.ban?.reason, "threat");
    const bob = await app(call("/api/calls/rooms/shop?since=0", { user: "bob" }));
    const roster = (await bob.json()) as { peers: { id: string }[] };
    assert.equal(
      roster.peers.some((peer) => peer.id === "ada"),
      false,
    );
  } finally {
    await close();
  }
});
