import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { openTestDb } from "../closed-test/test-db.ts";
import type { Db } from "../db.ts";
import {
  endpointGroup,
  parseStatsQuery,
  protectBreakdown,
  recoverableHidden,
  showCount,
  showPercent,
  toStatsCsv,
  type ShownCount,
  type StatsPayload,
} from "../../src/lib/board/stats.ts";
import { noteAuthenticatedRequest } from "./activity.ts";
import { startNightlyStats } from "./schedule.ts";
import { activityRetentionDays } from "./config.ts";
import { asCount, isoDate } from "./dates.ts";
import { readStats, readStatsCsv } from "./read.ts";
import { rollStats } from "./rollup.ts";

const NOW = new Date("2026-10-26T12:00:00Z");

test("endpoint groups follow the request path", () => {
  assert.equal(endpointGroup("/api/rooms/shop/chat"), "chat");
  assert.equal(endpointGroup("/api/rooms/shop/chat/1"), "chat");
  assert.equal(endpointGroup("/api/rooms/shop/posts"), "board");
  assert.equal(endpointGroup("/api/board"), "board");
  assert.equal(endpointGroup("/api/auth/get-session"), null);
  assert.equal(endpointGroup("/api/dm/threads"), "messages");
  assert.equal(endpointGroup("/api/admin/stats"), "admin");
  assert.equal(endpointGroup("/api/gatherings"), "gatherings");
  assert.equal(endpointGroup("/api/media/status"), "media");
  assert.equal(endpointGroup("/api/unknown-surface"), "other");
  assert.equal(endpointGroup("/about"), null);
});

test("activity retention defaults to 90 days", () => {
  assert.equal(activityRetentionDays(undefined), 90);
  assert.equal(activityRetentionDays(""), 90);
  assert.equal(activityRetentionDays("90"), 90);
  assert.throws(() => activityRetentionDays("0"), /whole number|1 to 3650/);
  assert.throws(() => activityRetentionDays("nope"), /whole number/);
  assert.throws(() => activityRetentionDays("3651"), /1 to 3650/);
});

test("a rounded total does not give a hidden cell back", () => {
  const rooms = protectBreakdown([10, 2]);
  assert.deepEqual(rooms.parts, [10, "<5"]);
  assert.equal(rooms.total, 10);
  const roomChoices = recoverableHidden([10, 2], rooms.total);
  assert.ok(roomChoices.length > 1);
  assert.equal(roomChoices.length === 1, false);

  const joins = protectBreakdown([6, 1]);
  assert.equal(joins.parts[1], "<5");
  assert.notEqual(joins.total, 7);
  assert.ok(recoverableHidden([6, 1], joins.total).length > 1);

  const leak = protectBreakdown([7, 0]);
  assert.equal(leak.total, "<5");
  assert.deepEqual(recoverableHidden([7, 0], leak.total), []);
  assert.deepEqual(recoverableHidden([7, 0], 5), [0]);
});

test("counts under 5 are hidden and a percent needs five people on both sides", () => {
  assert.equal(showCount(0), "<5");
  assert.equal(showCount(4), "<5");
  assert.equal(showCount(5), 5);
  assert.equal(showCount(6), 6);
  assert.equal(showPercent(4, 10), null);
  assert.equal(showPercent(6, 4), null);
  assert.equal(showPercent(6, 10), 60);
  assert.equal(showPercent(12, 10), null);
});

