import type { Db } from "../db.ts";
import {
  UNSORTED_CATEGORY,
  RSVP_NOTE,
  SMALL_COUNT,
  STATS_CATEGORIES,
  endpointLabel,
  roundedTotalIsSafe,
  protectTotalOverCells,
  type ProtectedCount,
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

export async function readStats(
  db: Db,
  now: Date,
  filter: { days: StatsDays; category: string; requested?: string } = {
    days: 30,
    category: "all",
  },
): Promise<StatsPayload> {
  const today = utcDate(now);
  const stored = await load(db, addUtcDays(today, -400));
  const names = await roomNames(db);
  const membership = await loadMembership(db);
  const catalog = await loadCatalog(db, membership);
  const category = resolveCategory(filter, catalog);
  const inCategory = roomIdsFor(membership, category);
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
  const roomCells = roomGatheringCells(stored, inChart, inCategory);
  const rooms = roomSeries(stored, names, inChart, inCategory);
  const features = featureSeries(stored, today);
  const intent = intentOf(stored, asOf, roll);
  const tiles = asOf
    ? await tilesOf(
        db,
        stored,
        asOf,
        filter.days,
        category,
        membership,
        catalog,
        roomCells,
        inCategory,
      )
    : blankTiles(filter.days);
  const roomsByCategory = asOf
    ? await categoriesOf(
        db,
        addUtcDays(asOf, -(filter.days - 1)),
        asOf,
        category,
        membership,
        catalog,
      )
    : catalog
        .filter((item) => item.id !== UNSORTED_CATEGORY.id)
        .map((item) => ({
          id: item.id,
          label: item.label,
          count: "<5" as const,
        }));
  const funnel = asOf
    ? await funnelOf(db, addUtcDays(asOf, -(filter.days - 1)), asOf)
    : emptyFunnel();

  return {
    asOf,
    days: filter.days,
    category,
    categories: catalog,
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
  filter: { days: StatsDays; category: string; requested?: string } = {
    days: 30,
    category: "all",
  },
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

function blankTiles(days: StatsDays): StatsPayload["tiles"] {
  const labels = tileLabels(days);
  const blank = (id: StatsTile["id"], label: string): StatsTile => ({
    id,
    label,
    value: null,
    change: null,
  });
  return [
    blank("members", labels.members),
    blank("invites", labels.invites),
    blank("rooms", labels.rooms),
    blank("gatherings", labels.gatherings),
  ];
}

function tileLabels(days: StatsDays): {
  members: string;
  invites: string;
  rooms: string;
  gatherings: string;
} {
  return {
    members: "Members",
    invites: `Invites accepted (${days} days)`,
    rooms: `Active rooms (${days} days)`,
    gatherings: `Gatherings held (${days} days)`,
  };
}

async function tilesOf(
  db: Db,
  stored: Stored[],
  asOf: string,
  days: StatsDays,
  category: string,
  membership: Map<string, Set<string>>,
  catalog: CategoryInfo[],
  roomCells: number[] = [],
  inCategory: string[] | null = null,
): Promise<StatsPayload["tiles"]> {
  const labels = tileLabels(days);
  const currentStart = addUtcDays(asOf, -(days - 1));
  const priorEnd = addUtcDays(asOf, -days);
  const priorStart = addUtcDays(priorEnd, -(days - 1));
  const members = compared(
    "members",
    labels.members,
    filledCounts(stored, "joins", currentStart, asOf),
    filledCounts(stored, "joins", priorStart, priorEnd),
  );
  const invites = comparedCounts(
    "invites",
    labels.invites,
    await redeemed(db, currentStart, asOf),
    await redeemed(db, priorStart, priorEnd),
  );
  const rooms = roomsTile(
    await categorySnapshot(db, currentStart, asOf, membership, catalog),
    await categorySnapshot(db, priorStart, priorEnd, membership, catalog),
    category,
    labels.rooms,
    catalog,
  );
  const currentGatherings = await gatheringSnapshot(db, currentStart, asOf, membership, catalog);
  const gatherings = gatheringsTile(
    currentGatherings,
    await gatheringSnapshot(db, priorStart, priorEnd, membership, catalog),
    category,
    labels.gatherings,
    catalog,
    roomCells,
    // The prior window's rooms are listed when the window is moved back, so its
    // total is protected against those cells too.
    roomGatheringCells(stored, (date) => date >= priorStart && date <= priorEnd, inCategory),
  );
  return [members, invites, rooms, gatherings];
}

function roomsTile(
  current: CategorySnapshot,
  prior: CategorySnapshot,
  category: string,
  label: string,
  catalog: CategoryInfo[],
): StatsTile {
  const now = publishedBreakdown(current, category, catalog);
  return {
    id: "rooms",
    label,
    value: now.value,
    approx: now.approx,
    ...changeOf(now, publishedBreakdown(prior, category, catalog)),
  };
}

function gatheringsTile(
  current: CategorySnapshot,
  prior: CategorySnapshot,
  category: string,
  label: string,
  catalog: CategoryInfo[],
  roomCells: number[] = [],
  priorRoomCells: number[] = [],
): StatsTile {
  const shown = besideRoomTable(
    publishedBreakdown(current, category, catalog),
    categoryTotal(current, category, catalog),
    roomCells,
  );
  return {
    id: "gatherings",
    label,
    value: shown.value,
    approx: shown.approx,
    ...changeOf(
      shown,
      besideRoomTable(
        publishedBreakdown(prior, category, catalog),
        categoryTotal(prior, category, catalog),
        priorRoomCells,
      ),
    ),
  };
}

/** The exact count behind a published breakdown value. */
function categoryTotal(
  snapshot: CategorySnapshot,
  category: string,
  catalog: CategoryInfo[],
): number {
  if (category === "all") return snapshot.total;
  const index = catalog.findIndex((item) => item.id === category);
  return index < 0 ? 0 : (snapshot.parts[index] ?? 0);
}

/**
 * The gatherings tile sits next to the per-room weekly table for the same
 * window and category, and which rooms are in a category is public. An exact
 * tile minus the shown room cells would give back a hidden "<5" cell, so the
 * tile is also protected against those cells.
 */
function besideRoomTable(
  shown: ProtectedCount,
  exact: number,
  roomCells: number[],
): ProtectedCount {
  if (typeof shown.value !== "number" || exact === 0) return shown;
  const overCells = protectTotalOverCells(exact, roomCells);
  if (typeof overCells.value !== "number") return { value: "<5", approx: false };
  return shown.approx ? shown : overCells;
}

/** Every gatherings cell the per-room weekly table shows for this window and category. */
function roomGatheringCells(
  stored: Stored[],
  inWindow: (date: string) => boolean,
  inCategory: string[] | null,
): number[] {
  const cells = new Map<string, number>();
  for (const row of stored) {
    if (row.metric !== "room_posts" && row.metric !== "room_gatherings") continue;
    if (!inWindow(row.date)) continue;
    if (inCategory && !inCategory.includes(row.dimension)) continue;
    const key = `${row.date}\n${row.dimension}`;
    cells.set(key, (cells.get(key) ?? 0) + (row.metric === "room_gatherings" ? row.count : 0));
  }
  return [...cells.values()];
}

/**
 * One breakdown for every category, including the hall-wide total.
 * A large category stays exact. The total is rounded or hidden when any
 * category is under 5, so all minus one category cannot recover it.
 */
function publishedBreakdown(
  snapshot: CategorySnapshot,
  category: string,
  catalog: CategoryInfo[],
): ProtectedCount {
  const protectedParts = protectBreakdown(snapshot.parts, CATEGORY_RULE);
  if (category === "all") return protectRoomTotal(snapshot.total, snapshot.parts);
  const index = catalog.findIndex((item) => item.id === category);
  if (index < 0) return { value: "<5", approx: false };
  return { value: protectedParts.parts[index] ?? "<5", approx: false };
}

/** Category buckets: an empty one (0) is not a small cell, so it cannot hide a full total. */
const CATEGORY_RULE = { emptyShown: true } as const;

function protectRoomTotal(total: number, parts: number[]): ProtectedCount {
  if (!parts.some((part) => part > 0 && part < SMALL_COUNT)) {
    return { value: showCount(total), approx: false };
  }
  // Decided from public facts only (shown cells, hidden count), never the hidden values.
  if (!roundedTotalIsSafe(parts, CATEGORY_RULE)) return { value: "<5", approx: false };
  const rounded = roundToFive(total);
  return rounded < SMALL_COUNT ? { value: "<5", approx: false } : { value: rounded, approx: true };
}

/**
 * The change between two protected values, never the exact counts, so the
 * change cannot give back a total the tile rounded or hid. Hidden when either
 * side is "<5"; approximate when either side was rounded.
 */
function changeOf(
  now: ProtectedCount,
  prior: ProtectedCount,
): { change: number | null; changeApprox: boolean } {
  const change = shownChange(now.value, prior.value);
  return { change, changeApprox: change !== null && (now.approx || prior.approx) };
}

function compared(
  id: StatsTile["id"],
  label: string,
  current: number[],
  prior: number[],
): StatsTile {
  const now = protectBreakdown(current);
  const before = protectBreakdown(prior);
  return {
    id,
    label,
    value: now.total,
    approx: now.approx,
    ...changeOf(
      { value: now.total, approx: now.approx },
      { value: before.total, approx: before.approx },
    ),
  };
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
    weeks.push({
      week,
      posts: posts.total,
      gatherings: gatherings.total,
      postsApprox: posts.approx,
      gatheringsApprox: gatherings.approx,
    });
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

type CategoryInfo = { id: string; label: string };

type CategorySnapshot = { parts: number[]; total: number };

/**
 * One count per catalog category, then rooms in none of them.
 * A room in two categories increments both. The total counts it once.
 */
async function categorySnapshot(
  db: Db,
  start: string,
  end: string,
  membership: Map<string, Set<string>>,
  catalog: CategoryInfo[],
): Promise<CategorySnapshot> {
  return countByCategory(await activeRoomIds(db, start, end), membership, catalog, () => 1);
}

async function gatheringSnapshot(
  db: Db,
  start: string,
  end: string,
  membership: Map<string, Set<string>>,
  catalog: CategoryInfo[],
): Promise<CategorySnapshot> {
  const rows = await db.query<{ room_id: string; count: unknown }>(
    `select room_id, count(*)::int as count from (
       select room_id
       from board_post
       where type = 'hosted'
         and removed = false
         and on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and on_date::date between $1::date and $2::date
       union all
       select room_id
       from public_gathering
       where removed = false
         and gather_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and gather_on::date between $1::date and $2::date
     ) held
     group by room_id`,
    [start, end],
  );
  const counts = new Map(rows.map((row) => [row.room_id, asCount(row.count)]));
  return countByCategory(
    [...counts.keys()],
    membership,
    catalog,
    (roomId) => counts.get(roomId) ?? 0,
  );
}

function countByCategory(
  roomIds: string[],
  membership: Map<string, Set<string>>,
  catalog: CategoryInfo[],
  amount: (roomId: string) => number,
): CategorySnapshot {
  const parts = catalog.map(() => 0);
  let remainder = 0;
  let total = 0;
  for (const roomId of roomIds) {
    const count = amount(roomId);
    total += count;
    const slugs = membership.get(roomId) ?? new Set<string>();
    let matched = false;
    catalog.forEach((category, index) => {
      if (!slugs.has(category.id)) return;
      parts[index] = (parts[index] ?? 0) + count;
      matched = true;
    });
    if (!matched) remainder += count;
  }
  return { parts: [...parts, remainder], total };
}

async function categoriesOf(
  db: Db,
  start: string,
  end: string,
  category: string,
  membership: Map<string, Set<string>>,
  catalog: CategoryInfo[],
): Promise<CategoryCount[]> {
  const snapshot = await categorySnapshot(db, start, end, membership, catalog);
  const parts = protectBreakdown(snapshot.parts, CATEGORY_RULE);
  const bars = catalog.map((item, index) => ({
    id: item.id,
    label: item.label,
    count: parts.parts[index] ?? ("<5" as const),
  }));
  // The not-yet-sorted row is shown only when some active room is in it.
  if (category === "all") {
    return bars.filter(
      (bar, index) => bar.id !== UNSORTED_CATEGORY.id || (snapshot.parts[index] ?? 0) > 0,
    );
  }
  return bars.filter((bar) => bar.id === category);
}

function resolveCategory(
  filter: { category: string; requested?: string },
  catalog: CategoryInfo[],
): string {
  const requested = (filter.requested ?? filter.category).trim();
  if (catalog.some((item) => item.id === requested)) return requested;
  if (requested === "all" || requested === "") return "all";
  if (filter.category !== "all" && catalog.some((item) => item.id === filter.category)) {
    return filter.category;
  }
  return "all";
}

/** Browse categories, plus any an admin has added, under the name stored for each. */
async function loadCatalog(db: Db, membership: Map<string, Set<string>>): Promise<CategoryInfo[]> {
  const named = await categoryNames(db);
  const ids = new Set<string>(STATS_CATEGORIES.map((category) => category.id));
  for (const slug of named.keys()) ids.add(slug);
  for (const slugs of membership.values()) {
    for (const slug of slugs) ids.add(slug);
  }
  const extras = [...ids]
    .filter((id) => !STATS_CATEGORIES.some((category) => category.id === id))
    .sort();
  const unsorted = extras.includes(UNSORTED_CATEGORY.id);
  return [
    ...STATS_CATEGORIES.map((category) => ({
      id: category.id,
      label: named.get(category.id) ?? category.label,
    })),
    ...extras
      .filter((id) => id !== UNSORTED_CATEGORY.id)
      .map((id) => ({ id, label: named.get(id) ?? id })),
    // Rooms not yet sorted always come last, under a plain label.
    ...(unsorted ? [{ id: UNSORTED_CATEGORY.id, label: UNSORTED_CATEGORY.label }] : []),
  ];
}

async function categoryNames(db: Db): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!(await relationExists(db, "categories"))) return names;
  const ordered = await columnExists(db, "categories", "sort_order");
  const rows = await db.query<{ slug: string; name: string }>(
    ordered
      ? `select slug, name from categories order by sort_order, slug`
      : `select slug, name from categories order by slug`,
  );
  for (const row of rows) {
    const name = row.name.trim();
    if (row.slug && name) names.set(row.slug, name);
  }
  return names;
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
 * A room may belong to more than one category. `room_categories` is that join
 * table. When it is not present, `room.category_id` is the single category,
 * and otherwise the seeded map is used.
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
