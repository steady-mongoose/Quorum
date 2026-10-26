import type { Db } from "../db.ts";
import { addUtcDays, asCount, isoDate, utcDate, weekStart } from "./dates.ts";

/**
 * Rolls first-party counts into stats_daily, then drops activity days older
 * than the retention window. Completed days already rolled are left as they
 * were, except yesterday, which is written again. Message tables are not read.
 */

const REPLACE_METRICS = [
  "joins",
  "roll",
  "attendance",
  "room_posts",
  "room_gatherings",
  "rooms_steady",
  "in_person_attended",
  "in_person_members",
  "cross_room_members",
  "cross_room_vouches",
];

type StatRow = { date: string; metric: string; dimension: string; count: number };

type CountRow = { date: string; count: unknown };

export async function rollStats(
  db: Db,
  now: Date,
  retentionDays: number,
): Promise<{ pruned: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("ACTIVITY_RETENTION_DAYS must be a whole number of days.");
  }
  const today = utcDate(now);
  const yesterday = addUtcDays(today, -1);
  const cutoff = addUtcDays(today, -retentionDays);
  return db.transaction(async (tx) => {
    const rows = [
      ...(await joinRows(tx, today)),
      ...(await rollRows(tx, today)),
      ...(await roomRows(tx, today)),
      ...(await steadyRows(tx, yesterday)),
      ...(await intentRows(tx, yesterday)),
    ];
    await tx.query(`delete from stats_daily where metric = any($1::text[])`, [REPLACE_METRICS]);
    await insertRows(tx, rows);
    await writeActivity(tx, today, yesterday, cutoff);
    const pruned = await tx.query<{ count: unknown }>(
      `with gone as (
         delete from member_active_days where date < $1::date returning 1
       )
       select count(*)::int as count from gone`,
      [cutoff],
    );
    return { pruned: asCount(pruned[0]?.count) };
  });
}

async function joinRows(db: Db, today: string): Promise<StatRow[]> {
  const rows = await db.query<CountRow>(
    `select ("createdAt" at time zone 'utc')::date::text as date, count(*)::int as count
     from "user"
     where ("createdAt" at time zone 'utc')::date < $1::date
     group by 1`,
    [today],
  );
  return rows
    .map((row) => ({ date: isoDate(row.date), count: asCount(row.count) }))
    .filter((row) => row.date < today)
    .map((row) => ({ date: row.date, metric: "joins", dimension: "", count: row.count }));
}

async function rollRows(db: Db, today: string): Promise<StatRow[]> {
  const rows = await db.query<{ date: string; rolls: unknown; attendance: unknown }>(
    `select
       case
         when on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then on_date
         else (created_at at time zone 'utc')::date::text
       end as date,
       count(*)::int as rolls,
       coalesce(sum(cardinality(came)), 0)::int as attendance
     from board_post
     where type = 'hosted' and removed = false
     group by 1`,
  );
  const out: StatRow[] = [];
  for (const row of rows) {
    const date = isoDate(row.date);
    if (date >= today) continue;
    out.push({ date, metric: "roll", dimension: "", count: asCount(row.rolls) });
    out.push({ date, metric: "attendance", dimension: "", count: asCount(row.attendance) });
  }
  return out;
}

async function roomRows(db: Db, today: string): Promise<StatRow[]> {
  const posts = await db.query<{ week: string; room_id: string; count: unknown }>(
    `select (date_trunc('week', created_at at time zone 'utc'))::date::text as week,
            room_id,
            count(*)::int as count
     from board_post
     where removed = false
       and (created_at at time zone 'utc')::date < $1::date
     group by 1, 2`,
    [today],
  );
  const gatherings = await db.query<{ week: string; room_id: string; count: unknown }>(
    `select (date_trunc('week', gather_on::timestamp))::date::text as week,
            room_id,
            count(*)::int as count
     from public_gathering
     where removed = false
       and room_id <> ''
       and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and gather_on::date < $1::date
     group by 1, 2`,
    [today],
  );
  return [
    ...posts.map((row) => ({
      date: isoDate(row.week),
      metric: "room_posts",
      dimension: row.room_id,
      count: asCount(row.count),
    })),
    ...gatherings.map((row) => ({
      date: isoDate(row.week),
      metric: "room_gatherings",
      dimension: row.room_id,
      count: asCount(row.count),
    })),
  ];
}

async function steadyRows(db: Db, yesterday: string): Promise<StatRow[]> {
  const thisWeek = weekStart(yesterday);
  const oldest = addUtcDays(thisWeek, -21);
  const weeks = [0, 1, 2, 3].map((step) => addUtcDays(thisWeek, -7 * step));
  const meetings = await db.query<{ room_id: string; week: string }>(
    `select room_id, (date_trunc('week', on_date::timestamp))::date::text as week
     from board_post
     where type = 'hosted'
       and removed = false
       and on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and on_date::date between $1::date and $2::date
     union
     select room_id, (date_trunc('week', gather_on::timestamp))::date::text as week
     from public_gathering
     where removed = false
       and room_id <> ''
       and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and gather_on::date between $1::date and $2::date`,
    [oldest, yesterday],
  );
  const byRoom = new Map<string, Set<string>>();
  for (const row of meetings) {
    const week = isoDate(row.week);
    if (!weeks.includes(week)) continue;
    const seen = byRoom.get(row.room_id) ?? new Set<string>();
    seen.add(week);
    byRoom.set(row.room_id, seen);
  }
  let steady = 0;
  for (const seen of byRoom.values()) {
    if (seen.size >= 3) steady += 1;
  }
  return [{ date: yesterday, metric: "rooms_steady", dimension: "", count: steady }];
}

