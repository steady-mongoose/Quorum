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
import {
  type As,
  BASE,
  GATHERING,
  type Handler,
  type ListBody,
  MARIAS,
  OTHER,
  WRITE_NOW,
  app,
  att,
  call,
  gatheringBody,
  grant,
  inShop,
  makeAdmin,
  roomOfGathering,
  scene,
  seen,
  setup,
  stewardOf,
  user,
  writeUp,
  youCameOn,
} from "./rsvp-test-kit.ts";

// ---- Josh's card answers via CoS, Oct 30 12:47 PM ET ----

const specialOf = async (t: Awaited<ReturnType<typeof setup>>, id = GATHERING) =>
  (await t.db.query<{ special: boolean }>(`select special from public_gathering where id = $1`, [id]))[0]?.special;
const PLAIN = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

test("Josh 1: 'This is a special event' is the host's checkbox, stored by 0050 (0049 untouched)", async () => {
  const t = await setup();
  try {
    // A new gathering is not special unless the host says so.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: undefined }))).status, 200);
    assert.equal(await specialOf(t, PLAIN), false);
    // The host ticks it, and unticks it.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: true }))).status, 200);
    assert.equal(await specialOf(t, PLAIN), true);
    // A steward may edit the gathering but not say whether it is special; an admin grant does nothing.
    const sam = await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: false }));
    assert.equal(sam.status, 403);
    assert.match(await sam.text(), /Only the host can say whether this is a special event/);
    assert.equal((await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: false }))).status, 403);
    // Leaving it out (or sending the same value) is fine for a steward's other edits.
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: undefined, title: "Lifts" }))).status, 200);
    assert.equal(await specialOf(t, PLAIN), true);
    // Only a true or false.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: "yes" }))).status, 400);
    // 0049 is byte-for-byte what it was; 0050 adds the columns with safe defaults.
    const { createHash } = await import("node:crypto");
    const sha = (file: string) => createHash("sha256").update(readFileSync(new URL(`../../migrations/${file}`, import.meta.url))).digest("hex");
    assert.equal(sha("0049_gathering_rsvp.sql"), "32360246292276f1feb569b9f187e3ea3f0af9e2840f8a718286f3992e47c362");
    const sql = readFileSync(new URL("../../migrations/0050_gathering_special.sql", import.meta.url), "utf8");
    assert.match(sql, /add column if not exists special boolean not null default false/);
    assert.match(sql, /add column if not exists moved_from text\[\] not null default '\{\}'/);
  } finally {
    await t.close();
  }
});

test("Josh 1 / Design L4: before 0050 a ticked gathering is still saved, as not special, and the answer says not ready", async () => {
  const t = await setup();
  try {
    await t.db.query(`alter table public_gathering drop column special, drop column moved_from`);
    assert.equal((await call(t.handler, t.dale, "GET", "/api/rsvps")).status, 200);
    // A new gathering added with the box ticked: saved, not lost (L4).
    const NEW = "4b9d0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";
    const added = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(NEW, "shop", { special: true, title: "New lifts" }));
    assert.equal(added.status, 200);
    const addedBody = (await added.json()) as { gathering: { id: string; special: boolean; title: string }; notice?: string };
    assert.equal(addedBody.gathering.special, false);
    assert.equal(addedBody.gathering.title, "New lifts");
    assert.equal(addedBody.notice, "Your gathering is saved. Special events aren't ready yet, so it isn't marked special. Try again later.");
    assert.equal((await t.db.query(`select 1 from public_gathering where id = $1`, [NEW])).length, 1);
    // An edit that ticks it: the rest of the edit is saved, the tick is not.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: undefined }))).status, 200);
    const tick = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: true, title: "Renamed" }));
    assert.equal(tick.status, 200);
    const tickBody = (await tick.json()) as { gathering: { special: boolean; title: string }; notice?: string };
    assert.deepEqual([tickBody.gathering.special, tickBody.gathering.title, tickBody.notice], [false, "Renamed", "Your gathering is saved. Special events aren't ready yet, so it isn't marked special. Try again later."]);
    // A plain save carries no notice.
    const plainSave = (await (await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: undefined }))).json()) as { notice?: string };
    assert.equal(plainSave.notice, undefined);
    const rsvp = await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true });
    assert.equal(rsvp.status, 409);
  } finally {
    await t.close();
  }
});

