// Theme groups from the server. The list stays in the order the server sent.
// A score, a like, or a reshare on the wire is dropped and never used to sort.

import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";
import { OBJECT_ID, ROOM_ID } from "../media/limits.ts";

export type GroupSummary = {
  id: string;
  name: string;
  about: string;
  joined: boolean;
  admin: boolean;
  /** The inviter's name while this member holds an open invite. */
  inviteFrom?: string;
  audience?: "men" | "women";
};

export type GroupPostRow = {
  id: string;
  groupId: string;
  author: string;
  body: string;
  on: string;
  at: number;
  mark: "sloppy" | "unsupported" | null;
};

export type GroupMarkRow = {
  id: string;
  postId: string;
  author: string;
  by: string;
  mark: "sloppy" | "unsupported" | null;
  reason: string;
  at: number;
};

export type GroupRemovalRow = {
  id: string;
  postId: string;
  author: string;
  reason: "threat" | "porn" | "csam" | "doxxing" | "blasphemy";
  at: number;
};

/** The refusal and the muted line a non-member sees on a group page. */
export const GROUP_INVITE_ONLY =
  "Only members of this group can read and post here. Ask a group admin or steward for an invite.";

export type GroupInviteRow = { id: string; name: string; by: string; at: number };

export type GroupDetail = {
  group: GroupSummary & {
    admins: string[];
    canInvite: boolean;
    invited: boolean;
    invitedBy: string;
  };
  posts: GroupPostRow[];
  marks: GroupMarkRow[];
  removals: GroupRemovalRow[];
  next: string | null;
};

export type GroupRequestRow = {
  id: string;
  groupId: string;
  name: string;
  about: string;
  by: string;
  roomId: string;
  status: "open" | "approved" | "refused";
  note: string;
  at: number;
};

export type GroupAppealRow = {
  id: string;
  postId: string;
  groupId: string;
  by: string;
  text: string;
  status: "open" | "upheld" | "lifted";
  decidedBy: string;
  at: number;
  decidedAt: number | null;
};

/**
 * `mfa` is set when the server refused because an authenticator is needed
 * (mfa_required, mfa_step_up, mfa_locked). A load that fails this way is a
 * quiet note in its own section, not a page alert.
 */
export type GroupCall<T> = { ok: true; value: T } | { ok: false; error: string; mfa?: true };

/** A load that failed. Only a save says "That did not save." */
export const GROUP_LOAD_FAILED = "That did not load.";
export const GROUP_SAVE_FAILED = "That did not save.";
/** The server's own enroll wording, used when its 403 carries no message. */
export const GROUP_MFA_NEEDED = "Turn on an authenticator before using this.";

const HARD = new Set(["threat", "porn", "csam", "doxxing", "blasphemy"]);
const MARKS = new Set(["sloppy", "unsupported"]);

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value;
}

function stamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function markOf(value: unknown): GroupPostRow["mark"] | undefined {
  if (value === null) return null;
  if (typeof value === "string" && MARKS.has(value)) return value as GroupPostRow["mark"];
  return undefined;
}

function summary(value: unknown): GroupSummary | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row.id, 32);
  const name = text(row.name, 80);
  const about = text(row.about, 600);
  if (!id || !ROOM_ID.test(id) || name === null || !name.trim() || about === null) return null;
  if (typeof row.joined !== "boolean" || typeof row.admin !== "boolean") return null;
  return {
    id,
    name,
    about,
    joined: row.joined,
    admin: row.admin,
    ...(typeof row.inviteFrom === "string" && row.inviteFrom.length <= 200 && row.inviteFrom.trim()
      ? { inviteFrom: row.inviteFrom }
      : {}),
    ...(row.audience === "men" || row.audience === "women" ? { audience: row.audience } : {}),
  };
}

/** Keeps server order. Extra rank fields are not copied. */
export function parseGroupList(value: unknown): GroupSummary[] | null {
  const body = record(value);
  if (!body || !Array.isArray(body.groups)) return null;
  const groups: GroupSummary[] = [];
  for (const item of body.groups) {
    const group = summary(item);
    if (!group) return null;
    groups.push(group);
  }
  return groups;
}

