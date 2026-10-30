export type IncomingRing =
  | { id: string; kind: "room"; roomId: string; fromName: string }
  | { id: string; kind: "dm"; threadId: string; fromName: string };

const THREAD_ID = /^[0-9a-f-]{36}$/;

/** Drops anything malformed. Never trusts a room or thread id the page can't route to. */
export function parseRings(body: unknown): IncomingRing[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { rings?: unknown; record?: unknown };
  if (record.record !== false || !Array.isArray(record.rings)) return [];
  const out: IncomingRing[] = [];
  for (const item of record.rings) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      kind?: unknown;
      roomId?: unknown;
      threadId?: unknown;
      fromName?: unknown;
    };
    if (typeof row.id !== "string" || !/^r\d{1,12}$/.test(row.id)) continue;
    if (typeof row.fromName !== "string" || !row.fromName || row.fromName.length > 80) continue;
    if (row.kind === "dm") {
      if (typeof row.threadId !== "string" || !THREAD_ID.test(row.threadId)) continue;
      out.push({ id: row.id, kind: "dm", threadId: row.threadId, fromName: row.fromName });
      continue;
    }
    if (row.kind !== undefined && row.kind !== "room") continue;
    if (typeof row.roomId !== "string" || !/^[a-z0-9-]{1,32}$/.test(row.roomId)) continue;
    out.push({ id: row.id, kind: "room", roomId: row.roomId, fromName: row.fromName });
  }
  return out;
}

export type SettledHow = "answered" | "declined" | "missed" | "gone";
const HOWS = new Set<string>(["answered", "declined", "missed", "gone"]);

/** What became of recent rings, by id. Only "missed" shows a missed-call line. */
export function parseSettled(body: unknown): Map<string, SettledHow> {
  const out = new Map<string, SettledHow>();
  if (!body || typeof body !== "object") return out;
  const list = (body as { settled?: unknown }).settled;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; how?: unknown };
    if (typeof row.id !== "string" || !/^r\d{1,12}$/.test(row.id)) continue;
    if (typeof row.how !== "string" || !HOWS.has(row.how)) continue;
    out.set(row.id, row.how as SettledHow);
  }
  return out;
}

/** Tabs of the same browser tell each other a ring was answered or declined. */
export const RING_CHANNEL = "avouch-call-rings";

/** What the incoming-call prompt says. */
/** Names longer than this are cut with an ellipsis on screen; aria-labels keep the full name. */
export const NAME_MAX = 40;

export function clampName(name: string, max = NAME_MAX): string {
  const chars = [...name];
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : name;
}

/** "Ann is calling you." Pass `max: Infinity` for the full name. */
export function ringLine(ring: IncomingRing, max = NAME_MAX): string {
  const name = clampName(ring.fromName, max);
  return ring.kind === "dm"
    ? `${name} is calling you.`
    : `${name} is calling you into a room call.`;
}

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Most names a missed-call line lists; older ones drop off. No counts. */
export const MISSED_MAX = 3;

/** Adds a caller to the missed list: no repeats, newest last, at most MISSED_MAX. */
export function addMissed(names: string[], name: string): string[] {
  return [...names.filter((n) => n !== name), name].slice(-MISSED_MAX);
}

/** "Missed call from Ann." or "Missed calls from Ann and Ben." */
export function missedLine(names: string | string[], max = NAME_MAX): string {
  const list = (typeof names === "string" ? [names] : names).map((n) => clampName(n, max));
  return list.length > 1
    ? `Missed calls from ${joinNames(list)}.`
    : `Missed call from ${list[0] ?? ""}.`;
}

/** A ring this person sent was declined or ran out (from the call's poll). */
export type SentRingOutcome = { kind: "declined" | "missed"; name: string };
const outcomeListeners = new Set<(outcome: SentRingOutcome) => void>();

/** Lets the "Call a member" picker clear its "Calling Ann…" line once Ann answers no. */
export function onRingOutcome(listener: (outcome: SentRingOutcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

export function emitRingOutcome(outcome: SentRingOutcome): void {
  for (const listener of [...outcomeListeners]) listener(outcome);
}