test("Josh 2: a gathering that is not a special event takes no RSVP, no mark, and no names on its write-up", async () => {
  const t = await setup();
  try {
    await inShop(t, [t.dale.id, t.tom.id]);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(PLAIN, "shop", { special: false }))).status, 200);
    const rsvp = await call(t.handler, t.tom, "POST", `/api/gatherings/${PLAIN}/rsvp`, { going: true });
    assert.equal(rsvp.status, 409);
    assert.match(await rsvp.text(), /only for special events/);
    const mark = await call(t.handler, t.dale, "POST", `/api/gatherings/${PLAIN}/attendance`, { userIds: [rsvpHandle(PLAIN, t.tom.id)] });
    assert.equal(mark.status, 409);
    // Clearing my own going is always allowed (nothing to clear here).
    assert.notEqual((await call(t.handler, t.tom, "POST", `/api/gatherings/${PLAIN}/rsvp`, { going: false })).status, 409);
    const rows = await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [PLAIN]);
    assert.equal(rows.length, 0);
    // A hosted write-up of it may not name who came; one with no names files.
    const named = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-29", came: ["Tom"], cardId: PLAIN, cameIds: [t.tom.id] },
      now: WRITE_NOW,
    });
    assert.equal(named.ok, false);
    assert.equal(named.ok ? 0 : named.status, 409);
    const plain = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-29", came: [], cardId: PLAIN, cameIds: [] },
      now: WRITE_NOW,
    });
    assert.equal(plain.ok, true, JSON.stringify(plain));
    // Unticking special hides the RSVPs it had (Josh via Design, 2:03 PM ET): nobody reads them, and they are kept.
    await scene(t);
    assert.ok((await seen(t, t.dale)).rows.length > 0);
    const kept = (await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [GATHERING])).length;
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: false }))).status, 200);
    assert.deepEqual((await seen(t, t.dale)).rows.filter((row) => row.startsWith("G:")), []);
    assert.equal((await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [GATHERING])).length, kept);
    assert.equal((await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 409);
  } finally {
    await t.close();
  }
});

test("Josh 3: a member barred in the old room stays hidden after the gathering moves to another room", async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const names = async () =>
      ((await (await call(t.handler, t.dale, "GET", `/api/gatherings/${GATHERING}/rsvps`)).json()) as { people?: { name: string }[] }).people?.map((p) => p.name);
    assert.deepEqual(await names(), ["Maria"]);
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'county', now())`, [t.dale.id]);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
    assert.equal(await roomOfGathering(t), "county");
    const moved = await t.db.query<{ moved_from: string[] }>(`select moved_from from public_gathering where id = $1`, [GATHERING]);
    assert.deepEqual(moved[0]?.moved_from, ["shop"]);
    assert.deepEqual(await names(), ["Maria"], "Tom is still hidden in county");
    assert.equal((await seen(t, t.dale)).rows.some((row) => row.includes(":Tom:")), false);
    // Tom still sees his own.
    assert.equal((await seen(t, t.tom)).rows.some((row) => row.startsWith("G:Tom:")), true);
  } finally {
    await t.close();
  }
});

test("Josh 4: a host joins a room through the app and then moves a gathering into it (the existing rule)", async () => {
  const t = await setup();
  try {
    await scene(t);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 403);
    // Rooms are joined by invitation: Dale holds a county invite (a room-scoped member grant).
    await t.db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note)
       values ($1, $2, 'Dale', 'member', 'county', 'grant', 'test', 'test', 'test', 'Invited for the test.')`,
      [randomUUID(), t.dale.id],
    );
    const joined = await call(t.handler, t.dale, "POST", "/api/rooms/county/join", {});
    assert.equal(joined.status, 200, await joined.clone().text());
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
    assert.equal(await roomOfGathering(t), "county");
  } finally {
    await t.close();
  }
});

test("Josh 5: a steward changes a gathering's date in a room they steward; another room's steward and a member cannot", async () => {
  const t = await setup();
  try {
    const dateOf = async () =>
      String((await t.db.query<{ gather_on: string }>(`select gather_on::text as gather_on from public_gathering where id = $1`, [GATHERING]))[0]?.gather_on);
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { date: "2026-11-07" }))).status, 200);
    assert.equal(await dateOf(), "2026-11-07");
    assert.equal((await call(t.handler, t.cara, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { date: "2026-11-14" }))).status, 403);
    assert.equal((await call(t.handler, t.tom, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { date: "2026-11-14" }))).status, 403);
    assert.equal((await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { date: "2026-11-14" }))).status, 403);
    assert.equal(await dateOf(), "2026-11-07");
  } finally {
    await t.close();
  }
});

