import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trustAuthenticator } from "../mfa/test-trust.ts";
import { createApp, type AppDeps } from "../http.ts";
import type { Db } from "../db.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import { createPost, listBoard } from "./store.ts";
import {
  rsvpHandle,
  MARK_REFUSED,
  moveEntries,
  purgeOldRsvps,
  RSVP_BATCH_MAX,
  RSVP_NOT_READY,
  ROLL_CALL_STALE,
  rsvpCutoff,
} from "./rsvp.ts";
import { RSVP_SUMMARY_MIN_COUNT, nearEveryone, rebuildsHidden, rsvpSummary, suppressGroup, suppressSummary, type RsvpSummary } from "./rsvp-summary.ts";
import { WRITE_UP_HOST_ONLY } from "./store.ts";
import { ADMIN_NO_NAMES, MARK_NOT_GOING, MARK_TOO_EARLY, withAdminRoleSeesNames } from "../../src/lib/board/rsvp-rules.ts";

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
    // After the gatherings below (Oct 31), so marking is open (QA F4).
    now: () => new Date("2026-11-01T12:00:00Z"),
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
  // These gatherings are in a room that takes roll (rooms start with roll off).
  await db.query(`update room set options = array['roll_call', 'members', 'chat', 'calls'] where id = 'shop'`);
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
    userIds: [rsvpHandle(GATHERING, t.tom.id)],
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

test("an admin, as an admin, sees no one: no people, and only their own rows (Oct 30)", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id)],
      close: false,
    });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    const one = await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(one.status, 200);
    assert.deepEqual(await one.json(), { mine: { going: false, attended: false } });
    const all = (await (await call(t.handler, t.josh, "GET", "/api/rsvps")).json()) as {
      admin: boolean;
      rsvps: { name: string }[];
    };
    assert.equal(all.admin, true);
    assert.deepEqual(all.rsvps, []);
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
      userIds: [rsvpHandle(GATHERING, t.tom.id)],
    });
    assert.equal(sneak.status, 403);
    const fake = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: false });
    assert.equal(fake.status, 400);
    // A member cannot mark themselves as having come, either.
    const self = await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
    assert.equal(self.status, 403);
    assert.deepEqual(await self.json(), { error: MARK_REFUSED, api: "rsvp" });
    assert.deepEqual(await sneak.json(), { error: MARK_REFUSED, api: "rsvp" });

    // A handle the host's list does not hold (Maria has no RSVP here) is
    // stale: the whole call is refused, so Tom is not marked either.
    const stale = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id), rsvpHandle(GATHERING, t.maria.id)],
      close: true,
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: ROLL_CALL_STALE, api: "rsvp" });
    const unknown = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: ["h_notarealhandleatall00"],
    });
    assert.equal(unknown.status, 409);
    const tomBefore = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await tomBefore.json(), { mine: { going: true, attended: false } });

    // The host marks who came, but the answer names nobody.
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id)],
      close: true,
    });
    assert.equal(marked.status, 200);
    assert.deepEqual(await marked.json(), { ok: true });
    const tomNow = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await tomNow.json(), { mine: { going: false, attended: true } });
    // Maria was never sent, so she was not marked.
    const mariaNow = await call(t.handler, t.maria, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.deepEqual(await mariaNow.json(), { mine: { going: false, attended: false } });

    // An admin, as an admin, may not mark (Oct 30), by handle or by id.
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    for (const sent of [t.maria.id, rsvpHandle(GATHERING, t.maria.id)]) {
      const admin = await call(t.handler, t.josh, "POST", `/api/gatherings/${GATHERING}/attendance`, { userIds: [sent] });
      assert.equal(admin.status, 403);
      assert.deepEqual(await admin.json(), { error: MARK_REFUSED, api: "rsvp" });
    }
    // The room's steward may, by handle.
    const steward = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.maria.id)],
    });
    assert.equal(steward.status, 200);

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

