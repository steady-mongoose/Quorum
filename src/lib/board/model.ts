// The Board: a town board with a lock on the feed.
// Every rule from the design handoff lives here, not in the views.

export type RoomId =
  | "civic"
  | "hall"
  | "skills"
  | "guilds"
  | "school"
  | "reformed"
  | "latin"
  | "orthodox"
  | "dispatch";

export type PostType = "did" | "asked" | "noted" | "saw" | "hosted";
export type Mark = "sloppy" | "unsupported";
export type Section = "rooms" | "find" | "civic" | "messages" | "about";
export type CardKind = "meeting" | "candidate" | "trade";
export type HardRule = "threat" | "porn" | "csam";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const BAN_DAYS = 30;
export const SESSION_LINE_MINUTES = 20;
/** Messages are plain and kept 30 days. Say so on the about page. */
export const DM_RETENTION_DAYS = 30;
/** A room opens on its shelf only when a card has a date this close. */
export const SHELF_DAYS = 14;
export const SHELF_MAX = 2;

export type Room = {
  id: RoomId;
  name: string;
  what: string;
  takes: PostType[];
  cardKinds: CardKind[];
  /** "Service" for the church rooms, "Meeting" elsewhere. */
  cardNoun: "Meeting" | "Service";
  /** Guilds: a next date or it is not listed. */
  requiresNextDate: boolean;
};

export type Post = {
  id: string;
  room: RoomId;
  type: PostType;
  /** The act, the question, the passage, the scene, or how it went. */
  claim: string;
  /** The proof, what was tried, the source, or the clock and place. */
  reason: string;
  /** ISO date for Did, Saw and Hosted. */
  on: string;
  /** Hosted: the next date, or empty for none. */
  next: string;
  author: string;
  at: number;
  parentId: string | null;
  closed: boolean;
  mark: Mark | null;
  removed: boolean;
  /** Links a Civic Did to the Quorum campaign that produced it. */
  campaignId?: string;
  /** Hosted: the card it closes. Did: the card it was about. */
  cardId?: string;
  /** Did: the trade card for whoever did the work. */
  tradeId?: string;
};

export type MeetingCard = {
  id: string;
  room: RoomId;
  kind: CardKind;
  name: string;
  place: string;
  /** Meeting: when. Trade: what they do. */
  time: string;
  /** Meeting: who hosts. Trade: the tradesman's name on this board. */
  host: string;
  next: string;
  /** Oldest first, up to four. true = it happened. */
  lastFour: boolean[];
  /** Names who marked "I went", the lister first. Two names list a card. */
  wentBy: string[];
  pinned: boolean;
  /** From the brief: checked once, still to be visited before it stays. */
  unverified: boolean;
  firstTimer: boolean;
};

export type MarkRow = {
  id: string;
  room: RoomId;
  postId: string;
  author: string;
  by: string;
  mark: Mark | null;
  at: number;
};

export type RemovalRow = {
  id: string;
  postId: string;
  author: string;
  reason: HardRule;
  at: number;
};

export type DmThread = { id: string; between: [string, string] };
export type DmMessage = { id: string; threadId: string; from: string; text: string; at: number };

export const RULE_LABEL: Record<HardRule, string> = {
  threat: "Threat of violence",
  porn: "Pornography",
  csam: "Child sexual abuse material",
};

export const MARK_LABEL: Record<Mark, string> = { sloppy: "Sloppy", unsupported: "Unsupported" };

const ALL: PostType[] = ["did", "asked", "noted", "hosted"];
const SERVICE: PostType[] = ["noted", "hosted"];

