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
    // The real host may move it, into a room they belong to (Josh via CoS, 10:59 AM ET).
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'county', now())`, [t.dale.id]);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
    assert.equal(await roomOf(), "county");
  } finally {
    await t.close();
  }
});

// ---- Josh via CoS, Oct 30 10:59 AM ET: a host moves a gathering only into a room they belong to or steward ----

const leaksNoNames = async (t: Awaited<ReturnType<typeof setup>>, res: Response) => {
  const text = await res.text();
  for (const name of ["Tom", "Maria"]) assert.equal(text.includes(name), false, name);
  for (const id of [t.tom.id, t.maria.id]) assert.equal(text.includes(id), false);
  return text;
};

test("move rule: a host moves into a room they belong to (room_join or room_member)", async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'county', now())`, [t.dale.id]);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
    assert.equal(await roomOfGathering(t), "county");
    // room_member counts too: back into shop after standing there.
    await t.db.query(`insert into room_member (room_id, user_id) values ('shop', $1) on conflict do nothing`, [t.dale.id]);
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop"))).status, 200);
    assert.equal(await roomOfGathering(t), "shop");
    // Editing in place never needs the rule.
    assert.equal((await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "shop", { title: "Lifts" }))).status, 200);
  } finally {
    await t.close();
  }
});

test("move rule: a host moving into a visible room they are not in gets 403, no change and no names", async () => {
  const t = await setup();
  try {
    await scene(t);
    const res = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"));
    assert.equal(res.status, 403);
    const text = await leaksNoNames(t, res);
    assert.match(text, /only into a room you belong to or steward/);
    assert.equal(await roomOfGathering(t), "shop");
    const title = await t.db.query<{ title: string }>(`select title from public_gathering where id = $1`, [GATHERING]);
    assert.equal(title[0]?.title, "Saturday lifts", "nothing in the body was saved");
  } finally {
    await t.close();
  }
});

for (const seesNames of [true, false]) test(`move rule: an admin who hosts moving into a room they are not in gets 403; the admin grant never counts (ADMIN_ROLE_SEES_NAMES=${seesNames})`, () => withAdminRoleSeesNames(seesNames, async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(`update public_gathering set host_user_id = $1 where id = $2`, [t.josh.id, GATHERING]);
    const res = await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"));
    assert.equal(res.status, 403);
    await leaksNoNames(t, res);
    assert.equal(await roomOfGathering(t), "shop");
    // Once the admin really joins the room, the move is theirs to make.
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'county', now())`, [t.josh.id]);
    assert.equal((await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 200);
  } finally {
    await t.close();
  }
}));

test("move rule: QA's case (Abe moves g2 into r3, then Ava, r3's steward, sees names) now fails", async () => {
  const t = await setup();
  try {
    // Abe = Dale, the real host of g2 (GATHERING, in shop, with Tom and Maria going).
    // Ava = Cara, a real steward of r3 (county) only. Dale is not in county.
    await scene(t);
    const before = (await (await call(t.handler, t.cara, "GET", "/api/rsvps")).json()) as ListBody;
    assert.deepEqual(before.rsvps.filter((row) => row.userId !== t.cara.id), [], "Ava sees no names while g2 is in shop");
    const moved = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"));
    assert.equal(moved.status, 403);
    await leaksNoNames(t, moved);
    assert.equal(await roomOfGathering(t), "shop");
    const one = await call(t.handler, t.cara, "GET", `/api/gatherings/${GATHERING}/rsvps`);
    await leaksNoNames(t, one);
    const after = (await (await call(t.handler, t.cara, "GET", "/api/rsvps")).json()) as ListBody;
    assert.deepEqual(after.rsvps.filter((row) => row.userId !== t.cara.id), [], "Ava still sees no names");
    // A steward moving it still needs a real role in both rooms: Sam (shop) cannot, even into a room he joined.
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'county', now())`, [t.sam.id]);
    assert.equal((await call(t.handler, t.sam, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"))).status, 403);
    assert.equal(await roomOfGathering(t), "shop");
  } finally {
    await t.close();
  }
});