async function intentRows(db: Db, yesterday: string): Promise<StatRow[]> {
  const monthStart = `${yesterday.slice(0, 8)}01`;
  const spanStart = addUtcDays(yesterday, -27);
  const attended = await db.query<{ count: unknown }>(
    `with hosted as (
       select author_user_id, came
       from board_post
       where type = 'hosted'
         and removed = false
         and on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and on_date::date between $1::date and $2::date
     ),
     people as (
       select u.id
       from hosted h
       join lateral unnest(h.came) as attendee(attended_name) on true
       join "user" u on u.name = attendee.attended_name
       where attendee.attended_name <> ''
       union
       select author_user_id from hosted where author_user_id is not null
       union
       select host_user_id
       from public_gathering
       where removed = false
         and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and gather_on::date between $1::date and $2::date
     )
     select count(distinct id)::int as count from people`,
    [monthStart, yesterday],
  );
  const members = await db.query<{ count: unknown }>(
    `select count(*)::int as count
     from "user"
     where ("createdAt" at time zone 'utc')::date <= $1::date`,
    [yesterday],
  );
  const crossMembers = await db.query<{ count: unknown }>(
    `select count(*)::int as count from (
       select author_user_id
       from board_post
       where removed = false
         and author_user_id is not null
         and (created_at at time zone 'utc')::date between $1::date and $2::date
       group by author_user_id
       having count(distinct room_id) >= 2
     ) active_rooms`,
    [spanStart, yesterday],
  );
  const vouches = await db.query<{ count: unknown }>(
    `select count(*)::int as count
     from access_log grant_row
     where grant_row.action = 'grant'
       and grant_row.room_id <> ''
       and (grant_row.at at time zone 'utc')::date between $1::date and $2::date
       and (
         exists (
           select 1 from board_post post
           where post.author_user_id = grant_row.user_id
             and post.removed = false
             and post.room_id <> grant_row.room_id
             and (post.created_at at time zone 'utc')::date between $1::date and $2::date
         )
         or exists (
           select 1 from room_join joined
           where joined.user_id = grant_row.user_id
             and joined.room_id <> grant_row.room_id
         )
       )`,
    [spanStart, yesterday],
  );
  return [
    {
      date: yesterday,
      metric: "in_person_attended",
      dimension: "",
      count: asCount(attended[0]?.count),
    },
    {
      date: yesterday,
      metric: "in_person_members",
      dimension: "",
      count: asCount(members[0]?.count),
    },
    {
      date: yesterday,
      metric: "cross_room_members",
      dimension: "",
      count: asCount(crossMembers[0]?.count),
    },
    {
      date: yesterday,
      metric: "cross_room_vouches",
      dimension: "",
      count: asCount(vouches[0]?.count),
    },
  ];
}

async function writeActivity(
  db: Db,
  today: string,
  yesterday: string,
  cutoff: string,
): Promise<void> {
  const oldestRow = await db.query<{ date: string | null }>(
    `select min(date)::text as date from member_active_days where date < $1::date`,
    [today],
  );
  const oldest = oldestRow[0]?.date ? isoDate(oldestRow[0].date) : yesterday;
  const start = oldest < yesterday ? oldest : yesterday;
  const rows = await db.query<{ day: string; dau: unknown; wau: unknown; mau: unknown }>(
    `select day::date::text as day,
            (select count(*)::int from member_active_days m where m.date = day::date) as dau,
            (
              select count(distinct m.member_id)::int
              from member_active_days m
              where m.date between day::date - 6 and day::date
            ) as wau,
            (
              select count(distinct m.member_id)::int
              from member_active_days m
              where m.date between day::date - 29 and day::date
            ) as mau
     from generate_series($1::timestamp, $2::timestamp, interval '1 day') as day`,
    [start, yesterday],
  );
  const flat: StatRow[] = [];
  const refresh: StatRow[] = [];
  const wauSafe = addUtcDays(yesterday, -6) >= cutoff;
  const mauSafe = addUtcDays(yesterday, -29) >= cutoff;
  for (const row of rows) {
    const date = isoDate(row.day);
    const dau = { date, metric: "dau", dimension: "", count: asCount(row.dau) };
    const wau = { date, metric: "wau", dimension: "", count: asCount(row.wau) };
    const mau = { date, metric: "mau", dimension: "", count: asCount(row.mau) };
    flat.push(dau, wau, mau);
    if (date === yesterday) {
      refresh.push(dau);
      if (wauSafe) refresh.push(wau);
      if (mauSafe) refresh.push(mau);
    }
  }
  await insertIgnore(db, flat);
  if (refresh.length === 0) return;
  await db.query(
    `delete from stats_daily
     where date = $1::date and metric = any($2::text[]) and dimension = ''`,
    [yesterday, refresh.map((row) => row.metric)],
  );
  await insertRows(db, refresh);
}

function rowArrays(rows: StatRow[]): [string[], string[], string[], string[]] {
  return [
    rows.map((row) => row.date),
    rows.map((row) => row.metric),
    rows.map((row) => row.dimension),
    rows.map((row) => String(row.count)),
  ];
}

async function insertIgnore(db: Db, rows: StatRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `insert into stats_daily (date, metric, dimension, count)
     select incoming.day::date, incoming.metric, incoming.dimension, incoming.count::int
     from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       as incoming(day, metric, dimension, count)
     on conflict (date, metric, dimension) do nothing`,
    rowArrays(rows),
  );
}

async function insertRows(db: Db, rows: StatRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `insert into stats_daily (date, metric, dimension, count)
     select incoming.day::date, incoming.metric, incoming.dimension, incoming.count::int
     from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       as incoming(day, metric, dimension, count)`,
    rowArrays(rows),
  );
}
