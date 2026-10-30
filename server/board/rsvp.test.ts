import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trustAuthenticator } from "../mfa/test-trust.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { MARK_REFUSED, moveEntries, RSVP_BATCH_MAX, RSVP_NOT_READY } from "./rsvp.ts";

const GATHERING = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "7c2a3b4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e";
/** Hosted by Maria, in the same room as Dale's. */
const MARIAS = "9e4c5d6f-7a81-4d9e-9fa0-2b3c4d5e6f70";
const BASE = "http://127.0.0.1:8787";

async function user(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`],
  );
  return id;
}

async function grant(db: Db, userId: string, name: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name],
  );
}

async function stewardOf(db: Db, userId: string, name: string, roomId: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'steward', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name, roomId],
  );
}

async function makeAdmin(db: Db, userId: string) {
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair)
     values ($1, true, false, false)
     on conflict (user_id) do update set is_admin = true`,
    [userId],
  );
}

function app(db: Db) {
  return createApp({
    db,
    origins: ["http://localhost:8080"],
    now: () => new Date("2026-10-29T12:00:00Z"),
    createAccount: async () => ({ id: randomUUID() }),
    signIn: async (input) => ({
      ok: true,
      user: { id: input.userId, name: input.name, email: input.email },
    }),
    readSession: async (headers) => {
      const id = headers.get("x-user-id");
      if (!id) return null;
      return { id, name: "x", email: "x@example.com", sessionId: headers.get("x-session-id") ?? undefined };
    },
    forwardAuth: async () => new Response(null, { status: 500 }),
  } satisfies AppDeps);
}

type Handler = (request: Request) => Promise<Response>;
type As = { id: string; session?: string };

