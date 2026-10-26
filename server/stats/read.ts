import type { Db } from "../db.ts";
import {
  RSVP_NOTE,
  SMALL_COUNT,
  STATS_CATEGORIES,
  endpointLabel,
  hiddenCellLeaks,
  protectBreakdown,
  roundToFive,
  showCount,
  showPercent,
  shownChange,
  toStatsCsv,
  type ActiveDay,
  type CategoryCount,
  type DayCount,
  type FeatureUse,
  type FunnelStep,
  type RollDay,
  type RoomWeek,
  type ShownCount,
  type StatsAlerts,
  type StatsDays,
  type StatsPayload,
  type StatsTile,
  type TotalWeek,
} from "../../src/lib/board/stats.ts";
import { addUtcDays, asCount, isoDate, utcDate } from "./dates.ts";

type Stored = { date: string; metric: string; dimension: string; count: number };

const FEATURE_DAYS = 27;
const TILE_DAYS = 30;

export async function readStats(
  db: Db,
  now: Date,
  filter: { days: StatsDays; category: string } = { days: 30, category: "all" },
): Promise<StatsPayload> {
  const today = utcDate(now);
  const stored = await load(db, addUtcDays(today, -400));
  const names = await roomNames(db);
  const membership = await loadMembership(db);
  const inCategory = roomIdsFor(membership, filter.category);
  const dauDays = stored.filter((row) => row.metric === "dau").map((row) => row.date);
  const asOf = dauDays.length > 0 ? dauDays[dauDays.length - 1] : null;
  const chartStart = asOf ? addUtcDays(asOf, -(filter.days - 1)) : null;
  const inChart = (date: string) =>
    chartStart ? date >= chartStart && date <= (asOf ?? date) : false;

  const joins = asOf
    ? protectedDaily(stored, "joins", addUtcDays(asOf, -(filter.days - 1)), asOf)
    : [];
  const active = asOf ? activeSeries(stored, addUtcDays(asOf, -(filter.days - 1)), asOf) : [];
  const roll = rollSeries(stored, inChart);
  const rooms = roomSeries(stored, names, inChart, inCategory);
  const features = featureSeries(stored, today);
  const intent = intentOf(stored, asOf, roll);
  const tiles = asOf ? await tilesOf(db, stored, asOf, filter.category, membership) : blankTiles();
  const roomsByCategory = asOf
    ? await categoriesOf(
        db,
        addUtcDays(asOf, -(filter.days - 1)),
        asOf,
        filter.category,
        membership,
      )
    : STATS_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        count: "<5" as const,
      }));
  const funnel = asOf
    ? await funnelOf(db, addUtcDays(asOf, -(filter.days - 1)), asOf)
    : emptyFunnel();

  return {
    asOf,
    days: filter.days,
    category: filter.category,
    tiles,
    joins,
    active,
    roll,
    rooms,
    roomsByCategory,
    funnel,
    alerts: await alertsOf(db),
    features: features.rows,
    mostUsed: features.most,
    leastUsed: features.least,
    intent,
  };
}

export async function readStatsCsv(
  db: Db,
  now: Date,
  filter: { days: StatsDays; category: string } = { days: 30, category: "all" },
): Promise<string> {
  return toStatsCsv(await readStats(db, now, filter));
}

async function load(db: Db, since: string): Promise<Stored[]> {
  const rows = await db.query<{
    date: string;
    metric: string;
    dimension: string;
    count: unknown;
  }>(
    `select date::text as date, metric, dimension, count
     from stats_daily
     where date >= $1::date
     order by date, metric, dimension`,
    [since],
  );
  return rows.map((row) => ({
    date: isoDate(row.date),
    metric: row.metric,
    dimension: row.dimension,
    count: asCount(row.count),
  }));
}

async function roomNames(db: Db): Promise<Map<string, string>> {
  const rows = await db.query<{ id: string; name: string }>(`select id, name from room`);
  return new Map(rows.map((row) => [row.id, row.name.trim() || row.id]));
}

function countOn(stored: Stored[], metric: string, date: string, dimension = ""): number | null {
  const row = stored.find(
    (item) => item.metric === metric && item.date === date && item.dimension === dimension,
  );
  return row ? row.count : null;
}

function blankTiles(): StatsPayload["tiles"] {
  const blank = (id: StatsTile["id"], label: string): StatsTile => ({
    id,
    label,
    value: null,
    change: null,
  });
  return [
    blank("members", "Members"),
    blank("invites", "Invites accepted (30 days)"),
    blank("rooms", "Active rooms (30 days)"),
    blank("gatherings", "Gatherings held (30 days)"),
  ];
}

