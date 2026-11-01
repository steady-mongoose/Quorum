import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COUNTIES } from "../../src/lib/board/counties.ts";
import { openTestDb } from "../closed-test/test-db.ts";
import {
  mintInvite,
  redeemInvite,
  seatFoundingAdmin,
  type CreateAccount,
  type SignIn,
} from "../closed-test/store.ts";
import type { Db } from "../db.ts";
import { importListings } from "./claims.ts";
import { readHomeCounty, saveHomeCounty } from "./counties.ts";
import { decideGroupRequest, listGroups, requestGroup } from "./groups.ts";
import { decideRoom, listHome, requestRoom } from "./places-store.ts";
import { createRoom, listBoard, updateRoom } from "./store.ts";
import { firstSteward } from "./test-stewards.ts";

const now = new Date("2026-11-01T12:00:00Z");
const headers = new Headers();

async function user(db: Db, id: string, name: string) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4, $4)`,
    [id, name, `${id}@example.com`, now],
  );
}

async function grant(db: Db, id: string, name: string, role: "member" | "admin", roomId = "") {
  await db.query(
    `insert into access_log
     (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
     values ($1, $2, $3, $4, $5, 'grant', 'test', 'test', 'test', 'Granted for the test.', $6)`,
    [randomUUID(), id, name, role, roomId, now],
  );
}

async function county(db: Db, roomId: string): Promise<string | undefined> {
  const rows = await db.query<{ county_id: string }>(`select county_id from room where id = $1`, [
    roomId,
  ]);
  return rows[0]?.county_id;
}

test("0051 seeds the four counties and agrees with the code", async () => {
  const { db, close } = await openTestDb();
  try {
    const rows = await db.query<{ id: string; name: string }>(
      `select id, name from county order by sort_order`,
    );
    assert.deepEqual(
      rows.map((row) => ({ id: row.id, name: row.name })),
      COUNTIES.map((row) => ({ id: row.id, name: row.name })),
    );
  } finally {
    await close();
  }
});

test("0051 puts rooms and groups in Hillsborough and opens a County room in the other three", async () => {
  const { db, close } = await openTestDb();
  try {
    for (const id of ["county", "shop", "dispatch", "cong-grace", "region-hillsborough"]) {
      assert.equal(await county(db, id), "hillsborough");
    }
    assert.equal(await county(db, "county-polk"), "polk");
    assert.equal(await county(db, "county-manatee"), "manatee");
    assert.equal(await county(db, "county-pinellas"), "pinellas");
    const listed = await db.query<{ category_id: string }>(
      `select category_id from room_categories where room_id = 'county-polk'`,
    );
    assert.deepEqual(
      listed.map((row) => row.category_id),
      ["county"],
    );
    const groups = await db.query<{ county_id: string }>(
      `select distinct county_id from theme_group`,
    );
    assert.deepEqual(
      groups.map((row) => row.county_id),
      ["hillsborough"],
    );
  } finally {
    await close();
  }
});

test("0051 keeps a saved county, asks everyone else, and leaves joined rooms alone", async () => {
  const { pg, close } = await openTestDb({ before: "0051_counties.sql" });
  const apply = async () =>
    pg.exec(await readFile(new URL("../../migrations/0051_counties.sql", import.meta.url), "utf8"));
  try {
    const add = async (id: string, town: string, where: string) => {
      await pg.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $1, $2, true, now(), now())`,
        [id, `${id}@example.com`],
      );
      await pg.query(
        `insert into members (user_id, display_name, location_town, location_county)
         values ($1, $1, $2, $3)`,
        [id, town, where],
      );
    };
    await add("maria", "bradenton", "manatee");
    await add("dale", "", "");
    await add("luis", "elsewhere", "");
    await pg.query(`insert into room_join (user_id, room_id) values ('dale', 'shop')`);
    await pg.query(
      `insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun,
                         requires_next_date, parish, sort_order, status, county)
       values ('st-pete-listing', 'St. Pete Listing', '', '{}', '{}', '{}', 'Meeting',
               false, false, 90, 'unclaimed', 'Pinellas County')`,
    );
    await apply();
    const homes = await pg.query<{ user_id: string; home_county: string | null }>(
      `select user_id, home_county from members order by user_id`,
    );
    assert.deepEqual(
      homes.rows.map((row) => [row.user_id, row.home_county]),
      [
        ["dale", null],
        ["luis", null],
        ["maria", "manatee"],
      ],
    );
    const joined = await pg.query(`select 1 from room_join where user_id = 'dale'`);
    assert.equal(joined.rows.length, 1);
    const listing = await pg.query<{ county_id: string }>(
      `select county_id from room where id = 'st-pete-listing'`,
    );
    assert.equal(listing.rows[0]?.county_id, "pinellas");
    // A second run changes nothing and adds nothing.
    await apply();
    const rooms = await pg.query(`select 1 from room where id like 'county-%'`);
    assert.equal(rooms.rows.length, 3);
  } finally {
    await close();
  }
});