export function parseGroupDetail(value: unknown): GroupDetail | null {
  const body = record(value);
  if (!body) return null;
  const groupRow = record(body.group);
  const group = summary(groupRow);
  if (!group || !groupRow || !Array.isArray(groupRow.admins)) return null;
  const admins: string[] = [];
  for (const name of groupRow.admins) {
    const clean = text(name, 200);
    if (clean === null) return null;
    admins.push(clean);
  }
  if (!Array.isArray(body.posts) || !Array.isArray(body.marks) || !Array.isArray(body.removals))
    return null;
  const posts: GroupPostRow[] = [];
  for (const item of body.posts) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const groupId = text(row.groupId, 32);
    const author = text(row.author, 200);
    const postBody = text(row.body, 600);
    const on = text(row.on, 10);
    const at = stamp(row.at);
    const mark = markOf(row.mark);
    if (!id || !OBJECT_ID.test(id) || !groupId || !ROOM_ID.test(groupId)) return null;
    if (author === null || postBody === null || on === null || at === null || mark === undefined)
      return null;
    posts.push({ id, groupId, author, body: postBody, on, at, mark });
  }
  const marks: GroupMarkRow[] = [];
  for (const item of body.marks) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const postId = text(row.postId, 80);
    const author = text(row.author, 200);
    const by = text(row.by, 200);
    const reason = text(row.reason, 1000);
    const at = stamp(row.at);
    const mark = markOf(row.mark);
    if (!id || !OBJECT_ID.test(id) || !postId || !OBJECT_ID.test(postId)) return null;
    if (author === null || by === null || reason === null || at === null || mark === undefined)
      return null;
    marks.push({ id, postId, author, by, mark, reason, at });
  }
  const removals: GroupRemovalRow[] = [];
  for (const item of body.removals) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const postId = text(row.postId, 80);
    const author = text(row.author, 200);
    const reason = text(row.reason, 32);
    const at = stamp(row.at);
    if (!id || !OBJECT_ID.test(id) || !postId || !OBJECT_ID.test(postId)) return null;
    if (author === null || reason === null || !HARD.has(reason) || at === null) return null;
    removals.push({ id, postId, author, reason: reason as GroupRemovalRow["reason"], at });
  }
  if (body.next !== null && (typeof body.next !== "string" || body.next.length > 120)) return null;
  return {
    group: {
      ...group,
      admins,
      canInvite: groupRow.canInvite === true,
      invited: groupRow.invited === true,
      invitedBy:
        typeof groupRow.invitedBy === "string" && groupRow.invitedBy.length <= 200
          ? groupRow.invitedBy
          : "",
    },
    posts,
    marks,
    removals,
    next: body.next,
  };
}

export function parseGroupRequests(value: unknown): GroupRequestRow[] | null {
  const body = record(value);
  if (!body || !Array.isArray(body.requests)) return null;
  const requests: GroupRequestRow[] = [];
  for (const item of body.requests) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const groupId = text(row.groupId, 32);
    const name = text(row.name, 80);
    const about = text(row.about, 600);
    const by = text(row.by, 200);
    const roomId = text(row.roomId, 32);
    const note = text(row.note, 1000);
    const at = stamp(row.at);
    const status = row.status;
    if (!id || !OBJECT_ID.test(id) || !groupId || !ROOM_ID.test(groupId)) return null;
    if (name === null || about === null || by === null || roomId === null || !ROOM_ID.test(roomId))
      return null;
    if (note === null || at === null) return null;
    if (status !== "open" && status !== "approved" && status !== "refused") return null;
    requests.push({ id, groupId, name, about, by, roomId, status, note, at });
  }
  return requests;
}

export function parseGroupAppeals(value: unknown): GroupAppealRow[] | null {
  const body = record(value);
  if (!body || !Array.isArray(body.appeals)) return null;
  const appeals: GroupAppealRow[] = [];
  for (const item of body.appeals) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const postId = text(row.postId, 80);
    const groupId = text(row.groupId, 32);
    const by = text(row.by, 200);
    const appealText = text(row.text, 600);
    const decidedBy = text(row.decidedBy, 200);
    const at = stamp(row.at);
    const status = row.status;
    if (!id || !OBJECT_ID.test(id) || !postId || !OBJECT_ID.test(postId)) return null;
    if (!groupId || !ROOM_ID.test(groupId) || by === null || appealText === null) return null;
    if (decidedBy === null || at === null) return null;
    if (status !== "open" && status !== "upheld" && status !== "lifted") return null;
    if (row.decidedAt !== null && stamp(row.decidedAt) === null) return null;
    appeals.push({
      id,
      postId,
      groupId,
      by,
      text: appealText,
      status,
      decidedBy,
      at,
      decidedAt: row.decidedAt === null ? null : stamp(row.decidedAt),
    });
  }
  return appeals;
}