function call(handler: Handler, as: As | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers["x-user-id"] = as.id;
  if (as?.session) headers["x-session-id"] = as.session;
  return handler(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function setup() {
  const opened = await openTestDb();
  const { db } = opened;
  const dale = await user(db, "Dale");
  const maria = await user(db, "Maria");
  const tom = await user(db, "Tom");
  const josh = await user(db, "Josh");
  const owner = await user(db, "Olive");
  const sam = await user(db, "Sam");
  const cara = await user(db, "Cara");
  for (const [id, name] of [
    [dale, "Dale"],
    [maria, "Maria"],
    [tom, "Tom"],
    [josh, "Josh"],
    [owner, "Olive"],
    [sam, "Sam"],
    [cara, "Cara"],
  ] as const) {
    await grant(db, id, name);
  }
  await makeAdmin(db, josh);
  await db.query(`insert into bootstrap_seat (id, user_id) values ('founding', $1) on conflict (id) do update set user_id = $1`, [owner]);
  await stewardOf(db, sam, "Sam", "shop");
  await stewardOf(db, cara, "Cara", "county");
  const joshSession = await trustAuthenticator(db, josh);
  const ownerSession = await trustAuthenticator(db, owner);
  const samSession = await trustAuthenticator(db, sam);
  const caraSession = await trustAuthenticator(db, cara);
  const handler = app(db);
  for (const [id, host] of [
    [GATHERING, dale],
    [OTHER, dale],
    [MARIAS, maria],
  ] as const) {
    const saved = await call(handler, { id: host }, "POST", "/api/gatherings", {
      id,
      roomId: "shop",
      title: "Saturday lifts",
      date: "2026-10-31",
      time: "7 a.m.",
      place: "Dale's garage, Riverview",
    });
    assert.equal(saved.status, 200, await saved.clone().text());
  }
  return {
    ...opened,
    handler,
    dale: { id: dale },
    maria: { id: maria },
    tom: { id: tom },
    josh: { id: josh, session: joshSession },
    owner: { id: owner, session: ownerSession },
    sam: { id: sam, session: samSession },
    cara: { id: cara, session: caraSession },
  };
}

type ListBody = {
  viewer: string;
  admin: boolean;
  hosts: string[];
  stewardRooms: string[];
  rsvps: { gatheringId: string; roomId: string; userId: string; name: string; going: boolean; attended: boolean }[];
};

/** What one viewer can read, as [gathering, name, going, attended], sorted. */
async function seen(t: Awaited<ReturnType<typeof setup>>, who: As) {
  const res = await call(t.handler, who, "GET", "/api/rsvps");
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;
  return {
    body,
    rows: body.rsvps
      .map((row) => [row.gatheringId === GATHERING ? "G" : row.gatheringId === MARIAS ? "M" : "O", row.name, row.going, row.attended] as const)
      .map((row) => row.join(":"))
      .sort(),
  };
}

/**
 * Dale hosts G. Maria hosts M. Tom and Maria are going to G; Tom came to G
 * once already (marked by Dale). Tom and Dale are going to M.
 */
async function scene(t: Awaited<ReturnType<typeof setup>>) {
  await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
  const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
    userIds: [t.tom.id],
  });
  assert.equal(marked.status, 200);
  await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
  await call(t.handler, t.tom, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
  await call(t.handler, t.dale, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
}

test("a member sees only their own RSVP: no other names, no counts", async () => {
  const t = await setup();
  try {
    for (const who of [t.maria, t.tom]) {
      const set = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
      assert.equal(set.status, 200);
      assert.deepEqual(await set.json(), { mine: { going: true, attended: false } });
    }

    const one = await call(t.handler, t.maria, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(one.status, 200);
    const oneBody = await one.json();
    assert.deepEqual(oneBody, { mine: { going: true, attended: false } });

    const all = await call(t.handler, t.maria, "GET", "/api/rsvps");
    const body = (await all.json()) as { viewer: string; admin: boolean; rsvps: { userId: string; name: string }[] };
    assert.equal(body.admin, false);
    assert.equal(body.viewer, t.maria.id);
    assert.equal(body.rsvps.length, 1);
    assert.equal(body.rsvps[0]?.userId, t.maria.id);
    const text = JSON.stringify(body) + JSON.stringify(oneBody);
    assert.equal(text.includes("Tom"), false);
    assert.equal(text.includes(t.tom.id), false);
    assert.equal(/count|total|score|like/i.test(text), false);


    // Clearing my RSVP removes it.
    const cleared = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    assert.deepEqual(await cleared.json(), { mine: { going: false, attended: false } });
  } finally {
    await t.close();
  }
});

test("an admin sees everyone who is going and who has been", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.tom.id],
      close: false,
    });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    const one = await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(one.status, 200);
    const body = (await one.json()) as { people: { name: string; going: boolean; attended: boolean }[] };
    assert.deepEqual(
      body.people.map((row) => [row.name, row.going, row.attended]),
      [
        ["Maria", true, false],
        ["Tom", false, true],
      ],
    );
    const all = (await (await call(t.handler, t.josh, "GET", "/api/rsvps")).json()) as {
      admin: boolean;
      rsvps: { name: string }[];
    };
    assert.equal(all.admin, true);
    assert.deepEqual(all.rsvps.map((row) => row.name).sort(), ["Maria", "Tom"]);
  } finally {
    await t.close();
  }
});

test("the routes check who is asking", async () => {
  const t = await setup();
  try {
    assert.equal((await call(t.handler, null, "GET", "/api/rsvps")).status, 401);
    assert.equal((await call(t.handler, null, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 401);

    // Not a member: the gathering does not exist for them.
    const stranger = { id: await user(t.db, "Stranger") };
    assert.equal(
      (await call(t.handler, stranger, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status,
      404,
    );
    assert.equal((await call(t.handler, stranger, "GET", `/api/gatherings/${GATHERING}/rsvps`)).status, 404);

    // A missing gathering is a 404 too.
    const missing = "8d3b4c5e-6f70-4c8d-8e9f-1a2b3c4d5e6f";
    assert.equal((await call(t.handler, t.maria, "POST", `/api/gatherings/${missing}/rsvp`, { going: true })).status, 404);

    // A member cannot mark anyone as having come, or set it through rsvp.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const sneak = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.tom.id],
    });
    assert.equal(sneak.status, 403);
    const fake = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: false });
    assert.equal(fake.status, 400);
    // A member cannot mark themselves as having come, either.
    const self = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
    assert.equal(self.status, 403);
    assert.deepEqual(await self.json(), { error: MARK_REFUSED });
    assert.deepEqual(await sneak.json(), { error: MARK_REFUSED });

    // The host marks who came, but the answer names nobody.
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.tom.id, t.maria.id],
      close: true,
    });
    assert.equal(marked.status, 200);
    assert.deepEqual(await marked.json(), { ok: true });
    const tomNow = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await tomNow.json(), { mine: { going: false, attended: true } });
    // Maria never said she would come, so she was not marked.
    const mariaNow = await call(t.handler, t.maria, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await mariaNow.json(), { mine: { going: false, attended: false } });

    // An admin may mark attendance too.
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const admin = await call(t.handler, t.josh, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [t.maria.id],
    });
    assert.equal(admin.status, 200);

    // Too many ids is refused.
    const many = Array.from({ length: RSVP_BATCH_MAX + 1 }, () => randomUUID());
    assert.equal(
      (await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, { userIds: many })).status,
      400,
    );
  } finally {
    await t.close();
  }
});