test("Josh 6: the purge deletes write-up DM links older than 12 months (decided, not a switch left open)", () => {
  assert.equal(OLD_WRITE_UPS_DROP_DM_LINKS, true);
  const code = readFileSync(new URL("./rsvp.ts", import.meta.url), "utf8");
  assert.match(code, /QA N3, decided: "the purge also deletes write-up DM links older than 12\s*\n\s*\* months" \(Josh via CoS, Oct 30 12:47 PM ET\)/);
});

// ---- QA early findings at 85f06d1 (Oct 30) ----

test("QA S3 summary: admin totals count only special events; barred members still counted, never named; no backfill", async () => {
  const t = await setup();
  try {
    await scene(t);
    // Tom is barred from the shop room: his RSVPs still count (Josh's rule), with no name.
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Sam', 1, $3, 'shop', now())`,
      [randomUUID(), t.tom.id, "2027-01-01T00:00:00Z"],
    );
    const before = await rsvpSummary(t.db, new Date(), 1);
    assert.deepEqual([before.totals.going, before.totals.came], [4, 1]);
    // M stops being special by hand (its rows stay): it drops out of the totals.
    await t.db.query(`update public_gathering set special = false where id = $1`, [MARIAS]);
    const after = await rsvpSummary(t.db, new Date(), 1);
    assert.deepEqual([after.totals.going, after.totals.came], [2, 1], "G only: Tom (barred) and Maria going, Tom came");
    const ids = after.rooms.flatMap((room) => room.gatherings.map((g) => g.gatheringId));
    assert.equal(ids.includes(MARIAS), false);
    assert.equal(ids.includes(GATHERING), true);
    const text = JSON.stringify(after);
    assert.equal(text.includes(t.tom.id), false);
    assert.equal(text.includes('"Tom"'), false);
    // Existing gatherings stay not special after 0050: no backfill, no auto-marking.
    const sql = readFileSync(new URL("../../migrations/0050_gathering_special.sql", import.meta.url), "utf8");
    assert.doesNotMatch(sql, /\bupdate\b|\binsert\b/i);
    assert.match(sql, /special boolean not null default false/);
    const src = readFileSync(new URL("./rsvp-summary.ts", import.meta.url), "utf8");
    assert.match(src, /and \$\{GATHERING_IS_SPECIAL\}/);
  } finally {
    await t.close();
  }
});

/** Dale's write-up of G naming Tom (came list + id link), and a hand-made one on OTHER that must survive. */
async function writeUps(t: Awaited<ReturnType<typeof setup>>) {
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
  const postId = posted.ok ? posted.value.id : "";
  const other = randomUUID();
  await t.db.query(
    `insert into board_post (id, room_id, type, claim, reason, on_date, author_user_id, author_name, came, card_id, created_at)
     select $1, room_id, type, claim, reason, on_date, author_user_id, author_name, array['Tom'], $2, now()
     from board_post where id = $3`,
    [other, OTHER, postId],
  );
  await t.db.query(`insert into dm_named_account (post_id, user_id) values ($1, $2)`, [other, t.tom.id]);
  const came = async (id: string) => (await t.db.query<{ came: string[] }>(`select came from board_post where id = $1`, [id]))[0]!.came;
  const links = async (id: string) => (await t.db.query(`select 1 from dm_named_account where post_id = $1`, [id])).length;
  const rsvps = async () => (await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [GATHERING])).length;
  const tomSees = async () => {
    const board = await listBoard(t.db, t.tom.id, new Date("2026-11-01T12:00:00Z"), { room: "shop" });
    assert.equal(board.ok, true);
    return board.ok ? board.value.posts.find((post) => post.id === postId)?.youCame : undefined;
  };
  return { postId, other, came, links, rsvps, tomSees };
}

