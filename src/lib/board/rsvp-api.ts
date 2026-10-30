import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";
import { isGatheringId } from "./public-gathering.ts";
import type { MeetingCard } from "./model.ts";

/**
 * RSVPs on the server (migration 0049). The server filters what each viewer
 * may read (Josh, Oct 29, 9:04 PM ET): an admin gets every row; a host gets
 * every row for their own gatherings; a steward gets who is going in the
 * rooms they steward; anyone else gets only their own rows. applyServerRsvps
 * repeats that rule, and forViewer (model.ts) runs in the views as a third
 * layer.
 */

/** The server's one code for "0049 is not applied yet". Only this keeps a change on the device. */
export const RSVP_NOT_READY = "rsvp-not-ready";
export const RSVP_NOT_SAVED = "Your RSVP was not saved. Try again in a moment.";
export const CAME_NOT_SAVED = "Who came was not saved. Try again in a moment.";

export type ServerRsvp = {
  gatheringId: string;
  roomId: string;
  userId: string;
  name: string;
  going: boolean;
  attended: boolean;
};

export type RsvpList = {
  viewer: string;
  admin: boolean;
  /** Gathering ids this viewer hosts. */
  hosts: string[];
  /** Rooms this viewer stewards (admins are not listed). */
  stewardRooms: string[];
  rsvps: ServerRsvp[];
};

/** One person on a roll call, by server id. Two members may share a name. */
export type RollPerson = { userId: string; name: string };

export type RsvpMove = { gatheringId: string; going: boolean; attended: boolean };

/**
 * `code` is the server's raw error, so a caller can tell rsvp-not-ready from a
 * dropped connection. `oldApi` is a 404 without the RSVP routes' marker: an
 * API from before this change (the client shipped first).
 */
export type RsvpFail = { ok: false; error: string; status: number; code: string; oldApi?: boolean };

/**
 * Keep the change on this device only when the server cannot hold RSVPs yet:
 * 0049 is not applied (rsvp-not-ready), or the API predates the RSVP routes.
 * Anything else, a dropped connection included, is a failure.
 */
export function keptOnDevice(result: { ok: true } | RsvpFail): boolean {
  return result.ok || result.code === RSVP_NOT_READY || result.oldApi === true;
}
type Fail = RsvpFail;

const LOAD_MS = 8000;

async function failure(response: Response, fallback: string): Promise<Fail> {
  const json = (await response.json().catch(() => null)) as { error?: unknown; api?: unknown } | null;
  const error = typeof json?.error === "string" ? json.error : "";
  return {
    ok: false,
    status: response.status,
    code: error,
    oldApi: response.status === 404 && json?.api !== "rsvp",
    error: userFacingError(error || fallback, fallback),
  };
}

function rowFrom(value: unknown): ServerRsvp | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.gatheringId !== "string" || !isGatheringId(row.gatheringId)) return null;
  if (typeof row.userId !== "string" || typeof row.name !== "string") return null;
  return {
    gatheringId: row.gatheringId.toLowerCase(),
    roomId: typeof row.roomId === "string" ? row.roomId : "",
    userId: row.userId,
    name: row.name,
    going: row.going === true,
    attended: row.attended === true,
  };
}

export async function loadRsvps(): Promise<({ ok: true } & RsvpList) | Fail> {
  const response = await apiFetch("/api/rsvps", {
    credentials: "include",
    signal: AbortSignal.timeout(LOAD_MS),
  });
  if (!response.ok) return failure(response, "RSVPs did not load.");
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json.viewer !== "string") {
    return { ok: false, status: 502, code: "", error: "RSVPs did not load." };
  }
  const rsvps = Array.isArray(json.rsvps)
    ? json.rsvps.map(rowFrom).filter((row): row is ServerRsvp => row !== null)
    : [];
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    ok: true,
    viewer: json.viewer,
    admin: json.admin === true,
    hosts: strings(json.hosts).map((id) => id.toLowerCase()),
    stewardRooms: strings(json.stewardRooms),
    rsvps,
  };
}

async function post(path: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return failure(response, fallback);
  return { ok: true as const, json: (await response.json().catch(() => null)) as unknown };
}

/** Set or clear my own "going". `attended` is for the host (the lister) or an admin; anyone else gets 403. */
export async function saveMyRsvp(
  gatheringId: string,
  input: { going?: boolean; attended?: true },
): Promise<{ ok: true } | Fail> {
  const saved = await post(
    `/api/gatherings/${encodeURIComponent(gatheringId.toLowerCase())}/rsvp`,
    input,
    "Your RSVP was not saved.",
  );
  return saved.ok ? { ok: true } : saved;
}

/** Host or admin: who came, and end this date so every "going" resets. */
export async function saveAttendance(
  gatheringId: string,
  input: { userIds: string[]; close: boolean },
): Promise<{ ok: true } | Fail> {
  const saved = await post(
    `/api/gatherings/${encodeURIComponent(gatheringId.toLowerCase())}/attendance`,
    input,
    "Who came was not saved.",
  );
  return saved.ok ? { ok: true } : saved;
}

export async function moveRsvps(entries: RsvpMove[]): Promise<{ ok: true } | Fail> {
  const saved = await post("/api/rsvps/move", { entries }, "Your RSVPs were not moved.");
  return saved.ok ? { ok: true } : saved;
}