export const ROOMS: Room[] = [
  { id: "civic", name: "Civic", what: "Hearings, bills, labeled candidate cards. The Quorum desk files its calls here.", takes: ALL, cardKinds: ["meeting", "candidate"], cardNoun: "Meeting", requiresNextDate: false },
  { id: "hall", name: "Public hall", what: "One question, a Christian host, chairs open to anyone. A brewery or a hall.", takes: ALL, cardKinds: ["meeting"], cardNoun: "Meeting", requiresNextDate: false },
  { id: "skills", name: "Skills", what: "Carpentry, gardening, fishing, baking, radio, lawful gunsmithing as a bench log. No build instructions. A tradesman is listed by the people he worked for.", takes: ALL, cardKinds: ["meeting", "trade"], cardNoun: "Meeting", requiresNextDate: false },
  { id: "guilds", name: "Guilds", what: "Apprentice night, men's gym hour, women's gym hour. A next date or it is not listed.", takes: ALL, cardKinds: ["meeting", "trade"], cardNoun: "Meeting", requiresNextDate: true },
  { id: "school", name: "School", what: "Classical Christian and homeschool chapter logs. Not curriculum ads.", takes: ALL, cardKinds: ["meeting"], cardNoun: "Meeting", requiresNextDate: false },
  { id: "reformed", name: "Reformed", what: "Service time only.", takes: SERVICE, cardKinds: ["meeting"], cardNoun: "Service", requiresNextDate: false },
  { id: "latin", name: "Latin Mass", what: "Service time only.", takes: SERVICE, cardKinds: ["meeting"], cardNoun: "Service", requiresNextDate: false },
  { id: "orthodox", name: "Greek Orthodox", what: "Service time only.", takes: SERVICE, cardKinds: ["meeting"], cardNoun: "Service", requiresNextDate: false },
  { id: "dispatch", name: "Dispatch", what: "Saw posts only. A public scene, a clock, a clip. No home addresses, no children's faces, no naming a private person.", takes: ["saw"], cardKinds: [], cardNoun: "Meeting", requiresNextDate: false },
];

export type TypeMeta = {
  id: PostType;
  label: string;
  what: string;
  claimLabel: string;
  /** Absent: the type has no reason field. */
  reasonLabel?: string;
  dateLabel?: string;
  /** "own": the author must host the card. */
  cardPick: "none" | "optional" | "own";
  tradePick: boolean;
  attest: boolean;
  next: boolean;
  closable: boolean;
};

export const POST_TYPES: TypeMeta[] = [
  { id: "did", label: "Did", what: "An act, a date, one proof. No verdict.", claimLabel: "What you did", reasonLabel: "One proof", dateLabel: "Date", cardPick: "optional", tradePick: true, attest: false, next: false, closable: false },
  { id: "asked", label: "Asked", what: "One question, and what was already tried. Closes when answered.", claimLabel: "The question", reasonLabel: "What you already tried", cardPick: "none", tradePick: false, attest: false, next: false, closable: true },
  { id: "noted", label: "Noted", what: "A passage, a measurement, a date. No ask.", claimLabel: "The passage, measurement, or date", reasonLabel: "Where it comes from", cardPick: "none", tradePick: false, attest: false, next: false, closable: false },
  { id: "saw", label: "Saw", what: "Public scene, clock, clip. Dispatch room only.", claimLabel: "What you saw, in public", reasonLabel: "The clock and the street or block", dateLabel: "Date", cardPick: "none", tradePick: false, attest: true, next: false, closable: false },
  { id: "hosted", label: "Hosted", what: "The host says it happened and names the next date. No headcount.", claimLabel: "How it went", dateLabel: "The date it happened", cardPick: "own", tradePick: false, attest: false, next: true, closable: false },
];

export const CARD_LABELS: Record<"meeting" | "trade", { name: string; place: string; time: string; host: string }> = {
  meeting: { name: "Name", place: "Place", time: "Time", host: "Host" },
  trade: { name: "Business or tradesman", place: "Town", time: "What they do", host: "Their name on this board" },
};

export function roomById(id: RoomId): Room {
  return ROOMS.find((room) => room.id === id) ?? ROOMS[0];
}

export function typeMeta(type: PostType): TypeMeta {
  return POST_TYPES.find((item) => item.id === type) ?? POST_TYPES[0];
}

