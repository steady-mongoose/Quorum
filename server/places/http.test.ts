import assert from "node:assert/strict";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { trustAuthenticator } from "../mfa/test-trust.ts";
import type { PlaceLookup, SearchInput } from "./lookup.ts";

const now = new Date("2026-10-29T23:00:00Z");

function app(db: Db, places?: PlaceLookup) {
  const sessions = new Map<string, Promise<string>>();
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      let session = sessions.get(id);
      if (!session) {
        session = trustAuthenticator(db, id);
        sessions.set(id, session);
      }
      return { id, name: "Ann", email: "ann@example.com", sessionId: await session };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
    places,
  } satisfies AppDeps);
}

async function member(db: Db, id: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Ann', $2, true, $3, $3)`,
    [id, `${id}@example.com`, now],
  );
}

function post(id: string | null, body: unknown) {
  return new Request("http://127.0.0.1:8787/api/places/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...(id ? { "x-user-id": id } : {}) },
    body: JSON.stringify(body),
  });
}

test("place search needs a session, three letters, and returns places with attribution", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann");
    const seen: { memberId: string; input: SearchInput }[] = [];
    const places: PlaceLookup = {
      inspect: () => ({ cacheKeys: [], limiterKeys: [] }),
      search: async (memberId, input) => {
        seen.push({ memberId, input });
        return {
          ok: true,
          places: [
            { ref: "node/2", name: "Near Church", address: "Brandon, Florida", distanceKm: 1 },
          ],
        };
      },
    };
    const handler = app(db, places);
    assert.equal((await handler(post(null, { q: "Grace", kind: "church" }))).status, 401);
    assert.equal((await handler(post("ann", { q: "Gr", kind: "church" }))).status, 400);
    const ok = await handler(
      post("ann", { q: "Grace", kind: "church", near: { lat: 27.937812, lon: -82.285912 } }),
    );
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { places: { ref: string }[]; attribution: string };
    assert.equal(body.places[0]?.ref, "node/2");
    assert.equal(body.attribution, "© OpenStreetMap contributors");
    assert.deepEqual(seen[0]?.input.near, { lat: 27.94, lon: -82.29 });
    const get = await handler(
      new Request("http://127.0.0.1:8787/api/places/search", { headers: { "x-user-id": "ann" } }),
    );
    assert.equal(get.status, 405);
  } finally {
    await close();
  }
});

test("place search answers 503 when it is not configured", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann");
    const response = await app(db)(post("ann", { q: "Grace", kind: "church" }));
    assert.equal(response.status, 503);
  } finally {
    await close();
  }
});