async function tilesOf(
  db: Db,
  stored: Stored[],
  asOf: string,
  category: string,
  membership: Map<string, Set<string>>,
): Promise<StatsPayload["tiles"]> {
  const currentStart = addUtcDays(asOf, -(TILE_DAYS - 1));
  const priorEnd = addUtcDays(asOf, -TILE_DAYS);
  const priorStart = addUtcDays(priorEnd, -(TILE_DAYS - 1));
  const members = compared(
    "members",
    "Members",
    filledCounts(stored, "joins", currentStart, asOf),
    filledCounts(stored, "joins", priorStart, priorEnd),
  );
  const invites = comparedCounts(
    "invites",
    "Invites accepted (30 days)",
    await redeemed(db, currentStart, asOf),
    await redeemed(db, priorStart, priorEnd),
  );
  const rooms = roomsTile(
    await categorySnapshot(db, currentStart, asOf, membership),
    await categorySnapshot(db, priorStart, priorEnd, membership),
    category,
  );
  const inCategory = roomIdsFor(membership, category);
  const gatherings = compared(
    "gatherings",
    "Gatherings held (30 days)",
    await gatheringParts(db, currentStart, asOf, inCategory),
    await gatheringParts(db, priorStart, priorEnd, inCategory),
  );
  return [members, invites, rooms, gatherings];
}

function roomsTile(
  current: CategorySnapshot,
  prior: CategorySnapshot,
  category: string,
): StatsTile {
  return {
    id: "rooms",
    label: "Active rooms (30 days)",
    value: publishedRooms(current, category),
    change: shownChange(publishedRooms(current, category), publishedRooms(prior, category)),
  };
}

/** The same number the category chart publishes, so a filter cannot reveal a hidden bar. */
function publishedRooms(snapshot: CategorySnapshot, category: string): ShownCount {
  const protectedParts = protectBreakdown(snapshot.parts);
  if (category === "all") return protectRoomTotal(snapshot.distinct, snapshot.parts);
  const index = STATS_CATEGORIES.findIndex((item) => item.id === category);
  return protectedParts.parts[index] ?? "<5";
}

function protectRoomTotal(distinct: number, parts: number[]): ShownCount {
  if (!parts.some((part) => part < SMALL_COUNT)) return showCount(distinct);
  const rounded = roundToFive(distinct);
  if (rounded < SMALL_COUNT || hiddenCellLeaks(parts, rounded)) return "<5";
  return rounded;
}

function compared(
  id: StatsTile["id"],
  label: string,
  current: number[],
  prior: number[],
): StatsTile {
  const now = protectBreakdown(current);
  const before = protectBreakdown(prior);
  return { id, label, value: now.total, change: shownChange(now.total, before.total) };
}

function comparedCounts(
  id: StatsTile["id"],
  label: string,
  current: number,
  prior: number,
): StatsTile {
  const value = showCount(current);
  const previous = showCount(prior);
  return { id, label, value, change: shownChange(value, previous) };
}

function shownOrNull(count: number | null): ShownCount | null {
  if (count === null) return null;
  return showCount(count);
}

function activeSeries(stored: Stored[], start: string, end: string): ActiveDay[] {
  return eachDay(start, end).map((date) => ({
    date,
    dau: showCount(countOn(stored, "dau", date) ?? 0),
    wau: bucketActive(countOn(stored, "wau", date) ?? 0, lookback(stored, date, 6)),
    mau: bucketActive(countOn(stored, "mau", date) ?? 0, lookback(stored, date, 29)),
  }));
}

/** A small day inside the window would fall out of an exact weekly or monthly total. */
function bucketActive(count: number, window: number[]): ShownCount {
  if (count < SMALL_COUNT) return "<5";
  if (!window.some((day) => day < SMALL_COUNT)) return showCount(count);
  const rounded = roundToFive(count);
  return rounded < SMALL_COUNT ? "<5" : rounded;
}

function lookback(stored: Stored[], date: string, daysBack: number): number[] {
  const counts: number[] = [];
  for (let ago = daysBack; ago >= 0; ago -= 1) {
    counts.push(countOn(stored, "dau", addUtcDays(date, -ago)) ?? 0);
  }
  return counts;
}

