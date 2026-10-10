// The Hall: your church, your shop, your county. Show up.
// Every rule lives here, not in the views.

export const APP_NAME = "The Hall";
export const TAGLINE = "Your church, your shop, your county. Show up.";

export type RoomId = "county" | "question" | "shop" | "shelf" | "coop" | "baptist" | "presbyterian" | "latin" | "orthodox" | "dispatch";
export type PostType = "did" | "asked" | "noted" | "saw" | "hosted";
export type Mark = "sloppy" | "unsupported";
export type Section = "week" | "rooms" | "find" | "civic" | "messages" | "about" | "profile";
export type CardKind = "meeting" | "candidate" | "trade" | "need";
export type HardRule = "threat" | "porn" | "csam";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const BAN_DAYS = 30;
export const SESSION_LINE_MINUTES = 20;
export const DM_RETENTION_DAYS = 30;
export const SHELF_DAYS = 14;
export const SHELF_MAX = 2;
export const WEEK_DAYS = 7;
export const INVITE_DAYS = 7;
export const NAMED_SHOWN = 3;

/**
 * The platform is invite-only. The first member on a box gets in with the
 * founder code and becomes a steward; everyone after that gets in by a
 * host's code to a card. Set VITE_FOUNDER_CODE in .env for a real box.
 */
export const FOUNDER_CODE = (import.meta.env.VITE_FOUNDER_CODE as string | undefined)?.trim().toUpperCase() || "FOUNDER";

export type Room = {
  id: RoomId;
  name: string;
  what: string;
  /** What a member may file. */
  takes: PostType[];
  /** What only a steward may file: announcements, bulletins. */
  stewardTakes: PostType[];
  cardKinds: CardKind[];
  cardNoun: "Meeting" | "Service" | "Reading";
  requiresNextDate: boolean;
  /** Church rooms: the host may post a parish need. */
  parish: boolean;
};

export type Post = {
  id: string;
  room: RoomId;
  type: PostType;
  claim: string;
  reason: string;
  on: string;
  /** Hosted: the next date, or empty. */
  next: string;
  /** Hosted: who came, from the card's going list. They join wentBy. */
  came: string[];
  /** Hosted: one person the host names. Must be on `came`. */
  named: string;
  author: string;
  at: number;
  parentId: string | null;
  closed: boolean;
  mark: Mark | null;
  removed: boolean;
  campaignId?: string;
  cardId?: string;
  tradeId?: string;
};

export type Slot = { day: string; by: string };

export type MeetingCard = {
  id: string;
  room: RoomId;
  kind: CardKind;
  name: string;
  place: string;
  /** Meeting: when. Trade: what they do. Need: what is needed. */
  time: string;
  host: string;
  next: string;
  lastFour: boolean[];
  /** Names who have been, the lister first. Two names list a card. */
  wentBy: string[];
  /** Names who said they would come next time. Never shown as a count. */
  going: string[];
  pinned: boolean;
  unverified: boolean;
  firstTimer: boolean;
  /** Need: the days, and who put their name on each. Nothing enforces it. */
  slots: Slot[];
  /** Reading: the book, title and author. One book at a time. */
  book: string;
  /** Reading: what to have read by the next date. The host sets it when closing. */
  pages: string;
};

export type Invite = {
  code: string;
  cardId: string;
  by: string;
  at: number;
  redeemedBy: string;
};

export type Profile = { household: string; parish: string; trade: string };

export type MarkRow = { id: string; room: RoomId; postId: string; author: string; by: string; mark: Mark | null; at: number };
export type RemovalRow = { id: string; postId: string; author: string; reason: HardRule; at: number };
export type DmThread = { id: string; between: [string, string] };
export type DmMessage = { id: string; threadId: string; from: string; text: string; at: number };

export const RULE_LABEL: Record<HardRule, string> = {
  threat: "Threat of violence",
  porn: "Pornography",
  csam: "Child sexual abuse material",
};
export const MARK_LABEL: Record<Mark, string> = { sloppy: "Sloppy", unsupported: "Unsupported" };