test("QA H2: an admin-host in r1 and r2 only moving g2 from r2 into r3 gets 403, and r3's steward still sees no names", async () => {
  // gathering-record.ts:191 let a host skip the target-room check (QA's live repro: 200, then Ava saw TEST Ben and TEST Dee).
  const t = await setup();
  try {
    await scene(t);
    const other = (await t.db.query<{ id: string }>(`select id from room where id not in ('shop', 'county') order by id limit 1`))[0];
    assert.ok(other, "a third room to stand in for r1");
    // Abe = Josh, an admin who hosts g2 (GATHERING) and belongs to r1 (another room) and r2 (shop) only.
    for (const roomId of [other.id, "shop"]) {
      await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, $2, now()) on conflict do nothing`, [t.josh.id, roomId]);
    }
    await t.db.query(`update public_gathering set host_user_id = $1 where id = $2`, [t.josh.id, GATHERING]);
    const moved = await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, "county"));
    assert.equal(moved.status, 403);
    await leaksNoNames(t, moved);
    assert.equal(await roomOfGathering(t), "shop");
    // Ava = Cara, r3's (county's) steward.
    await leaksNoNames(t, await call(t.handler, t.cara, "GET", `/api/gatherings/${GATHERING}/rsvps`));
    const list = (await (await call(t.handler, t.cara, "GET", "/api/rsvps")).json()) as ListBody;
    assert.deepEqual(list.rsvps.filter((row) => row.userId !== t.cara.id), []);
    // Moving within the rooms Abe belongs to still works.
    assert.equal((await call(t.handler, t.josh, "POST", "/api/gatherings", gatheringBody(GATHERING, other.id))).status, 200);
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

// ---- QA N1: the hidden rooms as one set ----

test("QA N1's example: A 6/6 and B 7/7 hidden, C 25/50 shown; 38 - 25 = 13 = 6 + 7, so the grand total is hidden", () => {
  const raw = [
    { roomId: "a", members: 6, gatherings: [g("a1", 6, 6)], weeks: [] },
    { roomId: "b", members: 7, gatherings: [g("b1", 7, 7)], weeks: [] },
    { roomId: "c", members: 50, gatherings: [g("c1", 25, 25)], weeks: [] },
  ];
  const sizes: Record<string, number> = { a: 6, b: 7, c: 50 };
  // Disjoint rooms: the distinct membership of A and B is 13.
  const out = suppressSummary(raw, 5, (ids) => ids.reduce((sum, id) => sum + (sizes[id] ?? 0), 0));
  const [a, b, c] = out.rooms;
  assert.equal(a!.going, null);
  assert.equal(b!.going, null);
  assert.equal(c!.going, 25);
  assert.equal(out.totals.going, null);
  assert.equal(out.totals.came, null);
  assert.equal(remainderGivesAway([6, 7, 25], [null, null, 25], raw, 5, true, () => 13), true);
});

test("QA N1 variants: overlapping members, and a near-whole remainder, still hide the total", () => {
  // A and B share 3 people: their distinct membership is 10, the remainder 13 is at least that.
  const overlap = [
    { roomId: "a", members: 6, gatherings: [g("a1", 6)], weeks: [] },
    { roomId: "b", members: 7, gatherings: [g("b1", 7)], weeks: [] },
    { roomId: "c", members: 50, gatherings: [g("c1", 25)], weeks: [] },
  ];
  assert.equal(suppressSummary(overlap, 5, (ids) => (ids.length === 2 && !ids.includes("c") ? 10 : 60)).totals.going, null);
  // Near-whole: A 6 of 8 and B 7 of 9 (distinct 17); 13 >= 17 - 5.
  const near = [
    { roomId: "a", members: 8, gatherings: [g("a1", 6)], weeks: [] },
    { roomId: "b", members: 9, gatherings: [g("b1", 7)], weeks: [] },
    { roomId: "c", members: 50, gatherings: [g("c1", 25)], weeks: [] },
  ];
  const sizes: Record<string, number> = { a: 8, b: 9, c: 50 };
  const out = suppressSummary(near, 5, (ids) => ids.reduce((sum, id) => sum + (sizes[id] ?? 0), 0));
  assert.deepEqual(out.rooms.map((r) => r.going), [null, null, 25]);
  assert.equal(out.totals.going, null);
});

test("QA N1: hidden rooms whose remainder is far from their membership leave the total shown", () => {
  const raw = [
    { roomId: "a", members: 100, gatherings: [g("a1", 3)], weeks: [] },
    { roomId: "b", members: 100, gatherings: [g("b1", 4)], weeks: [] },
    { roomId: "c", members: 50, gatherings: [g("c1", 25)], weeks: [] },
    { roomId: "d", members: 60, gatherings: [g("d1", 30)], weeks: [] },
  ];
  const sizes: Record<string, number> = { a: 100, b: 100, c: 50, d: 60 };
  const out = suppressSummary(raw, 5, (ids) => ids.reduce((sum, id) => sum + (sizes[id] ?? 0), 0));
  assert.deepEqual(out.rooms.map((r) => r.going), [null, null, 25, 30]);
  // 62 - 55 = 7: at least N, and nowhere near 200 members.
  assert.equal(out.totals.going, 62);
  // Write-ups are not people: only the under-N rule applies to them.
  assert.equal(remainderGivesAway([6, 7, 25], [null, null, 25], raw, 5, false, () => 13), false);
  assert.equal(remainderGivesAway([2, 2, 25], [null, null, 25], raw, 5, false, () => 13), true);
});

// ---- QA N2: the start time is free text; read it in New York time ----

test("QA N2: startMinutes reads am/pm, p.m., noon and 24-hour times; a bare 9:30 reads as the later 21:30", () => {
  const cases: Array<[string, number | null]> = [
    ["7 pm", 19 * 60],
    ["7pm", 19 * 60],
    ["7:00 p.m.", 19 * 60],
    ["7 P.M.", 19 * 60],
    ["11:59 pm", 23 * 60 + 59],
    ["7:00am", 7 * 60],
    ["12 am", 0],
    ["12 pm", 12 * 60],
    ["noon", 12 * 60],
    ["19:00", 19 * 60],
    ["07:30", 7 * 60 + 30],
    ["0:30", 30],
    ["9:30", 21 * 60 + 30],
    ["12:15", 12 * 60 + 15],
    ["Saturdays 6:30 PM, talk at 7", 18 * 60 + 30],
    ["Room 12", null],
    ["after supper", null],
    ["", null],
  ];
  for (const [text, minutes] of cases) assert.equal(startMinutes(text), minutes, text);
});

// ---- QA N5: more than one time reads as the latest; "noon" only on its own ----

test("QA N5/N6: the latest time in the text counts, and 'noon' is one of the times", () => {
  const cases: Array<[string, number | null]> = [
    ["after noon service, 3 pm", 15 * 60],
    ["noon service, then 3 pm", 15 * 60],
    ["3 pm, after the noon service", 15 * 60],
    ["noon", 12 * 60],
    ["lunch at noon", 12 * 60],
    ["Doors 6:30 pm, talk at 7:15 pm", 19 * 60 + 15],
    ["7:15 pm talk, doors 6:30 pm", 19 * 60 + 15],
    ["10 am and 7 pm", 19 * 60],
    ["19:00, coffee from 08:30", 19 * 60],
    ["9:30 or 10 am", 21 * 60 + 30],
    ["coffee 10:15 am, service at noon", 12 * 60],
    ["noon, coffee at 10:15 am", 12 * 60],
    ["afternoon tea", null],
  ];
  for (const [text, minutes] of cases) assert.equal(startMinutes(text), minutes, text);
  // Never early: 'after noon service, 3 pm' is closed at 12:00 and 2:59 pm in New York, open at 3 pm.
  const time = "after noon service, 3 pm";
  assert.equal(markOpen({ date: "2026-10-30", time }, new Date("2026-10-30T16:00:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time }, new Date("2026-10-30T18:59:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time }, new Date("2026-10-30T19:00:00Z")), true);
  // QA N6: 'coffee 10:15 am, service at noon' is closed at 10:45 and 11:59, open at 12:00 in New York (EDT: 16:00 UTC).
  const six = "coffee 10:15 am, service at noon";
  assert.equal(markOpen({ date: "2026-10-30", time: six }, new Date("2026-10-30T14:45:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: six }, new Date("2026-10-30T15:59:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: six }, new Date("2026-10-30T16:00:00Z")), true);
  // 'noon' alone still opens at noon.
  assert.equal(markOpen({ date: "2026-10-30", time: "noon" }, new Date("2026-10-30T15:59:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: "noon" }, new Date("2026-10-30T16:00:00Z")), true);
});

test("QA N2: markOpen in New York time, across the clock change; unreadable times wait for the date to end; undated never opens", () => {
  // Nov 1 2026 is the day the clocks go back: 23:30 UTC is 6:30 pm EST.
  const at = (iso: string) => new Date(iso);
  const day = "2026-11-01";
  assert.equal(markOpen({ date: day, time: "7 pm" }, at("2026-11-01T23:30:00Z")), false);
  assert.equal(markOpen({ date: day, time: "7 pm" }, at("2026-11-02T00:00:00Z")), true);
  assert.equal(markOpen({ date: day, time: "6:30 p.m." }, at("2026-11-01T23:30:00Z")), true);
  assert.equal(markOpen({ date: day, time: "11:59 pm" }, at("2026-11-02T04:58:00Z")), false);
  assert.equal(markOpen({ date: day, time: "11:59 pm" }, at("2026-11-02T04:59:00Z")), true);
  // Oct 30 (EDT): 7 am is 11:00 UTC.
  assert.equal(markOpen({ date: "2026-10-30", time: "07:00" }, at("2026-10-30T10:59:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: "07:00" }, at("2026-10-30T11:00:00Z")), true);
  // A bare 9:30 waits for 9:30 pm.
  assert.equal(markOpen({ date: "2026-10-30", time: "9:30" }, at("2026-10-30T14:00:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: "9:30" }, at("2026-10-31T01:30:00Z")), true);
  // Unreadable: closed all that day in New York, open the next.
  assert.equal(markOpen({ date: "2026-10-30", time: "after supper" }, at("2026-10-31T03:59:00Z")), false);
  assert.equal(markOpen({ date: "2026-10-30", time: "after supper" }, at("2026-10-31T04:00:00Z")), true);
  // Before the date, closed; undated, closed on the client and the server alike.
  assert.equal(markOpen({ date: "2026-11-02", time: "7 am" }, at("2026-11-01T23:30:00Z")), false);
  assert.equal(markOpen({ date: "", time: "7 pm" }, at("2026-11-01T23:30:00Z")), false);
});

test("QA N2: the server refuses marks on an undated gathering, an unreadable time on its own day, and a 7 pm start at 7 am", async () => {
  const t = await setup();
  try {
    // The handler's clock: Nov 1 2026, 7 a.m. in New York.
    const ids = { undated: randomUUID(), supper: randomUUID(), evening: randomUUID(), morning: randomUUID(), yesterday: randomUUID() };
    const plan: Array<[string, string, string]> = [
      [ids.undated, "", "7 pm"],
      [ids.supper, "2026-11-01", "after supper"],
      [ids.evening, "2026-11-01", "7 pm"],
      [ids.morning, "2026-11-01", "6:30 a.m."],
      [ids.yesterday, "2026-10-31", "after supper"],
    ];
    for (const [id, date, time] of plan) {
      const saved = await call(t.handler, t.dale, "POST", "/api/gatherings", gatheringBody(id, "shop", { date, time }));
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.equal((await call(t.handler, t.tom, "POST", `/api/gatherings/${id}/rsvp`, { going: true })).status, 200);
    }
    const mark = (id: string) => call(t.handler, t.dale, "POST", `/api/gatherings/${id}/attendance`, { userIds: [rsvpHandle(id, t.tom.id)] });
    for (const id of [ids.undated, ids.supper, ids.evening]) {
      const res = await mark(id);
      assert.equal(res.status, 409, id);
      assert.deepEqual(await res.json(), { error: MARK_TOO_EARLY, api: "rsvp" });
    }
    for (const id of [ids.morning, ids.yesterday]) assert.equal((await mark(id)).status, 200, id);
  } finally {
    await t.close();
  }
});

// ---- QA N3: the purge also ends DM "met at a meeting" from old write-ups ----

test("QA N3: someone named only on a write-up older than 12 months loses that DM eligibility (OLD_WRITE_UPS_DROP_DM_LINKS)", async () => {
  assert.equal(OLD_WRITE_UPS_DROP_DM_LINKS, true);
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
    // Tom confirms while the write-up is recent: #138 refuses a confirm on a
    // write-up already older than 12 months (QA H2 on #138, Oct 30).
    assert.equal((await recordAttendance(t.db, t.tom.id, new Date("2026-11-01T12:00:00Z"), [GATHERING])).ok, true);
    assert.equal((await t.db.query(`select 1 from dm_attendance where user_id = $1`, [t.tom.id])).length, 1);
    // That write-up is the only one naming Tom; make it older than 12 months.
    await t.db.query(`update board_post set on_date = '2025-09-01' where type = 'hosted' and card_id = $1`, [GATHERING]);
    assert.equal(await sharesMeeting(t.db, t.tom.id, t.dale.id), true, "before the purge, Tom and Dale met at a meeting");
    await purgeOldRsvps(t.db, new Date("2026-11-01T12:00:00Z"));
    assert.equal(await sharesMeeting(t.db, t.tom.id, t.dale.id), false, "after it, that write-up no longer makes them peers");
    // The purge deletes Tom's attendance confirm with the link (QA H1 on #138).
    assert.equal((await t.db.query(`select 1 from dm_attendance where user_id = $1`, [t.tom.id])).length, 0);
    // And Tom can no longer confirm it.
    await recordAttendance(t.db, t.tom.id, new Date("2026-11-01T12:00:00Z"), [GATHERING]);
    assert.equal((await t.db.query(`select 1 from dm_attendance where user_id = $1`, [t.tom.id])).length, 0);
  } finally {
    await t.close();
  }
});

for (const dropDmLinks of [true, false]) test(`QA N7: a member's own 'You came' is false on a write-up older than 12 months (OLD_WRITE_UPS_DROP_DM_LINKS=${dropDmLinks})`, async () => {
  const t = await setup();
  const now = new Date("2026-11-01T12:00:00Z");
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    await scene(t);
    const posted = await createPost(t.db, {
      userId: t.dale.id,
      name: "Dale",
      roomId: "shop",
      body: { type: "hosted", claim: "The lift went well and the next one is set.", on: "2026-10-31", came: ["Tom"], cardId: GATHERING, cameIds: [rsvpHandle(GATHERING, t.tom.id)] },
      now,
    });
    assert.equal(posted.ok, true, JSON.stringify(posted));
    // Tom reads the room as a member of it.
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.tom.id]);
    const youCame = async () => {
      const board = await listBoard(t.db, t.tom.id, now, { room: "shop" });
      assert.equal(board.ok, true);
      return board.ok ? board.value.posts.find((p) => p.type === "hosted")?.youCame : undefined;
    };
    assert.equal(await youCame(), true, "a recent write-up says You came");
    await t.db.query(`update board_post set on_date = '2025-09-01' where type = 'hosted' and card_id = $1`, [GATHERING]);
    assert.equal(await youCame(), false, "older than 12 months, even before the purge runs");
    await purgeOldRsvps(t.db, now, dropDmLinks);
    const links = await t.db.query(`select 1 from dm_named_account where user_id = $1`, [t.tom.id]);
    assert.equal(links.length, dropDmLinks ? 0 : 1, "the switch decides only the DM link");
    assert.equal(await youCame(), false, "and after it, either way");
  } finally {
    await t.close();
  }
});