function rollSeries(stored: Stored[], inWindow: (date: string) => boolean): RollDay[] {
  const dates = [
    ...new Set(
      stored
        .filter(
          (row) => (row.metric === "roll" || row.metric === "attendance") && inWindow(row.date),
        )
        .map((row) => row.date),
    ),
  ].sort();
  return dates.map((date) => ({
    date,
    roll: showCount(countOn(stored, "roll", date) ?? 0),
    attendance: showCount(countOn(stored, "attendance", date) ?? 0),
  }));
}

function roomSeries(
  stored: Stored[],
  names: Map<string, string>,
  inWindow: (date: string) => boolean,
  inCategory: string[] | null,
): StatsPayload["rooms"] {
  const keys = new Map<
    string,
    { week: string; roomId: string; posts: number; gatherings: number }
  >();
  for (const row of stored) {
    if (row.metric !== "room_posts" && row.metric !== "room_gatherings") continue;
    if (!inWindow(row.date)) continue;
    if (inCategory && !inCategory.includes(row.dimension)) continue;
    const key = `${row.date}\n${row.dimension}`;
    const current = keys.get(key) ?? {
      week: row.date,
      roomId: row.dimension,
      posts: 0,
      gatherings: 0,
    };
    if (row.metric === "room_posts") current.posts += row.count;
    else current.gatherings += row.count;
    keys.set(key, current);
  }
  const byWeek = new Map<string, { roomId: string; posts: number; gatherings: number }[]>();
  for (const row of keys.values()) {
    const list = byWeek.get(row.week) ?? [];
    list.push(row);
    byWeek.set(row.week, list);
  }
  const rows: RoomWeek[] = [];
  const weeks: TotalWeek[] = [];
  for (const [week, rooms] of byWeek) {
    rooms.sort((a, b) => roomLabel(names, a.roomId).localeCompare(roomLabel(names, b.roomId)));
    const posts = protectBreakdown(rooms.map((room) => room.posts));
    const gatherings = protectBreakdown(rooms.map((room) => room.gatherings));
    weeks.push({ week, posts: posts.total, gatherings: gatherings.total });
    rooms.forEach((room, index) => {
      rows.push({
        week,
        room: roomLabel(names, room.roomId),
        posts: posts.parts[index] ?? "<5",
        gatherings: gatherings.parts[index] ?? "<5",
      });
    });
  }
  weeks.sort((a, b) => a.week.localeCompare(b.week));
  rows.sort((a, b) => a.room.localeCompare(b.room) || a.week.localeCompare(b.week));
  const steadyDate = stored
    .filter((row) => row.metric === "rooms_steady")
    .map((row) => row.date)
    .sort()
    .at(-1);
  const steady = steadyDate ? showCount(countOn(stored, "rooms_steady", steadyDate) ?? 0) : null;
  return { weeks, rows, steady };
}

function roomLabel(names: Map<string, string>, roomId: string): string {
  return names.get(roomId) ?? roomId;
}

function featureSeries(
  stored: Stored[],
  today: string,
): { rows: FeatureUse[]; most: string | null; least: string | null } {
  const start = addUtcDays(today, -FEATURE_DAYS);
  const totals = new Map<string, number>();
  for (const row of stored) {
    if (row.metric !== "feature" || row.date < start || row.date > today) continue;
    totals.set(row.dimension, (totals.get(row.dimension) ?? 0) + row.count);
  }
  const ranked = [...totals.entries()].map(([group, count]) => ({
    group,
    label: endpointLabel(group),
    count,
  }));
  const visible = ranked.filter((row) => row.count >= 5);
  visible.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const hidden = ranked
    .filter((row) => row.count < 5)
    .sort((a, b) => a.label.localeCompare(b.label));
  const rows: FeatureUse[] = [
    ...visible.map((row) => ({ group: row.group, label: row.label, count: showCount(row.count) })),
    ...hidden.map((row) => ({ group: row.group, label: row.label, count: showCount(row.count) })),
  ];
  const most = visible[0] ?? null;
  const least = visible.length > 1 ? visible[visible.length - 1] : null;
  const leastDistinct = least && most && least.group !== most.group ? least : null;
  return {
    rows,
    most: most ? most.label : null,
    least: leastDistinct ? leastDistinct.label : null,
  };
}