const MEMBER: PostType[] = ["did", "asked", "hosted"];
const SERVICE: PostType[] = ["hosted"];

export const ROOMS: Room[] = [
  { id: "county", name: "The County", what: "Hearings, bills, the week's call, labeled candidate cards. The Quorum desk files its calls here.", takes: MEMBER, stewardTakes: ["noted"], cardKinds: ["meeting", "candidate"], cardNoun: "Meeting", requiresNextDate: false, parish: false },
  { id: "question", name: "The Question", what: "One question a month. A Christian host, chairs open to anyone. A brewery or a hall.", takes: MEMBER, stewardTakes: ["noted"], cardKinds: ["meeting"], cardNoun: "Meeting", requiresNextDate: false, parish: false },
  { id: "shop", name: "The Shop", what: "Apprentice nights, bench logs, the gym hour, the radio net. A tradesman is listed by the men he worked for.", takes: MEMBER, stewardTakes: ["noted"], cardKinds: ["meeting", "trade"], cardNoun: "Meeting", requiresNextDate: true, parish: false },
  { id: "shelf", name: "The Shelf", what: "Book readings. One book at a time, a few chapters a week, a table. Bring the book; the host sets what to have read by next time.", takes: MEMBER, stewardTakes: ["noted"], cardKinds: ["meeting"], cardNoun: "Reading", requiresNextDate: true, parish: false },
  { id: "coop", name: "The Co-op", what: "Classical and homeschool chapter logs. Households, not individuals. Not curriculum ads.", takes: MEMBER, stewardTakes: ["noted"], cardKinds: ["meeting"], cardNoun: "Meeting", requiresNextDate: false, parish: false },
  { id: "baptist", name: "Reformed Baptist", what: "Confessional Baptist churches holding the 1689 Second London Confession. Service time, the meal after, the calendar, and what the church needs this week.", takes: SERVICE, stewardTakes: ["noted"], cardKinds: ["meeting", "need"], cardNoun: "Service", requiresNextDate: false, parish: true },
  { id: "presbyterian", name: "Reformed Presbyterian", what: "Confessional Presbyterian churches holding the Westminster Standards. Service time, the meal after, the calendar, and what the church needs this week.", takes: SERVICE, stewardTakes: ["noted"], cardKinds: ["meeting", "need"], cardNoun: "Service", requiresNextDate: false, parish: true },
  { id: "latin", name: "Latin Mass", what: "Service time, the meal after, the calendar, and what the parish needs this week.", takes: SERVICE, stewardTakes: ["noted"], cardKinds: ["meeting", "need"], cardNoun: "Service", requiresNextDate: false, parish: true },
  { id: "orthodox", name: "Greek Orthodox", what: "Service time, the meal after, the calendar, and what the parish needs this week.", takes: SERVICE, stewardTakes: ["noted"], cardKinds: ["meeting", "need"], cardNoun: "Service", requiresNextDate: false, parish: true },
  { id: "dispatch", name: "Dispatch", what: "Steward bulletins: a road closed, a hearing moved, a clock and a block. No one else files here.", takes: [], stewardTakes: ["saw"], cardKinds: [], cardNoun: "Meeting", requiresNextDate: false, parish: false },
];

export type TypeMeta = {
  id: PostType;
  label: string;
  what: string;
  claimLabel: string;
  reasonLabel?: string;
  dateLabel?: string;
  cardPick: "none" | "optional" | "own";
  tradePick: boolean;
  attest: boolean;
  /** Hosted: next date, roll call, and Named. */
  closes: boolean;
  closable: boolean;
};