test("the move keeps a self-marked 'I've been' only for the host or the room's steward, not an admin", async () => {
  const t = await setup();
  try {
    const entries = [
      { gatheringId: GATHERING, going: true, attended: true },
      { gatheringId: MARIAS, going: true, attended: true },
      // Not going: the device mark is not kept for anyone (QA F4).
      { gatheringId: OTHER, going: false, attended: true },
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
        [GATHERING, true, true],
        [MARIAS, true, false],
      ],
    );
    // An admin, as an admin, keeps neither "I've been" (Oct 30).
    assert.equal((await call(t.handler, t.josh, "POST", "/api/rsvps/move", { entries })).status, 200);
    assert.deepEqual(
      (await rows(t.josh.id)).map((r) => [r.gathering_id, r.going, r.attended]),
      [
        [GATHERING, true, false],
        [MARIAS, true, false],
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

    // Admin and owner, as admins: no one else's rows, no people (Oct 30).
    for (const who of [t.josh, t.owner]) {
      const { body, rows } = await seen(t, who);
      assert.equal(body.admin, true);
      assert.deepEqual(rows, []);
      const one = (await (await call(t.handler, who, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: unknown[];
      };
      assert.equal(one.people, undefined);
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
    // shop gathering, and marks who came (Oct 30).
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
      // A steward marks who came now (Oct 30).
      const mark = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [rsvpHandle(GATHERING, t.maria.id)],
      });
      assert.equal(mark.status, 200);
      const after = (await (await call(t.handler, t.sam, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
        people?: { name: string; attended: boolean }[];
      };
      assert.deepEqual(after.people?.map((p) => [p.name, p.attended]), [
        ["Maria", true],
        ["Tom", true],
      ]);
      // Reset for the rows below.
      await t.db.query(`update gathering_rsvp set attended = false where gathering_id = $1 and user_id = $2`, [GATHERING, t.maria.id]);
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

test("only the host or the room's steward marks who came; a member, another host, another room's steward and an admin get 403", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    for (const who of [t.tom, t.maria, t.cara, t.josh, t.owner]) {
      const res = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [t.tom.id],
      });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: MARK_REFUSED, api: "rsvp" });
      const self = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
      assert.equal(self.status, 403);
    }
    const tom = await (await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json();
    assert.deepEqual(tom, { mine: { going: true, attended: false } });
    // The host may say they came, as on the device. So may the room's steward.
    // Each says "going" first: only members going can be marked (QA F4).
    for (const who of [t.dale, t.sam]) {
      const early = await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
      assert.equal(early.status, 409);
      assert.deepEqual(await early.json(), { error: MARK_NOT_GOING, api: "rsvp" });
      await call(t.handler, who, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    }
    assert.equal(
      (await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true })).status,
      200,
    );
    assert.equal(
      (await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true })).status,
      200,
    );
    const steward = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id)],
    });
    assert.equal(steward.status, 200);
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
    // An opaque per-gathering handle, never Tom's account id.
    assert.equal(tomId, rsvpHandle(MARIAS, t.tom.id));
    assert.notEqual(tomId, t.tom.id);
    const closed = await call(t.handler, t.maria, "POST", `/api/gatherings/${MARIAS}/attendance`, {
      userIds: [tomId],
      close: true,
      seen: roll.people.map((p) => p.userId),
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
    assert.deepEqual(await res.json(), { error: RSVP_NOT_READY, api: "rsvp" });
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

test("retention: RSVP rows are deleted after 12 months untouched or ended, going and attended alike, dated or not; newer ones stay", async () => {
  const { db, close } = await openTestDb();
  try {
    const now = new Date("2026-10-29T12:00:00Z");
    assert.equal(rsvpCutoff(now).toISOString(), "2025-10-29T12:00:00.000Z");
    const host = await user(db, "Dale");
    const ann = await user(db, "Ann");
    const tom = await user(db, "Tom");
    const id = () => randomUUID();
    const gathering = async (on: string) => {
      const gid = id();
      await db.query(
        `insert into public_gathering (id, title, host_user_id, room_id, gather_on) values ($1, 'T', $2, 'shop', $3)`,
        [gid, host, on],
      );
      return gid;
    };
    const rsvp = async (gid: string, uid: string, going: boolean, attended: boolean, touched: string) =>
      db.query(
        `insert into gathering_rsvp (gathering_id, user_id, going, attended, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $5)`,
        [gid, uid, going, attended, touched],
      );
    // Ended 13 months ago: every row goes, going and attended.
    const old = await gathering("2025-09-29");
    await rsvp(old, ann, false, true, "2025-09-29T20:00:00Z");
    await rsvp(old, tom, true, false, "2025-09-28T20:00:00Z");
    // Ended 11 months ago: kept.
    const recent = await gathering("2025-11-29");
    await rsvp(recent, ann, false, true, "2025-11-29T20:00:00Z");
    await rsvp(recent, tom, true, false, "2025-11-28T20:00:00Z");
    // A weekly meeting that still meets: its date moved forward. Attendance
    // last touched 13 months ago ages out; 11 months ago stays. A "going"
    // (alone or with came) untouched for 13 months ages out too (QA S3).
    const weekly = await gathering("2026-11-05");
    await rsvp(weekly, ann, false, true, "2025-09-29T20:00:00Z");
    await rsvp(weekly, tom, false, true, "2025-11-29T20:00:00Z");
    await rsvp(weekly, host, true, true, "2025-09-29T20:00:00Z");
    // A gathering with no date: an old "going" goes, a recent one stays.
    const undated = await gathering("");
    await rsvp(undated, ann, true, false, "2025-09-29T20:00:00Z");
    await rsvp(undated, tom, true, false, "2025-11-29T20:00:00Z");

    const result = await purgeOldRsvps(db, now);
    assert.equal(result.deleted, 5);
    const left = await db.query<{ gathering_id: string; user_id: string }>(
      `select gathering_id, user_id from gathering_rsvp order by gathering_id, user_id`,
    );
    const key = (g: string, u: string) => `${g}:${u}`;
    assert.deepEqual(
      left.map((r) => key(r.gathering_id, r.user_id)).sort(),
      [key(recent, ann), key(recent, tom), key(weekly, tom), key(undated, tom)].sort(),
    );
    // The gatherings themselves are not touched.
    const gatherings = await db.query(`select id from public_gathering`);
    assert.equal(gatherings.length, 4);
    // A second run deletes nothing more.
    assert.equal((await purgeOldRsvps(db, now)).deleted, 0);
  } finally {
    await close();
  }
});

test("retention runs in the API at start and daily, not in 0049", () => {
  const host = readFileSync(new URL("../host.ts", import.meta.url), "utf8");
  assert.match(host, /startRsvpRetention\(boardDb\)/);
  const sql = readFileSync(new URL("../../migrations/0049_gathering_rsvp.sql", import.meta.url), "utf8");
  assert.equal(/retention|12 months/i.test(sql), false);
});

test("concurrent toggles never answer 500, and a close racing a 'going' succeeds", async () => {
  const t = await setup();
  try {
    // 20 overlapping alternating taps from one member (two devices, retries).
    const taps = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: i % 2 === 0 }),
      ),
    );
    assert.deepEqual(taps.map((r) => r.status).filter((s) => s !== 200), []);
    // The table never holds an all-false row (the check would have refused it).
    const empty = await t.db.query(`select 1 from gathering_rsvp where not going and not attended`);
    assert.equal(empty.length, 0);

    // Tom came once before (so the close has a row to update), Ann's going is cleared by the close.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const [close, going, again] = await Promise.all([
      call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
        userIds: [rsvpHandle(GATHERING, t.tom.id)],
        close: true,
        seen: [rsvpHandle(GATHERING, t.maria.id)],
      }),
      call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false }),
      call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true }),
    ]);
    assert.equal(close.status, 200, await close.clone().text());
    assert.equal(going.status, 200);
    assert.equal(again.status, 200);
    // The roll call was not rolled back.
    const tom = await t.db.query<{ attended: boolean }>(
      `select attended from gathering_rsvp where gathering_id = $1 and user_id = $2`,
      [GATHERING, t.tom.id],
    );
    assert.equal(tom[0]?.attended, true);
  } finally {
    await t.close();
  }
});

test("request hygiene: close must be a boolean, wrong method is 405, paths match exactly, big bodies refused early", async () => {
  const t = await setup();
  try {
    const bad = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [],
      close: "true",
    });
    assert.equal(bad.status, 400);

    const wrong = await call(t.handler, t.tom, "GET", "/api/rsvps/move");
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get("allow"), "POST");
    assert.match(((await wrong.json()) as { error: string }).error, /Method not allowed/);
    assert.equal((await call(t.handler, t.tom, "DELETE", "/api/rsvps")).status, 405);

    // Uppercase ids and actions are not these routes.
    const upper = await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING.toUpperCase()}/rsvp`, { going: true });
    assert.notEqual(upper.status, 200);
    const upperAction = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/RSVPS`);
    assert.notEqual(upperAction.status, 200);

    // A declared oversize body is refused before it is read.
    const big = await t.handler(
      new Request(`${BASE}/api/rsvps/move`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": t.tom.id, "content-length": "40000" },
        body: "{}",
      }),
    );
    assert.equal(big.status, 413);

    // This API's refusals carry its marker; the client keeps a change on the
    // device only for a 404 without it (an API from before these routes).
    const hidden = await call(t.handler, t.tom, "POST", "/api/gatherings/00000000-0000-4000-8000-000000000000/rsvp", {
      going: true,
    });
    assert.equal(hidden.status, 404);
    assert.equal(((await hidden.json()) as { api?: string }).api, "rsvp");
  } finally {
    await t.close();
  }
});