test("Josh H1 (hide): untick then re-tick keeps every row and brings the lists back; members keep their own", async () => {
  const t = await setup();
  try {
    const w = await writeUps(t);
    const snapshot = async () => ({
      rsvps: await t.db.query(`select user_id, going, attended from gathering_rsvp where gathering_id = $1 order by user_id`, [GATHERING]),
      came: await w.came(w.postId),
      links: await w.links(w.postId),
    });
    const samSees = async () => {
      const board = await listBoard(t.db, t.sam.id, new Date("2026-11-01T12:00:00Z"), { room: "shop" });
      return board.ok ? board.value.posts.find((post) => post.id === w.postId)?.came : undefined;
    };
    const tomOnRoster = async (viewer: string) => {
      const list = await listRoomMembers(t.db, viewer, "shop", new Date("2026-11-01T12:00:00Z"));
      return list.ok ? (list.value.members.find((m) => m.id === t.tom.id)?.attended.length ?? 0) : -1;
    };
    for (const who of [t.sam, t.tom]) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [who.id]);
    }
    const rows = await snapshot();
    const lists = (await seen(t, t.dale)).rows.filter((row) => row.startsWith("G:"));
    assert.ok(lists.length > 0);
    assert.deepEqual(await samSees(), ["Tom"]);
    const onRoster = await tomOnRoster(t.sam.id);
    assert.equal(onRoster, 2, "G's write-up and the other one");
    assert.equal(await w.tomSees(), true);
    // Untick: nothing deleted, nothing named.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: false }))).status, 200);
    assert.equal(await specialOf(t), false);
    assert.deepEqual(await snapshot(), rows, "every row kept");
    assert.deepEqual((await seen(t, t.dale)).rows.filter((row) => row.startsWith("G:")), []);
    assert.deepEqual((await seen(t, t.sam)).rows.filter((row) => row.startsWith("G:")), []);
    assert.deepEqual(await samSees(), [], "the write-up names no one while not special");
    assert.equal(await tomOnRoster(t.sam.id), onRoster - 1, "the roster shows others no came date for G");
    assert.equal(await w.tomSees(), true, "Tom keeps his own 'You came'");
    assert.equal(await tomOnRoster(t.tom.id), onRoster, "Tom keeps his own 'You've been' on the roster");
    assert.equal((await call(t.handler, t.tom, "POST", `/api/gatherings/${GATHERING}/rsvp`, { going: true })).status, 409);
    assert.equal((await rsvpSummary(t.db, new Date(), 1)).rooms.flatMap((r) => r.gatherings).some((g) => g.gatheringId === GATHERING), false);
    // The other gathering's write-up is untouched throughout.
    assert.deepEqual(await w.came(w.other), ["Tom"]);
    // Re-tick: all back.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: true }))).status, 200);
    assert.deepEqual(await snapshot(), rows);
    assert.deepEqual((await seen(t, t.dale)).rows.filter((row) => row.startsWith("G:")), lists);
    assert.deepEqual(await samSees(), ["Tom"]);
    assert.equal(await tomOnRoster(t.sam.id), onRoster);
    // No delete path is left in saveGathering.
    const src = readFileSync(new URL("./gathering-record.ts", import.meta.url), "utf8");
    const save = src.slice(src.indexOf("export async function saveGathering"), src.indexOf("export async function", src.indexOf("export async function saveGathering") + 10));
    assert.doesNotMatch(save, /delete from|dropGatheringRsvps|came = '\{\}'/);
    assert.match(save, /db\.transaction\(write\)/);
  } finally {
    await t.close();
  }
});

test("Josh H1 (hide): the 12-month purge still clears hidden rows and a hidden write-up's came list", async () => {
  const t = await setup();
  try {
    const w = await writeUps(t);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: false }))).status, 200);
    assert.ok((await w.rsvps()) > 0);
    await t.db.query(`update gathering_rsvp set updated_at = '2025-01-01T00:00:00Z' where gathering_id = $1`, [GATHERING]);
    await t.db.query(`update board_post set on_date = '2025-09-01', created_at = '2025-09-01T00:00:00Z' where id = $1`, [w.postId]);
    const marias = (await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [MARIAS])).length;
    await purgeOldRsvps(t.db, new Date("2026-11-01T12:00:00Z"));
    assert.equal(await w.rsvps(), 0, "hidden RSVPs older than 12 months are purged");
    assert.deepEqual(await w.came(w.postId), []);
    assert.equal(await w.links(w.postId), OLD_WRITE_UPS_DROP_DM_LINKS ? 0 : 1);
    assert.equal((await t.db.query(`select 1 from gathering_rsvp where gathering_id = $1`, [MARIAS])).length, marias, "recent rows stay");
  } finally {
    await t.close();
  }
});