export const POST_TYPES: TypeMeta[] = [
  { id: "did", label: "Did", what: "An act, a date, one proof. No verdict.", claimLabel: "What you did", reasonLabel: "One proof", dateLabel: "Date", cardPick: "optional", tradePick: true, attest: false, closes: false, closable: false },
  { id: "asked", label: "Asked", what: "One question, and what was already tried. Closes when answered.", claimLabel: "The question", reasonLabel: "What you already tried", cardPick: "none", tradePick: false, attest: false, closes: false, closable: true },
  { id: "noted", label: "Notice", what: "A steward's announcement: a date, a change, a fact with its source.", claimLabel: "The notice", reasonLabel: "Where it comes from", cardPick: "none", tradePick: false, attest: false, closes: false, closable: false },
  { id: "saw", label: "Bulletin", what: "A steward's bulletin: a public scene, a clock, a block.", claimLabel: "What is happening, in public", reasonLabel: "The clock and the street or block", dateLabel: "Date", cardPick: "none", tradePick: false, attest: true, closes: false, closable: false },
  { id: "hosted", label: "Hosted", what: "The host closes the date: how it went, who came, the next date. No headcount.", claimLabel: "How it went", dateLabel: "The date it happened", cardPick: "own", tradePick: false, attest: false, closes: true, closable: false },
];

export const CARD_LABELS: Record<"meeting" | "trade" | "need", { name: string; place: string; time: string; host: string }> = {
  meeting: { name: "Name", place: "Place", time: "Time", host: "Host" },
  trade: { name: "Business or tradesman", place: "Town", time: "What they do", host: "Their name here" },
  need: { name: "Who needs it (household, first names only)", place: "Where to bring it", time: "What is needed", host: "Who is organizing" },
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function roomById(id: RoomId): Room {
  return ROOMS.find((room) => room.id === id) ?? ROOMS[0];
}

export function typeMeta(type: PostType): TypeMeta {
  return POST_TYPES.find((item) => item.id === type) ?? POST_TYPES[0];
}

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

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  return date ? todayIso(new Date(date.getTime() + days * DAY)) : iso;
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
    came: [],
    named: "",
    at: Date.now(),
    parentId: null,
    closed: false,
    mark: null,
    removed: false,
    ...fields,
  };
}

export function newCard(fields: Pick<MeetingCard, "room" | "kind" | "name" | "place" | "time" | "host"> & Partial<MeetingCard>): MeetingCard {
  return {
    id: crypto.randomUUID(),
    next: "",
    lastFour: [],
    wentBy: [],
    going: [],
    pinned: false,
    unverified: false,
    firstTimer: false,
    slots: [],
    book: "",
    pages: "",
    ...fields,
  };
}

export function inviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export function inviteLive(invite: Invite, now: number): boolean {
  return !invite.redeemedBy && now - invite.at < INVITE_DAYS * DAY;
}

// --- The composer check -----------------------------------------------------

const CLOCK = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;
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
  came: string[];
  named: string;
  /** Reading: what to have read by the next date. */
  pages: string;
  attested: boolean;
  cardId: string;
  tradeId: string;
};

export function blankDraft(room: RoomId): Draft {
  return { room, type: null, claim: "", reason: "", on: todayIso(), next: "", came: [], named: "", pages: "", attested: false, cardId: "", tradeId: "" };
}

export type Check = { ok: boolean; stops: string[]; notes: string[] };
export type CheckContext = { author: string; steward: boolean; posts: Post[]; cards: MeetingCard[]; removals: RemovalRow[]; now: number };

export function sawLockedFor(author: string, posts: Post[]): boolean {
  const own = posts.filter((post) => post.author === author && !post.parentId && !post.removed).sort((a, b) => b.at - a.at).slice(0, 3);
  return own.length === 3 && own.every((post) => post.mark === "sloppy");
}

export type Ban = { until: number; strikes: number; reason: HardRule };

export function banFor(author: string, removals: RemovalRow[], now: number): Ban | null {
  const own = removals.filter((row) => row.author === author).sort((a, b) => b.at - a.at);
  if (own.length === 0) return null;
  const until = own[0].at + BAN_DAYS * DAY;
  if (own.length < 2 && until <= now) return null;
  return { until, strikes: own.length, reason: own[0].reason };
}

/** The types this person may file in this room. */
export function typesFor(room: Room, steward: boolean): PostType[] {
  return steward ? [...room.takes, ...room.stewardTakes] : room.takes;
}