test("a barred member drops out of others' lists and the roll call, and still sees their own", async () => {
  const t = await setup();
  try {
    await scene(t);
    // Tom is barred from the shop room.
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const sam = await seen(t, t.sam);
    assert.equal(sam.rows.some((row) => row.includes(":Tom:")), false);
    const dale = (await (await call(t.handler, t.dale, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as {
      people?: { name: string }[];
    };
    assert.deepEqual(dale.people?.map((p) => p.name), ["Maria"]);
    // An expired first-strike bar no longer hides anyone.
    await t.db.query(`update board_ban set until_at = '2026-01-01T00:00:00Z' where user_id = $1`, [t.tom.id]);
    assert.equal((await seen(t, t.sam)).rows.some((row) => row.includes(":Tom:")), true);
  } finally {
    await t.close();
  }
});

test("removing a gathering deletes its RSVPs; the purge clears removed gatherings and gone rooms", async () => {
  const t = await setup();
  try {
    await scene(t);
    const removed = await call(t.handler, t.dale, "DELETE", `/api/gatherings/${GATHERING}`);
    assert.equal(removed.status, 200, await removed.clone().text());
    const left = await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [GATHERING]);
    assert.equal(left.length, 0);

    // Rows left from before: one on a removed gathering, one in a room that no longer exists.
    await t.db.query(`update public_gathering set removed = true where id = $1`, [OTHER]);
    await t.db.query(`insert into gathering_rsvp (gathering_id, user_id, going) values ($1, $2, true)`, [OTHER, t.tom.id]);
    await t.db.query(`update public_gathering set room_id = 'gone-room' where id = $1`, [MARIAS]);
    const result = await purgeOldRsvps(t.db, new Date("2026-10-29T12:00:00Z"));
    assert.equal(result.deleted, 3);
    assert.equal((await t.db.query(`select 1 from gathering_rsvp`)).length, 0);
    // Gatherings are not deleted by the purge.
    assert.equal((await t.db.query(`select 1 from public_gathering`)).length, 3);
  } finally {
    await t.close();
  }
});

test("host and steward lists carry no account ids, and an admin gets none at all (Oct 30)", async () => {
  const t = await setup();
  try {
    await scene(t);
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const others = (viewer: string) =>
      [t.dale.id, t.maria.id, t.tom.id, t.josh.id, t.owner.id, t.sam.id, t.cara.id].filter((id) => id !== viewer);
    for (const who of [t.dale, t.sam]) {
      const list = await (await call(t.handler, who, "GET", "/api/rsvps")).json();
      const one = await (await call(t.handler, who, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json();
      const text = JSON.stringify(list) + JSON.stringify(one);
      assert.ok((one as { people?: unknown[] }).people?.length, "the roll call is there");
      for (const id of others(who.id)) assert.equal(text.includes(id), false, `${who.id} saw ${id}`);
      // Only the viewer's own id may appear.
      const gatheringIds = new Set([GATHERING, MARIAS, OTHER].map((id) => id.toLowerCase()));
      for (const found of text.match(uuid) ?? []) {
        if (!gatheringIds.has(found.toLowerCase())) assert.equal(found, who.id);
      }
      const handles = (one as { people: { userId: string }[] }).people.map((row) => row.userId);
      assert.ok(handles.every((h) => /^h_[A-Za-z0-9_-]{22}$/.test(h) || h === who.id));
    }
    // Handles differ per gathering, so lists cannot be linked.
    assert.notEqual(rsvpHandle(GATHERING, t.tom.id), rsvpHandle(MARIAS, t.tom.id));
    // A made-up handle or a raw id is refused as stale and marks nobody.
    const fake = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: ["h_AAAAAAAAAAAAAAAAAAAAAA", t.maria.id],
    });
    assert.equal(fake.status, 409);
    const maria = await t.db.query<{ attended: boolean }>(
      `select attended from gathering_rsvp where gathering_id = $1 and user_id = $2`,
      [GATHERING, t.maria.id],
    );
    assert.equal(maria[0]?.attended, false, "a host cannot mark by raw id");
    // An admin gets no one's id, handle or name.
    const admin =
      JSON.stringify(await (await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) +
      JSON.stringify(await (await call(t.handler, t.josh, "GET", "/api/rsvps")).json());
    for (const id of others(t.josh.id)) assert.equal(admin.includes(id), false);
    assert.equal(/h_[A-Za-z0-9_-]{22}/.test(admin), false);
    for (const name of ["Tom", "Maria", "Dale"]) assert.equal(admin.includes(name), false);
  } finally {
    await t.close();
  }
});

test("a steward without a trusted authenticator cannot RSVP (Josh, 10:21 PM ET: keep it)", async () => {
  const t = await setup();
  try {
    const bare = { id: t.sam.id };
    const refused = await call(t.handler, bare, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.notEqual(refused.status, 200, await refused.clone().text());
    const rows = await t.db.query(`select 1 from gathering_rsvp where user_id = $1`, [t.sam.id]);
    assert.equal(rows.length, 0);
    const ok = await call(t.handler, t.sam, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal(ok.status, 200);
  } finally {
    await t.close();
  }
});

test("a room with roll off refuses who came; a close with no names still clears going", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await t.db.query(`update room set options = array['members', 'chat', 'calls'] where id = 'shop'`);
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id)],
    });
    assert.equal(marked.status, 409);
    assert.deepEqual(await marked.json(), { error: "This room does not take roll. Leave out who came.", api: "rsvp" });
    const self = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/rsvp`, { attended: true });
    assert.equal(self.status, 409);
    const attended = await t.db.query(`select 1 from gathering_rsvp where attended`);
    assert.equal(attended.length, 0);
    // A close that never saw Tom's "going" is refused (QA S3); one that saw it clears it.
    const blind = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [],
      close: true,
    });
    assert.equal(blind.status, 409);
    const closed = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [],
      close: true,
      seen: [rsvpHandle(GATHERING, t.tom.id)],
    });
    assert.equal(closed.status, 200);
    assert.equal((await t.db.query(`select 1 from gathering_rsvp`)).length, 0);
  } finally {
    await t.close();
  }
});

test("a host cannot mark a hidden barred member as came, by handle or by id", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, t.tom.id), t.tom.id],
    });
    // Hidden from the host, so the handle reads as stale: refused, nobody marked.
    assert.equal(marked.status, 409);
    assert.deepEqual(await marked.json(), { error: ROLL_CALL_STALE, api: "rsvp" });
    const row = await t.db.query<{ attended: boolean }>(
      `select attended from gathering_rsvp where user_id = $1`,
      [t.tom.id],
    );
    assert.equal(row[0]?.attended, false);
  } finally {
    await t.close();
  }
});

test("a member barred from the room can still clear their own RSVP, and nothing else", async () => {
  const t = await setup();
  try {
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const again = await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal(again.status, 404);
    const read = await call(t.handler, t.tom, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    assert.equal(read.status, 404);
    const cleared = await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    assert.equal(cleared.status, 200, await cleared.clone().text());
    assert.equal((await t.db.query(`select 1 from gathering_rsvp where user_id = $1`, [t.tom.id])).length, 0);
  } finally {
    await t.close();
  }
});

test("oddly cased or trailing-slash RSVP paths answer 404 with the api marker; a body with no length is capped", async () => {
  const t = await setup();
  try {
    for (const path of [
      "/api/rsvps/",
      "/API/rsvps",
      "/api/rsvps/move/",
      `/api/gatherings/${GATHERING}/rsvps/`,
      `/api/gatherings/${GATHERING.toUpperCase()}/RSVP`,
      `/api/gatherings/${GATHERING}/attendance/`,
    ]) {
      const res = await call(t.handler, t.tom, "GET", path);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { error: "Not found.", api: "rsvp" }, path);
    }
    // A streamed body with no Content-Length, over the cap, is refused.
    const big = new TextEncoder().encode(JSON.stringify({ going: true, pad: "x".repeat(40_000) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.length; i += 4096) controller.enqueue(big.slice(i, i + 4096));
        controller.close();
      },
    });
    const res = await t.handler(
      new Request(`${BASE}/api/gatherings/${GATHERING}/rsvp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": t.tom.id },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    assert.equal(res.status, 413);
  } finally {
    await t.close();
  }
});

test("the stale roll call line matches the browser's copy", async () => {
  const api = await import("../../src/lib/board/rsvp-api.ts");
  assert.equal(ROLL_CALL_STALE, api.ROLL_CALL_STALE);
});

