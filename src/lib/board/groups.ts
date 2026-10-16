// Theme groups sit beside town and congregation rooms. A member requests one.
// A steward of a room they have joined approves it, and the requester becomes
// the admin. Join and leave use the same `{ kind: "group", id }` list Home
// already sorts. A group admin moderates under the room guard rails: a mark
// is logged and does not reorder, and a hard removal is only threat,
// pornography, or CSAM. Stewards hear appeals. The interface is English.
// Notes are not checked for language. No likes, reshares, or scores.

import { isRoomSteward, type AccessRow } from "./access.ts";
import type { HomeEntry } from "./home.ts";
import type { HardRule, Mark } from "./model.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseIsoDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const next = new Date(date.getTime() + days * DAY_MS);
  const y = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${y}-${month}-${day}`;
}

export type ThemeGroup = {
  id: string;
  name: string;
  about: string;
  /** The member who moderates this group. */
  admin: string;
  at: number;
};

export type GroupNote = {
  id: string;
  groupId: string;
  author: string;
  body: string;
  /** Upcoming gathering, as YYYY-MM-DD, or "" when the note has no date. */
  on: string;
  at: number;
  mark: Mark | null;
  removed: boolean;
  removedFor: HardRule | null;
};

export type GroupModerationRow = {
  id: string;
  noteId: string;
  groupId: string;
  by: string;
  action: "mark" | "clear" | "remove";
  mark: Mark | null;
  reason: string;
  at: number;
};

export type GroupAppeal = {
  id: string;
  noteId: string;
  groupId: string;
  by: string;
  text: string;
  at: number;
  status: "open" | "upheld" | "lifted";
  decidedBy: string;
  decidedAt: number | null;
};

export type GroupResult<T> = { ok: true; value: T } | { ok: false; error: string };

const HARD_RULES: readonly HardRule[] = ["threat", "porn", "csam"];

export const SEED_GROUPS: readonly ThemeGroup[] = [
  { id: "carpentry", name: "Carpentry", about: "Benches, frames, and shop nights that are not tied to one town.", admin: "Tom", at: 1 },
  { id: "gardening", name: "Gardening", about: "Beds, soil, and what is coming up.", admin: "Ruth", at: 2 },
  { id: "brewing", name: "Brewing", about: "Homebrew and the pour.", admin: "Luis", at: 3 },
  { id: "literary", name: "Literary society", about: "One book, a few chapters, a table. The discussion is the meeting.", admin: "Maria", at: 4 },
  { id: "christian-businesses", name: "Christian-run businesses", about: "Shops and trades run by members of a church. A note here is not a voucher.", admin: "Dale", at: 5 },
];

export function groupIdFor(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function written(text: string, empty: string): GroupResult<string> {
  const body = text.trim();
  if (!body) return { ok: false, error: empty };
  return { ok: true, value: body };
}

/** A member asks. The group does not exist until a steward of their room approves. */
export type GroupRequest = {
  id: string;
  groupId: string;
  name: string;
  about: string;
  by: string;
  /** A room the requester has joined. A steward of this room decides. */
  roomId: string;
  at: number;
  status: "open" | "approved" | "refused";
  decidedBy: string;
  decidedAt: number | null;
  note: string;
};

export function requestGroup(
  actor: string,
  joinedRoomIds: readonly string[],
  groups: readonly ThemeGroup[],
  requests: readonly GroupRequest[],
  draft: { name: string; about: string; roomId: string },
  now: number,
  id: string,
): GroupResult<GroupRequest> {
  const by = actor.trim();
  if (!by) return { ok: false, error: "A member asks for a group." };
  const titled = written(draft.name, "Name the group.");
  if (!titled.ok) return titled;
  const blurb = written(draft.about, "Say what the group is.");
  if (!blurb.ok) return blurb;
  const roomId = draft.roomId.trim();
  if (!roomId || !joinedRoomIds.includes(roomId)) return { ok: false, error: "Ask from a room you have joined." };
  const groupId = groupIdFor(titled.value);
  if (!groupId) return { ok: false, error: "Name the group." };
  if (groups.some((group) => group.id === groupId)) return { ok: false, error: "That group is already here." };
  if (requests.some((row) => row.groupId === groupId && row.status === "open")) return { ok: false, error: "That group already has an open request." };
  return {
    ok: true,
    value: { id, groupId, name: titled.value, about: blurb.value, by, roomId, at: now, status: "open", decidedBy: "", decidedAt: null, note: "" },
  };
}

/** Approve creates the group and makes the requester its admin. The request row keeps the decision. */
export function decideGroupRequest(
  actor: string,
  log: readonly AccessRow[],
  groups: readonly ThemeGroup[],
  request: GroupRequest | undefined,
  decision: "approved" | "refused",
  note: string,
  now: number,
): GroupResult<{ request: GroupRequest; group: ThemeGroup | null }> {
  const by = actor.trim();
  if (!request || request.status !== "open") return { ok: false, error: "That request is not open." };
  if (!isRoomSteward(log, by, request.roomId)) return { ok: false, error: "A steward of that room decides a group." };
  if (by === request.by) return { ok: false, error: "Someone else decides a group." };
  const reason = note.trim();
  if (!reason) return { ok: false, error: "Write the decision down." };
  if (decision === "refused") {
    return { ok: true, value: { request: { ...request, status: "refused", decidedBy: by, decidedAt: now, note: reason }, group: null } };
  }
  if (groups.some((group) => group.id === request.groupId)) return { ok: false, error: "That group is already here." };
  const group: ThemeGroup = { id: request.groupId, name: request.name, about: request.about, admin: request.by, at: now };
  return { ok: true, value: { request: { ...request, status: "approved", decidedBy: by, decidedAt: now, note: reason }, group } };
}

export function fileGroupNote(
  actor: string,
  group: ThemeGroup | undefined,
  joined: boolean,
  draft: { body: string; on: string },
  now: number,
  id: string,
): GroupResult<GroupNote> {
  if (!group) return { ok: false, error: "That group is not here." };
  const who = actor.trim();
  if (!who || (!joined && who !== group.admin)) return { ok: false, error: "Join the group before you post." };
  const body = written(draft.body, "Write something.");
  if (!body.ok) return body;
  const on = draft.on.trim();
  if (on && !isIsoDate(on)) return { ok: false, error: "The date has to be a calendar day." };
  return {
    ok: true,
    value: { id, groupId: group.id, author: who, body: body.value, on, at: now, mark: null, removed: false, removedFor: null },
  };
}

/** Newest first. A mark does not move a note. Removed notes stay out of this list. */
export function groupFeed(notes: readonly GroupNote[], groupId: string): GroupNote[] {
  return notes.filter((note) => note.groupId === groupId && !note.removed).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function markGroupNote(
  actor: string,
  group: ThemeGroup | undefined,
  note: GroupNote | undefined,
  mark: Mark | null,
  now: number,
  id: string,
): GroupResult<{ note: GroupNote; row: GroupModerationRow }> {
  if (!group || !note || note.groupId !== group.id) return { ok: false, error: "That note is not in this group." };
  if (actor.trim() !== group.admin) return { ok: false, error: "Only the group admin can mark a note." };
  if (note.removed) return { ok: false, error: "That note was removed." };
  const next: GroupNote = { ...note, mark };
  const row: GroupModerationRow = {
    id,
    noteId: note.id,
    groupId: group.id,
    by: actor.trim(),
    action: mark ? "mark" : "clear",
    mark,
    reason: mark ?? "",
    at: now,
  };
  return { ok: true, value: { note: next, row } };
}

export function removeGroupNote(
  actor: string,
  group: ThemeGroup | undefined,
  note: GroupNote | undefined,
  reason: HardRule,
  now: number,
  id: string,
): GroupResult<{ note: GroupNote; row: GroupModerationRow }> {
  if (!group || !note || note.groupId !== group.id) return { ok: false, error: "That note is not in this group." };
  if (actor.trim() !== group.admin) return { ok: false, error: "Only the group admin can remove a note." };
  if (!HARD_RULES.includes(reason)) return { ok: false, error: "A group admin can remove a note only for a threat, pornography, or child sexual abuse material." };
  if (note.removed) return { ok: false, error: "That note was already removed." };
  const next: GroupNote = { ...note, removed: true, removedFor: reason };
  const row: GroupModerationRow = { id, noteId: note.id, groupId: group.id, by: actor.trim(), action: "remove", mark: null, reason, at: now };
  return { ok: true, value: { note: next, row } };
}

export function appealGroupNote(
  actor: string,
  note: GroupNote | undefined,
  appeals: readonly GroupAppeal[],
  text: string,
  now: number,
  id: string,
): GroupResult<GroupAppeal> {
  if (!note) return { ok: false, error: "That note is not here." };
  if (actor.trim() !== note.author) return { ok: false, error: "Only the author can appeal." };
  if (!note.mark && !note.removed) return { ok: false, error: "There is nothing to appeal." };
  if (appeals.some((appeal) => appeal.noteId === note.id && appeal.status === "open")) return { ok: false, error: "That appeal is already with the stewards." };
  const body = written(text, "Write the appeal.");
  if (!body.ok) return body;
  return {
    ok: true,
    value: { id, noteId: note.id, groupId: note.groupId, by: actor.trim(), text: body.value, at: now, status: "open", decidedBy: "", decidedAt: null },
  };
}

/** A steward upholds the mark or lifts it. Lifting clears the mark and puts a removed note back. */
export function decideGroupAppeal(
  actor: string,
  steward: boolean,
  appeal: GroupAppeal | undefined,
  note: GroupNote | undefined,
  decision: "upheld" | "lifted",
  now: number,
): GroupResult<{ appeal: GroupAppeal; note: GroupNote }> {
  if (!steward) return { ok: false, error: "Only a steward can decide an appeal." };
  if (!appeal || appeal.status !== "open" || !note || note.id !== appeal.noteId) return { ok: false, error: "That appeal is not open." };
  const who = actor.trim();
  if (!who) return { ok: false, error: "Only a steward can decide an appeal." };
  if (who === appeal.by) return { ok: false, error: "A steward does not decide their own appeal." };
  const nextAppeal: GroupAppeal = { ...appeal, status: decision, decidedBy: who, decidedAt: now };
  const nextNote: GroupNote = decision === "lifted" ? { ...note, mark: null, removed: false, removedFor: null } : note;
  return { ok: true, value: { appeal: nextAppeal, note: nextNote } };
}

/**
 * Home's joined tier. Only a gathering dated inside the next seven days.
 * A note with no date, or a past note, stays on the group page.
 */
export function groupHomeEntries(notes: readonly GroupNote[], today: string, days = 7): HomeEntry[] {
  const end = addDays(today, days);
  const entries: HomeEntry[] = [];
  for (const note of notes) {
    if (note.removed || !note.on || !isIsoDate(note.on)) continue;
    if (note.on < today || note.on >= end) continue;
    const at = parseIsoDate(note.on)?.getTime();
    if (at == null) continue;
    entries.push({ id: note.id, at, place: { kind: "group", id: note.groupId } });
  }
  return entries;
}
