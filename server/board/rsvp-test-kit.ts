import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  OLD_WRITE_UPS_DROP_DM_LINKS,
} from "./rsvp.ts";
import { listRoomMembers } from "./members.ts";
import { saveGathering } from "./gathering-record.ts";
import { dateMail, dateMailLink, resetDateMailGuard } from "./date-mail.ts";
import { RSVP_SUMMARY_MIN_COUNT, nearEveryone, rebuildsHidden, remainderGivesAway, rsvpSummary, suppressGroup, suppressSummary, type RsvpSummary } from "./rsvp-summary.ts";
import { WRITE_UP_HOST_ONLY } from "./store.ts";
import { ADMIN_NO_NAMES, MARK_NOT_GOING, MARK_TOO_EARLY, markOpen, startMinutes, withAdminRoleSeesNames } from "../../src/lib/board/rsvp-rules.ts";
import { recordAttendance, sharesMeeting } from "../dm/store.ts";
import { writeUpWithin } from "./rsvp-retention.ts";

/** Shared by the RSVP server test files (split so each stays under the 300s per-file CI timeout). */

export const GATHERING = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const OTHER = "7c2a3b4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e";
/** Hosted by Maria, in the same room as Dale's. */
export const MARIAS = "9e4c5d6f-7a81-4d9e-9fa0-2b3c4d5e6f70";
export const BASE = "http://127.0.0.1:8787";

export async function user(db: Db, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, now(), now())`,
    [id, name, `${name.toLowerCase()}-${id.slice(0, 8)}@example.com`],
  );
  return id;
}

export async function grant(db: Db, userId: string, name: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'member', '', 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name],
  );
}

export async function stewardOf(db: Db, userId: string, name: string, roomId: string) {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
     values ($1, $2, $3, 'steward', $4, 'grant', 'test', 'test', 'test', 'Granted for the test.')`,
    [randomUUID(), userId, name, roomId],
  );
}

export async function makeAdmin(db: Db, userId: string) {
  await db.query(
    `insert into member_role (user_id, is_admin, is_council, is_council_chair)
     values ($1, true, false, false)
     on conflict (user_id) do update set is_admin = true`,
    [userId],
  );
}

export function app(db: Db) {
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

export type Handler = (request: Request) => Promise<Response>;
export type As = { id: string; session?: string };

export function call(handler: Handler, as: As | null, method: string, path: string, body?: unknown) {
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

export async function setup() {
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
      // Only a special event takes RSVPs (Josh via CoS, Oct 30 12:47 PM ET).
      special: true,
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

export type ListBody = {
  viewer: string;
  admin: boolean;
  hosts: string[];
  stewardRooms: string[];
  rsvps: { gatheringId: string; roomId: string; userId: string; name: string; going: boolean; attended: boolean }[];
};

/** What one viewer can read, as [gathering, name, going, attended], sorted. */
export async function seen(t: Awaited<ReturnType<typeof setup>>, who: As) {
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
export async function scene(t: Awaited<ReturnType<typeof setup>>) {
  await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
  const marked = await call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, {
    userIds: [rsvpHandle(GATHERING, t.tom.id)],
  });
  assert.equal(marked.status, 200);
  await call(t.handler, t.maria, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
  await call(t.handler, t.tom, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
  await call(t.handler, t.dale, "POST", `/api/gatherings/${MARIAS}/rsvp`, { going: true });
}


export async function inShop(t: Awaited<ReturnType<typeof setup>>, ids: string[]) {
  for (const id of ids) {
    await t.db.query(
      `insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', $2) on conflict do nothing`,
      [id, new Date("2026-10-01T00:00:00Z")],
    );
  }
}
export const WRITE_NOW = new Date("2026-10-29T12:00:00Z");
export async function writeUp(t: Awaited<ReturnType<typeof setup>>, came: string[], cameIds: string[], on = "2026-10-29") {
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
export async function youCameOn(t: Awaited<ReturnType<typeof setup>>, viewer: string, postId: string) {
  const board = await listBoard(t.db, viewer, WRITE_NOW, { room: "shop" });
  assert.equal(board.ok, true);
  const post = board.ok ? board.value.posts.find((item) => item.id === postId) : undefined;
  assert.ok(post, "the write-up is on the board");
  return post?.youCame;
}
export const att = (t: Awaited<ReturnType<typeof setup>>, body: unknown) =>
  call(t.handler, t.dale, "POST", `/api/gatherings/${GATHERING}/attendance`, body);


export const gatheringBody = (id: string, roomId: string, extra: Record<string, unknown> = {}) => ({
  id,
  roomId,
  title: "Saturday lifts",
  date: "2026-10-31",
  time: "7 a.m.",
  place: "Dale's garage, Riverview",
  special: true,
  ...extra,
});
export const roomOfGathering = async (t: Awaited<ReturnType<typeof setup>>) =>
  (await t.db.query<{ room_id: string }>(`select room_id from public_gathering where id = $1`, [GATHERING]))[0]!.room_id;
