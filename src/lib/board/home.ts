// Home order for The Hall. Fixed tiers, chronological inside each tier.
// The only thing that may jump a tier is a live council approval (guard rail 7).
// Theme groups are not built here. A joined group is just another place in the
// first tier, so a later PR can pass `{ kind: "group", id }` without a new sort.

export type HomePlaceKind = "room" | "group";

/** A room, or (later) a theme group. Kind is part of the identity. */
export type HomePlace = {
  kind: HomePlaceKind;
  id: string;
};

export type RoomScope =
  | { kind: "town"; townId: string }
  | { kind: "congregation"; congregationId: string }
  | { kind: "region"; regionId: string };

export type ScopedRoom = {
  id: string;
  scope: RoomScope;
};

/** One ZIP belongs to one town. A town may cover many ZIPs. */
export type ZipTown = {
  zip: string;
  townId: string;
};

export type CongregationRef = {
  id: string;
  name: string;
};

export type HomeMember = {
  /** Raw ZIP from the profile. Invalid values match no town. */
  zip: string;
  /** Congregation id, or "" when the member has none. */
  congregationId: string;
  /**
   * Rooms and theme groups the member has joined. Groups are accepted and
   * sorted in the first tier. This module does not create or moderate them.
   */
  joined: readonly HomePlace[];
};

/** One piece of Home content. `at` is the chronological key (earlier first). */
export type HomeEntry = {
  id: string;
  at: number;
  place: HomePlace;
};

/**
 * Guard rail 7. The council log is the only record that may lift an entry
 * above the locality tiers. The newest row for an entry decides: a blank
 * reason does not promote, and a revoked row does not promote.
 */
export type CouncilApproval = {
  id: string;
  entryId: string;
  reason: string;
  by: string;
  at: number;
  revokedAt: number | null;
};

export const COUNCIL_APPROVED_LABEL = "Council-approved";

export const HOME_TIERS = ["joined", "town", "congregation", "region"] as const;
export type HomeTier = (typeof HOME_TIERS)[number];
export type HomeRank = HomeTier | "council";

export const HOME_SECTION_LABEL: Record<HomeRank, string> = {
  council: COUNCIL_APPROVED_LABEL,
  joined: "What you've joined",
  town: "Your town",
  congregation: "Your congregation",
  region: "Farther out",
};

export type HomeRow = {
  entry: HomeEntry;
  tier: HomeRank;
  councilApproved: boolean;
  approvalId: string | null;
  /** The council's logged reason, when this row is promoted. */
  reason: string | null;
  label: typeof COUNCIL_APPROVED_LABEL | null;
};

export type HomeCatalog = {
  rooms: readonly ScopedRoom[];
  zips: readonly ZipTown[];
};

export type HomeSection = {
  tier: HomeRank;
  label: string;
  rows: HomeRow[];
};

const RANK: Record<HomeRank, number> = {
  council: 0,
  joined: 1,
  town: 2,
  congregation: 3,
  region: 4,
};

/** Five digits, or the first five of a ZIP+4. Anything else is not a ZIP. */
export function normalizeZip(value: string): string {
  const match = /^(\d{5})(?:-\d{4})?$/.exec(value.trim());
  return match ? match[1] : "";
}

/**
 * The town for a ZIP. Null when the ZIP is missing, invalid, or claimed by
 * two different towns (the directory is ambiguous; Home does not guess).
 */
export function townIdForZip(zip: string, zips: readonly ZipTown[]): string | null {
  const code = normalizeZip(zip);
  if (!code) return null;
  let found: string | null = null;
  for (const row of zips) {
    if (normalizeZip(row.zip) !== code) continue;
    if (found && found !== row.townId) return null;
    found = row.townId;
  }
  return found;
}

/** Case-sensitive id match on the congregation directory. Parish text is separate. */
export function congregationIdForParish(parish: string, congregations: readonly CongregationRef[]): string {
  const name = parish.trim().toLowerCase();
  if (!name) return "";
  return congregations.find((item) => item.name.trim().toLowerCase() === name)?.id ?? "";
}

export function toHomeMember(
  profile: { zip: string; parish: string; congregationId: string },
  joined: readonly HomePlace[],
  congregations: readonly CongregationRef[],
): HomeMember {
  const explicit = profile.congregationId.trim();
  const known = congregations.some((item) => item.id === explicit);
  return {
    zip: profile.zip,
    congregationId: known ? explicit : congregationIdForParish(profile.parish, congregations),
    joined,
  };
}

/**
 * Home place for a card or post. An empty local room stays off Home.
 * Find and the topical rooms still list it. A council approval places a
 * post that has no local room; see `homePostEntries`.
 */
export function homeRoomPlace(localRoomId: string | undefined): HomePlace | null {
  const id = (localRoomId ?? "").trim();
  return id ? { kind: "room", id } : null;
}

