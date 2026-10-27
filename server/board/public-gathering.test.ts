import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { gatheringViewLimitKey } from "./public-gathering.ts";
import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT } from "../rate-limit.ts";

const DALE_ID = "3f2a9c1e-8241-4c3e-9a11-8241abcd1234";
const PRIVATE = {
  host: "Dale",
  going: ["Josh", "Pete"],
  place: "Dale's garage, 1010 E Brandon Blvd, Riverview",
  posts: ["Josh came and brought the plates."],
  members: ["Dale", "Josh"],
  address: "1010 E Brandon Blvd",
  title: "Free prize claim now",
  town: "1010 E Brandon Blvd",
  time: "Call Dale at 813-662-9622",
};

async function user(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`],
  );
  return id;
}

async function grant(db: Db, userId: string, name: string, role: "member" | "steward", roomId = "") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name, role, roomId],
  );
}

async function scopeToTown(db: Db, roomId: string, name: string) {
  const townId = name.toLowerCase();
  await db.query(`insert into town (id, name, state) values ($1, $2, 'FL') on conflict (id) do nothing`, [
    townId,
    name,
  ]);
  await db.query(`update room set scope_kind = 'town', town_id = $2 where id = $1`, [roomId, townId]);
}

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => new Date("2026-10-19T12:00:00Z"),
    createAccount: async () => ({ id: randomUUID() }),
    signIn: async (input) => ({
      ok: true,
      user: { id: input.userId, name: input.name, email: input.email },
    }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Dale", email: "dale@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function save(handler: (request: Request) => Promise<Response>, userId: string, body: Record<string, unknown>) {
  return handler(
    new Request("http://127.0.0.1:8787/api/gatherings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": userId },
      body: JSON.stringify(body),
    }),
  );
}

test("a member cannot publish someone else's gathering or a missing one", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    const maria = await user(db, "Maria");
    await grant(db, dale, "Dale", "member");
    await grant(db, maria, "Maria", "member");
    const handler = app(db);

    const unsigned = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared: true, title: "Free prize claim now" }),
      }),
    );
    assert.equal(unsigned.status, 401);

    const missing = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria },
        body: JSON.stringify({ shared: true, ...PRIVATE }),
      }),
    );
    assert.equal(missing.status, 404);

    const created = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-24",
      time: "7 a.m.",
      place: "Dale's garage, 1010 E Brandon Blvd, Riverview",
      town: "Tampa",
      host: PRIVATE.host,
      going: PRIVATE.going,
      posts: PRIVATE.posts,
      members: PRIVATE.members,
      address: PRIVATE.address,
    });
    assert.equal(created.status, 200);

    const squatted = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria },
        body: JSON.stringify({ shared: true, title: "Free prize claim now", town: "1010 E Brandon Blvd" }),
      }),
    );
    assert.equal(squatted.status, 403);
    const hidden = await handler(new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`));
    assert.equal(hidden.status, 404);

    const guess = await handler(
      new Request("http://127.0.0.1:8787/api/e/1", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria },
        body: JSON.stringify({ shared: true, title: "Free prize claim now" }),
      }),
    );
    assert.equal(guess.status, 404);
    const guessPage = await handler(new Request("http://127.0.0.1:8787/e/1"));
    assert.equal(guessPage.status, 404);
  } finally {
    await close();
  }
});