test("two members named Ann: 'You were there' follows the host's pick by account id (QA S4)", async () => {
  const t = await setup();
  try {
    const annA = await user(t.db, "Ann");
    const annB = await user(t.db, "Ann");
    await grant(t.db, annA, "Ann");
    await grant(t.db, annB, "Ann");
    for (const id of [annA, annB]) {
      assert.equal((await call(t.handler, { id }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 200);
    }
    // Dale picks the second Ann by handle, then files the write-up naming "Ann".
    const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [rsvpHandle(GATHERING, annB)],
      close: true,
      seen: [rsvpHandle(GATHERING, annA), rsvpHandle(GATHERING, annB)],
    });
    assert.equal(marked.status, 200);
    const now = new Date("2026-10-29T12:00:00Z");
    for (const id of [t.dale.id, annA, annB]) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [
        id,
        new Date("2026-10-01T00:00:00Z"),
      ]);
    }
    const posted = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-29", came: ["Ann"], cardId: GATHERING, cameIds: [rsvpHandle(GATHERING, annB)] },
      now,
    });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    const youCame = async (id: string) => {
      const board = await listBoard(t.db, id, now, { room: "shop" });
      assert.equal(board.ok, true);
      const post = board.ok ? board.value.posts.find((item) => item.type === "hosted") : undefined;
      assert.ok(post, "the write-up is on the board");
      assert.deepEqual(post?.came, [], "no names for a member");
      return post?.youCame;
    };
    assert.equal(await youCame(annB), true);
    assert.equal(await youCame(annA), false);
  } finally {
    await t.close();
  }
});

test("QA S4 e: a did-not-happen close links nobody, and happened:false with names answers 400", async () => {
  const t = await setup();
  try {
    await inShop(t, [t.dale.id, t.tom.id]);
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    const named = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [tomH], close: true, happened: false, seen: [tomH],
    });
    assert.equal(named.status, 400);
    const odd = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [], close: true, happened: "no", seen: [tomH],
    });
    assert.equal(odd.status, 400);
    const closed = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [], close: true, happened: false, seen: [tomH],
    });
    assert.equal(closed.status, 200);
    const rows = await t.db.query<{ attended: boolean }>(
      `select attended from gathering_rsvp where gathering_id = $1 and user_id = $2`, [GATHERING, t.tom.id],
    );
    assert.notEqual(rows[0]?.attended, true, "Tom is not marked");
    const base = { type: "hosted", claim: "It did not happen.", on: "2026-10-29", cardId: GATHERING, happened: false };
    const refused = await createPost(t.db, { userId: t.dale.id, name: "Dale", roomId: "shop", body: { ...base, came: ["Tom"], cameIds: [tomH] }, now: new Date("2026-10-29T12:00:00Z") });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? 0 : refused.status, 400);
    const posted = await createPost(t.db, { userId: t.dale.id, name: "Dale", roomId: "shop", body: { ...base, came: [] }, now: new Date("2026-10-29T12:00:00Z") });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    const board = await listBoard(t.db, t.tom.id, new Date("2026-10-29T12:00:00Z"), { room: "shop" });
    const post = board.ok ? board.value.posts.find((item) => item.type === "hosted") : undefined;
    assert.ok(post);
    assert.equal(post?.youCame, false, "a did-not-happen write-up links nobody");
  } finally {
    await t.close();
  }
});

/** Helpers for the write-up link tests: members of the shop room, and Dale's write-up. */
async function inShop(t: Awaited<ReturnType<typeof setup>>, ids: string[]) {
  for (const id of ids) {
    await t.db.query(
      `insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2) on conflict do nothing`,
      [id, new Date("2026-10-01T00:00:00Z")],
    );
  }
}
const WRITE_NOW = new Date("2026-10-29T12:00:00Z");
async function writeUp(t: Awaited<ReturnType<typeof setup>>, came: string[], cameIds: string[], on = "2026-10-29") {
  const posted = await createPost(t.db, {
    userId: t.dale.id,
    name: "Dale",
    roomId: "shop",
    body: { type: "hosted", claim: "The lift went well and the next one is set.", on, came, cardId: GATHERING, cameIds },
    now: WRITE_NOW,
  });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  return posted.ok ? posted.value.id : "";
}
async function youCameOn(t: Awaited<ReturnType<typeof setup>>, viewer: string, postId: string) {
  const board = await listBoard(t.db, viewer, WRITE_NOW, { room: "shop" });
  assert.equal(board.ok, true);
  const post = board.ok ? board.value.posts.find((item) => item.id === postId) : undefined;
  assert.ok(post, "the write-up is on the board");
  return post?.youCame;
}
const att = (t: Awaited<ReturnType<typeof setup>>, body: unknown) =>
  call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, body);

test("QA S3: a retry after a stale roll call cannot clear a going it never saw, and a cancelled Ann is not linked", async () => {
  const t = await setup();
  try {
    const ann = await user(t.db, "Ann");
    await grant(t.db, ann, "Ann");
    await inShop(t, [t.dale.id, t.tom.id, ann]);
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, { id: ann }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    const annH = rsvpHandle(GATHERING, ann);
    // Dale's list shows Tom and Ann; then Ann cancels.
    await call(t.handler, { id: ann }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: false });
    const first = await att(t, { userIds: [tomH, annH], close: true, seen: [tomH, annH] });
    assert.equal(first.status, 409);
    assert.deepEqual(await first.json(), { error: ROLL_CALL_STALE, api: "rsvp" });
    // The old form's retry: no picks, and a list that held only Ann.
    const retry = await att(t, { userIds: [], close: true, seen: [annH] });
    assert.equal(retry.status, 409);
    const tomRow = await t.db.query<{ going: boolean }>(
      `select going from gathering_rsvp where gathering_id = $1 and user_id = $2`,
      [GATHERING, t.tom.id],
    );
    assert.equal(tomRow[0]?.going, true, "Tom's going row is still there");
    // The reset form sends Tom only, from the refreshed list.
    assert.equal((await att(t, { userIds: [tomH], close: true, seen: [tomH] })).status, 200);
    // Even a write-up that names Ann, and carries her old handle, does not link her.
    const post = await writeUp(t, ["Tom", "Ann"], [tomH, annH]);
    assert.equal(await youCameOn(t, ann, post), false);
    assert.equal(await youCameOn(t, t.tom.id, post), true);
  } finally {
    await t.close();
  }
});

test("QA S4 2: on a repeating gathering, week 2's write-up links only week 2's roll call", async () => {
  const t = await setup();
  try {
    const ann = await user(t.db, "Ann");
    await grant(t.db, ann, "Ann");
    await inShop(t, [t.dale.id, t.tom.id, ann]);
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    const annH = rsvpHandle(GATHERING, ann);
    // Week 1: Tom came.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal((await att(t, { userIds: [tomH], close: true, seen: [tomH] })).status, 200);
    const week1 = await writeUp(t, ["Tom"], [tomH], "2026-10-22");
    // Week 2: Tom and Ann say they are going; only Ann comes. The close
    // re-stamps Tom's old attended row, but he is not on this roll call.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, { id: ann }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal((await att(t, { userIds: [annH], close: true, seen: [tomH, annH] })).status, 200);
    const week2 = await writeUp(t, ["Ann", "Tom"], [annH]);
    assert.equal(await youCameOn(t, t.tom.id, week1), true);
    assert.equal(await youCameOn(t, t.tom.id, week2), false, "Tom came to week 1, not week 2");
    assert.equal(await youCameOn(t, ann, week2), true);
    assert.equal(await youCameOn(t, ann, week1), false);
  } finally {
    await t.close();
  }
});

test("QA S4 3: a write-up filed long after the close still links the roll call", async () => {
  const t = await setup();
  try {
    await inShop(t, [t.dale.id, t.tom.id]);
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal((await att(t, { userIds: [tomH], close: true, seen: [tomH] })).status, 200);
    await t.db.query(`update gathering_rsvp set updated_at = now() - interval '3 hours' where gathering_id = $1`, [
      GATHERING,
    ]);
    const post = await writeUp(t, ["Tom"], [tomH]);
    assert.equal(await youCameOn(t, t.tom.id, post), true);
  } finally {
    await t.close();
  }
});