/**
 * Meeting cards for Home. `going` is ignored: an RSVP is not a join and
 * does not put a card on Home. No local room means the card is omitted.
 */
export function homeMeetingEntries(
  cards: readonly { id: string; at: number; localRoomId?: string; going?: readonly string[] }[],
): HomeEntry[] {
  const entries: HomeEntry[] = [];
  for (const card of cards) {
    const place = homeRoomPlace(card.localRoomId);
    if (!place || !card.id) continue;
    entries.push({ id: card.id, at: card.at, place });
  }
  return entries;
}

/**
 * A post reaches Home only with a live council approval. If it has no local
 * room, the approval still places it, under an id that is not a room.
 */
export function homePostEntries(
  posts: readonly { id: string; at: number; localRoomId?: string; removed?: boolean; parentId?: string | null }[],
  approvals: readonly CouncilApproval[],
): HomeEntry[] {
  const entries: HomeEntry[] = [];
  for (const post of posts) {
    if (!post.id || post.removed || post.parentId) continue;
    if (!liveApproval(post.id, approvals)) continue;
    const place = homeRoomPlace(post.localRoomId) ?? { kind: "room" as const, id: `post:${post.id}` };
    entries.push({ id: post.id, at: post.at, place });
  }
  return entries;
}

function isJoined(member: HomeMember, place: HomePlace): boolean {
  if (!place.id) return false;
  return member.joined.some((item) => item.kind === place.kind && item.id === place.id);
}

/** Newest log row wins. A later revocation or a blank reason ends promotion. */
export function liveApproval(entryId: string, approvals: readonly CouncilApproval[]): CouncilApproval | null {
  let latest: CouncilApproval | null = null;
  for (const row of approvals) {
    if (row.entryId !== entryId) continue;
    if (!latest || row.at > latest.at || (row.at === latest.at && row.id > latest.id)) latest = row;
  }
  if (!latest || latest.revokedAt != null || !latest.reason.trim()) return null;
  return latest;
}

function classify(entry: HomeEntry, member: HomeMember, catalog: HomeCatalog, approval: CouncilApproval | null): HomeRank | null {
  if (!entry.id || !entry.place?.id) return null;
  if (approval) return "council";
  if (isJoined(member, entry.place)) return "joined";
  // Groups have no town, congregation, or region. Unjoined groups stay off Home.
  if (entry.place.kind === "group") return null;
  const room = catalog.rooms.find((item) => item.id === entry.place.id);
  if (!room) return null;
  if (room.scope.kind === "town") {
    const townId = townIdForZip(member.zip, catalog.zips);
    return townId && room.scope.townId === townId ? "town" : null;
  }
  if (room.scope.kind === "congregation") {
    return member.congregationId && room.scope.congregationId === member.congregationId ? "congregation" : null;
  }
  return "region";
}

function toRow(entry: HomeEntry, tier: HomeRank, approval: CouncilApproval | null): HomeRow {
  const councilApproved = tier === "council" && approval != null;
  return {
    entry,
    tier,
    councilApproved,
    approvalId: councilApproved ? approval.id : null,
    reason: councilApproved ? approval.reason.trim() : null,
    label: councilApproved ? COUNCIL_APPROVED_LABEL : null,
  };
}

/**
 * Locality order for Home.
 *
 * 1. Council-approved (guard rail 7), earlier `at` first.
 * 2. Rooms and groups the member has joined.
 * 3. Town rooms for the member's ZIP.
 * 4. The member's congregation.
 * 5. Wider regions.
 *
 * An entry is listed once, in the most local tier that fits. Joined wins
 * over geography. Another town, another congregation, and an unjoined group
 * are left out. Inside a tier, earlier `at` is first: the soonest upcoming
 * item, not the newest post. Nothing here reads marks, replies, attendance,
 * an RSVP (`going`), or a score.
 */
export function homeOrder(
  member: HomeMember,
  entries: readonly HomeEntry[],
  catalog: HomeCatalog,
  approvals: readonly CouncilApproval[] = [],
): HomeRow[] {
  const seen = new Set<string>();
  const rows: HomeRow[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const approval = liveApproval(entry.id, approvals);
    const tier = classify(entry, member, catalog, approval);
    if (!tier) continue;
    rows.push(toRow(entry, tier, approval));
  }
  rows.sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.entry.at - b.entry.at || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
  return rows;
}

/** Consecutive rows of the same tier, in homeOrder's order. Empty tiers are absent. */
export function homeSections(rows: readonly HomeRow[]): HomeSection[] {
  const sections: HomeSection[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last && last.tier === row.tier) last.rows.push(row);
    else sections.push({ tier: row.tier, label: HOME_SECTION_LABEL[row.tier], rows: [row] });
  }
  return sections;
}
