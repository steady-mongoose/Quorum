// Home is a fixed list. Joined rooms, then the member's ZIP town, then the
// member's congregation, then wider regions. A room is listed once, in the
// nearest tier. Nothing here reads a reply, a mark, an RSVP, or a score.
//
// Council-approved candidate and business posts are a separate lift above
// those rooms. The lift is the label, once. It is not a ranking.

import { COUNCIL_APPROVED_LABEL } from "./council.ts";

export { COUNCIL_APPROVED_LABEL };

export type ScopeKind = "topic" | "town" | "congregation" | "region";
export type HomeTier = "joined" | "town" | "congregation" | "region";
export type HomeRank = HomeTier | "council";

export const HOME_TIERS = ["joined", "town", "congregation", "region"] as const;

export const HOME_SECTION_LABEL: Record<HomeRank, string> = {
  council: COUNCIL_APPROVED_LABEL,
  joined: "What you've joined",
  town: "Your town",
  congregation: "Your congregation",
  region: "Farther out",
};

const RANK: Record<HomeRank, number> = {
  council: 0,
  joined: 1,
  town: 2,
  congregation: 3,
  region: 4,
};

export type ScopedRoom = {
  id: string;
  name: string;
  scopeKind: ScopeKind;
  townId: string;
  congregationId: string;
  regionId: string;
  sortOrder: number;
};

export type HomeRoomRow = {
  tier: HomeTier;
  room: ScopedRoom;
};

export type ZipSeed = { zip: string; townId: string };

export type ZipCorrectionRow = {
  id: string;
  zip: string;
  townId: string;
  at: number;
};

/** Five digits, or the first five of a ZIP+4. Anything else is not a ZIP. */
export function normalizeZip(value: string): string {
  const match = /^(\d{5})(?:-\d{4})?$/.exec(value.trim());
  return match?.[1] ?? "";
}

/** "Riverview" + FL -> riverview-fl. */
export function townSlug(name: string, state: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const st = state.trim().toLowerCase();
  return base && st ? `${base}-${st}` : "";
}

export function nameSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The town for a ZIP after corrections. A blank correction clears it.
 * Two seed towns for one ZIP match nothing. Home does not guess.
 */