test("0051 lets a member save a Polk town and refuses a town in the wrong county", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann");
    await db.query(`insert into members (user_id, display_name) values ('ann', 'Ann')`);
    await db.query(
      `update members set location_county = 'polk', location_town = 'lakeland'
       where user_id = 'ann'`,
    );
    await assert.rejects(
      db.query(
        `update members set location_county = 'polk', location_town = 'tampa'
         where user_id = 'ann'`,
      ),
    );
    await assert.rejects(
      db.query(`update members set home_county = 'sarasota' where user_id = 'ann'`),
    );
  } finally {
    await close();
  }
});

test("a member chooses a home county and can change it", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann");
    await grant(db, "ann", "Ann", "member");
    await user(db, "stranger", "Stranger");
    const first = await listBoard(db, "ann", now);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.me.homeCounty, null);
    assert.equal(first.value.me.countiesOn, true);

    assert.equal((await saveHomeCounty(db, { userId: "ann", county: "polk", now })).ok, true);
    assert.equal(await readHomeCounty(db, "ann"), "polk");
    await saveHomeCounty(db, { userId: "ann", county: "pinellas", now });
    const again = await listBoard(db, "ann", now);
    assert.equal(again.ok && again.value.me.homeCounty, "pinellas");

    const wrong = await saveHomeCounty(db, { userId: "ann", county: "sarasota", now });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.ok === false && wrong.status, 400);
    const outsider = await saveHomeCounty(db, { userId: "stranger", county: "polk", now });
    assert.equal(outsider.ok === false && outsider.status, 403);
  } finally {
    await close();
  }
});

test("the board lists every county's rooms: a county is a place to look, not a wall", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann");
    await grant(db, "ann", "Ann", "member");
    await saveHomeCounty(db, { userId: "ann", county: "hillsborough", now });
    const board = await listBoard(db, "ann", now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    const polk = board.value.rooms.find((room) => room.id === "county-polk");
    assert.equal(polk?.countyId, "polk");
    assert.equal(board.value.rooms.find((room) => room.id === "shop")?.countyId, "hillsborough");
  } finally {
    await close();
  }
});

test("a new room names its county, and only an admin moves it", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "admin", "Admin");
    await grant(db, "admin", "Admin", "admin");
    await user(db, "ann", "Ann");
    await grant(db, "ann", "Ann", "member");
    const stewards = await firstSteward(db, "admin", now);
    const base = {
      userId: "admin",
      id: "polk-shop",
      name: "Polk Shop",
      what: "Bench nights in Lakeland.",
      categoryIds: ["business-trades"],
      ...stewards,
      now,
    };
    const none = await createRoom(db, base);
    assert.equal(none.ok === false && none.status, 400);
    assert.equal((await createRoom(db, { ...base, county: "sarasota" })).ok, false);
    const made = await createRoom(db, { ...base, county: "polk" });
    assert.equal(made.ok && made.value.countyId, "polk");

    const moved = await updateRoom(db, {
      userId: "admin",
      id: "polk-shop",
      county: "manatee",
      now,
    });
    assert.equal(moved.ok && moved.value.countyId, "manatee");
    const refused = await updateRoom(db, { userId: "ann", id: "polk-shop", county: "polk", now });
    assert.equal(refused.ok, false);
    assert.equal(await county(db, "polk-shop"), "manatee");
  } finally {
    await close();
  }
});

test("a room request carries its county through approval, and Home shows it", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "admin", "Admin");
    await grant(db, "admin", "Admin", "admin");
    await user(db, "ann", "Ann");
    await grant(db, "ann", "Ann", "member");
    const blank = await requestRoom(db, {
      userId: "ann",
      kind: "town",
      name: "Lakeland",
      state: "FL",
      now,
    });
    assert.equal(blank.ok, false);
    const asked = await requestRoom(db, {
      userId: "ann",
      kind: "town",
      name: "Lakeland",
      state: "FL",
      county: "polk",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    const home = await listHome(db, "admin", now);
    assert.equal(home.ok && home.value.requests[0]?.countyId, "polk");
    const stewards = await firstSteward(db, "admin", now);
    const decided = await decideRoom(db, {
      userId: "admin",
      requestId: asked.value.id,
      decision: "approved",
      note: "People in Polk asked for this.",
      ...stewards,
      now,
    });
    assert.equal(decided.ok, true);
    if (!decided.ok) return;
    assert.equal(await county(db, decided.value.roomId ?? ""), "polk");
  } finally {
    await close();
  }
});