test("a csv cell that starts like a formula is neutralized", () => {
  const stats = emptyStats();
  stats.rooms.rows = [
    { week: "2026-10-19", room: '=HYPERLINK("http://example.test")', posts: "<5", gatherings: 6 },
  ];
  const csv = toStatsCsv(stats);
  assert.match(csv, /'=HYPERLINK/);
  assert.equal(csv.includes(",=HYPERLINK"), false);
});

test("stats code does not read message tables or store an address", async () => {
  const dir = new URL("./", import.meta.url);
  const names = (await readdir(dir)).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
  const migration = await readFile(
    new URL("../../migrations/0022_stats.sql", import.meta.url),
    "utf8",
  );
  const sources = [migration];
  for (const name of names) sources.push(await readFile(new URL(name, dir), "utf8"));
  const combined = sources.join("\n");
  assert.equal(/\bdm_[a-z_]+/.test(combined), false);
  assert.equal(combined.includes("room_chat_message"), false);
  assert.equal(combined.includes("ip_address"), false);
  assert.equal(combined.includes("ipAddress"), false);
});

test("migration 0022 creates the activity and daily tables", async () => {
  const { db, close } = await openTestDb();
  try {
    const tables = await db.query<{ table_name: string; columns: string }>(
      `select c.table_name,
              string_agg(c.column_name, ',' order by c.column_name) as columns
       from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name in ('member_active_days', 'stats_daily')
       group by c.table_name
       order by c.table_name`,
    );
    assert.deepEqual(
      tables.map((row) => row.table_name),
      ["member_active_days", "stats_daily"],
    );
    assert.equal(tables[0]?.columns, "date,member_id");
    assert.equal(tables[1]?.columns, "count,date,dimension,metric");
  } finally {
    await close();
  }
});

test("the nightly rollup writes counts and the read hides anything under 5", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada@example.com", "2026-09-01T15:00:00Z");
    const bob = await user(db, "Bob Stone", "bob@example.com", "2026-09-01T15:00:00Z");
    const attendees: { id: string; name: string }[] = [];
    for (let n = 0; n < 6; n += 1) {
      const name = `Wren ${n}`;
      attendees.push({
        id: await user(db, name, `wren${n}@example.com`, "2026-10-20T15:00:00Z"),
        name,
      });
    }
    const lateA = await user(db, "Join North", "join-north@example.com", "2026-10-21T15:00:00Z");
    const lateB = await user(db, "Join South", "join-south@example.com", "2026-10-21T15:00:00Z");
    for (const day of [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]) {
      await active(db, ada, day);
    }
    await active(db, bob, "2026-10-25");

    const host = attendees[0]?.id ?? ada;
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-09-28",
      came: [],
      at: "2026-09-28T18:00:00Z",
    });
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-10-06",
      came: [],
      at: "2026-10-06T18:00:00Z",
    });
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-10-13",
      came: [],
      at: "2026-10-13T18:00:00Z",
    });
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-10-20",
      came: attendees.map((person) => person.name),
      at: "2026-10-20T18:00:00Z",
    });
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-10-21",
      came: ["Guest North", "Guest South"],
      at: "2026-10-21T18:00:00Z",
    });
    await hosted(db, {
      roomId: "shop",
      authorId: host,
      authorName: "Wren 0",
      on: "2026-10-26",
      came: ["Wren 0", "Wren 1", "Wren 2", "Wren 3", "Wren 4", "Wren 5"],
      at: "2026-10-26T01:00:00Z",
    });
    for (let n = 0; n < 2; n += 1) {
      await post(db, ada, "Ada Lovelace", "shop", `2026-10-21T1${n}:00:00Z`);
      await post(db, ada, "Ada Lovelace", "county", `2026-10-21T1${n}:30:00Z`);
    }
    await db.query(
      `insert into public_gathering
       (id, title, gather_on, room_id, host_user_id)
       values ($1, 'County hearing', '2026-10-20', 'county', $2)`,
      [randomUUID(), host],
    );
    await db.query(
      `insert into access_log
       (id, user_id, name, role, room_id, action, vouched_by, approved_by, by_actor, note, at)
       values ($1, $2, 'Ada Lovelace', 'member', 'shop', 'grant', 'test', 'test', 'test', 'Vouched into the shop.', '2026-10-22T12:00:00Z')`,
      [randomUUID(), ada],
    );
    await db.query(
      `insert into stats_daily (date, metric, dimension, count) values
       ('2026-10-25'::date, 'feature', 'board', 8),
       ('2026-10-25'::date, 'feature', 'gatherings', 5),
       ('2026-10-25'::date, 'feature', 'calls', 1),
       ('2026-10-25'::date, 'feature', 'messages', 3)`,
    );

    const rolled = await rollStats(db, NOW, 90);
    assert.equal(rolled.pruned, 0);

    assert.equal(await countOf(db, "joins", "2026-09-01"), 2);
    assert.equal(await countOf(db, "joins", "2026-10-20"), 6);
    assert.equal(await countOf(db, "joins", "2026-10-21"), 2);
    assert.equal(await countOf(db, "joins", "2026-10-26"), null);
    assert.equal(await countOf(db, "dau", "2026-10-19"), 1);
    assert.equal(await countOf(db, "wau", "2026-10-19"), 1);
    assert.equal(await countOf(db, "dau", "2026-10-24"), 1);
    assert.equal(await countOf(db, "wau", "2026-10-24"), 1);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "wau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "mau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "roll", "2026-10-20"), 1);
    assert.equal(await countOf(db, "attendance", "2026-10-20"), 6);
    assert.equal(await countOf(db, "roll", "2026-10-21"), 1);
    assert.equal(await countOf(db, "attendance", "2026-10-21"), 2);
    assert.equal(await countOf(db, "roll", "2026-10-26"), null);
    assert.equal(await countOf(db, "room_posts", "2026-10-19", "shop"), 4);
    assert.equal(await countOf(db, "room_posts", "2026-10-19", "county"), 2);
    assert.equal(await countOf(db, "room_gatherings", "2026-10-19", "county"), 1);
    assert.equal(await countOf(db, "rooms_steady", "2026-10-25"), 1);
    assert.equal(await countOf(db, "in_person_attended", "2026-10-25"), 6);
    assert.equal(await countOf(db, "in_person_members", "2026-10-25"), 10);
    assert.equal(await countOf(db, "cross_room_members", "2026-10-25"), 1);
    assert.equal(await countOf(db, "cross_room_vouches", "2026-10-25"), 1);
    assert.equal(await countOf(db, "feature", "2026-10-25", "board"), 8);
    assert.equal(lateA === lateB, false);

    const stats = await readStats(db, NOW);
    const body = JSON.stringify(stats);
    assert.equal(body.includes("Lovelace"), false);
    assert.equal(body.includes(ada), false);
    assert.equal(body.includes(bob), false);
    assert.equal(stats.asOf, "2026-10-25");
    assert.equal(stats.days, 30);
    assert.equal(stats.category, "all");
    assert.equal(stats.tiles[0]?.id, "members");
    assert.equal(stats.tiles[0]?.value, 10);
    assert.equal(stats.tiles[0]?.change, null);
    assert.equal(stats.tiles[1]?.value, "<5");
    assert.equal(stats.tiles[2]?.value, "<5");
    assert.equal(stats.tiles[3]?.id, "gatherings");
    assert.equal(stats.tiles[3]?.value, 5);
    assert.equal(stats.joins.length, 30);
    assert.equal(stats.joins.find((row) => row.date === "2026-10-20")?.count, 6);
    assert.equal(stats.joins.find((row) => row.date === "2026-10-21")?.count, "<5");
    assert.equal(stats.funnel.find((step) => step.id === "opened")?.count, null);
    assert.equal(stats.alerts.health, "ok");
    assert.equal(stats.alerts.reports, 0);
    assert.equal(stats.roll.find((row) => row.date === "2026-10-20")?.attendance, 6);
    assert.equal(stats.roll.find((row) => row.date === "2026-10-21")?.attendance, "<5");
    const week = stats.rooms.weeks.find((row) => row.week === "2026-10-19");
    assert.equal(week?.posts, 5);
    assert.equal(week?.gatherings, "<5");
    const shop = stats.rooms.rows.find(
      (row) => row.week === "2026-10-19" && row.room === "The Shop",
    );
    const county = stats.rooms.rows.find(
      (row) => row.week === "2026-10-19" && row.room === "The County",
    );
    assert.equal(shop?.posts, "<5");
    assert.equal(county?.posts, "<5");
    assert.equal(stats.rooms.steady, "<5");
    assert.deepEqual(
      stats.features.map((row) => row.label),
      ["Board", "Gatherings", "Calls", "Messages"],
    );
    assert.equal(stats.features[2]?.count, "<5");
    assert.equal(stats.features[3]?.count, "<5");
    assert.equal(stats.mostUsed, "Board");
    assert.equal(stats.leastUsed, "Gatherings");
    assert.equal(stats.intent.inPersonCount, 6);
    assert.equal(stats.intent.inPersonPercent, 60);
    assert.equal(stats.intent.crossRoomMembers, "<5");
    assert.equal(stats.intent.crossRoomVouches, "<5");
    assert.match(stats.intent.rsvpNote, /no RSVP count/);

    const csv = await readStatsCsv(db, NOW);
    assert.match(csv, /<5/);
    assert.match(csv, /,6/);
    assert.match(csv, /rooms,2026-10-19,posts,,5/);
    assert.equal(csv.includes("rooms,2026-10-19,posts,,6"), false);
    assert.equal(csv.includes("Members,,8"), false);
    assert.equal(csv.includes("Lovelace"), false);
    assert.equal(csv.includes(ada), false);
  } finally {
    await close();
  }
});