test("the one-time move only adds my own rows, and a second run changes nothing", async () => {
  const t = await setup();
  try {
    const entries = [
      { gatheringId: GATHERING, going: true, attended: false },
      { gatheringId: OTHER, going: false, attended: true },
      { gatheringId: "brief", going: true, attended: true },
      { gatheringId: "8d3b4c5e-6f70-4c8d-8e9f-1a2b3c4d5e6f", going: true, attended: false },
      { gatheringId: GATHERING, going: false, attended: false, userId: t.tom.id, name: "Tom" },
    ];
    const first = await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries });
    assert.equal(first.status, 200);
    // OTHER only said "I've been", and Maria is not its host or an admin, so
    // that self-marked flag is dropped and nothing is saved for it.
    assert.deepEqual(((await first.json()) as { saved: string[] }).saved.sort(), [GATHERING]);

    const rows = () =>
      t.db.query<{ gathering_id: string; user_id: string; going: boolean; attended: boolean }>(
        `select gathering_id, user_id, going, attended from gathering_rsvp order by gathering_id, user_id`,
      );
    const before = await rows();
    assert.equal(before.length, 1);
    assert.ok(before.every((row) => row.user_id === t.maria.id && !row.attended));

    const second = await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries });
    assert.equal(second.status, 200);
    assert.deepEqual(await rows(), before);

    // A move never clears what the server already has.
    await call(t.handler, t.maria, "POST", "/api/rsvps/move", {
      entries: [{ gatheringId: GATHERING, going: false, attended: false }],
    });
    assert.deepEqual(await rows(), before);

    const tooMany = Array.from({ length: RSVP_BATCH_MAX + 1 }, () => ({ gatheringId: GATHERING, going: true }));
    assert.equal((await call(t.handler, t.maria, "POST", "/api/rsvps/move", { entries: tooMany })).status, 400);
  } finally {
    await t.close();
  }
});

test("the move keeps a self-marked 'I've been' only for the host or an admin", async () => {
  const t = await setup();
  try {
    const entries = [
      { gatheringId: GATHERING, going: false, attended: true },
      { gatheringId: MARIAS, going: true, attended: true },
    ];
    const rows = (userId: string) =>
      t.db.query<{ gathering_id: string; going: boolean; attended: boolean }>(
        `select gathering_id, going, attended from gathering_rsvp where user_id = $1 order by gathering_id`,
        [userId],
      );
    // Dale hosts G (kept) but not M (dropped, going kept).
    assert.equal((await call(t.handler, t.dale, "POST", "/api/rsvps/move", { entries })).status, 200);
    assert.deepEqual(
      (await rows(t.dale.id)).map((r) => [r.gathering_id, r.going, r.attended]),
      [
        [GATHERING, false, true],
        [MARIAS, true, false],
      ],
    );
    // An admin keeps both.
    assert.equal((await call(t.handler, t.josh, "POST", "/api/rsvps/move", { entries })).status, 200);
    assert.deepEqual(
      (await rows(t.josh.id)).map((r) => [r.gathering_id, r.going, r.attended]),
      [
        [GATHERING, false, true],
        [MARIAS, true, true],
      ],
    );
  } finally {
    await t.close();
  }
});