test("QA S2 #1: a host who RSVP'd to their own gathering can mark themself and close it", async () => {
  const t = await setup();
  try {
    await inShop(t, [t.dale.id, t.tom.id]);
    await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    // The host's own row keeps the raw id; everyone else's is a handle.
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    const closed = await att(t, { userIds: [t.dale.id, tomH], close: true, seen: [t.dale.id, tomH] });
    assert.equal(closed.status, 200, await closed.clone().text());
    const rows = await t.db.query<{ user_id: string; attended: boolean }>(
      `select user_id, attended from gathering_rsvp where gathering_id = $1 order by user_id`,
      [GATHERING],
    );
    assert.deepEqual(
      rows.map((row) => [row.user_id, row.attended]).sort(),
      [[t.dale.id, true], [t.tom.id, true]].sort(),
    );
    // Another member's raw id is still refused from a host who is not an admin.
    await call(t.handler, t.tom, "POST", `/api/gatherings/${OTHER}/rsvp`, { going: true });
    const raw = await call(t.handler, t.dale, "POST", `/api/gatherings/${OTHER}/attendance`, { userIds: [t.tom.id] });
    assert.equal(raw.status, 409);
  } finally {
    await t.close();
  }
});

test("QA S4 #5: an RSVP that lands after the list was read but before the close is not deleted", async () => {
  const t = await setup();
  try {
    const ann = await user(t.db, "Ann");
    await grant(t.db, ann, "Ann");
    await inShop(t, [t.dale.id, t.tom.id, ann]);
    await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    const tomH = rsvpHandle(GATHERING, t.tom.id);
    let armed = true;
    // Ann RSVPs as the close starts, after the route has read the list.
    const racing: Db = {
      query: (...args: Parameters<Db["query"]>) => t.db.query(...args),
      transaction: async (fn) => {
        // Only the close's own transaction (other reads, such as the session,
        // may open one first).
        if (armed && String(fn).includes("delete from gathering_rsvp")) {
          armed = false;
          const going = await call(t.handler, { id: ann }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
          assert.equal(going.status, 200);
        }
        return t.db.transaction(fn);
      },
    } as Db;
    const closed = await call(app(racing), t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
      userIds: [tomH],
      close: true,
      seen: [tomH],
    });
    assert.equal(closed.status, 409);
    const annRow = await t.db.query<{ going: boolean }>(
      `select going from gathering_rsvp where gathering_id = $1 and user_id = $2`,
      [GATHERING, ann],
    );
    assert.equal(annRow[0]?.going, true, "Ann's going row survives the close");
  } finally {
    await t.close();
  }
});

// ---- Admin aggregates (Josh, Oct 30) ----

test("GET /api/rsvps/summary: counts for an admin, 403 for everyone else", async () => {
  const t = await setup();
  try {
    await scene(t);
    for (const who of [t.tom, t.maria, t.dale, t.sam, t.cara]) {
      const res = await call(t.handler, who, "GET", "/api/rsvps/summary");
      assert.equal(res.status, 403, who.id);
      const text = JSON.stringify(await res.json());
      assert.equal(/going|came|rooms/.test(text), false);
    }
    assert.equal((await call(t.handler, null, "GET", "/api/rsvps/summary")).status, 401);
    const res = await call(t.handler, t.josh, "GET", "/api/rsvps/summary");
    assert.equal(res.status, 200);
    const body = (await res.json()) as RsvpSummary;
    // At the provisional N (5), these small numbers are all hidden.
    assert.equal(body.minCount, RSVP_SUMMARY_MIN_COUNT);
    assert.equal(body.totals.going, null);
    assert.equal(body.totals.came, null);
    // The same counts with no hiding (n = 1).
    // scene: G has Tom (going, came) and Maria (going); M has Tom and Dale going.
    const open = await rsvpSummary(t.db, new Date(), 1);
    assert.equal(open.totals.going, 4);
    assert.equal(open.totals.came, 1);
    const g = open.rooms.flatMap((r) => r.gatherings).find((x) => x.gatheringId === GATHERING)!;
    assert.deepEqual([g.going, g.came], [2, 1]);
    const m = open.rooms.flatMap((r) => r.gatherings).find((x) => x.gatheringId === MARIAS)!;
    assert.deepEqual([m.going, m.came], [2, 0]);
    // No free-text titles (QA S4): a gathering carries its id and date only.
    for (const x of open.rooms.flatMap((r) => r.gatherings)) {
      assert.deepEqual(Object.keys(x).sort(), ["came", "date", "gatheringId", "going", "writeUps"]);
    }
    // No identities anywhere: no account ids, handles, names or emails.
    const text = JSON.stringify(body);
    for (const id of [t.tom.id, t.maria.id, t.dale.id, t.josh.id, t.sam.id]) assert.equal(text.includes(id), false);
    assert.equal(/h_[A-Za-z0-9_-]{22}/.test(text), false);
    assert.equal(/@/.test(text), false);
    for (const name of ["Tom", "Maria", "Dale", "Sam", "Olive"]) assert.equal(text.includes(`"${name}"`), false, name);
    assert.equal(/userId|user_id|email|rank|score/i.test(text), false);
    // The only names are room names (QA F7), never a person's.
    for (const room of body.rooms) assert.ok(typeof room.name === "string" && room.name !== "" && room.name !== room.roomId);
    // The owner is an admin too.
    assert.equal((await call(t.handler, t.owner, "GET", "/api/rsvps/summary")).status, 200);
  } finally {
    await t.close();
  }
});

test("the summary counts barred members (no hideBanned)", async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const body = await rsvpSummary(t.db, new Date(), 1);
    assert.equal(body.totals.going, 4);
    assert.equal(body.totals.came, 1);
    const src = readFileSync(new URL("./rsvp-summary.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /import[^;]*hideBanned|hideBanned\(/);
  } finally {
    await t.close();
  }
});

test("suppressGroup hides cells under N, and enough others that none can be worked out", () => {
  assert.deepEqual(suppressGroup([5, 0, 3], 1), [5, 0, 3]);
  // One small cell: a second is hidden so the total cannot give it away.
  assert.deepEqual(suppressGroup([10, 2, 7], 3), [10, null, null]);
  // Two small cells whose sum is still under N: hide one more.
  assert.deepEqual(suppressGroup([1, 1, 8, 9], 3), [null, null, null, 9]);
  // Zero is not a person and stays shown; nothing hidden means nothing extra.
  assert.deepEqual(suppressGroup([0, 4, 5], 3), [0, 4, 5]);
  for (const cells of [[10, 2, 7], [1, 1, 8, 9], [2, 2, 2]]) {
    const out = suppressGroup(cells, 3);
    const hidden = out.filter((v) => v === null).length;
    assert.ok(hidden === 0 || hidden >= 2, String(cells));
    cells.forEach((v, i) => {
      if (v > 0 && v < 3) assert.equal(out[i], null);
    });
  }
  // Provisional, privacy-safe default until Josh sets N (TODO in rsvp-rules.ts).
  assert.equal(RSVP_SUMMARY_MIN_COUNT, 5);
});