test("a group sits in its source room's county, and the same name is its own group", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "ann", "Ann");
    await grant(db, "ann", "Ann", "member");
    await user(db, "steward", "Steward");
    await grant(db, "steward", "Steward", "member");
    await db.query(`insert into access_log
      (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
      values ($1, 'steward', 'Steward', 'steward', 'county-polk', 'grant', 'a', 'b', 'c', 'Test.', $2)`, [
      randomUUID(),
      now,
    ]);
    await db.query(`insert into room_member (room_id, user_id) values ('county-polk', 'ann')`);
    const asked = await requestGroup(db, {
      userId: "ann",
      name: "Ann",
      roomId: "county-polk",
      groupName: "Carpentry",
      about: "Benches in Polk County.",
      now,
    });
    assert.equal(asked.ok, true);
    if (!asked.ok) return;
    assert.equal(asked.value.groupId, "polk-carpentry");
    const decided = await decideGroupRequest(db, {
      userId: "steward",
      name: "Steward",
      requestId: asked.value.id,
      decision: "approved",
      note: "People in Polk asked for this.",
      now,
    });
    assert.equal(decided.ok, true);
    const listed = await listGroups(db, "ann", now);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const byId = new Map(listed.value.groups.map((group) => [group.id, group.countyId]));
    assert.equal(byId.get("polk-carpentry"), "polk");
    assert.equal(byId.get("carpentry"), "hillsborough");
  } finally {
    await close();
  }
});

test("a listing is filed under the county it names", async () => {
  const { db, close } = await openTestDb();
  try {
    await user(db, "admin", "Admin");
    await grant(db, "admin", "Admin", "admin");
    const saved = await importListings(db, {
      userId: "admin",
      now,
      body: {
        listings: [
          {
            name: "Lakeland Grange",
            town: "Lakeland",
            county: "Polk County",
            category: "Civic",
            source_url: "https://example.com/grange",
          },
        ],
      },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(await county(db, saved.value.imported[0]?.id ?? ""), "polk");
  } finally {
    await close();
  }
});

test("a room invite gives its county, and a code with no room leaves it for the member", async () => {
  const { db, close } = await openTestDb();
  try {
    const createAccount: CreateAccount = async (tx, input) => {
      const id = randomUUID();
      await tx.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, now(), now())`,
        [id, input.name, input.email],
      );
      return { id };
    };
    const signIn: SignIn = async (input) => ({
      ok: true,
      user: { id: input.userId, name: input.name, email: input.email },
    });
    const seated = await seatFoundingAdmin(
      db,
      { envName: "Josh", email: "josh@example.com", password: "correct-horse", headers },
      async (input) => {
        const id = randomUUID();
        await db.query(
          `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
           values ($1, $2, $3, true, now(), now())`,
          [id, input.name, input.email],
        );
        return { ok: true, user: { id, name: input.name, email: input.email } };
      },
    );
    assert.equal(seated.ok, true);
    if (!seated.ok) return;
    const join = async (name: string, roomId?: string) => {
      const code = await mintInvite(
        db,
        {
          userId: seated.value.userId,
          maxUses: 1,
          expiresInDays: 7,
          attestAdult: true,
          ...(roomId ? { roomId } : {}),
        },
        now,
      );
      assert.equal(code.ok, true);
      if (!code.ok) throw new Error("no code");
      const joined = await redeemInvite(
        db,
        {
          name,
          email: `${name}@example.com`,
          password: "correct-horse",
          code: code.value.code,
          adult: true,
          headers,
        },
        createAccount,
        signIn,
        now,
      );
      assert.equal(joined.ok, true);
      if (!joined.ok) throw new Error("no member");
      return joined.value.user.id;
    };
    assert.equal(await readHomeCounty(db, await join("maria", "county-polk")), "polk");
    assert.equal(await readHomeCounty(db, await join("luis")), null);
  } finally {
    await close();
  }
});

test("before 0051 is applied the board still loads, with no county controls", async () => {
  const { db, close } = await openTestDb({ before: "0051_counties.sql" });
  try {
    await user(db, "ann", "Ann");
    await db.query(`update "user" set age_confirmed_at = now() where id = 'ann'`);
    await grant(db, "ann", "Ann", "member");
    const board = await listBoard(db, "ann", now);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(board.value.me.countiesOn, false);
    assert.equal(board.value.me.homeCounty, null);
    assert.equal(board.value.rooms.find((room) => room.id === "shop")?.countyId, "hillsborough");
    const saved = await saveHomeCounty(db, { userId: "ann", county: "polk", now });
    assert.equal(saved.ok === false && saved.status, 503);
  } finally {
    await close();
  }
});
