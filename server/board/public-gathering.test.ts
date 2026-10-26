import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";

const PRIVATE = {
  host: "Dale",
  going: ["Josh", "Pete"],
  place: "Dale's garage, 1010 E Brandon Blvd, Riverview",
  posts: ["Josh came and brought the plates."],
  members: ["Dale", "Josh"],
  address: "1010 E Brandon Blvd",
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

test("a shared gathering is public, and every other gathering is a 404", async () => {
  const { db, close } = await openTestDb();
  try {
    const dale = await user(db, "Dale");
    const maria = await user(db, "Maria");
    const handler = app(db);
    const missing = await handler(new Request("http://127.0.0.1:8787/e/s-lifts"));
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(await missing.text(), /not shared/);

    const unsigned = await handler(
      new Request("http://127.0.0.1:8787/api/e/s-lifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared: true, title: "Saturday lifts", date: "2026-10-24", town: "Riverview" }),
      }),
    );
    assert.equal(unsigned.status, 401);

    const published = await handler(
      new Request("http://127.0.0.1:8787/api/e/s-lifts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({
          shared: true,
          title: "Saturday lifts, garage gym",
          date: "2026-10-24",
          town: "Riverview",
          ...PRIVATE,
        }),
      }),
    );
    assert.equal(published.status, 200);

    const page = await handler(new Request("http://127.0.0.1:8787/e/s-lifts"));
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);
    const html = await page.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /Saturday lifts, garage gym/);
    assert.match(html, /October 24, 2026/);
    assert.match(html, /Riverview/);
    assert.equal(html.includes("Dale"), false);
    assert.equal(html.includes("Josh"), false);
    assert.equal(html.includes("Pete"), false);
    assert.equal(html.includes("1010"), false);
    assert.equal(html.includes("plates"), false);
    assert.equal(/\bgoing\b|\bposts\b|\baddress\b/i.test(html), false);

    const jsonPage = await handler(new Request("http://127.0.0.1:8787/api/e/s-lifts"));
    assert.equal(jsonPage.status, 200);
    const body = (await jsonPage.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["date", "title", "town"]);
    assert.equal(body.title, "Saturday lifts, garage gym");
    assert.equal("host" in body, false);
    assert.equal("going" in body, false);
    assert.equal("place" in body, false);
    assert.equal("posts" in body, false);
    assert.equal("members" in body, false);

    const stolen = await handler(
      new Request("http://127.0.0.1:8787/api/e/s-lifts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": maria },
        body: JSON.stringify({ shared: false, title: "Saturday lifts", date: "2026-10-24", town: "Riverview" }),
      }),
    );
    assert.equal(stolen.status, 403);

    const closed = await handler(
      new Request("http://127.0.0.1:8787/api/e/s-lifts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": dale },
        body: JSON.stringify({ shared: false }),
      }),
    );
    assert.equal(closed.status, 200);
    const gone = await handler(new Request("http://127.0.0.1:8787/api/e/s-lifts"));
    assert.equal(gone.status, 404);
    const goneBody = (await gone.json()) as Record<string, unknown>;
    assert.deepEqual(goneBody, { error: "Not found." });
    assert.equal("title" in goneBody, false);

    const other = await handler(new Request("http://127.0.0.1:8787/api/e/s-ham"));
    assert.equal(other.status, 404);
    const door = await handler(new Request("http://127.0.0.1:8787/api/invite-log"));
    assert.equal(door.status, 401);
    const home = await handler(new Request("http://127.0.0.1:8787/"));
    assert.equal(home.status, 404);
  } finally {
    await close();
  }
});
