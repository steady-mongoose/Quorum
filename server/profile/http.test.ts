import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";

const now = new Date("2026-10-19T15:00:00Z");

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => now,
    createAccount: async () => ({ id: "unused" }),
    signIn: async () => ({ ok: false, status: 500, message: "unused" }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "Josh", email: "josh@example.com" };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

async function member(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.', $4)`,
    [randomUUID(), id, name, now],
  );
}

function send(
  handler: (request: Request) => Promise<Response>,
  id: string,
  path: string,
  method: string,
  body?: unknown,
) {
  return handler(
    new Request(`http://127.0.0.1:8787${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-user-id": id,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

test("profile routes require a session", async () => {
  const { db, close } = await openTestDb();
  try {
    const response = await app(db)(new Request("http://127.0.0.1:8787/api/profile"));
    assert.equal(response.status, 401);
  } finally {
    await close();
  }
});

test("onboarding stores a profile, skips a gender already set, and hides the birthdate", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    await db.query(
      `insert into members (user_id, display_name, gender) values ('ann', 'Ann Vale', 'woman')`,
    );
    const handler = app(db);
    const young = await send(handler, "ann", "/api/profile/onboard", "POST", {
      birthdate: "2015-01-01",
    });
    assert.equal(young.status, 400);
    assert.match(await young.text(), /18/);
    const onboarded = await send(handler, "ann", "/api/profile/onboard", "POST", {
      birthdate: "1990-04-02",
      bio: "Keeps bees.",
      location: { county: "hillsborough", town: "brandon" },
      church: "Grace Bible Church of Brandon",
      interests: ["books"],
      links: [{ url: "HTTPS://Example.com/A", label: "Notes" }],
    });
    const text = await onboarded.text();
    assert.equal(onboarded.status, 200, text);
    assert.equal(text.includes("1990-04-02"), false);
    assert.equal(Object.hasOwn(JSON.parse(text).profile, "birthdate"), false);
    const body = JSON.parse(text) as {
      profile: {
        onboarded: boolean;
        gender: string;
        age: number;
        birthdateSet: boolean;
        displayName: string;
        links: { url: string }[];
        location: { townName: string };
      };
    };
    assert.equal(body.profile.onboarded, true);
    assert.equal(body.profile.gender, "woman");
    assert.equal(body.profile.age, 36);
    assert.equal(body.profile.birthdateSet, true);
    assert.equal(body.profile.displayName, "Ann Vale");
    assert.equal(body.profile.links[0]?.url, "https://example.com/A");
    assert.equal(body.profile.location.townName, "Brandon");

    const changed = await send(handler, "ann", "/api/profile", "PATCH", { gender: "man" });
    assert.equal(changed.status, 403);
    assert.match(await changed.text(), /cannot change this yourself/i);

    const own = await send(handler, "ann", "/api/profile", "GET");
    const ownBody = (await own.json()) as { options: { churches: string[] } };
    assert.equal(ownBody.options.churches.includes("Grace Bible Church of Brandon"), true);
  } finally {
    await close();
  }
});

test("links, admins-only visibility, and the anonymous flag are refused", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    const handler = app(db);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "vbscript:msgbox(1)",
      "file:///tmp/a",
      "http://example.com",
    ]) {
      const response = await send(handler, "ann", "/api/profile", "PATCH", {
        links: [{ url }],
      });
      assert.equal(response.status, 400, url);
      const text = await response.text();
      assert.match(text, /https/i, text);
    }
    const tooMany = await send(handler, "ann", "/api/profile", "PATCH", {
      links: Array.from({ length: 6 }, (_, index) => ({ url: `https://example.com/${index}` })),
    });
    assert.equal(tooMany.status, 400);
    const admins = await send(handler, "ann", "/api/profile", "PATCH", {
      visibility: { bio: "admins" },
    });
    assert.equal(admins.status, 400);
    assert.match(await admins.text(), /0025/);
    const anonymous = await send(handler, "ann", "/api/profile", "PATCH", { anonymous: true });
    assert.equal(anonymous.status, 400);
    assert.match(await anonymous.text(), /0025/);
  } finally {
    await close();
  }
});

test("another member reads the profile through profileView", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    await member(db, "bo", "Bo Hale");
    const handler = app(db);
    const onboarded = await send(handler, "ann", "/api/profile/onboard", "POST", {
      displayName: "Annie",
      gender: "woman",
      birthdate: "1990-04-02",
      bio: "Keeps bees.",
    });
    assert.equal(onboarded.status, 200, await onboarded.clone().text());
    const viewed = await send(handler, "bo", "/api/profile/ann", "GET");
    const text = await viewed.text();
    assert.equal(viewed.status, 200, text);
    assert.equal(text.includes("1990-04-02"), false);
    const body = JSON.parse(text) as {
      profile: { displayName: string; bio?: string; vouchedName?: string; age?: number };
    };
    assert.equal(body.profile.displayName, "Annie");
    assert.equal(body.profile.bio, "Keeps bees.");
    assert.equal(body.profile.vouchedName, undefined);
    assert.equal(body.profile.age, 36);
  } finally {
    await close();
  }
});