test("a second roll keeps yesterday when the window is still inside retention", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-refresh@example.com", "2026-09-01T15:00:00Z");
    const bob = await user(db, "Bob Stone", "bob-refresh@example.com", "2026-09-01T15:00:00Z");
    await active(db, ada, "2026-10-19");
    await active(db, bob, "2026-10-25");
    await rollStats(db, NOW, 90);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 1);
    assert.equal(await countOf(db, "dau", "2026-10-19"), 1);
    const cara = await user(db, "Cara Stone", "cara-refresh@example.com", "2026-09-01T15:00:00Z");
    await active(db, cara, "2026-10-25");
    await rollStats(db, NOW, 90);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "dau", "2026-10-19"), 1);
  } finally {
    await close();
  }
});

test("pruning drops activity older than the retention window and keeps the earlier rollup", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-prune@example.com", "2026-09-01T15:00:00Z");
    const bob = await user(db, "Bob Stone", "bob-prune@example.com", "2026-09-01T15:00:00Z");
    await active(db, ada, "2026-10-19");
    await active(db, ada, "2026-10-20");
    await active(db, bob, "2026-10-21");
    await active(db, bob, "2026-10-25");
    await rollStats(db, NOW, 5);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 1);
    assert.equal(await countOf(db, "wau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "dau", "2026-10-19"), 1);
    const left = await db.query<{ date: string }>(
      `select date::text as date from member_active_days order by date`,
    );
    assert.deepEqual(
      left.map((row) => isoDate(row.date)),
      ["2026-10-21", "2026-10-25"],
    );
    const again = await rollStats(db, NOW, 5);
    assert.equal(again.pruned, 0);
    assert.notEqual(again.skipped, true);
    assert.equal(await countOf(db, "wau", "2026-10-25"), 2);
    assert.equal(await countOf(db, "dau", "2026-10-19"), 1);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 1);
    const aggregates = JSON.stringify(await db.query(`select * from stats_daily`));
    assert.equal(aggregates.includes(ada), false);
    assert.equal(aggregates.includes(bob), false);
  } finally {
    await close();
  }
});

