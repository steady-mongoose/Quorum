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

test("two first gender writes cannot overwrite each other", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    await db.query(`insert into members (user_id, display_name) values ('ann', 'Ann Vale')`);
    const handler = app(db);
    const [left, right] = await Promise.all([
      send(handler, "ann", "/api/profile", "PATCH", { gender: "woman" }),
      send(handler, "ann", "/api/profile", "PATCH", { gender: "man" }),
    ]);
    const won = [left, right].filter((response) => response.status === 200);
    const lost = [left, right].filter((response) => response.status === 403);
    assert.equal(won.length, 1, `${left.status} ${right.status}`);
    assert.equal(lost.length, 1);
    assert.match(await lost[0]!.text(), /cannot change this yourself/i);
    const winner = won[0] === left ? "woman" : "man";
    const rows = await db.query<{ gender: string }>(
      `select gender from members where user_id = 'ann'`,
    );
    assert.equal(rows[0]?.gender, winner);
    const second = await db.query<{ user_id: string }>(
      `update members set gender = 'man' where user_id = 'ann' and gender is null returning user_id`,
    );
    assert.equal(second.length, 0);
    const still = await db.query<{ gender: string }>(
      `select gender from members where user_id = 'ann'`,
    );
    assert.equal(still[0]?.gender, winner);
  } finally {
    await close();
  }
});

test("a birthdate locks after onboarding, and only an approved correction changes it", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    await member(db, "ada", "Ada Glen");
    await db.query(`insert into member_role (user_id, is_admin) values ('ada', true)`);
    const handler = app(db);
    const early = await send(handler, "ann", "/api/profile", "PATCH", { birthdate: "1991-01-01" });
    assert.equal(early.status, 200, await early.clone().text());
    const corrected = await send(handler, "ann", "/api/profile", "PATCH", {
      birthdate: "1990-04-02",
    });
    assert.equal(corrected.status, 200, await corrected.clone().text());
    const onboarded = await send(handler, "ann", "/api/profile/onboard", "POST", {
      gender: "woman",
    });
    assert.equal(onboarded.status, 200, await onboarded.clone().text());
    const locked = await send(handler, "ann", "/api/profile", "PATCH", { birthdate: "1992-01-01" });
    assert.equal(locked.status, 403);
    assert.match(await locked.text(), /cannot change this yourself/i);
    const stored = await db.query<{ birthdate: string }>(
      `select to_char(birthdate, 'YYYY-MM-DD') as birthdate from members where user_id = 'ann'`,
    );
    assert.equal(stored[0]?.birthdate, "1990-04-02");

    // The old direct admin edit is gone.
    const direct = await send(handler, "ada", "/api/profile/ann/birthdate", "POST", {
      birthdate: "1989-04-02",
      reason: "No.",
    });
    assert.equal(direct.status === 404 || direct.status === 405, true);

    const unnamed = await send(handler, "ann", "/api/profile/corrections", "POST", {
      field: "birthdate",
      value: "1989-04-02",
    });
    assert.equal(unnamed.status, 400);
    const asked = await send(handler, "ann", "/api/profile/corrections", "POST", {
      field: "birthdate",
      value: "1989-04-02",
      reason: "I typed the wrong year.",
    });
    const askedText = await asked.text();
    assert.equal(asked.status, 201, askedText);
    assert.equal(askedText.includes("1989-04-02"), false);
    const id = (JSON.parse(askedText) as { correction: { id: string } }).correction.id;
    const twice = await send(handler, "ann", "/api/profile/corrections", "POST", {
      field: "birthdate",
      value: "1988-04-02",
      reason: "Again.",
    });
    assert.equal(twice.status, 409);

    const memberDecides = await send(handler, "ann", `/api/profile/corrections/${id}`, "POST", {
      decision: "approve",
    });
    assert.equal(memberDecides.status, 403);
    const queue = await send(handler, "ada", "/api/profile/corrections?scope=queue", "GET");
    const queueText = await queue.text();
    assert.equal(queue.status, 200);
    assert.equal(queueText.includes("1989-04-02"), false);
    assert.match(queueText, /age 37/);

    const approved = await send(handler, "ada", `/api/profile/corrections/${id}`, "POST", {
      decision: "approve",
    });
    assert.equal(approved.status, 200, await approved.clone().text());
    const next = await db.query<{ birthdate: string }>(
      `select to_char(birthdate, 'YYYY-MM-DD') as birthdate from members where user_id = 'ann'`,
    );
    assert.equal(next[0]?.birthdate, "1989-04-02");
    const audit = await db.query<{ action: string; actor_user_id: string; detail: string }>(
      `select action, actor_user_id, detail from gender_audit
       where subject_user_id = 'ann' and action in ('correction-request', 'change-birthdate')
       order by at, action`,
    );
    assert.deepEqual(
      audit.map((row) => row.action).sort(),
      ["change-birthdate", "correction-request"],
    );
    assert.equal(audit.find((row) => row.action === "change-birthdate")?.actor_user_id, "ada");
    assert.match(audit.find((row) => row.action === "change-birthdate")?.detail ?? "", /1990-04-02 -> 1989-04-02/);
    const again = await send(handler, "ada", `/api/profile/corrections/${id}`, "POST", { decision: "approve" });
    assert.equal(again.status, 404);
  } finally {
    await close();
  }
});