test("QA N4: with OLD_WRITE_UPS_DROP_DM_LINKS off, the purge keeps that DM eligibility (the came list still goes)", async () => {
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
    // Confirm while recent (QA H2 on #138), then make it older than 12 months.
    assert.equal((await recordAttendance(t.db, t.tom.id, new Date("2026-11-01T12:00:00Z"), [GATHERING])).ok, true);
    await t.db.query(`update board_post set on_date = '2025-09-01' where type = 'hosted' and card_id = $1`, [GATHERING]);
    assert.equal(await sharesMeeting(t.db, t.tom.id, t.dale.id), true, "before the purge, Tom and Dale met at a meeting");
    await purgeOldRsvps(t.db, new Date("2026-11-01T12:00:00Z"), false);
    assert.equal(await sharesMeeting(t.db, t.tom.id, t.dale.id), true, "the links stay, so they are still peers");
    assert.equal((await t.db.query(`select 1 from dm_attendance where user_id = $1`, [t.tom.id])).length, 1, "and so does the confirm");
    const post = await t.db.query<{ came: string[] }>(`select came from board_post where type = 'hosted' and card_id = $1`, [GATHERING]);
    assert.deepEqual(post[0]?.came, [], "the came list is cleared either way");
  } finally {
    await t.close();
  }
});