test("ninety days of per-member rows are kept, and the aggregate stays after they go", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-ninety@example.com", "2026-01-01T00:00:00Z");
    await active(db, ada, "2026-07-27");
    await active(db, ada, "2026-07-28");
    const rolled = await rollStats(db, NOW, 90);
    assert.equal(rolled.pruned, 1);
    assert.equal(await countOf(db, "dau", "2026-07-27"), 1);
    assert.equal(await countOf(db, "dau", "2026-07-28"), 1);
    const left = await db.query<{ date: string }>(
      `select date::text as date from member_active_days order by date`,
    );
    assert.deepEqual(
      left.map((row) => isoDate(row.date)),
      ["2026-07-28"],
    );
    const again = await rollStats(db, NOW, 90);
    assert.equal(again.pruned, 0);
    assert.equal(await countOf(db, "dau", "2026-07-27"), 1);
    const aggregates = JSON.stringify(await db.query(`select * from stats_daily`));
    assert.equal(aggregates.includes(ada), false);
  } finally {
    await close();
  }
});

test("the nightly job rolls on a schedule and does not roll twice the same day", async () => {
  const { db, close } = await openTestDb();
  let stop = () => {};
  try {
    const ada = await user(db, "Ada Lovelace", "ada-nightly@example.com", "2026-01-01T00:00:00Z");
    const bob = await user(db, "Bob Stone", "bob-nightly@example.com", "2026-01-01T00:00:00Z");
    await active(db, ada, "2026-10-25");
    let clock = new Date("2026-10-26T12:00:00Z");
    stop = startNightlyStats(db, 90, () => clock, 30);
    await until(async () => (await countOf(db, "dau", "2026-10-25")) === 1);
    await active(db, bob, "2026-10-25");
    await delay(80);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 1);
    await active(db, ada, "2026-10-26");
    clock = new Date("2026-10-27T12:00:00Z");
    await until(async () => (await countOf(db, "dau", "2026-10-26")) === 1);
    assert.equal(await countOf(db, "dau", "2026-10-25"), 1);
  } finally {
    stop();
    await close();
  }
});