for (const seesNames of [true, false]) {
  test(`an admin who hosts or stewards, ADMIN_ROLE_SEES_NAMES=${seesNames}: names, ids and marking follow the setting`, async () => {
    await withAdminRoleSeesNames(seesNames, async () => {
      for (const role of ["host", "steward", "neither"] as const) {
        const t = await setup();
        try {
          await scene(t);
          if (role === "host") {
            await t.db.query(`update public_gathering set host_user_id = $1 where id = $2`, [t.josh.id, GATHERING]);
          } else if (role === "steward") {
            await stewardOf(t.db, t.josh.id, "Josh", "shop");
          }
          const oneRes = await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`);
          const listRes = await call(t.handler, t.josh, "GET", `/api/rsvps`);
          const one = (await oneRes.json()) as { people?: { name: string }[]; mine: unknown };
          const listText = JSON.stringify(await listRes.json());
          const mark = await call(t.handler, t.josh, "POST", `/api/gatherings/${GATHERING}/attendance`, {
            userIds: [rsvpHandle(GATHERING, t.maria.id)],
          });
          const self = await call(t.handler, t.josh, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
          assert.equal(self.status, 200, `${role}: an admin still sets and sees their own RSVP`);
          if (seesNames && role !== "neither") {
            assert.deepEqual(one.people?.map((p) => p.name), ["Maria", "Tom"], role);
            assert.equal(mark.status, 200, role);
          } else {
            assert.equal(one.people, undefined, role);
            assert.ok(one.mine, role);
            for (const leak of ["Maria", "Tom", t.maria.id, t.tom.id, rsvpHandle(GATHERING, t.maria.id)]) {
              assert.equal(listText.includes(leak), false, `${role}: /api/rsvps carries ${leak}`);
            }
            assert.equal(mark.status, 403, role);
            const err = ((await mark.json()) as { error: string }).error;
            assert.equal(err, seesNames ? MARK_REFUSED : ADMIN_NO_NAMES, role);
          }
        } finally {
          await t.close();
        }
      }
    });
  });
}

for (const seesNames of [true, false]) test(`an admin who hosts files a write-up: with names only when ADMIN_ROLE_SEES_NAMES (=${seesNames}), with none always`, () => withAdminRoleSeesNames(seesNames, async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(`update public_gathering set host_user_id = $1 where id = $2`, [t.josh.id, GATHERING]);
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [t.josh.id, new Date("2026-10-01T00:00:00Z")]);
    const post = (body: Record<string, unknown>) =>
      createPost(t.db, {
        userId: t.josh.id,
        name: "Josh",
        roomId: "shop",
        body: { type: "hosted", claim: "The lathe night went well and the next one is set.", on: "2026-10-29", cardId: GATHERING, happened: true, ...body },
        now: new Date(),
      } as Parameters<typeof createPost>[1]);
    const plain = await post({});
    assert.equal(plain.ok, true, JSON.stringify(plain));
    await t.db.query(`delete from board_post where card_id = $1`, [GATHERING]);
    const named = await post({ came: ["Tom"], cameIds: [rsvpHandle(GATHERING, t.tom.id)] });
    if (seesNames) assert.equal(named.ok, true, JSON.stringify(named));
    else {
      assert.equal(named.ok, false);
      if (!named.ok) assert.deepEqual([named.status, named.error], [403, ADMIN_NO_NAMES]);
    }
  } finally {
    await t.close();
  }
}));

// ---- QA S2: hiding holds across levels ----

const g = (id: string, going: number, came = 0, writeUps = 0) => ({ gatheringId: id, date: "2026-10-26", going, came, writeUps });

test("QA's example (N=2): room A has one gathering of 1, room B has 2 and 3; B's parts never give A away", () => {
  const out = suppressSummary(
    [
      { roomId: "a", members: 0, gatherings: [g("a1", 1)], weeks: [] },
      { roomId: "b", members: 0, gatherings: [g("b1", 2), g("b2", 3)], weeks: [] },
    ],
    2,
  );
  assert.equal(out.totals.going, 6);
  const [a, b] = out.rooms;
  assert.equal(a!.going, null);
  // B is hidden as A's complement, so its parts are hidden too: 6 - (2 + 3) cannot be done.
  assert.equal(b!.going, null);
  assert.deepEqual(b!.gatherings.map((x) => x.going), [null, null]);
  assert.deepEqual(a!.gatherings.map((x) => x.going), [null]);
});

test("a room's own total is safe, but one part under N is hidden with a neighbour", () => {
  const out = suppressSummary([{ roomId: "b", members: 0, gatherings: [g("b1", 1), g("b2", 9), g("b3", 6)], weeks: [] }], 2);
  const b = out.rooms[0]!;
  assert.equal(b.going, 16);
  const parts = b.gatherings.map((x) => x.going);
  assert.equal(parts[0], null);
  assert.equal(parts.filter((v) => v === null).length, 2, "a total minus one shown part never gives the 1 back");
});

test("a grand total under N hides every room and every part", () => {
  const out = suppressSummary(
    [
      { roomId: "a", members: 0, gatherings: [g("a1", 1)], weeks: [] },
      { roomId: "b", members: 0, gatherings: [g("b1", 2)], weeks: [{ week: "2026-10-26", writeUps: 0 }] },
    ],
    5,
  );
  assert.equal(out.totals.going, null);
  for (const room of out.rooms) {
    assert.equal(room.going, null);
    for (const x of room.gatherings) assert.equal(x.going, null);
  }
});

test("a count equal to the room's whole membership is hidden, with a neighbour", () => {
  // At the live N (5): 20 of 20 going is hidden, and so is a neighbour.
  const out = suppressSummary([{ roomId: "shop", members: 20, gatherings: [g("s1", 20), g("s2", 9), g("s3", 8)], weeks: [] }]);
  const parts = out.rooms[0]!.gatherings.map((x) => x.going);
  assert.equal(parts[0], null, "20 of 20 going is hidden");
  assert.equal(parts.filter((v) => v === null).length >= 2, true, "and a neighbour, so the total cannot give it back");
});

test("a count at or above (members - N) is hidden: it would all but name everyone", () => {
  assert.equal(nearEveryone(8, 10, 2), true);
  assert.equal(nearEveryone(7, 10, 2), false);
  assert.equal(nearEveryone(8, 0, 2), false, "unknown member count: the rule does not apply");
  // The whole membership is hidden at any N, even N = 1.
  assert.equal(nearEveryone(10, 10, 1), true);
  assert.equal(nearEveryone(9, 10, 1), false);
  const out = suppressSummary([{ roomId: "shop", members: 12, gatherings: [g("s1", 11), g("s2", 4), g("s3", 3)], weeks: [] }], 2);
  const parts = out.rooms[0]!.gatherings.map((x) => x.going);
  assert.equal(parts[0], null, "11 of 12 going is hidden");
  assert.equal(parts.filter((v) => v === null).length >= 2, true);
});

test("came is the attended flag at every level, and weeks carry write-ups only (QA S3)", () => {
  const src = readFileSync(new URL("./rsvp-summary.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /cardinality\(p\.came\)/);
  const out = suppressSummary([{ roomId: "a", members: 0, gatherings: [g("a1", 3, 2), g("a2", 4, 3)], weeks: [{ week: "2026-10-26", writeUps: 2 }] }], 1);
  assert.equal(out.rooms[0]!.came, 5);
  assert.equal(out.totals.came, 5);
  assert.deepEqual(Object.keys(out.rooms[0]!.weeks[0]!).sort(), ["week", "writeUps"]);
});

// ---- QA S1: no write-up, and no roll call, by stand-in ----

test("an admin-only account cannot file a write-up on someone else's gathering (403), and gains no names", async () => {
  const t = await setup();
  try {
    await scene(t);
    for (const id of [t.dale.id, t.josh.id, t.sam.id, t.tom.id]) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [id, new Date("2026-10-01T00:00:00Z")]);
    }
    const direct = await createPost(t.db, {
      userId: t.josh.id,
      name: "Josh",
      roomId: "shop",
      body: { type: "hosted", claim: "The lathe night went well and the next one is set.", on: "2026-10-29", cardId: GATHERING, came: ["Tom"], cameIds: [rsvpHandle(GATHERING, t.tom.id)], happened: true },
      now: new Date(),
    } as Parameters<typeof createPost>[1]);
    assert.equal(direct.ok, false);
    if (!direct.ok) assert.deepEqual([direct.status, direct.error], [403, WRITE_UP_HOST_ONLY]);
    const filed = await t.db.query(`select 1 from board_post where card_id = $1 and type = 'hosted'`, [GATHERING]);
    assert.equal(filed.length, 0);
  } finally {
    await t.close();
  }
});

for (const seesNames of [true, false]) test(`seeing who came needs a real host or steward role, never one gained by filing (ADMIN_ROLE_SEES_NAMES=${seesNames})`, () => withAdminRoleSeesNames(seesNames, async () => {
  const t = await setup();
  try {
    await scene(t);
    for (const id of [t.dale.id, t.josh.id, t.sam.id, t.tom.id]) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2)`, [id, new Date("2026-10-01T00:00:00Z")]);
    }
    // Dale (the real host) files the write-up, then hands the gathering to Josh
    // in the table directly: Josh never filed, Dale no longer hosts.
    const posted = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lathe night went well and the next one is set.", on: "2026-10-29", cardId: GATHERING, came: ["Tom"], cameIds: [rsvpHandle(GATHERING, t.tom.id)], happened: true },
      now: new Date(),
    } as Parameters<typeof createPost>[1]);
    assert.equal(posted.ok, true, JSON.stringify(posted));
    const cameFor = async (id: string) => {
      const board = await listBoard(t.db, id, new Date(), { room: "shop" });
      assert.equal(board.ok, true);
      return board.ok ? (board.value.posts.find((p) => p.type === "hosted")?.came ?? []) : [];
    };
    assert.deepEqual(await cameFor(t.dale.id), ["Tom"], "the real host sees it");
    assert.deepEqual(await cameFor(t.sam.id), ["Tom"], "the room's steward sees it");
    assert.deepEqual(await cameFor(t.josh.id), [], "an admin as an admin does not");
    await t.db.query(`update public_gathering set host_user_id = $1 where id = $2`, [t.josh.id, GATHERING]);
    // Dale filed it but no longer hosts: filing grants nothing.
    assert.deepEqual(await cameFor(t.dale.id), [], "the filer who is not the host sees nothing");
    // Josh now really hosts it: the flag decides.
    assert.deepEqual(await cameFor(t.josh.id), seesNames ? ["Tom"] : []);
  } finally {
    await t.close();
  }
}));