function intentOf(stored: Stored[], asOf: string | null, roll: RollDay[]): StatsPayload["intent"] {
  const attendance: DayCount[] = roll.map((row) => ({ date: row.date, count: row.attendance }));
  if (!asOf) {
    return {
      attendance,
      rsvpNote: RSVP_NOTE,
      inPersonCount: null,
      inPersonPercent: null,
      crossRoomMembers: null,
      crossRoomVouches: null,
    };
  }
  const part = countOn(stored, "in_person_attended", asOf);
  const whole = countOn(stored, "in_person_members", asOf);
  return {
    attendance,
    rsvpNote: RSVP_NOTE,
    inPersonCount: part === null ? null : showCount(part),
    inPersonPercent: part === null || whole === null ? null : showPercent(part, whole),
    crossRoomMembers: shownOrNull(countOn(stored, "cross_room_members", asOf)),
    crossRoomVouches: shownOrNull(countOn(stored, "cross_room_vouches", asOf)),
  };
}

/** Seeded rooms and the seven browse categories. Uncategorized is not one of the seven. */
const ROOM_CATEGORY: Record<string, string> = {
  baptist: "churches",
  presbyterian: "churches",
  latin: "churches",
  orthodox: "churches",
  "cong-epiphany": "churches",
  "cong-grace": "churches",
  "cong-redeemer": "churches",
  "cong-st-john": "churches",
  question: "discussion",
  shelf: "discussion",
  coop: "discussion",
  shop: "business-trades",
  "rv-shop": "business-trades",
  dispatch: "civic",
  "rv-town": "civic",
  "brandon-town": "civic",
  "valrico-town": "civic",
  "tampa-town": "civic",
  county: "county",
  "region-hillsborough": "county",
};

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addUtcDays(day, 1)) days.push(day);
  return days;
}

function filledCounts(stored: Stored[], metric: string, start: string, end: string): number[] {
  return eachDay(start, end).map((date) => countOn(stored, metric, date) ?? 0);
}

function protectedDaily(stored: Stored[], metric: string, start: string, end: string): DayCount[] {
  const dates = eachDay(start, end);
  const protectedCounts = protectBreakdown(filledCounts(stored, metric, start, end));
  return dates.map((date, index) => ({ date, count: protectedCounts.parts[index] ?? "<5" }));
}

async function redeemed(db: Db, start: string, end: string): Promise<number> {
  const rows = await db.query<{ count: unknown }>(
    `select count(*)::int as count
     from invite_redemption
     where (redeemed_at at time zone 'utc')::date between $1::date and $2::date`,
    [start, end],
  );
  return asCount(rows[0]?.count);
}

async function activeRoomIds(db: Db, start: string, end: string): Promise<string[]> {
  const rows = await db.query<{ room_id: string }>(
    `select distinct room_id from board_post
     where removed = false
       and (created_at at time zone 'utc')::date between $1::date and $2::date
     union
     select room_id from public_gathering
     where removed = false
       and room_id <> ''
       and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and gather_on::date between $1::date and $2::date`,
    [start, end],
  );
  return rows.map((row) => row.room_id);
}

type CategorySnapshot = { parts: number[]; distinct: number };

/**
 * Seven category counts, then rooms with no browse category.
 * A room in two categories increments both. The distinct total counts it once.
 */
async function categorySnapshot(
  db: Db,
  start: string,
  end: string,
  membership: Map<string, Set<string>>,
): Promise<CategorySnapshot> {
  const counts = new Map<string, number>(STATS_CATEGORIES.map((category) => [category.id, 0]));
  let other = 0;
  const rooms = await activeRoomIds(db, start, end);
  for (const roomId of rooms) {
    const slugs = [...(membership.get(roomId) ?? [])].filter((slug) => counts.has(slug));
    if (slugs.length === 0) other += 1;
    for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return {
    parts: [...STATS_CATEGORIES.map((category) => counts.get(category.id) ?? 0), other],
    distinct: rooms.length,
  };
}

async function categoriesOf(
  db: Db,
  start: string,
  end: string,
  category: string,
  membership: Map<string, Set<string>>,
): Promise<CategoryCount[]> {
  const snapshot = await categorySnapshot(db, start, end, membership);
  const parts = protectBreakdown(snapshot.parts);
  const bars = STATS_CATEGORIES.map((item, index) => ({
    id: item.id,
    label: item.label,
    count: parts.parts[index] ?? ("<5" as const),
  }));
  if (category === "all") return bars;
  return bars.filter((bar) => bar.id === category);
}

/** Rooms in the selected category. Null means every room. A room may be in more than one. */
function roomIdsFor(membership: Map<string, Set<string>>, category: string): string[] | null {
  if (category === "all") return null;
  const ids: string[] = [];
  for (const [roomId, slugs] of membership) {
    if (slugs.has(category)) ids.push(roomId);
  }
  return ids;
}

/**
 * `room_categories` is the many-to-many list from the categories migration.
 * Until that table exists, one category on `room` is used, then the seeded map.
 */
async function loadMembership(db: Db): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const add = (roomId: string, slug: string) => {
    if (!roomId || !slug) return;
    const slugs = map.get(roomId) ?? new Set<string>();
    slugs.add(slug);
    map.set(roomId, slugs);
  };
  if (await relationExists(db, "room_categories")) {
    const rows = await db.query<{ room_id: string; category_id: string }>(
      `select room_id, category_id from room_categories`,
    );
    for (const row of rows) add(row.room_id, row.category_id);
    return map;
  }
  if (await columnExists(db, "room", "category_id")) {
    const rows = await db.query<{ id: string; category_id: string }>(
      `select id, category_id from room`,
    );
    for (const row of rows) add(row.id, row.category_id);
    return map;
  }
  for (const [roomId, slug] of Object.entries(ROOM_CATEGORY)) add(roomId, slug);
  return map;
}

