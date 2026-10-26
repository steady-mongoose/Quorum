import type { Db } from "../db.ts";
import {
  RSVP_NOTE,
  endpointLabel,
  showCount,
  showPercent,
  toStatsCsv,
  type ActiveDay,
  type DayCount,
  type FeatureUse,
  type RollDay,
  type RoomWeek,
  type ShownCount,
  type StatsPayload,
  type StatsTile,
  type TotalWeek,
} from "../../src/lib/board/stats.ts";
import { addUtcDays, asCount, isoDate, utcDate } from "./dates.ts";

type Stored = { date: string; metric: string; dimension: string; count: number };

const WINDOW_DAYS = 179;
const FEATURE_DAYS = 27;

export async function readStats(db: Db, now: Date): Promise<StatsPayload> {
  const today = utcDate(now);
  const stored = await load(db, addUtcDays(today, -400));
  const names = await roomNames(db);
  const dauDays = stored.filter((row) => row.metric === "dau").map((row) => row.date);
  const asOf = dauDays.length > 0 ? dauDays[dauDays.length - 1] : null;
  const start = asOf ? addUtcDays(asOf, -WINDOW_DAYS) : null;
  const inWindow = (date: string) => (start ? date >= start && date <= (asOf ?? date) : false);

  const joins = series(stored, "joins", "", inWindow);
  const active = activeSeries(stored, inWindow);
  const roll = rollSeries(stored, inWindow);
  const rooms = roomSeries(stored, names, inWindow);
  const features = featureSeries(stored, today);
  const intent = intentOf(stored, asOf, roll);

  return {
    asOf,
    tiles: tilesOf(stored, asOf),
    joins,
    active,
    roll,
    rooms,
    features: features.rows,
    mostUsed: features.most,
    leastUsed: features.least,
    intent,
  };
}

export async function readStatsCsv(db: Db, now: Date): Promise<string> {
  return toStatsCsv(await readStats(db, now));
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

function tilesOf(stored: Stored[], asOf: string | null): StatsPayload["tiles"] {
  const blank = (id: StatsTile["id"], label: string): StatsTile => ({ id, label, value: null });
  if (!asOf) {
    return [
      blank("dau", "On that day"),
      blank("wau", "In 7 days"),
      blank("mau", "In 30 days"),
      blank("joins", "Joins, 30 days"),
    ];
  }
  const joinStart = addUtcDays(asOf, -29);
  const joined = stored
    .filter((row) => row.metric === "joins" && row.date >= joinStart && row.date <= asOf)
    .reduce((sum, row) => sum + row.count, 0);
  return [
    { id: "dau", label: "On that day", value: shownOrNull(countOn(stored, "dau", asOf)) },
    { id: "wau", label: "In 7 days", value: shownOrNull(countOn(stored, "wau", asOf)) },
    { id: "mau", label: "In 30 days", value: shownOrNull(countOn(stored, "mau", asOf)) },
    { id: "joins", label: "Joins, 30 days", value: showCount(joined) },
  ];
}

function shownOrNull(count: number | null): ShownCount | null {
  if (count === null) return null;
  return showCount(count);
}

function series(
  stored: Stored[],
  metric: string,
  dimension: string,
  inWindow: (date: string) => boolean,
): DayCount[] {
  return stored
    .filter((row) => row.metric === metric && row.dimension === dimension && inWindow(row.date))
    .map((row) => ({ date: row.date, count: showCount(row.count) }));
}

function activeSeries(stored: Stored[], inWindow: (date: string) => boolean): ActiveDay[] {
  const dates = [
    ...new Set(
      stored.filter((row) => row.metric === "dau" && inWindow(row.date)).map((row) => row.date),
    ),
  ];
  return dates.map((date) => ({
    date,
    dau: showCount(countOn(stored, "dau", date) ?? 0),
    wau: showCount(countOn(stored, "wau", date) ?? 0),
    mau: showCount(countOn(stored, "mau", date) ?? 0),
  }));
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
): StatsPayload["rooms"] {
  const keys = new Map<
    string,
    { week: string; roomId: string; posts: number; gatherings: number }
  >();
  for (const row of stored) {
    if (row.metric !== "room_posts" && row.metric !== "room_gatherings") continue;
    if (!inWindow(row.date)) continue;
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
  const rows: RoomWeek[] = [...keys.values()]
    .sort(
      (a, b) =>
        a.week.localeCompare(b.week) ||
        roomLabel(names, a.roomId).localeCompare(roomLabel(names, b.roomId)),
    )
    .map((row) => ({
      week: row.week,
      room: roomLabel(names, row.roomId),
      posts: showCount(row.posts),
      gatherings: showCount(row.gatherings),
    }));
  const totals = new Map<string, { posts: number; gatherings: number }>();
  for (const row of keys.values()) {
    const total = totals.get(row.week) ?? { posts: 0, gatherings: 0 };
    total.posts += row.posts;
    total.gatherings += row.gatherings;
    totals.set(row.week, total);
  }
  const weeks: TotalWeek[] = [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, total]) => ({
      week,
      posts: showCount(total.posts),
      gatherings: showCount(total.gatherings),
    }));
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