export function composerCheck(draft: Draft, ctx: CheckContext): Check {
  const stops: string[] = [];
  const notes: string[] = [];
  const room = roomById(draft.room);

  if (banFor(ctx.author, ctx.removals, ctx.now)) return { ok: false, stops: ["Filing is off for this account."], notes };
  if (!draft.type) return { ok: false, stops: ["Pick a type. A post with no type does not send."], notes };
  const meta = typeMeta(draft.type);
  if (!typesFor(room, ctx.steward).includes(draft.type)) {
    stops.push(room.stewardTakes.includes(draft.type) ? `${meta.label} is filed by a steward.` : `${room.name} does not take ${meta.label}.`);
  }

  const claim = draft.claim.trim();
  const reason = draft.reason.trim();
  if (!claim) stops.push(`Missing: ${meta.claimLabel.toLowerCase()}.`);
  if (meta.reasonLabel && !reason) stops.push(`Missing: ${meta.reasonLabel.toLowerCase()}.`);
  if (claim.length > 600) stops.push("One claim. Cut it under 600 characters.");
  if (meta.dateLabel && !isIsoDate(draft.on)) stops.push("A date, or it is not a record.");
  if (meta.closes && draft.next && !isIsoDate(draft.next)) stops.push("The next date is not a date.");
  if (meta.closable && (claim.match(/\?/g) ?? []).length > 1) stops.push("One question. Split the second one into its own Asked.");

  if (meta.cardPick === "own") {
    const card = ctx.cards.find((item) => item.id === draft.cardId);
    if (!card) stops.push("Name the card this closes.");
    else if (card.host !== ctx.author) stops.push("Only the host files a Hosted.");
    else if (card.room !== draft.room) stops.push(`That card lives in ${roomById(card.room).name}.`);
    if (HEADCOUNT.test(claim)) stops.push("No headcount. Say how it went, not how many.");
    if (card?.book && draft.next && !draft.pages.trim()) stops.push("Say what to have read by then.");
    if (draft.named) {
      if (draft.named === ctx.author) stops.push("You cannot name yourself.");
      else if (!draft.came.includes(draft.named)) stops.push("You can only name someone who was there.");
    }
  }
  if (meta.tradePick && draft.tradeId) {
    const trade = ctx.cards.find((item) => item.id === draft.tradeId);
    if (trade && trade.host === ctx.author) stops.push("You cannot witness your own work.");
  }
  if (meta.attest) {
    if (sawLockedFor(ctx.author, ctx.posts)) stops.push("Bulletins are locked: three sloppy posts in a row.");
    if (!CLOCK.test(reason) && !CLOCK.test(claim)) stops.push("A bulletin wants a clock.");
    if (STREET_ADDRESS.test(claim) || STREET_ADDRESS.test(reason)) stops.push("That reads as a home address. Say the block or the corner, not the house.");
    if (!draft.attested) stops.push("Attest: no child's face, no private person named who was not acting in public.");
  }

  const text = `${claim}\n${reason}`;
  if (THREAT.test(text)) stops.push("That reads as a threat. It does not send.");
  if (PORN.test(text)) stops.push("That reads as pornography. It does not send.");
  if (meta.reasonLabel && reason && reason.length < 12) notes.push("Thin reason. A steward can mark this unsupported.");
  if (/^https?:\/\/\S+$/i.test(claim)) notes.push("A bare link is a repost. Say what you opened.");

  return { ok: stops.length === 0, stops, notes };
}

export type DeskContact = { title: string; waveLabel: string; office: string; role: string; window: string; who: string; campaignId: string };

export function deskDid(input: DeskContact & { author: string }): Post {
  return newPost({
    room: "county",
    type: "did",
    claim: `${input.waveLabel}: ${input.office}, ${input.role}. ${input.title}.`,
    reason: `Logged on the Quorum desk by ${input.who.trim() || "me"}. Window ${input.window}.`,
    on: todayIso(),
    author: input.author,
    campaignId: input.campaignId,
  });
}

// --- Sort, shelf, week, cards -------------------------------------------------

