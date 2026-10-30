import type { Db } from "../db.ts";

/**
 * Admin RSVP metrics (Josh via CoS, Oct 30, 7:01–7:04 AM ET): counts only,
 * per room, per gathering and per week. Never a respondent's name, email,
 * id or handle. Barred and banned members' RSVPs are counted, with no
 * identity, so these reads do not go through hideBanned. Admin-only
 * operational numbers: never shown to members, never ranked or scored.
 */

// RSVP_SUMMARY_MIN_COUNT (TODO Josh) lives in src/lib/board/rsvp-rules.ts, so
// the server's suppression and the panel's copy read the same number.
import { RSVP_SUMMARY_MIN_COUNT } from "../../src/lib/board/rsvp-rules.ts";
export { RSVP_SUMMARY_MIN_COUNT };

/** Weeks of write-ups in the per-week table. */
export const RSVP_SUMMARY_WEEKS = 12;

/** A shown count, or null when it is hidden as too small. */
export type SummaryCount = number | null;
export type SummaryCells = { going: SummaryCount; came: SummaryCount; writeUps: SummaryCount };
/**
 * No free-text title goes to an admin (QA S4): a gathering is labelled by its
 * date only ("Gathering on Oct 26, 2026" on the panel). "came" is the
 * attended flag at every level (QA S3); weeks carry write-ups only, because
 * attended is one flag per member and gathering, not per date.
 */
export type RsvpSummary = {
  minCount: number;
  totals: SummaryCells;
  rooms: Array<
    SummaryCells & {
      roomId: string;
      gatherings: Array<SummaryCells & { gatheringId: string; date: string }>;
      weeks: Array<{ week: string; writeUps: SummaryCount }>;
    }
  >;
};

/**
 * Small-count suppression for one group of cells under one shown total.
 * Primary: hide every cell above 0 and under n, and any cell flagged in
 * `also` (near-everyone counts). Complementary: while exactly one cell is
 * hidden, or the hidden cells add up to under n, also hide the smallest shown
 * cell above 0, so subtracting from the total never gives a small count back.
 * With n <= 1 nothing is hidden.
 */