test("who sees what, by role: admin, owner, host, steward, member, signed out", async () => {
  const t = await setup();
  try {
    await scene(t);
    const everyone = ["G:Maria:true:false", "G:Tom:true:true", "M:Dale:true:false", "M:Tom:true:false"];

    // Admin and owner: everything.
    for (const who of [t.josh, t.owner]) {
      const { body, rows } = await seen(t, who);
      assert.equal(body.admin, true);
      assert.deepEqual(rows, everyone);
      const one = (await (await call(t.handler, who, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: unknown[];
      };
      assert.equal(one.people?.length, 2);
    }

    // Host of G (Dale): G's going and came, plus only his own row on Maria's M.
    {
      const { body, rows } = await seen(t, t.dale);
      assert.equal(body.admin, false);
      assert.deepEqual(body.hosts.sort(), [GATHERING, OTHER].sort());
      assert.deepEqual(rows, ["G:Maria:true:false", "G:Tom:true:true", "M:Dale:true:false"]);
      const own = (await (await call(t.handler, t.dale, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: { name: string }[];
      };
      assert.deepEqual(own.people?.map((p) => p.name), ["Maria", "Tom"]);
      // Another host's gathering: no list, only his own status.
      const other = await (await call(t.handler, t.dale, "GET", `/api/gatherings/${MARIAS}/rsvps`)).json();
      assert.deepEqual(other, { mine: { going: true, attended: false } });
    }

    // Host of M (Maria): M's list, and on Dale's G only her own row.
    {
      const { rows } = await seen(t, t.maria);
      assert.deepEqual(rows, ["G:Maria:true:false", "M:Dale:true:false", "M:Tom:true:false"]);
    }

    // Steward of the room (Sam, shop): who is going and who came, in every
    // shop gathering (Josh, 9:24 PM ET), read only.
    {
      const { body, rows } = await seen(t, t.sam);
      assert.equal(body.admin, false);
      assert.deepEqual(body.stewardRooms, ["shop"]);
      assert.deepEqual(rows, everyone);
      const one = (await (await call(t.handler, t.sam, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: { name: string; attended: boolean }[];
      };
      assert.deepEqual(one.people?.map((p) => [p.name, p.attended]), [
        ["Maria", false],
        ["Tom", true],
      ]);
      // A steward reads who came but does not mark it: not for others, not for themselves.
      const mark = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [t.maria.id],
      });
      assert.equal(mark.status, 403);
      const close = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [],
        close: true,
      });
      assert.equal(close.status, 403);
      const self = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
      assert.equal(self.status, 403);
      // Nothing changed: Maria is still not marked.
      const after = (await (await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: { name: string; attended: boolean }[];
      };
      assert.deepEqual(after.people?.map((p) => [p.name, p.attended]), [
        ["Maria", false],
        ["Tom", true],
      ]);
    }

    // Steward of another room (Cara, county): nothing about shop gatherings.
    {
      const { rows } = await seen(t, t.cara);
      assert.deepEqual(rows, []);
      const one = await (await call(t.handler, t.cara, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json();
      assert.deepEqual(one, { mine: { going: false, attended: false } });
    }

    // A plain member (Tom): only his own rows. No names, no counts.
    {
      const { body, rows } = await seen(t, t.tom);
      assert.deepEqual(rows, ["G:Tom:true:true", "M:Tom:true:false"]);
      assert.deepEqual(body.hosts, []);
      assert.deepEqual(body.stewardRooms, []);
      const text = JSON.stringify(body);
      for (const name of ["Maria", "Dale", t.maria.id, t.dale.id]) assert.equal(text.includes(name), false, name);
      assert.equal(/count|total|score|like/i.test(text), false);
      const one = await (await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json();
      assert.deepEqual(one, { mine: { going: true, attended: true } });
      // Not who came either: Maria's row (going, not came) and every other row stay out.
      const other = await (await call(t.handler, t.tom, "GET", `/api/gatherings/${MARIAS}/rsvps`)).json();
      assert.deepEqual(other, { mine: { going: true, attended: false } });
    }

    // Signed out.
    assert.equal((await call(t.handler, null, "GET", "/api/rsvps")).status, 401);
    assert.equal((await call(t.handler, null, "GET", `/api/gatherings/${GATHERING}/rsvps`)).status, 401);
    assert.equal(
      (await call(t.handler, null, "POST", `/api/gatherings/${GATHERING}/attendance`, { userIds: [] })).status,
      401,
    );
  } finally {
    await t.close();
  }
});

test("only the host or an admin marks who came; a member and another host get 403", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    for (const who of [t.tom, t.maria, t.sam, t.cara]) {
      const res = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [t.tom.id],
      });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: MARK_REFUSED });
      const self = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
      assert.equal(self.status, 403);
    }
    const tom = await (await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json();
    assert.deepEqual(tom, { mine: { going: true, attended: false } });
    // The host (the lister) may say they came, as on the device. So may the owner.
    assert.equal(
      (await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true })).status,
      200,
    );
    assert.equal(
      (await call(t.handler, t.owner, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true })).status,
      200,
    );
  } finally {
    await t.close();
  }
});

