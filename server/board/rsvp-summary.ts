import type { Db } from "../db.ts";

/**
 * Admin RSVP metrics (Josh via CoS, Oct 30, 7:01–7:04 AM ET): counts only,
 * per room, per gathering and per week. Never a respondent's name, email,
 * id or handle. Barred and banned members' RSVPs are counted, with no
 * identity, so these reads do not go through hideBanned. Admin-only
 * operational numbers: never shown to members, never ranked or scored.
 */

/**
 * TODO(Josh): the smallest count shown. A count above 0 and under this is
 * shown as hidden (null), and enough neighbouring cells are hidden with it
 * that a total cannot give it away. 1 = no suppression, until Josh sets N.
 */
export const RSVP_SUMMARY_MIN_COUNT = 1;

/** Weeks of write-ups in the per-week table. */
export const RSVP_SUMMARY_WEEKS = 12;

/** A shown count, or null when it is hidden as too small. */
export type SummaryCount = number | null;
export type SummaryCells = { going: SummaryCount; came: SummaryCount; writeUps: SummaryCount };
export type RsvpSummary = {
  minCount: number;
  totals: SummaryCells;
  rooms: Array<
    SummaryCells & {
      roomId: string;
      gatherings: Array<SummaryCells & { gatheringId: string; title: string }>;
      weeks: Array<{ week: string; came: SummaryCount; writeUps: SummaryCount }>;
    }
  >;
};

/**
 * Small-count suppression for one group of cells under one shown total.
 * Primary: hide every cell above 0 and under n. Complementary: while exactly
 * one cell is hidden, or the hidden cells add up to under n, also hide the
 * smallest shown cell above 0, so subtracting from the total never gives a
 * small count back. With n <= 1 nothing is hidden.
 */
export function suppressGroup(values: readonly number[], n: number = RSVP_SUMMARY_MIN_COUNT): SummaryCount[] {
  const hidden = values.map((value) => n > 1 && value > 0 && value < n);
  if (hidden.some(Boolean)) {
    const sum = () => values.reduce((total, value, i) => total + (hidden[i] ? value : 0), 0);
    for (;;) {
      const count = hidden.filter(Boolean).length;
      if (count !== 1 && sum() >= n) break;
      let pick = -1;
      for (let i = 0; i < values.length; i += 1) {
        if (!hidden[i] && values[i]! > 0 && (pick < 0 || values[i]! < values[pick]!)) pick = i;
      }
      if (pick < 0) break;
      hidden[pick] = true;
    }
  }
  return values.map((value, i) => (hidden[i] ? null : value));
}

/** A total under n is itself hidden. */
function total(value: number, n: number): SummaryCount {
  return n > 1 && value > 0 && value < n ? null : value;
}

type Metric = "going" | "came" | "writeUps";
const METRICS: Metric[] = ["going", "came", "writeUps"];

/** Apply suppression per metric to children under a parent. */
function suppressChildren<T extends Partial<Record<Metric, number>>>(
  rows: T[],
  metrics: Metric[],
  n: number,
): Array<Omit<T, Metric> & Partial<Record<Metric, SummaryCount>>> {
  const out = rows.map((row) => ({ ...row })) as Array<Omit<T, Metric> & Partial<Record<Metric, SummaryCount>>>;
  for (const metric of metrics) {
    const shown = suppressGroup(rows.map((row) => row[metric] ?? 0), n);
    shown.forEach((value, i) => {
      (out[i] as Record<string, unknown>)[metric] = value;
    });
  }
  return out;
}

export async function rsvpSummary(db: Db, now: Date, n: number = RSVP_SUMMARY_MIN_COUNT): Promise<RsvpSummary> {
  const gatherings = await db.query<{ id: string; room_id: string; title: string; going: unknown; came: unknown; write_ups: unknown }>(
    `select g.id, g.room_id, g.title,
            (select count(*) from gathering_rsvp r where r.gathering_id = g.id and r.going)::int as going,
            (select count(*) from gathering_rsvp r where r.gathering_id = g.id and r.attended)::int as came,
            (select count(*) from board_post p
              where p.type = 'hosted' and p.removed = false and p.card_id = g.id)::int as write_ups
     from public_gathering g
     where g.removed = false
     order by g.room_id, g.title, g.id`,
  );
  const since = new Date(now.getTime() - RSVP_SUMMARY_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const weeks = await db.query<{ room_id: string; week: string; came: unknown; write_ups: unknown }>(
    `select g.room_id,
            to_char(date_trunc('week', p.on_date::date), 'YYYY-MM-DD') as week,
            coalesce(sum(cardinality(p.came)), 0)::int as came,
            count(*)::int as write_ups
     from board_post p
     join public_gathering g on g.id = p.card_id and g.removed = false
     where p.type = 'hosted'
       and p.removed = false
       and p.on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and p.on_date::date >= $1::date
     group by 1, 2
     order by 1, 2`,
    [since.toISOString().slice(0, 10)],
  );
  const byRoom = new Map<string, { gatherings: Array<{ gatheringId: string; title: string; going: number; came: number; writeUps: number }>; weeks: Array<{ week: string; came: number; writeUps: number }> }>();
  const room = (id: string) => {
    const found = byRoom.get(id) ?? { gatherings: [], weeks: [] };
    byRoom.set(id, found);
    return found;
  };
  for (const row of gatherings) {
    room(row.room_id).gatherings.push({
      gatheringId: row.id,
      title: row.title,
      going: Number(row.going),
      came: Number(row.came),
      writeUps: Number(row.write_ups),
    });
  }
  for (const row of weeks) {
    room(row.room_id).weeks.push({ week: row.week, came: Number(row.came), writeUps: Number(row.write_ups) });
  }
  const raw = [...byRoom.entries()].map(([roomId, value]) => {
    const sums = Object.fromEntries(
      METRICS.map((metric) => [metric, value.gatherings.reduce((acc, g) => acc + g[metric], 0)]),
    ) as Record<Metric, number>;
    return { roomId, ...sums, gatherings: value.gatherings, weeks: value.weeks };
  });
  const totals = Object.fromEntries(
    METRICS.map((metric) => [metric, total(raw.reduce((acc, r) => acc + r[metric], 0), n)]),
  ) as SummaryCells;
  const rooms = suppressChildren(raw, METRICS, n).map((row) => ({
    roomId: row.roomId,
    going: row.going ?? null,
    came: row.came ?? null,
    writeUps: row.writeUps ?? null,
    gatherings: suppressChildren(row.gatherings, METRICS, n).map((g) => ({
      gatheringId: g.gatheringId,
      title: g.title,
      going: g.going ?? null,
      came: g.came ?? null,
      writeUps: g.writeUps ?? null,
    })),
    weeks: suppressChildren(row.weeks, ["came", "writeUps"], n).map((w) => ({
      week: w.week,
      came: w.came ?? null,
      writeUps: w.writeUps ?? null,
    })),
  }));
  return { minCount: n, totals, rooms };
}