export function suppressGroup(
  values: readonly number[],
  n: number = RSVP_SUMMARY_MIN_COUNT,
  also: readonly boolean[] = [],
): SummaryCount[] {
  if (n <= 1) return [...values];
  const hidden = values.map((value, i) => (value > 0 && value < n) || (value > 0 && also[i] === true));
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

/**
 * Near everyone: a count of people at or above (members - n) all but names
 * the room (QA S2). Only for people counts, only where the room's member
 * count is known (room_join), never for "No room".
 */
export function nearEveryone(value: number, members: number, n: number): boolean {
  if (members <= 0 || value <= 0) return false;
  // The whole membership is always hidden, at any N: it says what every member did.
  if (value >= members) return true;
  return n > 1 && value >= members - n;
}

type People = "going" | "came";
const PEOPLE: People[] = ["going", "came"];

type RawGathering = { gatheringId: string; date: string; going: number; came: number; writeUps: number };
type RawRoom = { roomId: string; members: number; gatherings: RawGathering[]; weeks: Array<{ week: string; writeUps: number }> };

/**
 * Hide across levels (QA S2), per metric:
 * 1. Rooms are one group under the grand total (small, near-everyone, then
 *    complementary). A grand total under n hides itself and every room.
 * 2. A hidden room hides all of its parts (gatherings, and weeks for
 *    write-ups), so its parts never rebuild it, and the grand total minus the
 *    shown rooms never gives a small room back from its parts.
 * 3. A shown room's gatherings (and weeks) are one group under that room's
 *    total, with the same complementary rule.
 */
export function suppressSummary(raw: RawRoom[], n: number = RSVP_SUMMARY_MIN_COUNT): RsvpSummary {
  const metrics = ["going", "came", "writeUps"] as const;
  const totals = { going: 0, came: 0, writeUps: 0 } as SummaryCells;
  const roomCells = raw.map(() => ({ going: 0, came: 0, writeUps: 0 }) as SummaryCells);
  const gatheringCells = raw.map((room) => room.gatherings.map(() => ({ going: 0, came: 0, writeUps: 0 }) as SummaryCells));
  const weekCells: SummaryCount[][] = raw.map((room) => room.weeks.map(() => 0));
  for (const metric of metrics) {
    const people = (PEOPLE as readonly string[]).includes(metric);
    const roomValues = raw.map((room) => room.gatherings.reduce((acc, g) => acc + g[metric], 0));
    const grand = roomValues.reduce((a, b) => a + b, 0);
    const grandHidden = n > 1 && grand > 0 && grand < n;
    totals[metric] = grandHidden ? null : grand;
    const rooms = grandHidden
      ? roomValues.map((v) => (v > 0 ? null : 0))
      : suppressGroup(
          roomValues,
          n,
          raw.map((room, i) => people && nearEveryone(roomValues[i]!, room.members, n)),
        );
    raw.forEach((room, r) => {
      roomCells[r]![metric] = rooms[r]!;
      const parts = room.gatherings.map((g) => g[metric]);
      const shownParts =
        rooms[r] === null
          ? parts.map((v) => (v > 0 ? null : 0))
          : suppressGroup(parts, n, parts.map((v) => people && nearEveryone(v, room.members, n)));
      shownParts.forEach((v, g) => {
        gatheringCells[r]![g]![metric] = v;
      });
      if (metric === "writeUps") {
        const weeks = room.weeks.map((w) => w.writeUps);
        weekCells[r] = rooms[r] === null ? weeks.map((v) => (v > 0 ? null : 0)) : suppressGroup(weeks, n);
      }
    });
  }
  return {
    minCount: n,
    totals,
    rooms: raw.map((room, r) => ({
      roomId: room.roomId,
      ...roomCells[r]!,
      gatherings: room.gatherings.map((g, i) => ({ gatheringId: g.gatheringId, date: g.date, ...gatheringCells[r]![i]! })),
      weeks: room.weeks.map((w, i) => ({ week: w.week, writeUps: weekCells[r]![i]! })),
    })),
  };
}

export async function rsvpSummary(db: Db, now: Date, n: number = RSVP_SUMMARY_MIN_COUNT): Promise<RsvpSummary> {
  // Barred members are counted: no hideBanned here (Josh, Oct 30).
  const gatherings = await db.query<{ id: string; room_id: string; gather_on: string; going: unknown; came: unknown; write_ups: unknown }>(
    `select g.id, g.room_id, g.gather_on,
            (select count(*) from gathering_rsvp r where r.gathering_id = g.id and r.going)::int as going,
            (select count(*) from gathering_rsvp r where r.gathering_id = g.id and r.attended)::int as came,
            (select count(*) from board_post p
              where p.type = 'hosted' and p.removed = false and p.card_id = g.id)::int as write_ups
     from public_gathering g
     where g.removed = false
     order by g.room_id, g.gather_on, g.id`,
  );
  const members = await db.query<{ room_id: string; members: unknown }>(
    `select room_id, count(distinct user_id)::int as members from room_join group by room_id`,
  );
  const memberCount = new Map(members.map((row) => [row.room_id, Number(row.members)]));
  const since = new Date(now.getTime() - RSVP_SUMMARY_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const weeks = await db.query<{ room_id: string; week: string; write_ups: unknown }>(
    `select g.room_id,
            to_char(date_trunc('week', p.on_date::date), 'YYYY-MM-DD') as week,
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
  const byRoom = new Map<string, RawRoom>();
  const room = (id: string) => {
    const found = byRoom.get(id) ?? { roomId: id, members: id ? (memberCount.get(id) ?? 0) : 0, gatherings: [], weeks: [] };
    byRoom.set(id, found);
    return found;
  };
  for (const row of gatherings) {
    room(row.room_id).gatherings.push({
      gatheringId: row.id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(row.gather_on) ? row.gather_on : "",
      going: Number(row.going),
      came: Number(row.came),
      writeUps: Number(row.write_ups),
    });
  }
  for (const row of weeks) room(row.room_id).weeks.push({ week: row.week, writeUps: Number(row.write_ups) });
  return suppressSummary([...byRoom.values()], n);
}