test("a room in two categories counts in each filter and once overall", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-cats@example.com", "2026-09-01T15:00:00Z");
    await db.query(
      `create table room_categories (
         room_id text not null references room (id) on delete cascade,
         category_id text not null,
         primary key (room_id, category_id)
       )`,
    );
    for (const [id, name] of [
      ["hall-a", "Hall A"],
      ["hall-b", "Hall B"],
      ["hall-c", "Hall C"],
      ["hall-d", "Hall D"],
      ["hall-e", "Hall E"],
      ["hall-f", "Hall F"],
    ] as const) {
      await db.query(`insert into room (id, name) values ($1, $2)`, [id, name]);
      await db.query(`insert into room_categories (room_id, category_id) values ($1, 'churches')`, [
        id,
      ]);
      await post(db, ada, "Ada Lovelace", id, "2026-10-20T15:00:00Z");
    }
    await db.query(
      `insert into room_categories (room_id, category_id) values
       ('shop', 'business-trades'),
       ('shop', 'civic'),
       ('county', 'county')`,
    );
    await post(db, ada, "Ada Lovelace", "shop", "2026-10-20T16:00:00Z");
    await post(db, ada, "Ada Lovelace", "county", "2026-10-20T16:30:00Z");
    for (let day = 20; day < 26; day += 1) {
      await hosted(db, {
        roomId: "shop",
        authorId: ada,
        authorName: "Ada Lovelace",
        on: `2026-10-${day}`,
        came: [],
        at: `2026-10-${day}T18:00:00Z`,
      });
    }
    await db.query(
      `insert into stats_daily (date, metric, dimension, count) values
       ('2026-10-25'::date, 'dau', '', 6),
       ('2026-10-19'::date, 'room_posts', 'shop', 10),
       ('2026-10-19'::date, 'room_posts', 'county', 8)`,
    );
    const all = await readStats(db, NOW, { days: 30, category: "all" });
    const churches = await readStats(db, NOW, { days: 30, category: "churches" });
    const civic = await readStats(db, NOW, { days: 30, category: "civic" });
    const trades = await readStats(db, NOW, { days: 30, category: "business-trades" });
    assert.equal(all.tiles.find((tile) => tile.id === "rooms")?.value, 10);
    assert.equal(all.roomsByCategory.find((row) => row.id === "churches")?.count, 6);
    assert.equal(all.roomsByCategory.find((row) => row.id === "civic")?.count, "<5");
    assert.equal(churches.tiles.find((tile) => tile.id === "rooms")?.value, 6);
    assert.equal(civic.tiles.find((tile) => tile.id === "rooms")?.value, "<5");
    assert.equal(trades.tiles.find((tile) => tile.id === "rooms")?.value, "<5");
    assert.equal(churches.roomsByCategory.length, 1);
    assert.equal(
      civic.rooms.rows.some((row) => row.room === "The Shop"),
      true,
    );
    assert.equal(
      trades.rooms.rows.some((row) => row.room === "The Shop"),
      true,
    );
    assert.equal(
      churches.rooms.rows.some((row) => row.room === "The Shop"),
      false,
    );
    assert.equal(
      civic.rooms.rows.some((row) => row.room === "The County"),
      false,
    );
    assert.equal(all.rooms.weeks.find((row) => row.week === "2026-10-19")?.posts, 18);
    assert.equal(civic.rooms.weeks.find((row) => row.week === "2026-10-19")?.posts, 10);
    assert.equal(churches.tiles.find((tile) => tile.id === "gatherings")?.value, "<5");
    assert.equal(civic.tiles.find((tile) => tile.id === "gatherings")?.value, 6);
    assert.equal(all.tiles.find((tile) => tile.id === "gatherings")?.value, 5);
    assert.equal(all.tiles.find((tile) => tile.id === "members")?.value, churches.tiles[0]?.value);
  } finally {
    await close();
  }
});