test("the public page is the live stored gathering, and sharing loads from the server", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    const maria = await user(db, "Maria");
    const ruth = await user(db, "Ruth");
    await grant(db, dale, "Dale", "member");
    await grant(db, maria, "Maria", "member");
    await grant(db, ruth, "Ruth", "member");
    await grant(db, ruth, "Ruth", "steward", "shop");
    await scopeToTown(db, "shop", "Riverview");
    const handler = app(db);
    const created = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-24",
      time: "07:00",
      place: "Dale's garage, 1010 E Brandon Blvd, Riverview",
    });
    assert.equal(created.status, 200);

    const stewardOn = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": ruth },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(stewardOn.status, 403);
    assert.equal((await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`))).status, 404);

    const off = await handler(
      new Request(`http://127.0.0.1:8787/api/gatherings/${DALE_ID}`, {
        headers: { "x-user-id": dale },
      }),
    );
    assert.equal(off.status, 200);
    const offBody = (await off.json()) as { gathering: { shared: boolean; place: string } };
    assert.equal(offBody.gathering.shared, false);

    const published = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({ shared: true, ...PRIVATE }),
      }),
    );
    assert.equal(published.status, 200);

    const page = await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`));
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);
    const html = await page.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /property="og:title" content="Saturday lifts"/);
    assert.match(html, /property="og:image" content="https:\/\/avouchsocial\.com\/art\/dore-og\.jpg"/);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /<link rel="stylesheet" href="\/gathering\.css">/);
    assert.match(html, /property="og:description" content="October 24, 2026 · 07:00 · Riverview"/);
    assert.match(html, /property="og:type" content="website"/);
    assert.match(html, /name="twitter:title" content="Saturday lifts"/);
    assert.match(html, /name="twitter:description" content="October 24, 2026 · 07:00 · Riverview"/);
    assert.match(html, /07:00/);
    assert.match(html, /Riverview/);
    assert.match(html, /hero-band/);
    assert.equal(html.includes("Free prize"), false);
    assert.equal(html.includes("Dale"), false);
    assert.equal(html.includes("Josh"), false);
    assert.equal(html.includes("Pete"), false);
    assert.equal(html.includes("1010"), false);
    assert.equal(html.includes("plates"), false);
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      assert.equal(/Dale|Josh|Pete|1010|plates|Free prize/.test(tag), false, tag);
    }

    const jsonPage = await handler(new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`));
    const body = (await jsonPage.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["date", "time", "title", "town"]);
    assert.equal(body.title, "Saturday lifts");
    assert.equal(body.time, "07:00");
    assert.equal("place" in body, false);
    assert.equal("host" in body, false);

    const edited = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts, later",
      date: "2026-10-31",
      time: "8:00 a.m.",
      place: "The shop, Riverview",
    });
    assert.equal(edited.status, 200);
    const live = await handler(new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`));
    const liveBody = (await live.json()) as { title: string; time: string; date: string; town: string };
    assert.equal(liveBody.title, "Saturday lifts, later");
    assert.equal(liveBody.time, "8:00 a.m.");
    assert.equal(liveBody.date, "2026-10-31");
    assert.equal(liveBody.town, "Riverview");

    const loaded = await handler(
      new Request(`http://127.0.0.1:8787/api/gatherings/${DALE_ID}`, {
        headers: { "x-user-id": dale },
      }),
    );
    const loadedBody = (await loaded.json()) as { gathering: { shared: boolean; title: string } };
    assert.equal(loadedBody.gathering.shared, true);
    assert.equal(loadedBody.gathering.title, "Saturday lifts, later");

    const stewardAgain = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": ruth },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(stewardAgain.status, 403);
    assert.equal((await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`))).status, 200);

    const steward = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": ruth },
        body: JSON.stringify({ shared: false, title: "Free prize claim now" }),
      }),
    );
    assert.equal(steward.status, 200);
    const unshared = await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`));
    assert.equal(unshared.status, 404);
    assert.match(await unshared.text(), /not shared/);

    const again = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(again.status, 200);
    const removed = await handler(
      new Request(`http://127.0.0.1:8787/api/gatherings/${DALE_ID}`, {
        method: "DELETE",
        headers: { "x-user-id": dale },
      }),
    );
    assert.equal(removed.status, 200);
    const gone = await handler(new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`));
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { error: "Not found." });

    const door = await handler(new Request("http://127.0.0.1:8787/api/invite-log"));
    assert.equal(door.status, 401);
  } finally {
    await close();
  }
});

test("a free-text time is stored for the host and omitted from the public page", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    const ruth = await user(db, "Ruth");
    await grant(db, dale, "Dale", "member");
    await grant(db, ruth, "Ruth", "member");
    await grant(db, ruth, "Ruth", "steward", "shop");
    await scopeToTown(db, "shop", "Riverview");
    const handler = app(db);
    const sentence = "Meet behind the old mill on Route 9";
    const created = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-24",
      time: sentence,
      place: "Riverview",
    });
    assert.equal(created.status, 200);
    const turnedOn = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": ruth },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(turnedOn.status, 403);
    const hostOn = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({ shared: true, time: sentence }),
      }),
    );
    assert.equal(hostOn.status, 200);
    const page = await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`));
    const html = await page.text();
    assert.equal(html.includes(sentence), false);
    assert.equal(html.includes("Route"), false);
    assert.equal(html.includes("mill"), false);
    const tags = (html.match(/<meta\b[^>]*>/gi) ?? []).join("\n");
    assert.equal(tags.includes(sentence), false);
    assert.match(tags, /property="og:description" content="October 24, 2026 · Riverview"/);
    const jsonPage = await handler(new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`));
    const body = (await jsonPage.json()) as Record<string, unknown>;
    assert.equal(JSON.stringify(body).includes(sentence), false);
    assert.equal("time" in body, false);
    const mine = await handler(
      new Request(`http://127.0.0.1:8787/api/gatherings/${DALE_ID}`, {
        headers: { "x-user-id": dale },
      }),
    );
    const stored = (await mine.json()) as { gathering: { time: string } };
    assert.equal(stored.gathering.time, sentence);
    const off = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": ruth },
        body: JSON.stringify({ shared: false }),
      }),
    );
    assert.equal(off.status, 200);
    assert.equal((await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`))).status, 404);
  } finally {
    await close();
  }
});

test("a removed gathering or a banned host is not public", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    await grant(db, dale, "Dale", "member");
    const handler = app(db);
    assert.equal(
      (await save(handler, dale, {
        id: DALE_ID,
        roomId: "shop",
        title: "Saturday lifts",
        date: "2026-10-24",
        time: "7 a.m.",
        place: "Riverview",
      })).status,
      200,
    );
    assert.equal(
      (
        await handler(
          new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-user-id": dale },
            body: JSON.stringify({ shared: true }),
          }),
        )
      ).status,
      200,
    );
    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Dale', 'threat', 'Tom', 1, $3, 'shop', $4)`,
      [randomUUID(), dale, new Date("2026-12-01T00:00:00Z"), new Date("2026-10-19T12:00:00Z")],
    );
    const banned = await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`));
    assert.equal(banned.status, 404);
    const bannedPost = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(bannedPost.status, 404);
  } finally {
    await close();
  }
});

test("share and view are rate limited", async () => {
  const { db, close } = await openTestDb();
  try {
    const handler = app(db);
    const now = Date.now();
    await db.query(
      `insert into "rateLimit" ("id", "key", "count", "lastRequest") values ($1, $2, $3, $4)`,
      [randomUUID(), gatheringViewLimitKey("local"), BOARD_READ_LIMIT.max, now],
    );
    const viewed = await handler(new Request(`http://127.0.0.1:8787/e/${DALE_ID}`));
    assert.equal(viewed.status, 429);

    await db.query(
      `insert into "rateLimit" ("id", "key", "count", "lastRequest") values ($1, $2, $3, $4)`,
      [randomUUID(), "board-write:ip:local", BOARD_WRITE_LIMIT.max, now],
    );
    const posted = await handler(
      new Request(`http://127.0.0.1:8787/api/e/${DALE_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared: true }),
      }),
    );
    assert.equal(posted.status, 429);
  } finally {
    await close();
  }
});

test("the public town is the room's structured town, never the place line", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    await grant(db, dale, "Dale", "member");
    const handler = app(db);
    const saved = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-24",
      time: "07:00",
      place: "Dale's garage, 1010 E Brandon Blvd, Riverview Street",
    });
    assert.equal(saved.status, 200);
    const row = await db.query<{ town: string }>(`select town from public_gathering where id = $1`, [DALE_ID]);
    assert.equal(row[0]?.town, "");

    await scopeToTown(db, "shop", "Riverview");
    const again = await save(handler, dale, {
      id: DALE_ID,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-24",
      time: "07:00",
      place: "Dale's garage, 1010 E Brandon Blvd, Brandon",
    });
    assert.equal(again.status, 200);
    const scoped = await db.query<{ town: string }>(`select town from public_gathering where id = $1`, [DALE_ID]);
    assert.equal(scoped[0]?.town, "Riverview");
  } finally {
    await close();
  }
});