/** Names stay in the order given. An empty list has no line. */
export function runByLine(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return `Run by ${clean[0]}`;
  if (clean.length === 2) return `Run by ${clean[0]} and ${clean[1]}`;
  return `Run by ${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

const MFA_CODES = new Set(["mfa_required", "mfa_step_up", "mfa_locked"]);

/**
 * The server's own sentence when it sent one: `error` for the group routes,
 * `message` for the authenticator gate. A bare code falls back.
 */
export function groupFailure(json: unknown, fallback: string): { error: string; mfa?: true } {
  const row = record(json);
  const error = row && typeof row.error === "string" ? row.error.trim() : "";
  const message = row && typeof row.message === "string" ? row.message.trim() : "";
  if (MFA_CODES.has(error)) {
    return { error: userFacingError(message, GROUP_MFA_NEEDED), mfa: true };
  }
  if (error === "banned") return { error: "You are barred from that group." };
  const said = userFacingError(error, "");
  if (said) return { error: said };
  return { error: userFacingError(message, fallback) };
}

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string; mfa?: true }> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      method,
      credentials: "include",
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: "The server did not answer." };
  }
  let json: unknown = null;
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      json = await response.json();
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const fallback = method === "GET" ? GROUP_LOAD_FAILED : GROUP_SAVE_FAILED;
    return { ok: false, ...groupFailure(json, fallback) };
  }
  return { ok: true, json };
}

export async function fetchGroups(): Promise<GroupCall<GroupSummary[]>> {
  const result = await call("GET", "/api/groups");
  if (!result.ok) return result;
  const groups = parseGroupList(result.json);
  if (!groups) return { ok: false, error: "The group list did not load." };
  return { ok: true, value: groups };
}

export async function fetchGroup(id: string, cursor = ""): Promise<GroupCall<GroupDetail>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const result = await call("GET", `/api/groups/${encodeURIComponent(id)}${query}`);
  if (!result.ok) return result;
  const detail = parseGroupDetail(result.json);
  if (!detail) return { ok: false, error: "That group did not load." };
  return { ok: true, value: detail };
}

export async function fetchGroupRequests(): Promise<GroupCall<GroupRequestRow[]>> {
  const result = await call("GET", "/api/group-requests");
  if (!result.ok) return result;
  const requests = parseGroupRequests(result.json);
  if (!requests) return { ok: false, error: "The requests did not load." };
  return { ok: true, value: requests };
}

export async function fetchGroupAppeals(): Promise<GroupCall<GroupAppealRow[]>> {
  const result = await call("GET", "/api/group-appeals");
  if (!result.ok) return result;
  const appeals = parseGroupAppeals(result.json);
  if (!appeals) return { ok: false, error: "The appeals did not load." };
  return { ok: true, value: appeals };
}

export function parseGroupInvites(value: unknown): GroupInviteRow[] | null {
  const body = record(value);
  if (!body || !Array.isArray(body.invites)) return null;
  const invites: GroupInviteRow[] = [];
  for (const item of body.invites) {
    const row = record(item);
    if (!row) return null;
    const id = text(row.id, 80);
    const name = text(row.name, 200);
    const by = text(row.by, 200);
    const at = stamp(row.at);
    if (!id || !OBJECT_ID.test(id) || name === null || by === null || at === null) return null;
    invites.push({ id, name, by, at });
  }
  return invites;
}

export async function fetchGroupInvites(id: string): Promise<GroupCall<GroupInviteRow[]>> {
  const result = await call("GET", `/api/groups/${encodeURIComponent(id)}/invites`);
  if (!result.ok) return result;
  const invites = parseGroupInvites(result.json);
  if (!invites) return { ok: false, error: "The invites did not load." };
  return { ok: true, value: invites };
}

export async function postGroup(
  path: string,
  body: Record<string, unknown>,
): Promise<GroupCall<true>> {
  const result = await call("POST", path, body);
  if (!result.ok) return result;
  return { ok: true, value: true };
}