async function relationExists(db: Db, name: string): Promise<boolean> {
  const rows = await db.query<{ present: string | null }>(`select to_regclass($1) as present`, [
    `public.${name}`,
  ]);
  return Boolean(rows[0]?.present);
}

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const rows = await db.query<{ present: unknown }>(
    `select 1 as present from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  );
  return Boolean(rows[0]);
}

async function gatheringParts(
  db: Db,
  start: string,
  end: string,
  roomIds: string[] | null,
): Promise<number[]> {
  const narrowed = roomIds !== null;
  const rows = await db.query<{ date: string; count: unknown }>(
    `select day as date, count(*)::int as count from (
       select on_date as day
       from board_post
       where type = 'hosted'
         and removed = false
         and on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and on_date::date between $1::date and $2::date
         and ($3::boolean = false or room_id = any($4::text[]))
       union all
       select gather_on as day
       from public_gathering
       where removed = false
         and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and gather_on::date between $1::date and $2::date
         and ($3::boolean = false or room_id = any($4::text[]))
     ) held
     group by day`,
    [start, end, narrowed, roomIds ?? []],
  );
  const byDay = new Map(rows.map((row) => [isoDate(row.date), asCount(row.count)]));
  return eachDay(start, end).map((date) => byDay.get(date) ?? 0);
}

async function funnelOf(db: Db, start: string, end: string): Promise<FunnelStep[]> {
  const sent = await db.query<{ count: unknown }>(
    `select count(*)::int as count
     from invite_code
     where (created_at at time zone 'utc')::date between $1::date and $2::date`,
    [start, end],
  );
  const accepted = await redeemed(db, start, end);
  const first = await db.query<{ count: unknown }>(
    `select count(distinct redemption.invited_user_id)::int as count
     from invite_redemption redemption
     where (redemption.redeemed_at at time zone 'utc')::date between $1::date and $2::date
       and (
         exists (
           select 1 from board_post post
           where post.author_user_id = redemption.invited_user_id
             and post.type = 'hosted'
             and post.removed = false
             and post.on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             and post.on_date::date >= (redemption.redeemed_at at time zone 'utc')::date
             and post.on_date::date <= $2::date
         )
         or exists (
           select 1 from public_gathering gathering
           where gathering.host_user_id = redemption.invited_user_id
             and gathering.removed = false
             and gathering.gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             and gathering.gather_on::date >= (redemption.redeemed_at at time zone 'utc')::date
             and gathering.gather_on::date <= $2::date
         )
       )`,
    [start, end],
  );
  return [
    { id: "sent", label: "Sent", count: showCount(asCount(sent[0]?.count)) },
    { id: "opened", label: "Opened", count: null },
    { id: "accepted", label: "Accepted", count: showCount(accepted) },
    { id: "first", label: "First gathering", count: showCount(asCount(first[0]?.count)) },
  ];
}

function emptyFunnel(): FunnelStep[] {
  return [
    { id: "sent", label: "Sent", count: null },
    { id: "opened", label: "Opened", count: null },
    { id: "accepted", label: "Accepted", count: null },
    { id: "first", label: "First gathering", count: null },
  ];
}

async function alertsOf(db: Db): Promise<StatsAlerts> {
  try {
    const rows = await db.query<{ count: unknown }>(
      `select count(*)::int as count
       from board_csam_hold
       where purged_at is null and filed_at is null`,
    );
    return { reports: asCount(rows[0]?.count), health: "ok" };
  } catch {
    return { reports: 0, health: "down" };
  }
}