// ---- QA review 5712501868 (Oct 30) ----

const gatheringBody = (id: string, roomId: string, extra: Record<string, unknown> = {}) => ({
  id,
  roomId,
  title: "Saturday lifts",
  date: "2026-10-31",
  time: "7 a.m.",
  place: "Dale's garage, Riverview",
  ...extra,
});

test("QA F1: TEST Ava, an admin who neither hosts nor stewards, cannot edit or move a gathering, and gets no names", async () => {
  const t = await setup();
  try {
    await scene(t);
    const roomOf = async () =>
      (await t.db.query<{ room_id: string }>(`select room_id from public_gathering where id = $1`, [GATHERING]))[0]!.room_id;
    const noNames = async (res: Response) => {
      const text = await res.text();
      for (const name of ["Tom", "Maria"]) assert.equal(text.includes(name), false, name);
      assert.equal(text.includes(t.tom.id), false);
    };
    // Josh (Ava's case): admin grant only. Edit in place and move both 403.
    for (const roomId of ["shop", "county"]) {
      const res = await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, roomId, { title: "Taken over" }));
      assert.equal(res.status, 403, roomId);
      await noNames(res);
    }
    assert.equal(await roomOf(), "shop");
    // Still no names after trying (the move did not make him a steward of anything).
    const after = await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    await noNames(after);
    const list = (await (await call(t.handler, t.josh, "GET", "/api/rsvps")).json()) as ListBody;
    assert.deepEqual(list.rsvps.filter((row) => row.userId !== t.josh.id), []);
    // A real steward of the target room only: still 403 (needs both rooms).
    await stewardOf(t.db, t.josh.id, "Josh", "county");
    assert.equal((await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 403);
    // The other room's steward cannot edit; the room's own steward edits but cannot move it out.
    assert.equal((await call(t.handler, t.cara, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop"))).status, 403);
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 403);
    assert.equal(await roomOf(), "shop");
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { title: "Lifts" }))).status, 200);
    // The real host may move it.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
    assert.equal(await roomOf(), "county");
  } finally {
    await t.close();
  }
});

const room = (roomId: string, members: number, going: number[]) => ({
  roomId,
  members,
  gatherings: going.map((value, i) => g(`${roomId}${i}`, value)),
  weeks: [],
});

test("QA F2: 6 going of a 6-member room: the room and the grand total are hidden", () => {
  const out = suppressSummary([room("a", 6, [6])], 5);
  assert.equal(out.rooms[0]!.going, null);
  assert.equal(out.totals.going, null);
});

test("QA F2: 20 going of 20 distinct members across two rooms: the grand total is hidden", () => {
  const out = suppressSummary([room("a", 10, [6]), room("b", 10, [14])], 5, () => 20);
  assert.equal(out.totals.going, null);
});

test("QA F2: 17 going of 20 distinct members is near everyone: the grand total is hidden", () => {
  const out = suppressSummary([room("a", 10, [6]), room("b", 10, [11])], 5, () => 20);
  assert.equal(out.totals.going, null);
  // 17 of 40 is not near everyone, and two rooms carry it: shown.
  const wide = suppressSummary([room("a", 20, [6]), room("b", 20, [11])], 5, () => 40);
  assert.equal(wide.totals.going, 17);
});

test("QA F2: 8 of 8 in one room plus rooms of zeros: zeros give no cover, the grand total is hidden", () => {
  const out = suppressSummary([room("a", 8, [8]), room("b", 10, [0]), room("c", 10, [0])], 5, () => 28);
  assert.equal(out.rooms[0]!.going, null);
  assert.equal(out.totals.going, null);
  // One room with data, even far from its membership: the total would be that room.
  const lone = suppressSummary([room("a", 50, [8]), room("b", 10, [0])], 5, () => 60);
  assert.equal(lone.totals.going, null);
});

test("QA F2: every room but one shown would rebuild the hidden one, so the total hides", () => {
  assert.equal(rebuildsHidden([9, 3], [9, null], 5), true);
  assert.equal(rebuildsHidden([9, 0], [9, null], 5), false);
  assert.equal(rebuildsHidden([9, 6, 7], [9, null, null], 5), false);
  // Room b (3) is hidden, so room a (9) is hidden with it: 12 - 9 cannot give 3 back.
  const out = suppressSummary([room("a", 100, [9]), room("b", 100, [3])], 5, () => 200);
  assert.deepEqual(out.rooms.map((r) => r.going), [null, null]);
  assert.equal(out.totals.going, 12);
  // Three rooms, one hidden by the whole-membership rule and the rest shown: the total hides.
  const three = suppressSummary([room("a", 100, [9]), room("b", 100, [8]), room("c", 7, [7])], 5, () => 207);
  const shown = three.rooms.map((r) => r.going);
  assert.equal(shown[2], null);
  if (shown.filter((v) => v === null).length === 1) assert.equal(three.totals.going, null);
});