test("Josh 2:03 PM: a real steward of the room can change date, time, title and place; not special, not another room's", async () => {
  const t = await setup();
  try {
    const res = await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", {
      special: undefined, title: "Sunday lifts", date: "2026-11-08", time: "8 a.m.", place: "The church hall, Riverview",
    }));
    assert.equal(res.status, 200, await res.clone().text());
    const row = (await t.db.query<{ title: string; gather_on: string; gather_time: string; place: string; host_user_id: string }>(
      `select title, gather_on, gather_time, place, host_user_id from public_gathering where id = $1`, [GATHERING]))[0]!;
    assert.deepEqual([row.title, row.gather_on, row.gather_time, row.place], ["Sunday lifts", "2026-11-08", "8 a.m.", "The church hall, Riverview"]);
    assert.equal(row.host_user_id, t.dale.id, "the host stays the host");
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: false }))).status, 403);
    // Cara stewards another room: no edit here. Josh (admin, not steward) neither.
    for (const who of [t.cara, t.josh, t.tom]) {
      assert.equal((await call(t.handler, who, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: undefined, title: "Nope" }))).status, 403, who.id);
    }
  } finally {
    await t.close();
  }
});

// ---- Steward date-change email (Josh via CoS, Oct 30 2:35 PM ET) ----

const MAIL_ENV = {} as NodeJS.ProcessEnv;
function mailbox(fail = false) {
  const sent: { to: string | string[]; subject: string; text: string; html?: string; idempotencyKey: string }[] = [];
  return {
    sent,
    deps: {
      env: MAIL_ENV,
      send: async (mail: (typeof sent)[number]) => {
        sent.push(mail);
        return fail ? ({ ok: false, error: "mail 500" } as const) : ({ ok: true } as const);
      },
    },
  };
}
const stewardDate = (t: Awaited<ReturnType<typeof setup>>, who: { id: string }, date: string, deps: unknown, at = new Date("2026-11-01T12:00:00Z")) =>
  saveGathering(t.db, { userId: who.id, ...gatheringBody(GATHERING, "shop", { special: undefined, date }), now: at }, deps as never);
async function verify(t: Awaited<ReturnType<typeof setup>>, ...people: { id: string }[]) {
  for (const who of people) {
    await t.db.query(`update "user" set "emailVerified" = true, email = $2 where id = $1`, [who.id, `${who.id}@mail.test`]);
  }
}