test("gathering filters cannot be subtracted back to a hidden category", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-gap@example.com", "2026-01-01T00:00:00Z");
    await db.query(
      `create table room_categories (
         room_id text not null references room (id) on delete cascade,
         category_id text not null,
         primary key (room_id, category_id)
       )`,
    );
    for (const [id, name] of [
      ["qa-big", "Big Hall"],
      ["qa-small", "Small Hall"],
      ["qa-both", "Shared Hall"],
    ] as const) {
      await db.query(`insert into room (id, name) values ($1, $2)`, [id, name]);
    }
    await db.query(
      `insert into room_categories (room_id, category_id) values
       ('qa-big', 'churches'),
       ('qa-small', 'civic'),
       ('qa-both', 'churches'),
       ('qa-both', 'discussion')`,
    );
    await db.query(
      `insert into board_post
       (id, room_id, author_user_id, author_name, type, claim, on_date, came, created_at)
       select 'qa-' || to_char(day, 'YYYYMMDD') || '-' || n::text,
              'qa-big', $1, 'Ada Lovelace', 'hosted',
              'The host filed the roll after the gathering.',
              to_char(day, 'YYYY-MM-DD'), '{}', day
       from generate_series('2026-07-28'::timestamptz, '2026-10-25'::timestamptz, interval '1 day') as day,
            generate_series(1, 5) as n`,
      [ada],
    );
    for (const roomId of ["qa-small", "qa-small", "qa-both"]) {
      await hosted(db, {
        roomId,
        authorId: ada,
        authorName: "Ada Lovelace",
        on: "2026-10-25",
        came: [],
        at: "2026-10-25T18:00:00Z",
      });
    }
    await db.query(
      `insert into stats_daily (date, metric, dimension, count) values ('2026-10-25'::date, 'dau', '', 6)`,
    );
    const hidden = 2;
    for (const days of [7, 30, 90] as const) {
      const all = await readStats(db, NOW, { days, category: "all" });
      const churches = await readStats(db, NOW, { days, category: "churches" });
      const civic = await readStats(db, NOW, { days, category: "civic" });
      const discussion = await readStats(db, NOW, { days, category: "discussion" });
      const whole = gatheringsOf(all);
      const churchesCount = gatheringsOf(churches);
      assert.equal(typeof whole, "number");
      assert.equal(typeof churchesCount, "number");
      assert.notEqual((whole as number) - (churchesCount as number), hidden);
      assert.notEqual((whole as number) - (churchesCount as number), 1);
      assert.equal(gatheringsOf(civic), "<5");
      assert.equal(gatheringsOf(discussion), "<5");
      const csv = await readStatsCsv(db, NOW, { days, category: "all" });
      const churchesCsv = await readStatsCsv(db, NOW, { days, category: "churches" });
      assert.equal(csv.includes(`Gatherings held (${days} days),,${hidden}`), false);
      assert.equal(churchesCsv.includes(`Gatherings held (${days} days),,${hidden}`), false);
      assert.match(csv, new RegExp(`Gatherings held \\(${days} days\\),,${whole}`));
      assert.match(churchesCsv, new RegExp(`Gatherings held \\(${days} days\\),,${churchesCount}`));
    }
  } finally {
    await close();
  }
});

test("an admin-added category is shown by its name", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-name@example.com", "2026-09-01T15:00:00Z");
    await db.query(
      `create table categories (
         slug text primary key,
         name text not null,
         sort_order integer not null default 0
       )`,
    );
    await db.query(
      `insert into categories (slug, name, sort_order) values ('choir', 'Parish choir', 20)`,
    );
    await db.query(
      `create table room_categories (
         room_id text not null references room (id) on delete cascade,
         category_id text not null,
         primary key (room_id, category_id)
       )`,
    );
    await db.query(`insert into room (id, name) values ('choir-hall', 'Choir hall')`);
    await db.query(
      `insert into room_categories (room_id, category_id) values ('choir-hall', 'choir')`,
    );
    await post(db, ada, "Ada Lovelace", "choir-hall", "2026-10-20T15:00:00Z");
    await db.query(
      `insert into stats_daily (date, metric, dimension, count) values ('2026-10-25'::date, 'dau', '', 6)`,
    );
    const all = await readStats(db, NOW, { days: 30, category: "all" });
    assert.equal(all.roomsByCategory.find((row) => row.id === "choir")?.label, "Parish choir");
    assert.equal(all.categories?.find((row) => row.id === "choir")?.label, "Parish choir");
    assert.equal(
      all.roomsByCategory.some((row) => row.id === "other" || row.label === "other"),
      false,
    );
    const filtered = await readStats(db, NOW, { days: 30, category: "all", requested: "choir" });
    assert.equal(filtered.category, "choir");
    assert.equal(filtered.roomsByCategory[0]?.label, "Parish choir");
    const unknown = await readStats(db, NOW, { days: 30, category: "all", requested: "nope" });
    assert.equal(unknown.category, "all");
  } finally {
    await close();
  }
});