test("the 18th birthday follows the New York date, not UTC", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ann", "Ann Vale");
    const evening = createApp({
      db,
      origins: ["http://localhost:8080"],
      now: () => new Date("2026-10-19T03:30:00Z"),
      createAccount: async () => ({ id: "unused" }),
      signIn: async () => ({ ok: false, status: 500, message: "unused" }),
      readSession: async (headers) => {
        const id = headers.get("x-user-id");
        if (!id) return null;
        return { id, name: "Josh", email: "josh@example.com" };
      },
      forwardAuth: async () => new Response(null, { status: 500 }),
    });
    const tooYoung = await send(evening, "ann", "/api/profile/onboard", "POST", {
      displayName: "Ann",
      gender: "woman",
      birthdate: "2008-10-19",
    });
    assert.equal(tooYoung.status, 400);
    assert.match(await tooYoung.text(), /18/);
    const ofAge = await send(evening, "ann", "/api/profile/onboard", "POST", {
      displayName: "Ann",
      gender: "woman",
      birthdate: "2008-10-18",
    });
    assert.equal(ofAge.status, 200, await ofAge.clone().text());
    assert.equal((await ofAge.text()).includes("2008-10-18"), false);
  } finally {
    await close();
  }
});

test("an admin cannot approve their own correction, and a refusal needs a reason", async () => {
  const { db, close } = await openTestDb();
  try {
    await member(db, "ada", "Ada Glen");
    await member(db, "bo", "Bo Reed");
    await member(db, "cy", "Cy Marsh");
    await db.query(`insert into member_role (user_id, is_admin) values ('ada', true), ('bo', true)`);
    await db.query(
      `insert into members (user_id, display_name, gender, birthdate, onboarded_at)
       values ('ada', 'Ada Glen', 'woman', '1980-01-01', $1), ('cy', 'Cy Marsh', 'man', '1985-05-05', $1)`,
      [now],
    );
    const handler = app(db);
    const early = await send(handler, "bo", "/api/profile/corrections", "POST", {
      field: "gender",
      value: "man",
      reason: "Wrong.",
    });
    assert.equal(early.status, 409, "not onboarded yet: edit directly");
    const own = await send(handler, "ada", "/api/profile/corrections", "POST", {
      field: "gender",
      value: "man",
      reason: "I picked the wrong one.",
    });
    assert.equal(own.status, 201);
    const ownId = ((await own.json()) as { correction: { id: string } }).correction.id;
    const self = await send(handler, "ada", `/api/profile/corrections/${ownId}`, "POST", { decision: "approve" });
    assert.equal(self.status, 403);
    const queue = (await (await send(handler, "ada", "/api/profile/corrections?scope=queue", "GET")).json()) as {
      corrections: { id: string }[];
    };
    assert.equal(queue.corrections.some((item) => item.id === ownId), false);

    const cy = await send(handler, "cy", "/api/profile/corrections", "POST", {
      field: "gender",
      value: "woman",
      reason: "I tapped the wrong button.",
    });
    const cyId = ((await cy.json()) as { correction: { id: string } }).correction.id;
    const bare = await send(handler, "bo", `/api/profile/corrections/${cyId}`, "POST", { decision: "refuse" });
    assert.equal(bare.status, 400);
    const refused = await send(handler, "bo", `/api/profile/corrections/${cyId}`, "POST", {
      decision: "refuse",
      note: "Please talk to an admin first.",
    });
    assert.equal(refused.status, 200);
    const gender = await db.query<{ gender: string }>(`select gender from members where user_id = 'cy'`);
    assert.equal(gender[0]?.gender, "man");
    const logged = await db.query(`select 1 from gender_audit where action = 'correction-refuse' and subject_user_id = 'cy'`);
    assert.equal(logged.length, 1);

    await db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id)
       values ('ban-bo', 'bo', 'Bo Reed', 'threat', 'test', 1, '2099-01-01T00:00:00Z', '')`,
    );
    const barred = await send(handler, "bo", `/api/profile/corrections/${ownId}`, "POST", { decision: "approve" });
    assert.equal(barred.status, 403);
    const still = await db.query<{ gender: string }>(`select gender from members where user_id = 'ada'`);
    assert.equal(still[0]?.gender, "woman");
  } finally {
    await close();
  }
});