test("QA F5: room membership is the distinct people across room_join and room_member", async () => {
  const t = await setup();
  try {
    const five: string[] = [];
    for (const name of ["Pat", "Lee", "Kim", "Ray", "Bo"]) {
      const id = await user(t.db, name);
      await grant(t.db, id, name);
      assert.equal((await call(t.handler, { id }, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 200);
      five.push(id);
    }
    const gathering = async () =>
      (await rsvpSummary(t.db, new Date("2026-11-01T12:00:00Z"), 5)).rooms
        .flatMap((r) => r.gatherings)
        .find((x) => x.gatheringId === GATHERING)!.going;
    // Eleven distinct members: three by room_join, nine by room_member, one in both.
    for (const id of five.slice(0, 3)) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [id]);
    }
    for (const id of [...five.slice(2), t.dale.id, t.maria.id, t.sam.id, t.cara.id, t.owner.id, t.josh.id]) {
      await t.db.query(`insert into room_member (room_id, user_id) values ('shop', $1) on conflict do nothing`, [id]);
    }
    assert.equal(await gathering(), 5, "5 of 11 distinct members is shown");
    // Drop the room_member side: 5 going of 3 joined is the whole membership, hidden.
    await t.db.query(`delete from room_member where room_id = 'shop'`);
    assert.equal(await gathering(), null);
  } finally {
    await t.close();
  }
});

test("QA F3: the 12-month purge clears old write-up came lists and named-account links, keeps new ones", async () => {
  const t = await setup();
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    await scene(t);
    const posted = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-31", came: ["Tom"], cardId: GATHERING, cameIds: [rsvpHandle(GATHERING, t.tom.id)] },
      now: new Date("2026-11-01T12:00:00Z"),
    });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    const fresh = randomUUID();
    const old = randomUUID();
    // Two copies by hand, one dated long ago, to test the purge alone.
    for (const [id, on] of [[old, "2025-09-01"], [fresh, "2026-10-01"]] as const) {
      await t.db.query(
        `insert into board_post (id, room_id, type, claim, reason, on_date, author_user_id, author_name, came, created_at)
         select $1, room_id, type, claim, reason, $2, author_user_id, author_name, array['Tom'], now()
         from board_post where type = 'hosted' limit 1`,
        [id, on],
      );
      await t.db.query(`insert into dm_named_account (post_id, user_id) values ($1, $2)`, [id, t.tom.id]);
    }
    const result = await purgeOldRsvps(t.db, new Date("2026-11-01T12:00:00Z"));
    assert.ok((result.writeUps ?? 0) >= 1);
    const came = async (id: string) =>
      (await t.db.query<{ came: string[] }>(`select came from board_post where id = $1`, [id]))[0]!.came;
    const links = async (id: string) =>
      (await t.db.query(`select 1 from dm_named_account where post_id = $1`, [id])).length;
    assert.deepEqual(await came(old), []);
    assert.equal(await links(old), 0);
    assert.deepEqual(await came(fresh), ["Tom"]);
    assert.equal(await links(fresh), 1);
    // The old write-up itself stays.
    assert.equal((await t.db.query(`select 1 from board_post where id = $1`, [old])).length, 1);
  } finally {
    await t.close();
  }
});

test("QA F4: no marks before the gathering starts (New York time), and a host can take a mark back", async () => {
  const t = await setup();
  try {
    // Nov 1 2026, 12:00 UTC is 7 a.m. in New York (after the clocks go back).
    const later = randomUUID();
    const soon = randomUUID();
    for (const [id, time] of [[later, "18:00"], [soon, "06:30"]] as const) {
      const saved = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(id, "shop", { date: "2026-11-01", time }));
      assert.equal(saved.status, 200, await saved.clone().text());
      const going = await call(t.handler, t.tom, "POST", `/api/gatherings/${id}/rsvp`, { going: true });
      assert.equal(going.status, 200, await going.clone().text());
    }
    const early = await call(t.handler, t.dale, "POST", `/api/gatherings/${later}/attendance`, { userIds: [rsvpHandle(later, t.tom.id)] });
    assert.equal(early.status, 409, await early.clone().text());
    assert.deepEqual(await early.json(), { error: MARK_TOO_EARLY, api: "rsvp" });
    // The room's steward, going, cannot say "I went" early either. (A member cannot at all: 403.)
    await call(t.handler, t.sam, "POST", `/api/gatherings/${later}/rsvp`, { going: true });
    const self = await call(t.handler, t.sam, "POST", `/api/gatherings/${later}/rsvp`, { attended: true });
    assert.equal(self.status, 409);
    assert.deepEqual(await self.json(), { error: MARK_TOO_EARLY, api: "rsvp" });
    const tomRow = async (id: string) =>
      (await t.db.query<{ going: boolean; attended: boolean }>(`select going, attended from gathering_rsvp where gathering_id = $1 and user_id = $2`, [id, t.tom.id]))[0];
    assert.deepEqual({ ...(await tomRow(later)) }, { going: true, attended: false });
    // Started at 6:30: marking is open.
    const tom = rsvpHandle(soon, t.tom.id);
    assert.equal((await call(t.handler, t.dale, "POST", `/api/gatherings/${soon}/attendance`, { userIds: [tom] })).status, 200);
    assert.deepEqual({ ...(await tomRow(soon)) }, { going: true, attended: true });
    // The roll call shows the existing mark.
    const roll = (await (await call(t.handler, t.dale, "GET", `/api/gatherings/${soon}/rsvps`)).json()) as {
      people: { userId: string; attended: boolean }[];
    };
    assert.equal(roll.people.find((p) => p.userId === tom)?.attended, true);
    // Mark and take back the same person at once: 400.
    assert.equal((await call(t.handler, t.dale, "POST", `/api/gatherings/${soon}/attendance`, { userIds: [tom], unmark: [tom] })).status, 400);
    // Take it back.
    assert.equal((await call(t.handler, t.dale, "POST", `/api/gatherings/${soon}/attendance`, { userIds: [], unmark: [tom] })).status, 200);
    assert.deepEqual({ ...(await tomRow(soon)) }, { going: true, attended: false });
    // A member who cancelled is not on the roll: refused, nothing set.
    await call(t.handler, t.maria, "POST", `/api/gatherings/${soon}/rsvp`, { going: true });
    await call(t.handler, t.maria, "POST", `/api/gatherings/${soon}/rsvp`, { going: false });
    const gone = await call(t.handler, t.dale, "POST", `/api/gatherings/${soon}/attendance`, { userIds: [rsvpHandle(soon, t.maria.id)] });
    assert.equal(gone.status >= 400 && gone.status < 500, true);
    assert.equal((await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1 and user_id = $2`, [soon, t.maria.id])).length, 0);
  } finally {
    await t.close();
  }
});

test("QA F6: a write-up on a gathering id with no row gets 404 and claims nothing", async () => {
  const t = await setup();
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    const before = (await t.db.query(`select id from board_post`)).length;
    const missing = randomUUID();
    const res = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-31", came: [], cardId: missing },
      now: new Date("2026-11-01T12:00:00Z"),
    });
    assert.equal(res.ok, false);
    assert.equal(res.ok ? 0 : res.status, 404);
    assert.equal((await t.db.query(`select id from board_post`)).length, before);
    assert.equal((await t.db.query(`select 1 from public_gathering where id = $1`, [missing])).length, 0);
  } finally {
    await t.close();
  }
});
