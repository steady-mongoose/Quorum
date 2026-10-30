import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";
import { isGatheringId } from "./public-gathering.ts";
import type { MeetingCard } from "./model.ts";

/**
 * RSVPs on the server (migration 0049). The server already filters what a
 * member may read: a member gets only their own rows, an admin gets all.
 * forViewer (model.ts) still runs in the views as a second layer.
 */

export type ServerRsvp = {
  gatheringId: string;
  userId: string;
  name: string;
  going: boolean;
  attended: boolean;
};

export type RsvpList = { viewer: string; admin: boolean; rsvps: ServerRsvp[] };

export type RsvpMove = { gatheringId: string; going: boolean; attended: boolean };

type Fail = { ok: false; error: string; status: number };

const LOAD_MS = 8000;

async function failure(response: Response, fallback: string): Promise<Fail> {
  const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = typeof json?.error === "string" ? json.error : fallback;
  return { ok: false, status: response.status, error: userFacingError(error, fallback) };
}

function rowFrom(value: unknown): ServerRsvp | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.gatheringId !== "string" || !isGatheringId(row.gatheringId)) return null;
  if (typeof row.userId !== "string" || typeof row.name !== "string") return null;
  return {
    gatheringId: row.gatheringId.toLowerCase(),
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
    return { ok: false, status: 502, error: "RSVPs did not load." };
  }
  const rsvps = Array.isArray(json.rsvps)
    ? json.rsvps.map(rowFrom).filter((row): row is ServerRsvp => row !== null)
    : [];
  return { ok: true, viewer: json.viewer, admin: json.admin === true, rsvps };
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

/** Set or clear my own "going", or say I have been. Nobody else's. */
export async function saveMyRsvp(
  gatheringId: string,
  input: { going?: boolean; attended?: true },
): Promise<{ ok: true } | Fail> {
  const saved = await post(
    `/api/gatherings/${encodeURIComponent(gatheringId)}/rsvp`,
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
    `/api/gatherings/${encodeURIComponent(gatheringId)}/attendance`,
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
 * Put the server's RSVPs on the cards it knows about. Cards the server does
 * not list keep what this browser has. A member's rows are matched by user
 * id and shown under their own name; any row about someone else is dropped
 * unless the server said this viewer is an admin.
 */
export function applyServerRsvps(
  cards: readonly MeetingCard[],
  list: RsvpList,
  input: { me: string; gatheringIds: ReadonlySet<string> },
): MeetingCard[] {
  const byCard = new Map<string, ServerRsvp[]>();
  for (const row of list.rsvps) {
    if (!list.admin && row.userId !== list.viewer) continue;
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

/** Admin roll call: a name on a card back to the member's id. */
export function rsvpIdsByName(list: RsvpList, me: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  if (!list.admin) return out;
  for (const row of list.rsvps) {
    const names = out.get(row.gatheringId) ?? new Map<string, string>();
    names.set(row.userId === list.viewer ? me : row.name, row.userId);
    out.set(row.gatheringId, names);
  }
  return out;
}
