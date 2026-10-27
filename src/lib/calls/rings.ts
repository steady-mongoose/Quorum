export type IncomingRing = { id: string; roomId: string; fromName: string };

/** Drops anything malformed. Never trusts a room id the page can't route to. */
export function parseRings(body: unknown): IncomingRing[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { rings?: unknown; record?: unknown };
  if (record.record !== false || !Array.isArray(record.rings)) return [];
  const out: IncomingRing[] = [];
  for (const item of record.rings) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; roomId?: unknown; fromName?: unknown };
    if (typeof row.id !== "string" || !/^r\d{1,12}$/.test(row.id)) continue;
    if (typeof row.roomId !== "string" || !/^[a-z0-9-]{1,32}$/.test(row.roomId)) continue;
    if (typeof row.fromName !== "string" || !row.fromName || row.fromName.length > 80) continue;
    out.push({ id: row.id, roomId: row.roomId, fromName: row.fromName });
  }
  return out;
}