test("a host who is not an admin closes a date and attendance is recorded on the server", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
    await call(t.handler, t.dale, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
    // Maria (not an admin) reads her roll call with ids, then closes with Tom.
    const roll = (await (await call(t.handler, t.maria, "GET", `/api/gatherings/${MARIAS}/rsvps`)).json()) as {
      people: { userId: string; name: string; going: boolean }[];
    };
    const tomId = roll.people.find((p) => p.name === "Tom")?.userId;
    assert.equal(tomId, t.tom.id);
    const closed = await call(t.handler, t.maria, "POST", `/api/gatherings/${MARIAS}/attendance`, {
      userIds: [tomId],
      close: true,
    });
    assert.equal(closed.status, 200);
    const rows = await t.db.query<{ user_id: string; going: boolean; attended: boolean }>(
      `select user_id, going, attended from gathering_rsvp where gathering_id = $1`,
      [MARIAS],
    );
    assert.deepEqual(
      rows.map((r) => [r.user_id, r.going, r.attended]),
      [[t.tom.id, false, true]],
    );
  } finally {
    await t.close();
  }
});

test("a missing table answers 503 rsvp-not-ready, the one code the client keeps on the device", async () => {
  const t = await setup();
  try {
    await t.db.query(`drop table gathering_rsvp`);
    const res = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: RSVP_NOT_READY });
  } finally {
    await t.close();
  }
});

test("move entries drop seed cards and merge duplicates", () => {
  assert.deepEqual(
    moveEntries([
      { gatheringId: "brief", going: true },
      { gatheringId: GATHERING.toUpperCase(), going: true },
      { gatheringId: GATHERING, attended: true },
      { gatheringId: OTHER, going: false, attended: false },
    ]),
    [{ gatheringId: GATHERING, going: true, attended: true }],
  );
  assert.equal(moveEntries("nope"), null);
});

test("migration 0049 is valid, owner-approved, idempotent, and has no counts", async () => {
  const sql = readFileSync(new URL("../../migrations/0049_gathering_rsvp.sql", import.meta.url), "utf8");
  assert.match(sql, /Numbered 0049/);
  assert.match(sql, /owner must approve/i);
  assert.match(sql, /Deploy order:/);
  assert.match(sql, /Rollback:/);
  assert.match(sql, /create table if not exists gathering_rsvp/);
  assert.match(sql, /primary key \(gathering_id, user_id\)/);
  assert.match(sql, /references public_gathering \(id\) on delete cascade/);
  assert.equal(/create or replace function/i.test(sql), false);
  assert.equal(/^\s*(drop table|delete from|update )/im.test(sql), false);
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();
  for (const banned of ["count", "likes", "score", "reshare", "rank"]) {
    assert.equal(code.includes(banned), false, banned);
  }

  // Applying it a second time is safe, and one row per gathering and member.
  const { db, pg, close } = await openTestDb();
  try {
    await pg.exec(sql);
    const u = await user(db, "Ann");
    await db.query(
      `insert into public_gathering (id, title, host_user_id, room_id) values ($1, 'T', $2, 'shop')`,
      [GATHERING, u],
    );
    await db.query(`insert into gathering_rsvp (gathering_id, user_id, going) values ($1, $2, true)`, [GATHERING, u]);
    await assert.rejects(
      db.query(`insert into gathering_rsvp (gathering_id, user_id, going) values ($1, $2, true)`, [GATHERING, u]),
    );
    await assert.rejects(
      db.query(`insert into gathering_rsvp (gathering_id, user_id) values ($1, $2)`, [OTHER, u]),
    );
    await db.query(`delete from "user" where id = $1`, [u]);
    assert.deepEqual(await db.query(`select 1 from gathering_rsvp`), []);
  } finally {
    await close();
  }
});
