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

/** What the incoming-call prompt says. */
export function ringLine(ring: IncomingRing): string {
  return ring.kind === "dm"
    ? `${ring.fromName} is calling you.`
    : `${ring.fromName} is calling you to a room call.`;
}

export function missedLine(name: string): string {
  return `Missed call from ${name}.`;
}