test("an authenticated request records one day and increments the endpoint group", async () => {
  const { db, close } = await openTestDb();
  try {
    const ada = await user(db, "Ada Lovelace", "ada-activity@example.com", "2026-09-01T15:00:00Z");
    await noteAuthenticatedRequest(db, ada, NOW, "/api/board");
    await noteAuthenticatedRequest(db, ada, NOW, "/api/board");
    await noteAuthenticatedRequest(db, ada, NOW, "/api/auth/get-session");
    await noteAuthenticatedRequest(db, randomUUID(), NOW, "/api/board");
    const days = await db.query<{ date: string }>(
      `select date::text as date from member_active_days where member_id = $1`,
      [ada],
    );
    assert.equal(days.length, 1);
    assert.equal(isoDate(days[0]?.date), "2026-10-26");
    assert.equal(await countOf(db, "feature", "2026-10-26", "board"), 1);
    assert.equal(await countOf(db, "feature", "2026-10-26", "admin"), null);
    await noteAuthenticatedRequest(db, ada, new Date("2026-10-27T01:00:00Z"), "/api/gatherings");
    const later = await db.query(
      `select date::text as date from member_active_days where member_id = $1`,
      [ada],
    );
    assert.equal(later.length, 2);
    assert.equal(await countOf(db, "feature", "2026-10-27", "gatherings"), 1);
  } finally {
    await close();
  }
});

test("published totals do not let a hidden count be subtracted back", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(
      `insert into room (id, name) values ('big-room', 'Big Room'), ('small-room', 'Small Room')`,
    );
    await db.query(
      `insert into stats_daily (date, metric, dimension, count) values
       ('2026-10-25'::date, 'dau', '', 2),
       ('2026-10-24'::date, 'dau', '', 10),
       ('2026-10-23'::date, 'dau', '', 4),
       ('2026-10-24'::date, 'wau', '', 10),
       ('2026-10-25'::date, 'wau', '', 12),
       ('2026-10-23'::date, 'wau', '', 4),
       ('2026-10-10'::date, 'joins', '', 6),
       ('2026-10-20'::date, 'joins', '', 1),
       ('2026-10-12'::date, 'room_posts', 'big-room', 10),
       ('2026-10-12'::date, 'room_posts', 'small-room', 2)`,
    );
    const stats = await readStats(db, NOW);
    assert.equal(stats.tiles.find((tile) => tile.id === "members")?.value, 5);
    assert.equal(stats.joins.find((row) => row.date === "2026-10-10")?.count, 6);
    assert.equal(stats.joins.find((row) => row.date === "2026-10-20")?.count, "<5");
    const week = stats.rooms.weeks.find((row) => row.week === "2026-10-12");
    assert.equal(week?.posts, 10);
    assert.notEqual(week?.posts, 12);
    assert.equal(stats.rooms.rows.find((row) => row.room === "Big Room")?.posts, 10);
    assert.equal(stats.rooms.rows.find((row) => row.room === "Small Room")?.posts, "<5");
    const oct24 = stats.active.find((row) => row.date === "2026-10-24");
    const oct25 = stats.active.find((row) => row.date === "2026-10-25");
    const oct23 = stats.active.find((row) => row.date === "2026-10-23");
    assert.equal(oct24?.wau, 10);
    assert.equal(oct25?.wau, 10);
    assert.equal(oct25?.dau, "<5");
    assert.equal(oct23?.wau, "<5");
    assert.notEqual(oct23?.wau, 5);
    const csv = await readStatsCsv(db, NOW);
    assert.equal(csv.includes("rooms,2026-10-12,posts,,12"), false);
    assert.match(csv, /rooms,2026-10-12,posts,,10/);
    assert.match(csv, /rooms,2026-10-12,posts,Big Room,10/);
    assert.match(csv, /rooms,2026-10-12,posts,Small Room,<5/);
    assert.equal(csv.includes("Members,,7"), false);

    assert.equal(
      stats.tiles.find((tile) => tile.id === "invites")?.label,
      "Invites accepted (30 days)",
    );
    const weekWindow = await readStats(db, NOW, { days: 7, category: "churches" });
    assert.equal(weekWindow.days, 7);
    assert.equal(weekWindow.category, "churches");
    assert.equal(weekWindow.joins.length, 7);
    assert.equal(weekWindow.tiles.find((tile) => tile.id === "members")?.value, "<5");
    assert.equal(
      weekWindow.tiles.find((tile) => tile.id === "invites")?.label,
      "Invites accepted (7 days)",
    );
    assert.equal(
      weekWindow.tiles.find((tile) => tile.id === "rooms")?.label,
      "Active rooms (7 days)",
    );
    assert.equal(
      weekWindow.tiles.find((tile) => tile.id === "gatherings")?.label,
      "Gatherings held (7 days)",
    );
    const weekAll = await readStats(db, NOW, { days: 7, category: "all" });
    assert.equal(weekWindow.tiles[0]?.value, weekAll.tiles[0]?.value);
    assert.equal(weekWindow.tiles[1]?.value, weekAll.tiles[1]?.value);
    assert.equal(stats.roomsByCategory.length, 7);
    assert.equal(weekWindow.roomsByCategory.length, 1);
    assert.equal(weekWindow.roomsByCategory[0]?.id, "churches");
    assert.deepEqual(parseStatsQuery(new URLSearchParams("days=3&category=nope")), {
      days: 30,
      category: "all",
    });
  } finally {
    await close();
  }
});

