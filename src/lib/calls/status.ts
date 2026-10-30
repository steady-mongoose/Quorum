import { parseIceUrl } from "./ice.ts";

export type CallPeerRow = { id: string; name: string; generation: number };

export type CallIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/** The caller hears that the person they rang declined or did not answer. */
export type RingOutcome = { kind: "declined" | "missed"; name: string };

/** Drops anything malformed. A missing list is an empty one. */
export function parseRingOutcomes(value: unknown): RingOutcome[] {
  if (!Array.isArray(value)) return [];
  const out: RingOutcome[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { kind?: unknown; name?: unknown };
    if (row.kind !== "declined" && row.kind !== "missed") continue;
    if (typeof row.name !== "string" || !row.name || row.name.length > 80) continue;
    out.push({ kind: row.kind, name: row.name });
  }
  return out;
}

export type CallWire = {
  id: number;
  from: string;
  kind: "offer" | "answer" | "ice";
  payload: Record<string, unknown>;
};

/** The page shows the button only when the API has calls on and recording off. */
export function callsAreAvailable(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as { enabled?: unknown; record?: unknown };
  return record.enabled === true && record.record === false;
}

/** Only an explicit record: true gets the recording copy. Malformed replies are refused with other copy. */
export function claimsRecording(body: unknown): boolean {
  return (
    Boolean(body) && typeof body === "object" && (body as { record?: unknown }).record === true
  );
}

/** Missing or true both refuse. The server sends false on every call response. */
export function refusesRecording(body: unknown): boolean {
  if (!body || typeof body !== "object") return true;
  return (body as { record?: unknown }).record !== false;
}

function peerRows(value: unknown): CallPeerRow[] | null {
  if (!Array.isArray(value)) return null;
  const peers: CallPeerRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as { id?: unknown; name?: unknown; generation?: unknown };
    if (typeof row.id !== "string" || typeof row.name !== "string") return null;
    if (!row.id || row.name.length > 80) return null;
    if (
      typeof row.generation !== "number" ||
      !Number.isInteger(row.generation) ||
      row.generation < 1
    ) {
      return null;
    }
    peers.push({ id: row.id, name: row.name, generation: row.generation });
  }
  return peers;
}

function iceServer(value: unknown): CallIceServer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { urls?: unknown; username?: unknown; credential?: unknown };
  const urls =
    typeof row.urls === "string" ? [row.urls] : Array.isArray(row.urls) ? row.urls : null;
  if (
    !urls ||
    urls.length === 0 ||
    urls.some((item) => typeof item !== "string" || !parseIceUrl(item, { allowCloudflare: true }))
  ) {
    return null;
  }
  const server: CallIceServer = {
    urls: urls.length === 1 ? (urls[0] as string) : (urls as string[]),
  };
  const hasUser = row.username !== undefined;
  const hasCredential = row.credential !== undefined;
  if (hasUser !== hasCredential) return null;
  if (hasUser) {
    if (typeof row.username !== "string" || typeof row.credential !== "string") return null;
    if (!row.username || !row.credential) return null;
    server.username = row.username;
    server.credential = row.credential;
  }
  return server;
}

export function parseCallJoin(body: unknown): {
  selfId: string;
  peers: CallPeerRow[];
  iceServers: CallIceServer[];
  cursor: number;
  ringing: boolean;
  /** Set when the call opened but the other person was not rung (ring cap). */
  ringError?: string;
} | null {
  if (refusesRecording(body) || !body || typeof body !== "object") return null;
  const record = body as {
    ringing?: unknown;
    ringError?: unknown;
    selfId?: unknown;
    peers?: unknown;
    iceServers?: unknown;
    cursor?: unknown;
  };
  if (typeof record.selfId !== "string" || !record.selfId) return null;
  if (typeof record.cursor !== "number" || !Number.isInteger(record.cursor) || record.cursor < 0) {
    return null;
  }
  const peers = peerRows(record.peers);
  const servers = iceServers(record.iceServers);
  if (!peers || !servers) return null;
  return {
    selfId: record.selfId,
    peers,
    iceServers: servers,
    cursor: record.cursor,
    ringing: record.ringing === true,
    ...(typeof record.ringError === "string" &&
    record.ringError.length > 0 &&
    record.ringError.length <= 200
      ? { ringError: record.ringError }
      : {}),
  };
}

function iceServers(value: unknown): CallIceServer[] | null {
  if (!Array.isArray(value)) return null;
  const servers: CallIceServer[] = [];
  for (const item of value) {
    const server = iceServer(item);
    if (!server) return null;
    servers.push(server);
  }
  return servers;
}

export function parseCallPoll(body: unknown): {
  peers: CallPeerRow[];
  signals: CallWire[];
  cursor: number;
  iceServers?: CallIceServer[];
  outcomes: RingOutcome[];
  /** True while a ring this person sent into the call is still unanswered. */
  ringsOut: boolean;
} | null {
  if (refusesRecording(body) || !body || typeof body !== "object") return null;
  const record = body as {
    peers?: unknown;
    signals?: unknown;
    cursor?: unknown;
    iceServers?: unknown;
    rings?: unknown;
    ringsOut?: unknown;
  };
  if (typeof record.cursor !== "number" || !Number.isInteger(record.cursor) || record.cursor < 0) {
    return null;
  }
  const peers = peerRows(record.peers);
  if (!peers || !Array.isArray(record.signals)) return null;
  const signals: CallWire[] = [];
  for (const item of record.signals) {
    if (!item || typeof item !== "object") return null;
    const row = item as { id?: unknown; from?: unknown; kind?: unknown; payload?: unknown };
    if (typeof row.id !== "number" || typeof row.from !== "string") return null;
    if (row.kind !== "offer" && row.kind !== "answer" && row.kind !== "ice") return null;
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return null;
    signals.push({
      id: row.id,
      from: row.from,
      kind: row.kind,
      payload: row.payload as Record<string, unknown>,
    });
  }
  const outcomes = parseRingOutcomes(record.rings);
  const ringsOut = record.ringsOut === true;
  if (record.iceServers === undefined) {
    return { peers, signals, cursor: record.cursor, outcomes, ringsOut };
  }
  const servers = iceServers(record.iceServers);
  if (!servers) return null;
  return { peers, signals, cursor: record.cursor, iceServers: servers, outcomes, ringsOut };
}