/** The most entries one move sends. The server takes the same. */
export const MOVE_MAX = 200;

/**
 * What this browser holds for `me`: only my own name, only on cards that are
 * server gatherings. Sample cards (ids like "brief") are never sent.
 */
export function deviceRsvpMoves(cards: readonly MeetingCard[], me: string): RsvpMove[] {
  const name = me.trim();
  if (!name) return [];
  const moves: RsvpMove[] = [];
  for (const card of cards) {
    if (!isGatheringId(card.id)) continue;
    const going = (card.going ?? []).includes(name);
    const attended = (card.wentBy ?? []).includes(name);
    if (going || attended) moves.push({ gatheringId: card.id.toLowerCase(), going, attended });
  }
  return moves.slice(0, MOVE_MAX);
}

/**
 * The same rule as the server's SQL, for one row: may this viewer see it,
 * and may they see its "came" flag?
 */
export function rowSight(list: RsvpList, row: ServerRsvp): { see: boolean; came: boolean } {
  if (list.admin || row.userId === list.viewer || list.hosts.includes(row.gatheringId)) {
    return { see: true, came: true };
  }
  // A steward reads going and came in their rooms (Josh, 9:24 PM); marking stays with the host and admins.
  if (row.roomId !== "" && list.stewardRooms.includes(row.roomId)) {
    return { see: true, came: true };
  }
  return { see: false, came: false };
}

/**
 * Put the server's RSVPs on the cards it knows about. Cards the server does
 * not list keep what this browser has. My own rows show under my own name.
 * A row this viewer should not see is dropped even if the server sent it.
 */
export function applyServerRsvps(
  cards: readonly MeetingCard[],
  list: RsvpList,
  input: { me: string; gatheringIds: ReadonlySet<string> },
): MeetingCard[] {
  const byCard = new Map<string, ServerRsvp[]>();
  for (const raw of list.rsvps) {
    const sight = rowSight(list, raw);
    if (!sight.see) continue;
    const row = sight.came ? raw : { ...raw, attended: false };
    const rows = byCard.get(row.gatheringId) ?? [];
    rows.push(row);
    byCard.set(row.gatheringId, rows);
  }
  const label = (row: ServerRsvp) => (row.userId === list.viewer ? input.me : row.name);
  return cards.map((card) => {
    const id = card.id.toLowerCase();
    if (!input.gatheringIds.has(id)) return card;
    const rows = byCard.get(id) ?? [];
    return {
      ...card,
      going: [...new Set(rows.filter((row) => row.going).map(label))],
      wentBy: [...new Set(rows.filter((row) => row.attended).map(label))],
    };
  });
}

/**
 * Roll call, by member id: who is going, for each gathering this viewer may
 * mark (they host it, or they are an admin). Stewards and members get none.
 */
export function rollCallPeople(list: RsvpList, me: string): Record<string, RollPerson[]> {
  const out: Record<string, RollPerson[]> = {};
  for (const row of list.rsvps) {
    if (!row.going) continue;
    if (!list.admin && !list.hosts.includes(row.gatheringId)) continue;
    const people = out[row.gatheringId] ?? [];
    people.push({ userId: row.userId, name: row.userId === list.viewer ? me : row.name });
    out[row.gatheringId] = people;
  }
  return out;
}

/**
 * The ids to send for a roll call. `picked` holds member ids from the pills
 * when the server gave a roll call. Without one (an older device list), a
 * name maps to an id only when exactly one going member has that name.
 */
export function cameIdsFor(
  people: readonly RollPerson[] | undefined,
  input: { picked?: readonly string[]; names: readonly string[] },
): string[] {
  if (!people) return [];
  const known = new Set(people.map((person) => person.userId));
  if (input.picked) return [...new Set(input.picked.filter((id) => known.has(id)))];
  const ids: string[] = [];
  for (const name of new Set(input.names)) {
    const matches = people.filter((person) => person.name === name);
    if (matches.length === 1) ids.push(matches[0]!.userId);
  }
  return ids;
}

/**
 * The roll call pills for one card: the server's people (by id) when it gave
 * a roll call, otherwise this device's going names (an offline board).
 */
export function rollCallFor(
  card: MeetingCard,
  rollCall: Readonly<Record<string, RollPerson[]>>,
): RollPerson[] {
  const people = rollCall[card.id.toLowerCase()];
  if (people) return people;
  return [...new Set(card.going)].map((name) => ({ userId: "", name }));
}

/** A pill's key: the member id, or the name on an offline board. */
export function rollKey(person: RollPerson): string {
  return person.userId || `name:${person.name}`;
}

/** Toggle one pill. Returns the new keys, the names for the write-up, and the ids for the server. */
export function toggleRoll(
  people: readonly RollPerson[],
  keys: readonly string[],
  person: RollPerson,
): { keys: string[]; came: string[]; cameIds: string[] } {
  const key = rollKey(person);
  const next = keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
  const picked = people.filter((item) => next.includes(rollKey(item)));
  return {
    keys: next,
    came: [...new Set(picked.map((item) => item.name))],
    cameIds: picked.map((item) => item.userId).filter(Boolean),
  };
}