test("feature groups under 5 are not named as most or least used", async () => {
  const { db, close } = await openTestDb();
  try {
    await db.query(
      `insert into stats_daily (date, metric, dimension, count)
       values ('2026-10-26'::date, 'feature', 'media', 2)`,
    );
    const stats = await readStats(db, NOW);
    assert.equal(stats.mostUsed, null);
    assert.equal(stats.leastUsed, null);
    assert.equal(stats.features[0]?.count, "<5");
    assert.equal(
      stats.tiles.every((tile) => tile.value === null),
      true,
    );
  } finally {
    await close();
  }
});

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await delay(40);
  }
  throw new Error("The nightly stats job did not finish.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gatheringsOf(stats: StatsPayload): ShownCount | null {
  return stats.tiles.find((tile) => tile.id === "gatherings")?.value ?? null;
}

async function user(db: Db, name: string, email: string, createdAt: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, true, $4::timestamptz, $4::timestamptz)`,
    [id, name, email, createdAt],
  );
  return id;
}

async function active(db: Db, memberId: string, date: string): Promise<void> {
  await db.query(`insert into member_active_days (member_id, date) values ($1, $2::date)`, [
    memberId,
    date,
  ]);
}

async function hosted(
  db: Db,
  input: {
    roomId: string;
    authorId: string;
    authorName: string;
    on: string;
    came: string[];
    at: string;
  },
): Promise<void> {
  await db.query(
    `insert into board_post
     (id, room_id, author_user_id, author_name, type, claim, on_date, came, created_at)
     values ($1, $2, $3, $4, 'hosted', 'The host filed the roll after the gathering.', $5, $6, $7::timestamptz)`,
    [randomUUID(), input.roomId, input.authorId, input.authorName, input.on, input.came, input.at],
  );
}

async function post(
  db: Db,
  authorId: string,
  authorName: string,
  roomId: string,
  at: string,
): Promise<void> {
  await db.query(
    `insert into board_post
     (id, room_id, author_user_id, author_name, type, claim, created_at)
     values ($1, $2, $3, $4, 'did', 'Posted a note in the room after the work night.', $5::timestamptz)`,
    [randomUUID(), roomId, authorId, authorName, at],
  );
}

async function countOf(
  db: Db,
  metric: string,
  date: string,
  dimension = "",
): Promise<number | null> {
  const rows = await db.query<{ count: unknown }>(
    `select count from stats_daily
     where metric = $1 and date = $2::date and dimension = $3`,
    [metric, date, dimension],
  );
  const row = rows[0];
  if (!row) return null;
  return asCount(row.count);
}

function emptyStats(): StatsPayload {
  return {
    asOf: "2026-10-25",
    days: 30,
    category: "all",
    tiles: [
      { id: "members", label: "Members", value: "<5", change: null },
      { id: "invites", label: "Invites accepted (30 days)", value: "<5", change: null },
      { id: "rooms", label: "Active rooms (30 days)", value: "<5", change: null },
      { id: "gatherings", label: "Gatherings held (30 days)", value: "<5", change: null },
    ],
    joins: [],
    active: [],
    roll: [],
    rooms: { weeks: [], rows: [], steady: null },
    roomsByCategory: [],
    funnel: [],
    alerts: { reports: 0, health: "ok" },
    features: [],
    mostUsed: null,
    leastUsed: null,
    intent: {
      attendance: [],
      rsvpNote: "",
      inPersonCount: null,
      inPersonPercent: null,
      crossRoomMembers: null,
      crossRoomVouches: null,
    },
  };
}
