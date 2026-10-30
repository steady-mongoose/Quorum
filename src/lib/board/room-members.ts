import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";
import type { Post, Room } from "./model.ts";
import { roomIncludes } from "./model.ts";

/** One member as the room's members see them. Name order, no count, no score. */
export type MemberRow = {
  id: string;
  name: string;
  steward: boolean;
  joinedOn: string;
  lastPostedOn: string;
  attended: { on: string; host: string; hosted: boolean }[];
  /** "open": a Message button. "wait": the 3-day wait line. "none": nothing. */
  message: MemberMessage;
};

export type MemberMessage = "open" | "wait" | "none";

/** Shown in place of Message while you are new to the room. */
export const MEMBER_WAIT_LINE = "You can message members of this room after 3 days here.";

export type MemberList = { members: MemberRow[]; rollCall: boolean };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseMemberList(value: unknown): MemberList | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { members?: unknown; rollCall?: unknown };
  if (!Array.isArray(body.members)) return null;
  const members = body.members.flatMap((item): MemberRow[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    const attended = Array.isArray(row.attended)
      ? row.attended.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const one = entry as Record<string, unknown>;
          return [{ on: text(one.on), host: text(one.host), hosted: one.hosted === true }];
        })
      : [];
    return [
      {
        id: row.id,
        name: row.name,
        steward: row.steward === true,
        joinedOn: text(row.joinedOn),
        lastPostedOn: text(row.lastPostedOn),
        attended,
        message: row.message === "open" || row.message === "wait" ? row.message : "none",
      },
    ];
  });
  return { members, rollCall: body.rollCall === true };
}

export async function loadRoomMembers(
  roomId: string,
): Promise<{ ok: true; list: MemberList } | { ok: false; error: string; status?: number }> {
  const fallback = "The member list did not load.";
  const response = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
    method: "GET",
    credentials: "include",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const raw =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : fallback;
    return { ok: false, error: userFacingError(raw, fallback), status: response.status };
  }
  const list = parseMemberList(json);
  return list ? { ok: true, list } : { ok: false, error: fallback };
}

function isoDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The demo on this device: everyone who posted in the room, everyone a host's
 * write-up there named, and you if you joined it. Attendance only in a room
 * that takes roll. Message opens for the names in peers.
 */
export function localRoomMembers(
  room: Room,
  posts: Post[],
  me: string,
  peers: ReadonlySet<string> = new Set(),
): MemberList {
  const rollCall = roomIncludes(room, "roll_call");
  const rows = new Map<string, MemberRow>();
  const row = (name: string): MemberRow => {
    const found = rows.get(name);
    if (found) return found;
    const fresh: MemberRow = {
      id: name,
      name,
      steward: false,
      joinedOn: "",
      lastPostedOn: "",
      attended: [],
      message: name !== me && peers.has(name) ? "open" : "none",
    };
    rows.set(name, fresh);
    return fresh;
  };
  if (room.joined && me) row(me);
  for (const post of posts) {
    if (post.room !== room.id || post.removed) continue;
    const author = row(post.author);
    const day = isoDay(post.at);
    if (day > author.lastPostedOn) author.lastPostedOn = day;
    if (!rollCall || post.type !== "hosted" || post.parentId) continue;
    const on = post.on || day;
    author.attended.push({ on, host: post.author, hosted: true });
    for (const name of post.came) {
      if (name !== post.author) row(name).attended.push({ on, host: post.author, hosted: false });
    }
  }
  const members = [...rows.values()]
    .map((item) => ({ ...item, attended: item.attended.sort((a, b) => b.on.localeCompare(a.on)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { members, rollCall };
}