/** The name on your posts. Login replaces this on the VPS. */
export function authorName(me: string): string {
  return me.trim() || "You";
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseIsoDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : iso;
}

export function formatWhen(at: number, now: number): string {
  const mins = Math.round(Math.max(0, now - at) / MINUTE);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString();
}

export function newPost(fields: Pick<Post, "room" | "type" | "claim" | "author"> & Partial<Post>): Post {
  return {
    id: crypto.randomUUID(),
    reason: "",
    on: "",
    next: "",
    at: Date.now(),
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    ...fields,
  };
}

// --- The composer check -----------------------------------------------------

// A clock: "7:30", "7:30 p.m.", "19:05", "noon", "7pm".
const CLOCK = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;
// A home address: a house number followed by a street word.
const STREET_ADDRESS =
  /\b\d{2,6}\s+[A-Za-z0-9.'-]+(\s+[A-Za-z0-9.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace)\b\.?/i;
// Crude backstops before send. The steward's hard remove is the real rule.
const THREAT =
  /\b(i('| wi)ll|we('| wi)ll|gonna|going to|should|let's|lets)\s+(kill|shoot|stab|hang|burn|beat|hurt|bomb|lynch)\b|\b(kill|shoot|hang|burn)\s+(him|her|them|you|that)\b/i;
const PORN = /\b(porn|pornograph|xxx|onlyfans|nsfw)\b/i;
const HEADCOUNT = /\b\d+\s*(people|folks|came|showed|attended|turned out|of us|guys|men|women)\b|\b(turnout|headcount|attendance)\b/i;

export type Draft = {
  room: RoomId;
  type: PostType | null;
  claim: string;
  reason: string;
  on: string;
  next: string;
  attested: boolean;
  cardId: string;
  tradeId: string;
};

export function blankDraft(room: RoomId): Draft {
  return { room, type: null, claim: "", reason: "", on: todayIso(), next: "", attested: false, cardId: "", tradeId: "" };
}

export type Check = { ok: boolean; stops: string[]; notes: string[] };

export type CheckContext = {
  author: string;
  posts: Post[];
  cards: MeetingCard[];
  removals: RemovalRow[];
  now: number;
};

/** Three sloppy posts in a row by this author locks Saw until one is revised. */
export function sawLockedFor(author: string, posts: Post[]): boolean {
  const own = posts
    .filter((post) => post.author === author && !post.parentId && !post.removed)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3);
  return own.length === 3 && own.every((post) => post.mark === "sloppy");
}

export type Ban = { until: number; strikes: number; reason: HardRule };

/** Derived from the removal log: 30 days per removal, closed on the second. */
export function banFor(author: string, removals: RemovalRow[], now: number): Ban | null {
  const own = removals.filter((row) => row.author === author).sort((a, b) => b.at - a.at);
  if (own.length === 0) return null;
  const until = own[0].at + BAN_DAYS * DAY;
  if (own.length < 2 && until <= now) return null;
  return { until, strikes: own.length, reason: own[0].reason };
}

/**
 * One claim and the reason, no threat, not pornography, plus the room and
 * type locks from the brief. Everything the check needs comes from `ctx`.
 */
export function composerCheck(draft: Draft, ctx: CheckContext): Check {
  const stops: string[] = [];
  const notes: string[] = [];
  const room = roomById(draft.room);

  if (banFor(ctx.author, ctx.removals, ctx.now)) {
    return { ok: false, stops: ["Filing is off for this account."], notes };
  }
  if (!draft.type) {
    return { ok: false, stops: ["Pick a type. A post with no type does not send."], notes };
  }
  const meta = typeMeta(draft.type);
  if (!room.takes.includes(draft.type)) {
    const takes = room.takes.map((type) => typeMeta(type).label).join(", ");
    stops.push(`${room.name} takes ${takes} only.`);
  }

  const claim = draft.claim.trim();
  const reason = draft.reason.trim();
  if (!claim) stops.push(`Missing: ${meta.claimLabel.toLowerCase()}.`);
  if (meta.reasonLabel && !reason) stops.push(`Missing: ${meta.reasonLabel.toLowerCase()}.`);
  if (claim.length > 600) stops.push("One claim. Cut it under 600 characters.");
  if (meta.dateLabel && !isIsoDate(draft.on)) stops.push("A date, or it is not a record.");
  if (meta.next && draft.next && !isIsoDate(draft.next)) stops.push("The next date is not a date.");
  if (meta.closable && (claim.match(/\?/g) ?? []).length > 1) {
    stops.push("One question. Split the second one into its own Asked.");
  }

  if (meta.cardPick === "own") {
    const card = ctx.cards.find((item) => item.id === draft.cardId);
    if (!card) stops.push("Name the card this closes.");
    else if (card.host !== ctx.author) stops.push("Only the host files a Hosted.");
    else if (card.room !== draft.room) stops.push(`That card lives in ${roomById(card.room).name}.`);
    if (HEADCOUNT.test(claim)) stops.push("No headcount. Say how it went, not how many.");
  }
  if (meta.tradePick && draft.tradeId) {
    const trade = ctx.cards.find((item) => item.id === draft.tradeId);
    if (trade && trade.host === ctx.author) stops.push("You cannot witness your own work.");
  }
  if (meta.attest) {
    if (sawLockedFor(ctx.author, ctx.posts)) stops.push("Saw is locked: three sloppy posts in a row. Revise one and it reopens.");
    if (!CLOCK.test(reason) && !CLOCK.test(claim)) stops.push("A Saw wants a clock in the proof.");
    if (STREET_ADDRESS.test(claim) || STREET_ADDRESS.test(reason)) {
      stops.push("That reads as a home address. Say the block or the corner, not the house.");
    }
    if (!draft.attested) stops.push("Attest: no child's face, no private person named who was not acting in public.");
  }

  const text = `${claim}\n${reason}`;
  if (THREAT.test(text)) stops.push("That reads as a threat. It does not send.");
  if (PORN.test(text)) stops.push("That reads as pornography. It does not send.");

  if (meta.reasonLabel && reason && reason.length < 12) notes.push("Thin reason. A steward can mark this unsupported.");
  if (/^https?:\/\/\S+$/i.test(claim)) notes.push("A bare link is a repost. Say what you opened.");

  return { ok: stops.length === 0, stops, notes };
}

export type DeskContact = {
  title: string;
  waveLabel: string;
  office: string;
  role: string;
  window: string;
  who: string;
  campaignId: string;
};

/** The Did a logged Quorum contact becomes in Civic. */
export function deskDid(input: DeskContact & { author: string }): Post {
  return newPost({
    room: "civic",
    type: "did",
    claim: `${input.waveLabel}: ${input.office}, ${input.role}. ${input.title}.`,
    reason: `Logged on the Quorum desk by ${input.who.trim() || "me"}. Window ${input.window}.`,
    on: todayIso(),
    author: input.author,
    campaignId: input.campaignId,
  });
}

// --- Sort, shelf, cards -------------------------------------------------------

function tier(post: Post): number {
  // Sloppy at the bottom. Unsupported under reasoned posts. Hosted and a Did
  // that names a card lead; other Dids and open Asked next; Noted under those.
  if (post.mark === "sloppy") return 5;
  if (post.mark === "unsupported") return 4;
  if (post.type === "noted" || (post.type === "asked" && post.closed)) return 3;
  if (post.type === "hosted" || (post.type === "did" && post.cardId)) return 1;
  return 2;
}

/** Chronological inside the room, grouped by the brief's sort tiers. */
export function sortRoom(posts: Post[], room: RoomId): Post[] {
  return posts
    .filter((post) => post.room === room && !post.parentId && !post.removed)
    .sort((a, b) => tier(a) - tier(b) || b.at - a.at);
}

/** Replies grouped by parent, oldest first, in one pass. */
export function repliesByParent(posts: Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  for (const post of posts) {
    if (!post.parentId || post.removed) continue;
    const list = map.get(post.parentId) ?? [];
    list.push(post);
    map.set(post.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.at - b.at);
  return map;
}

/** Named members, other than the tradesman, whose Dids name each trade. */
export function witnessesByTrade(posts: Post[], cards: MeetingCard[]): Map<string, string[]> {
  const hosts = new Map(cards.filter((card) => card.kind === "trade").map((card) => [card.id, card.host]));
  const map = new Map<string, Set<string>>();
  for (const post of posts) {
    if (post.type !== "did" || !post.tradeId || post.removed || !hosts.has(post.tradeId)) continue;
    if (post.author === hosts.get(post.tradeId)) continue;
    (map.get(post.tradeId) ?? map.set(post.tradeId, new Set()).get(post.tradeId)!).add(post.author);
  }
  return new Map([...map].map(([id, names]) => [id, [...names]]));
}

/**
 * Unvisited cards stay off. A card hides after two missed meetings. A trade
 * lists only when two other members have named it in a Did.
 */
export function cardListed(card: MeetingCard, witnesses: Map<string, string[]>): boolean {
  if (card.kind === "trade") return (witnesses.get(card.id)?.length ?? 0) >= 2;
  if (new Set(card.wentBy).size < 2) return false;
  const recent = card.lastFour.slice(-2);
  if (recent.length === 2 && recent.every((went) => !went)) return false;
  if (roomById(card.room).requiresNextDate && !card.next) return false;
  return true;
}

function daysUntil(iso: string, today: string): number {
  const a = parseIsoDate(iso);
  const b = parseIsoDate(today);
  return a && b ? Math.round((a.getTime() - b.getTime()) / DAY) : Number.POSITIVE_INFINITY;
}

/** Pinned cards, then cards dated inside SHELF_DAYS, at most SHELF_MAX. */
export function shelfFor(room: RoomId, cards: MeetingCard[], witnesses: Map<string, string[]>, today: string): MeetingCard[] {
  const listed = cards.filter((card) => card.room === room && card.kind !== "trade" && cardListed(card, witnesses));
  const pinned = listed.filter((card) => card.pinned);
  const soon = listed
    .filter((card) => !card.pinned && card.next)
    .map((card) => ({ card, days: daysUntil(card.next, today) }))
    .filter((item) => item.days >= 0 && item.days <= SHELF_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((item) => item.card);
  return [...pinned, ...soon].slice(0, SHELF_MAX);
}

/** A card cannot be pinned while the host's last note in its room is marked. */
export function cardCanPin(card: MeetingCard, posts: Post[]): boolean {
  const note = posts
    .filter((post) => post.author === card.host && post.room === card.room && !post.removed)
    .sort((a, b) => b.at - a.at)[0];
  return !note || note.mark === null;
}

export function cardSummary(card: MeetingCard): string {
  const parts = [card.place, card.time];
  if (card.host) parts.push(card.kind === "trade" ? card.host : `host ${card.host}`);
  return parts.join(" · ");
}

// --- Messages -----------------------------------------------------------------

/**
 * Everyone `me` may message: anyone on an "I went" list with me, and anyone
 * who replied to one of my posts. Strangers do not get a line in.
 */
export function messageable(me: string, cards: MeetingCard[], posts: Post[]): Set<string> {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.wentBy.includes(me)) for (const name of card.wentBy) names.add(name);
  }
  const mine = new Set(posts.filter((post) => post.author === me && !post.parentId).map((post) => post.id));
  for (const post of posts) {
    if (post.parentId && mine.has(post.parentId)) names.add(post.author);
  }
  names.delete(me);
  return names;
}

export function threadIdFor(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function otherIn(thread: DmThread, me: string): string {
  return thread.between.find((name) => name !== me) ?? "";
}