test("steward date email: the host and everyone going, one each, less barred, banned, the steward, not-going and unverified", async () => {
  resetDateMailGuard();
  const t = await setup();
  try {
    await scene(t); // G: Tom and Maria going; Dale hosts.
    const ann = await user(t.db, "Ann");
    const bob = await user(t.db, "Bob");
    const eve = await user(t.db, "Eve");
    const ned = await user(t.db, "Ned");
    for (const [id, name] of [[ann, "Ann"], [bob, "Bob"], [eve, "Eve"], [ned, "Ned"]] as const) await grant(t.db, id, name);
    for (const id of [ann, bob, eve, ned]) {
      await t.db.query(
        `insert into gathering_rsvp (gathering_id, user_id, going, attended, updated_at) values ($1, $2, $3, $4, now())`,
        // Ned is not going (only marked as came), so he gets nothing.
        [GATHERING, id, id !== ned, id === ned],
      );
    }
    // Ann: barred in the room. Bob: banned site-wide. Ned: not going. Eve: going.
    for (const [id, room] of [[ann, "shop"], [bob, ""]] as const) {
      await t.db.query(
        `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
         values ($1, $2, 'x', 'threat', 'Sam', 1, '2027-01-01T00:00:00Z', $3, now())`,
        [randomUUID(), id, room],
      );
    }
    // Sam (the steward) is going too; Maria has no verified email.
    await t.db.query(`insert into gathering_rsvp (gathering_id, user_id, going, attended, updated_at) values ($1, $2, true, false, now())`, [GATHERING, t.sam.id]);
    await verify(t, t.dale, t.tom, t.sam, { id: ann }, { id: bob }, { id: eve }, { id: ned });
    await t.db.query(`update "user" set "emailVerified" = false where id = $1`, [t.maria.id]);
    const box = mailbox();
    const saved = await stewardDate(t, t.sam, "2026-11-07", box.deps);
    assert.equal(saved.ok, true);
    assert.equal(await (saved.ok ? saved.mailed : undefined), 3);
    const to = box.sent.map((mail) => mail.to);
    assert.deepEqual([...to].sort(), [t.dale.id, t.tom.id, eve].map((id) => `${id}@mail.test`).sort());
    for (const mail of box.sent) assert.equal(typeof mail.to, "string", "one recipient per email, never a shared To");
    // Content: the title, both dates and a link; no names.
    const mail = box.sent[0]!;
    assert.equal(mail.subject, "New date for Saturday lifts");
    assert.match(mail.text, /It was: Saturday, October 31, 2026/);
    assert.match(mail.text, /It's now: Saturday, November 7, 2026/);
    assert.match(mail.text, /See it here: https:\/\/avouchsocial\.com\//);
    for (const name of ["Dale", "Tom", "Maria", "Sam", "Eve", "Ann", "Bob", "Ned", "The Shop", "steward"]) {
      assert.equal(mail.text.includes(name) || mail.subject.includes(name), false, name);
    }
    assert.equal(/@/.test(mail.text), false);
    // The HTML part says the same, and names no one either.
    assert.match(mail.html ?? "", /The date for <strong>Saturday lifts<\/strong> has changed\./);
    assert.match(mail.html ?? "", /It's now: <strong>Saturday, November 7, 2026<\/strong>/);
    for (const name of ["Dale", "Tom", "Maria", "Sam", "Eve", "Ann", "Bob", "Ned", "The Shop", "steward"]) {
      assert.equal((mail.html ?? "").includes(name), false, name);
    }
    assert.equal(/@/.test(mail.html ?? ""), false);
  } finally {
    await t.close();
  }
});

test("steward date email: barred in the room it moved from gets nothing; the host's own change or no date change sends nothing; not special tells the host only; revoked gets nothing", async () => {
  resetDateMailGuard();
  const t = await setup();
  try {
    await scene(t);
    await verify(t, t.dale, t.tom, t.maria);
    // Tom is barred in the room G came from.
    await t.db.query(`update public_gathering set moved_from = array['county'] where id = $1`, [GATHERING]);
    await t.db.query(
      `insert into board_ban (id, user_id, name, reason, by_name, strikes, until_at, room_id, created_at)
       values ($1, $2, 'Tom', 'threat', 'Cara', 1, '2027-01-01T00:00:00Z', 'county', now())`,
      [randomUUID(), t.tom.id],
    );
    const box = mailbox();
    const saved = await stewardDate(t, t.sam, "2026-11-07", box.deps);
    assert.equal(await (saved.ok ? saved.mailed : undefined), 2);
    assert.deepEqual(box.sent.map((m) => m.to).sort(), [t.dale.id, t.maria.id].map((id) => `${id}@mail.test`).sort());
    // The host changing it: nothing.
    resetDateMailGuard();
    const host = mailbox();
    const own = await stewardDate(t, t.dale, "2026-11-14", host.deps);
    assert.equal(own.ok && own.mailed, undefined);
    assert.equal(host.sent.length, 0);
    // A steward's edit that keeps the date: nothing.
    const same = mailbox();
    const kept = await saveGathering(t.db, { userId: t.sam.id, ...gatheringBody(GATHERING, "shop", { special: undefined, date: "2026-11-14", title: "Renamed" }), now: new Date("2026-11-01T12:00:00Z") }, same.deps as never);
    assert.equal(kept.ok && kept.mailed, undefined);
    // Not special: its RSVPs are hidden, so only the host is told (Maria's hidden "going" is not).
    resetDateMailGuard();
    await t.db.query(`update public_gathering set special = false where id = $1`, [GATHERING]);
    const plain = mailbox();
    const notSpecial = await stewardDate(t, t.sam, "2026-11-21", plain.deps);
    assert.equal(notSpecial.ok, true);
    assert.equal(await (notSpecial.ok ? notSpecial.mailed : undefined), 1);
    assert.deepEqual(plain.sent.map((m) => m.to), [`${t.dale.id}@mail.test`]);
    // A member whose access was revoked is not told either.
    resetDateMailGuard();
    await t.db.query(`update public_gathering set special = true where id = $1`, [GATHERING]);
    await t.db.query(
      `insert into access_log (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Maria', 'member', '', 'revoke', 'test', 'test', 'test', 'For the test.', now())`,
      [randomUUID(), t.maria.id],
    );
    const revoked = mailbox();
    const afterRevoke = await stewardDate(t, t.sam, "2026-11-28", revoked.deps);
    assert.equal(await (afterRevoke.ok ? afterRevoke.mailed : undefined), 1, "the host only: Tom is barred, Maria revoked");
    assert.deepEqual(revoked.sent.map((m) => m.to), [`${t.dale.id}@mail.test`]);
  } finally {
    await t.close();
  }
});

test("steward date email: a failed send does not undo the edit, and is logged without addresses", async () => {
  resetDateMailGuard();
  const t = await setup();
  try {
    await scene(t);
    await verify(t, t.dale, t.tom, t.maria);
    const box = mailbox(true);
    const logged: string[] = [];
    const error = console.error;
    console.error = (line: string) => logged.push(String(line));
    let saved;
    try {
      saved = await stewardDate(t, t.sam, "2026-11-07", box.deps);
      assert.equal(await (saved.ok ? saved.mailed : undefined), 0);
    } finally {
      console.error = error;
    }
    assert.equal(saved.ok, true);
    assert.equal((await t.db.query<{ gather_on: string }>(`select gather_on from public_gathering where id = $1`, [GATHERING]))[0]?.gather_on, "2026-11-07");
    assert.equal(box.sent.length, 3);
    assert.ok(logged.some((line) => line.includes("gathering-date-mail-failed")));
    assert.equal(logged.some((line) => line.includes("@")), false);
    // A transport that throws is caught too.
    resetDateMailGuard();
    const throws = { env: MAIL_ENV, send: async () => { throw new Error("boom"); } };
    console.error = () => {};
    try {
      const again = await stewardDate(t, t.sam, "2026-11-08", throws);
      assert.equal(again.ok, true);
      assert.equal(await (again.ok ? again.mailed : undefined), 0);
    } finally {
      console.error = error;
    }
    // A provider error that echoes an address is scrubbed before logging.
    resetDateMailGuard();
    const echoes = { env: MAIL_ENV, send: async (mail: { to: string | string[] }) => ({ ok: false, error: `bad recipient ${String(mail.to)}` }) as const };
    const echoed: string[] = [];
    console.error = (line: string) => echoed.push(String(line));
    try {
      await (async () => { const r = await stewardDate(t, t.sam, "2026-11-10", echoes); return r.ok ? r.mailed : undefined; })();
    } finally {
      console.error = error;
    }
    assert.equal(echoed.length, 3);
    assert.equal(echoed.some((line) => line.includes("@")), false);
    // Back to the 8th, which the API edit below moves on from.
    await t.db.query(`update public_gathering set gather_on = '2026-11-08' where id = $1`, [GATHERING]);
    assert.equal((await t.db.query<{ gather_on: string }>(`select gather_on from public_gathering where id = $1`, [GATHERING]))[0]?.gather_on, "2026-11-08");
    // Through the API, which has no mock: under the test runner it never sends, and the edit saves.
    const res = await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { special: undefined, date: "2026-11-09" }));
    assert.equal(res.status, 200);
  } finally {
    await t.close();
  }
});

test("steward date email: one per gathering per person per hour, however often the date changes", async () => {
  resetDateMailGuard();
  const t = await setup();
  try {
    await scene(t);
    await verify(t, t.dale, t.tom, t.maria);
    const box = mailbox();
    const at = (minutes: number) => new Date(Date.parse("2026-11-01T12:00:00Z") + minutes * 60_000);
    const first = await stewardDate(t, t.sam, "2026-11-07", box.deps, at(0));
    assert.equal(await (first.ok ? first.mailed : undefined), 3);
    const second = await stewardDate(t, t.sam, "2026-11-08", box.deps, at(10));
    assert.equal(await (second.ok ? second.mailed : undefined), 0);
    const third = await stewardDate(t, t.sam, "2026-11-09", box.deps, at(59));
    assert.equal(await (third.ok ? third.mailed : undefined), 0);
    assert.equal(box.sent.length, 3);
    const later = await stewardDate(t, t.sam, "2026-11-10", box.deps, at(61));
    assert.equal(await (later.ok ? later.mailed : undefined), 3);
    assert.equal(new Set(box.sent.map((m) => m.idempotencyKey)).size, 6);
  } finally {
    await t.close();
  }
});

test("steward date email: copy, HTML part and link (draft for Design)", () => {
  // The app's public address (gatheringPublicUrl): the public page when shared, else the app.
  assert.equal(dateMailLink({ gatheringId: GATHERING, shared: true }), `https://avouchsocial.com/e/${GATHERING}`);
  assert.equal(dateMailLink({ gatheringId: GATHERING, shared: false }), "https://avouchsocial.com/");
  const mail = dateMail({ title: "Saturday\nlifts", oldDate: "", newDate: "2026-11-07" }, "");
  assert.equal(mail.subject, "New date for Saturday lifts");
  assert.match(mail.text, /It was: no date/);
  assert.doesNotMatch(mail.text, /See it here/);
  assert.doesNotMatch(mail.html, /<a /);
  // A title is escaped in the HTML part.
  assert.match(dateMail({ title: "Lifts <b>&</b> more", oldDate: "2026-10-31", newDate: "2026-11-07" }, "https://a.example/e/x").html, /Lifts &lt;b&gt;&amp;&lt;\/b&gt; more/);
  const src = readFileSync(new URL("./date-mail.ts", import.meta.url), "utf8");
  assert.match(src, /claimFromAddress\(env\)/, "the member-facing sender of claim codes");
  assert.doesNotMatch(src, /RESEND_FROM\b(?!\))/);
});