function tier(post: Post): number {
  if (post.mark === "sloppy") return 5;
  if (post.mark === "unsupported") return 4;
  if (post.type === "noted" || (post.type === "asked" && post.closed)) return 3;
  if (post.type === "hosted" || (post.type === "did" && post.cardId)) return 1;
  return 2;
}

export function sortRoom(posts: Post[], room: RoomId): Post[] {
  return posts.filter((post) => post.room === room && !post.parentId && !post.removed).sort((a, b) => tier(a) - tier(b) || b.at - a.at);
}

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

export function cardListed(card: MeetingCard, witnesses: Map<string, string[]>): boolean {
  if (card.kind === "trade") return (witnesses.get(card.id)?.length ?? 0) >= 2;
  if (card.kind === "need") return true;
  if (new Set(card.wentBy).size < 2) return false;
  const recent = card.lastFour.slice(-2);
  if (recent.length === 2 && recent.every((went) => !went)) return false;
  if (roomById(card.room).requiresNextDate && !card.next) return false;
  return true;
}

export function daysUntil(iso: string, today: string): number {
  const a = parseIsoDate(iso);
  const b = parseIsoDate(today);
  return a && b ? Math.round((a.getTime() - b.getTime()) / DAY) : Number.POSITIVE_INFINITY;
}

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

export type WeekDay = { iso: string; cards: MeetingCard[] };

/** The next seven days that have something on them. Empty days are left out. */
export function weekFor(cards: MeetingCard[], witnesses: Map<string, string[]>, today: string): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const iso = addDays(today, i);
    const dated = cards.filter((card) => card.next === iso && card.kind !== "trade" && card.kind !== "need" && cardListed(card, witnesses));
    if (dated.length > 0) days.push({ iso, cards: dated });
  }
  return days;
}

export function needsFor(cards: MeetingCard[], room?: RoomId): MeetingCard[] {
  return cards.filter((card) => card.kind === "need" && (!room || card.room === room) && card.slots.some((slot) => !slot.by));
}

/** Whether each host's latest note in each room is unmarked, in one pass. Key: `${host}\u0000${room}`. */
export function hostsClear(posts: Post[]): Map<string, boolean> {
  const latest = new Map<string, Post>();
  for (const post of posts) {
    if (post.removed) continue;
    const key = `${post.author}\u0000${post.room}`;
    const seen = latest.get(key);
    if (!seen || post.at > seen.at) latest.set(key, post);
  }
  return new Map([...latest].map(([key, post]) => [key, post.mark === null]));
}

/** A card cannot be pinned while the host's last note in its room is marked. */
export function cardCanPin(card: MeetingCard, clear: Map<string, boolean>): boolean {
  return clear.get(`${card.host}\u0000${card.room}`) ?? true;
}

export function cardSummary(card: MeetingCard): string {
  const parts = [card.place, card.time];
  if (card.host) parts.push(card.kind === "trade" ? card.host : `host ${card.host}`);
  return parts.join(" · ");
}

/** Reading cards: the book, and what to have read by the next date. */
export function readingLine(card: MeetingCard): string {
  if (!card.book) return "";
  return card.pages ? `${card.book} · read ${card.pages}` : card.book;
}

// --- People -------------------------------------------------------------------

/** Everyone `me` has stood in a room with, or who replied to me. The gate for messages and profiles. */
export function stoodWith(me: string, cards: MeetingCard[], posts: Post[]): Set<string> {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.wentBy.includes(me)) for (const name of card.wentBy) names.add(name);
  }
  const mine = new Set(posts.filter((post) => post.author === me && !post.parentId).map((post) => post.id));
  for (const post of posts) if (post.parentId && mine.has(post.parentId)) names.add(post.author);
  names.delete(me);
  return names;
}

/** The last few times a host named this person, newest first. */
export function namedLines(name: string, posts: Post[]): Post[] {
  return posts.filter((post) => post.type === "hosted" && post.named === name && !post.removed).sort((a, b) => b.at - a.at).slice(0, NAMED_SHOWN);
}

export function threadIdFor(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function otherIn(thread: DmThread, me: string): string {
  return thread.between.find((name) => name !== me) ?? "";
}