// ---- QA review 5715189883 (Oct 30): N8 share write, N9 one retention predicate ----

const shareWrite = (t: Awaited<ReturnType<typeof setup>>, who: As, shared: boolean) =>
  call(t.handler, who, "POST", `/api/e/${GATHERING}`, { shared });
const isShared = async (t: Awaited<ReturnType<typeof setup>>) =>
  (await t.db.query<{ shared: boolean }>(`select shared from public_gathering where id = $1`, [GATHERING]))[0]!.shared;

for (const seesNames of [true, false]) test(`QA N8: a plain admin's share write is refused like the read; the host and a real steward still write (ADMIN_ROLE_SEES_NAMES=${seesNames})`, () => withAdminRoleSeesNames(seesNames, async () => {
  const t = await setup();
  try {
    await scene(t);
    await t.db.query(`update public_gathering set shared = true where id = $1`, [GATHERING]);
    // Josh: admin grant only, neither host nor steward of shop. The read is 404 (QA F1)...
    assert.equal((await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}`)).status, 404);
    // ...and the write is refused too, both ways, with no names and no change.
    for (const shared of [false, true]) {
      const res = await shareWrite(t, t.josh, shared);
      assert.ok(res.status === 403 || res.status === 404, `admin shared=${shared}: ${res.status}`);
      await leaksNoNames(t, res);
      assert.equal(await isShared(t), true, `admin shared=${shared} changed nothing`);
    }
    // A steward of another room is refused the same way.
    assert.equal((await shareWrite(t, t.cara, false)).status, 403);
    assert.equal(await isShared(t), true);
    // A real steward of the room reads it and may turn sharing off.
    assert.equal((await call(t.handler, t.sam, "GET", `/api/gatherings/${GATHERING}`)).status, 200);
    assert.equal((await shareWrite(t, t.sam, false)).status, 200);
    assert.equal(await isShared(t), false);
    // A steward still cannot turn it on; the host can write it.
    assert.equal((await shareWrite(t, t.sam, true)).status, 403);
    assert.equal((await call(t.handler, t.dale, "GET", `/api/gatherings/${GATHERING}`)).status, 200);
    await t.db.query(`update public_gathering set shared = true where id = $1`, [GATHERING]);
    assert.equal((await shareWrite(t, t.dale, false)).status, 200);
    assert.equal(await isShared(t), false);
    // Once the admin really stewards the room, that real role may turn it off.
    await t.db.query(`update public_gathering set shared = true where id = $1`, [GATHERING]);
    await stewardOf(t.db, t.josh.id, "Josh", "shop");
    assert.equal((await call(t.handler, t.josh, "GET", `/api/gatherings/${GATHERING}`)).status, 200);
    assert.equal((await shareWrite(t, t.josh, false)).status, 200);
    assert.equal(await isShared(t), false);
  } finally {
    await t.close();
  }
}));

test("QA N9: the write-up purge strips exactly what writeUpWithin no longer keeps, at the shared cutoff", async () => {
  const t = await setup();
  const now = new Date("2026-11-01T12:00:00Z");
  try {
    await t.db.query(`insert into room_join (user_id, room_id, joined_at) values ($1, 'shop', now()) on conflict do nothing`, [t.dale.id]);
    await scene(t);
    const cutoff = rsvpCutoff(now);
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    const dayBefore = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tom = [rsvpHandle(GATHERING, t.tom.id)];
    const posts = {
      onCutoff: await writeUp(t, ["Tom"], tom, "2026-10-29"),
      dayBefore: await writeUp(t, ["Tom"], tom, "2026-10-29"),
      undatedOld: await writeUp(t, ["Tom"], tom, "2026-10-29"),
      undatedNew: await writeUp(t, ["Tom"], tom, "2026-10-29"),
    };
    await t.db.query(`update board_post set on_date = $2 where id = $1`, [posts.onCutoff, cutoffDay]);
    await t.db.query(`update board_post set on_date = $2 where id = $1`, [posts.dayBefore, dayBefore]);
    await t.db.query(`update board_post set on_date = '', created_at = $2 where id = $1`, [posts.undatedOld, new Date(cutoff.getTime() - 1000)]);
    await t.db.query(`update board_post set on_date = '', created_at = $2 where id = $1`, [posts.undatedNew, new Date(cutoff.getTime() + 1000)]);
    // What the readers keep (members.ts, came-sight.ts), before the purge.
    const kept = async (id: string) =>
      (await t.db.query<{ kept: boolean }>(`select ${writeUpWithin("$1", "$2")} as kept from board_post p where p.id = $3`, [cutoffDay, cutoff, id]))[0]!.kept;
    const want = { onCutoff: true, dayBefore: false, undatedOld: false, undatedNew: true };
    for (const [key, id] of Object.entries(posts)) assert.equal(await kept(id), want[key as keyof typeof want], key);
    await purgeOldRsvps(t.db, now);
    for (const [key, id] of Object.entries(posts)) {
      const came = (await t.db.query<{ came: string[] }>(`select came from board_post where id = $1`, [id]))[0]!.came;
      assert.equal(came.length > 0, want[key as keyof typeof want], `${key}: the purge agrees with writeUpWithin`);
    }
    // One predicate in the source: the purge builds its condition from writeUpWithin, with no cutoff of its own.
    const source = readFileSync(new URL("./rsvp.ts", import.meta.url), "utf8");
    const purge = source.slice(source.indexOf("async function purgeOldWriteUpNames"), source.indexOf("export function startRsvpRetention"));
    assert.match(purge, /not \$\{writeUpWithin\("\$1", "\$2"\)\}/);
    assert.doesNotMatch(purge, /on_date\s*</);
    assert.doesNotMatch(purge, /created_at\s*</);
    assert.doesNotMatch(purge, /setUTCMonth|RSVP_RETENTION_MONTHS/);
  } finally {
    await t.close();
  }
});