// ---- QA held notes on #138 (Oct 30): H1 and H4 ----

test("QA H1 (#138): the 12-month purge deletes dm_attendance for old write-ups and keeps confirms backed by a recent one", async () => {
  const t = await setup();
  const now = new Date("2026-11-01T12:00:00Z");
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    await scene(t);
    const posted = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-31", came: ["Tom", "Maria"], cardId: GATHERING, cameIds: [rsvpHandle(GATHERING, t.tom.id), rsvpHandle(GATHERING, t.maria.id)] },
      now,
    });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    // Both confirmed (stored as /api/dm/attendance would; the purge is under test here).
    for (const who of [t.tom, t.maria]) {
      await t.db.query(`insert into dm_named_account (post_id, user_id) values ($1, $2) on conflict do nothing`, [posted.ok ? posted.value.id : "", who.id]);
      await t.db.query(`insert into dm_attendance (user_id, meeting_id, recorded_at) values ($1, $2, $3)`, [who.id, GATHERING, now]);
    }
    const rows = async () =>
      (await t.db.query<{ user_id: string }>(`select user_id from dm_attendance where meeting_id = $1 order by user_id`, [GATHERING])).map((row) => row.user_id);
    assert.deepEqual(await rows(), [t.tom.id, t.maria.id].sort());
    // A second, recent write-up on the same card names Maria only.
    const recent = randomUUID();
    await t.db.query(
      `insert into board_post (id, room_id, type, claim, reason, on_date, author_user_id, author_name, came, card_id, created_at)
       select $1, room_id, type, claim, reason, '2026-10-01', author_user_id, author_name, array['Maria'], card_id, now()
       from board_post where id = $2`,
      [recent, posted.ok ? posted.value.id : ""],
    );
    await t.db.query(`insert into dm_named_account (post_id, user_id) values ($1, $2)`, [recent, t.maria.id]);
    // The first write-up is now older than 12 months.
    await t.db.query(`update board_post set on_date = '2025-09-01' where id = $1`, [posted.ok ? posted.value.id : ""]);
    await purgeOldRsvps(t.db, now);
    // Tom's confirm went with his only link; Maria's stays, backed by the recent write-up.
    assert.deepEqual(await rows(), [t.maria.id]);
    assert.equal(await sharesMeeting(t.db, t.tom.id, t.dale.id), false);
    assert.equal(await sharesMeeting(t.db, t.maria.id, t.dale.id), true);
    // Off switch: links and confirms both stay.
    await t.db.query(`update board_post set on_date = '2025-09-01' where id = $1`, [recent]);
    await purgeOldRsvps(t.db, now, false);
    assert.deepEqual(await rows(), [t.maria.id]);
  } finally {
    await t.close();
  }
});

test("QA H4 (#138): a write-up dated in the future ages out 12 months after it was filed", async () => {
  const t = await setup();
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    await scene(t);
    const future = randomUUID();
    const recent = randomUUID();
    for (const [id, filed] of [[future, "2025-09-01T12:00:00Z"], [recent, "2026-10-15T12:00:00Z"]] as const) {
      await t.db.query(
        `insert into board_post (id, room_id, type, claim, reason, on_date, author_user_id, author_name, came, created_at)
         values ($1, 'shop', 'hosted', 'The lift went well and the next one is set.', '', '2099-01-01', $2, 'Dale', array['Tom'], $3)`,
        [id, t.dale.id, filed],
      );
    }
    await purgeOldRsvps(t.db, new Date("2026-11-01T12:00:00Z"));
    const came = async (id: string) => (await t.db.query<{ came: string[] }>(`select came from board_post where id = $1`, [id]))[0]?.came;
    assert.deepEqual(await came(future), [], "filed 14 months ago: aged out, whatever date it claims");
    assert.deepEqual(await came(recent), ["Tom"], "filed last month: kept");
  } finally {
    await t.close();
  }
});