export function resolvedTownId(
  zip: string,
  seed: readonly ZipSeed[],
  corrections: readonly ZipCorrectionRow[] = [],
): string | null {
  const code = normalizeZip(zip);
  if (!code) return null;
  let latest: ZipCorrectionRow | null = null;
  for (const row of corrections) {
    if (normalizeZip(row.zip) !== code) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  if (latest) return latest.townId.trim() ? latest.townId.trim() : null;
  let found: string | null = null;
  for (const row of seed) {
    if (normalizeZip(row.zip) !== code) continue;
    if (found && found !== row.townId) return null;
    found = row.townId;
  }
  return found;
}

/**
 * Nearest room first. Joined wins over the ZIP, the ZIP over the congregation,
 * the congregation over a wider region. Inside a tier the directory order is
 * fixed (`sortOrder`, then id). A score on the object is not read.
 */
export function orderHomeRooms(input: {
  rooms: readonly ScopedRoom[];
  joined: readonly string[];
  townId: string | null;
  congregationId: string;
}): HomeRoomRow[] {
  const joined = new Set(input.joined);
  const congregationId = input.congregationId.trim();
  const rows: HomeRoomRow[] = [];
  const seen = new Set<string>();
  for (const room of input.rooms) {
    if (!room.id || seen.has(room.id)) continue;
    let tier: HomeTier | null = null;
    if (joined.has(room.id)) tier = "joined";
    else if (room.scopeKind === "town" && input.townId && room.townId === input.townId) tier = "town";
    else if (
      room.scopeKind === "congregation" &&
      congregationId &&
      room.congregationId === congregationId
    ) {
      tier = "congregation";
    } else if (room.scopeKind === "region") tier = "region";
    if (!tier) continue;
    seen.add(room.id);
    rows.push({ tier, room });
  }
  rows.sort(
    (a, b) =>
      RANK[a.tier] - RANK[b.tier] ||
      a.room.sortOrder - b.room.sortOrder ||
      (a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0),
  );
  return rows;
}

export type CouncilLive = {
  id: string;
  reason: string;
  checklist: string[];
};

export type CouncilLift<T> = T & {
  approvalId: string;
  reason: string;
  checklist: string[];
  label: typeof COUNCIL_APPROVED_LABEL;
};

/**
 * Live council approvals, once each, newest post first.
 * A mark, a reply count, and a score are not arguments.
 */
export function orderCouncilPosts<
  T extends {
    id: string;
    at: number;
    subject?: string | null;
    removed?: boolean;
    parentId?: string | null;
  },
>(posts: readonly T[], live: ReadonlyMap<string, CouncilLive>): CouncilLift<T>[] {
  const seen = new Set<string>();
  const rows: CouncilLift<T>[] = [];
  for (const post of posts) {
    if (!post.id || seen.has(post.id) || post.removed || post.parentId) continue;
    if (post.subject !== "candidate" && post.subject !== "business") continue;
    const approval = live.get(post.id);
    if (!approval || !approval.reason.trim() || approval.checklist.length === 0) continue;
    seen.add(post.id);
    rows.push({
      ...post,
      approvalId: approval.id,
      reason: approval.reason.trim(),
      checklist: approval.checklist,
      label: COUNCIL_APPROVED_LABEL,
    });
  }
  rows.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

export type HomeRoom = { id: string; name: string };
export type HomePost = {
  id: string;
  room: string;
  roomName: string;
  claim: string;
  author: string;
  at: number;
  subject: "candidate" | "business";
  reason: string;
  checklist: string[];
  label: typeof COUNCIL_APPROVED_LABEL;
};
export type HomeSection =
  | { tier: "council"; label: string; posts: HomePost[] }
  | { tier: HomeTier; label: string; rooms: HomeRoom[] };

export type HomeRequest = {
  id: string;
  kind: "town" | "congregation" | "region";
  name: string;
  state: string;
  by: string;
  status: "open" | "approved" | "refused";
  note: string;
};

export type HomeAccessRow = {
  id: string;
  name: string;
  role: string;
  roomId: string;
  action: string;
  vouchedBy: string;
  approvedBy: string;
  note: string;
  at: number;
};

export type HomePayload = {
  zip: string;
  congregationId: string;
  congregations: { id: string; name: string }[];
  sections: HomeSection[];
  requests: HomeRequest[];
  accessLog: HomeAccessRow[];
};

function isTier(value: string): value is HomeTier {
  return value === "joined" || value === "town" || value === "congregation" || value === "region";
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Keeps the server's order. Drops a score, a like, or any extra field. */
export function parseHomePayload(value: unknown): HomePayload | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.sections)) return null;
  const sections: HomeSection[] = [];
  for (const item of body.sections) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (typeof row.tier !== "string" || typeof row.label !== "string") return null;
    if (row.tier === "council") {
      if (!Array.isArray(row.posts)) return null;
      const posts: HomePost[] = [];
      for (const post of row.posts) {
        if (!post || typeof post !== "object") return null;
        const entry = post as Record<string, unknown>;
        if (typeof entry.id !== "string" || typeof entry.room !== "string") return null;
        if (typeof entry.claim !== "string" || typeof entry.author !== "string") return null;
        if (typeof entry.at !== "number" || typeof entry.roomName !== "string") return null;
        if (entry.subject !== "candidate" && entry.subject !== "business") return null;
        if (entry.label !== COUNCIL_APPROVED_LABEL) return null;
        if (typeof entry.reason !== "string" || !entry.reason.trim()) return null;
        const checklist = strings(entry.checklist);
        if (checklist.length === 0) return null;
        posts.push({
          id: entry.id,
          room: entry.room,
          roomName: entry.roomName,
          claim: entry.claim,
          author: entry.author,
          at: entry.at,
          subject: entry.subject,
          reason: entry.reason,
          checklist,
          label: COUNCIL_APPROVED_LABEL,
        });
      }
      sections.push({ tier: "council", label: row.label, posts });
      continue;
    }
    if (!isTier(row.tier) || !Array.isArray(row.rooms)) return null;
    const rooms: HomeRoom[] = [];
    for (const room of row.rooms) {
      if (!room || typeof room !== "object") return null;
      const entry = room as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
      rooms.push({ id: entry.id, name: entry.name });
    }
    sections.push({ tier: row.tier, label: row.label, rooms });
  }
  const congregations: { id: string; name: string }[] = [];
  if (Array.isArray(body.congregations)) {
    for (const item of body.congregations) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id === "string" && typeof entry.name === "string") {
        congregations.push({ id: entry.id, name: entry.name });
      }
    }
  }
  const requests: HomeRequest[] = [];
  if (Array.isArray(body.requests)) {
    for (const item of body.requests) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.by !== "string")
        continue;
      if (entry.kind !== "town" && entry.kind !== "congregation" && entry.kind !== "region") continue;
      if (entry.status !== "open" && entry.status !== "approved" && entry.status !== "refused") continue;
      requests.push({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        state: typeof entry.state === "string" ? entry.state : "",
        by: entry.by,
        status: entry.status,
        note: typeof entry.note === "string" ? entry.note : "",
      });
    }
  }
  const accessLog: HomeAccessRow[] = [];
  if (Array.isArray(body.accessLog)) {
    for (const item of body.accessLog) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.at !== "number")
        continue;
      accessLog.push({
        id: entry.id,
        name: entry.name,
        role: typeof entry.role === "string" ? entry.role : "",
        roomId: typeof entry.roomId === "string" ? entry.roomId : "",
        action: typeof entry.action === "string" ? entry.action : "",
        vouchedBy: typeof entry.vouchedBy === "string" ? entry.vouchedBy : "",
        approvedBy: typeof entry.approvedBy === "string" ? entry.approvedBy : "",
        note: typeof entry.note === "string" ? entry.note : "",
        at: entry.at,
      });
    }
  }
  return {
    zip: typeof body.zip === "string" ? body.zip : "",
    congregationId: typeof body.congregationId === "string" ? body.congregationId : "",
    congregations,
    sections,
    requests,
    accessLog,
  };
}
