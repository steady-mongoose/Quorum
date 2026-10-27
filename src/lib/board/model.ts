// Avouch Social: your church, your shop, your county. Show up.
// Every rule lives here, not in the views.

import {
  hasClock,
  hasHeadcount,
  hasStreetAddress,
  isEnglish,
  looksLikeBlasphemy,
  looksLikeDoxxing,
  looksLikePorn,
  looksLikeThreat,
  type HardRuleValue,
  type MarkValue,
} from "./text.ts";
import { meetingDates, shiftLocalDate } from "./week-days.ts";

export const APP_NAME = "Avouch Social";
export const TAGLINE = "Your church, your shop, your county. Show up.";

export type RoomId =
  | "county"
  | "question"
  | "shop"
  | "shelf"
  | "coop"
  | "baptist"
  | "presbyterian"
  | "latin"
  | "orthodox"
  | "dispatch"
  | (string & {});
export type PostType = "did" | "asked" | "noted" | "saw" | "hosted";
export type Mark = MarkValue;
export type Section = "week" | "rooms" | "groups" | "find" | "civic" | "messages" | "about" | "profile";
export type CardKind = "meeting" | "candidate" | "trade" | "need";
export type HardRule = HardRuleValue;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const BAN_DAYS = 30;
export const SESSION_LINE_MINUTES = 20;
export { DM_RETENTION_DAYS, DM_TEXT_MAX, dmTextError } from "../e2ee/limits.ts";
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
function readFounderCode(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const raw = env?.VITE_FOUNDER_CODE;
  return typeof raw === "string" && raw.trim() ? raw.trim().toUpperCase() : "FOUNDER";
}

export const FOUNDER_CODE = readFounderCode();

export type Room = {
  id: RoomId;
  name: string;
  what: string;
  /** What a member may file. */
  takes: PostType[];
  /** What only a steward may file: announcements, bulletins. */
  stewardTakes: PostType[];
  cardKinds: CardKind[];
  cardNoun: "Meeting" | "Service" | "Reading" | "Debate";
  requiresNextDate: boolean;
  /** Church rooms: the host may post a parish need. */
  parish: boolean;
  /** Who the room is for. Missing means everyone. */
  audience?: "all" | "men" | "women";
  /** The signed-in member may change the audience. */
  host?: boolean;
};

export function audienceLabel(audience: string | null | undefined): "Men only" | "Women only" | "" {
  if (audience === "men") return "Men only";
  if (audience === "women") return "Women only";
  return "";
}

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
  /** Candidate or business. The council can label one of these, once. */
  subject?: "candidate" | "business";
  /** A one-time label. It does not move the post. */
  council?: {
    label: "Council-approved";
    reason: string;
    checklist: string[];
    approvalId: string;
  } | null;
  /** One picture or video, kept with the post. Older posts omit this. */
  media?: SharedMedia[];
};

/** A picture or video stored for members. The bytes are not in the browser's board. */
export type SharedMedia = { id: string; kind: "image" | "video" };

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
  /** Public /e page. Off until the organizer turns it on. */
  sharePublic?: boolean;
  /** Host paused the series. It does not fill the week. */
  paused?: boolean;
  /** This meeting was cancelled. */
  cancelled?: boolean;
  /** Last day the series still meets, inclusive. */
  until?: string;
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

export type MarkRow = {
  id: string;
  room: RoomId;
  postId: string;
  author: string;
  by: string;
  mark: Mark | null;
  /** One sentence. A mark never hides the post. */
  reason: string;
  at: number;
};
export type RemovalRow = {
  id: string;
  postId: string;
  author: string;
  reason: HardRule;
  at: number;
  /** A room chat line. A post leaves this off. */
  roomChat?: boolean;
};
export type BanRow = {
  id: string;
  author: string;
  reason: HardRule;
  until: number;
  strikes: number;
  at: number;
};
export type AppealKind = "mark" | "removal";
export type AppealDecision = "uphold" | "lift";
export type AppealRow = {
  id: string;
  room: RoomId;
  postId: string;
  author: string;
  kind: AppealKind;
  reason: string;
  decision: AppealDecision | null;
  decisionNote: string;
  decidedBy: string;
  at: number;
  decidedAt: number | null;
  /** Set when the appeal is of a removal. Null on a mark. */
  rule: HardRule | null;
};
/** Metadata for a hand-filed CyberTipline report. The post itself is not here. */
export type CsamReport = {
  id: string;
  postId: string;
  room: string;
  author: string;
  accountId: string;
  incidentAt: number;
  retainUntil: number;
  mediaCount: number;
  byteSize: number;
  mediaTypes: string[];
  status: "prepared" | "pending_seal" | "filed";
  reportId: string;
  filedAt: number | null;
  filedBy: string;
};
export type DmThread = { id: string; between: [string, string] };
export type DmMessage = {
  id: string;
  threadId: string;
  from: string;
  text: string;
  at: number;
  media?: SharedMedia[];
};

export const RULE_LABEL: Record<HardRule, string> = {
  threat: "Calls for violence, threats, or plans to attack or intimidate",
  porn: "Pornography",
  csam: "Child sexual abuse material",
  doxxing: "Doxxing",
  blasphemy: "Blasphemy (mocking God or Christ)",
};
/** One sentence a steward can apply the same way to every member. */
export const RULE_SENTENCE: Record<HardRule, string> = {
  threat:
    "A call for violence, a threat, or a plan or instructions to attack or intimidate someone is removed.",
  porn: "Pornography is removed and the account is closed for good the first time.",
  csam: "Child sexual abuse material is removed at once, the account is closed for good the first time, and the evidence is held for one year, pending counsel.",
  doxxing:
    "Publishing a private person's home address, phone number, or other contact so strangers can find them is removed.",
  blasphemy: "Blasphemy, a post that mocks God or Christ, is removed.",
};
export const MARK_LABEL: Record<Mark, string> = {
  sloppy: "Sloppy",
  unsupported: "No legs",
  out_of_scope: "Out of scope",
};

const MEMBER: PostType[] = ["did", "asked", "hosted"];
const SERVICE: PostType[] = ["hosted"];

export const ROOMS: Room[] = [
  {
    id: "county",
    name: "The County",
    what: "County hearings, bills, and the week's coordinated phone call to one official. Candidate events are allowed, labeled as such.",
    takes: MEMBER,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "candidate"],
    cardNoun: "Meeting",
    requiresNextDate: false,
    parish: false,
  },
  {
    id: "question",
    name: "Debate Night",
    what: "A debate once a month at a brewery or a hall. One question, two sides, a Christian host, anyone welcome. Afterwards the host writes up how it went and names next month's question.",
    takes: MEMBER,
    stewardTakes: ["noted"],
    cardKinds: ["meeting"],
    cardNoun: "Debate",
    requiresNextDate: true,
    parish: false,
  },
  {
    id: "shop",
    name: "The Shop",
    what: "Hands-on nights: woodworking, the radio net, the gym hour. Also the directory of tradesmen that members have vouched for.",
    takes: MEMBER,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "trade"],
    cardNoun: "Meeting",
    requiresNextDate: true,
    parish: false,
  },
  {
    id: "shelf",
    name: "Literary Society",
    what: "A reading group. One book at a time, a few chapters between meetings, talked through around a table. The host says what to read before next time.",
    takes: MEMBER,
    stewardTakes: ["noted"],
    cardKinds: ["meeting"],
    cardNoun: "Reading",
    requiresNextDate: true,
    parish: false,
  },
  {
    id: "coop",
    name: "The Co-op",
    what: "Homeschool and classical co-op chapters, by household.",
    takes: MEMBER,
    stewardTakes: ["noted"],
    cardKinds: ["meeting"],
    cardNoun: "Meeting",
    requiresNextDate: false,
    parish: false,
  },
  {
    id: "baptist",
    name: "Reformed Baptist",
    what: "Reformed Baptist churches that hold the 1689 Confession. Service times, the meal after, the church calendar, and families who need meals this week.",
    takes: SERVICE,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "need"],
    cardNoun: "Service",
    requiresNextDate: false,
    parish: true,
  },
  {
    id: "presbyterian",
    name: "Reformed Presbyterian",
    what: "Reformed Presbyterian churches that hold the Westminster Standards. Service times, the meal after, the church calendar, and families who need meals this week.",
    takes: SERVICE,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "need"],
    cardNoun: "Service",
    requiresNextDate: false,
    parish: true,
  },
  {
    id: "latin",
    name: "Latin Mass",
    what: "Traditional Latin Mass. Service times, the meal after, the church calendar, and families who need meals this week.",
    takes: SERVICE,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "need"],
    cardNoun: "Service",
    requiresNextDate: false,
    parish: true,
  },
  {
    id: "orthodox",
    name: "Greek Orthodox",
    what: "Greek Orthodox. Service times, the meal after, the church calendar, and families who need meals this week.",
    takes: SERVICE,
    stewardTakes: ["noted"],
    cardKinds: ["meeting", "need"],
    cardNoun: "Service",
    requiresNextDate: false,
    parish: true,
  },
  {
    id: "dispatch",
    name: "Dispatch",
    what: "Notices from the stewards: a road closed, a hearing moved. Members read; only stewards post.",
    takes: [],
    stewardTakes: ["saw"],
    cardKinds: [],
    cardNoun: "Meeting",
    requiresNextDate: false,
    parish: false,
  },
];

/** Room ids shipped in code. A group cannot take one, even if the row is missing. */
export const CODE_ROOM_IDS: ReadonlySet<string> = new Set(ROOMS.map((room) => room.id));

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
  {
    id: "did",
    label: "Did",
    what: "Something you did, with the date and one piece of proof: who was there, a receipt, a photo you took.",
    claimLabel: "What you did",
    reasonLabel: "One proof",
    dateLabel: "Date",
    cardPick: "optional",
    tradePick: true,
    attest: false,
    closes: false,
    closable: false,
  },
  {
    id: "asked",
    label: "Asked",
    what: "One question, and what you already tried. Mark it answered when someone answers it.",
    claimLabel: "The question",
    reasonLabel: "What you already tried",
    cardPick: "none",
    tradePick: false,
    attest: false,
    closes: false,
    closable: true,
  },
  {
    id: "noted",
    label: "Notice",
    what: "A steward's announcement, with where it comes from.",
    claimLabel: "The notice",
    reasonLabel: "Where it comes from",
    cardPick: "none",
    tradePick: false,
    attest: false,
    closes: false,
    closable: false,
  },
  {
    id: "saw",
    label: "Bulletin",
    what: "A steward's notice about something happening in public right now, with the time and the block.",
    claimLabel: "What is happening, in public",
    reasonLabel: "The clock and the street or block",
    dateLabel: "Date",
    cardPick: "none",
    tradePick: false,
    attest: true,
    closes: false,
    closable: false,
  },
  {
    id: "hosted",
    label: "Hosted",
    what: "The host's write-up after a meeting: how it went, who came, one person worth mentioning, and the next date. No headcount.",
    claimLabel: "How it went",
    dateLabel: "The date it happened",
    cardPick: "own",
    tradePick: false,
    attest: false,
    closes: true,
    closable: false,
  },
];

export const CARD_LABELS: Record<
  "meeting" | "trade" | "need",
  { name: string; place: string; time: string; host: string }
> = {
  meeting: { name: "Name", place: "Place", time: "Time", host: "Host" },
  trade: {
    name: "Business or tradesman",
    place: "Town",
    time: "What they do",
    host: "Their name here",
  },
  need: {
    name: "Who needs it (household, first names only)",
    place: "Where to bring it",
    time: "What is needed",
    host: "Who is organizing",
  },
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Replaced when the server sends its room list. Demo mode keeps ROOMS. */
let roomCatalog: readonly Room[] = ROOMS;

export function setRoomCatalog(rooms: readonly Room[]) {
  roomCatalog = rooms.length > 0 ? rooms : ROOMS;
}

export function currentRooms(): readonly Room[] {
  return roomCatalog;
}

export function roomById(id: RoomId, rooms: readonly Room[] = roomCatalog): Room {
  return rooms.find((room) => room.id === id) ?? ROOMS.find((room) => room.id === id) ?? ROOMS[0];
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

/** Local calendar days. Adding 24 hours repeats the fallback day and drops the Saturday after it. */
export function addDays(iso: string, days: number): string {
  return shiftLocalDate(iso, days);
}

const CALENDAR_DATE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

export function formatDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? date.toLocaleDateString("en-US", CALENDAR_DATE) : iso;
}

export function formatWhen(at: number, now: number): string {
  const mins = Math.round(Math.max(0, now - at) / MINUTE);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString("en-US", CALENDAR_DATE);
}

export function newPost(
  fields: Pick<Post, "room" | "type" | "claim" | "author"> & Partial<Post>,
): Post {
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
    media: fields.media ?? [],
  };
}

export function newCard(
  fields: Pick<MeetingCard, "room" | "kind" | "name" | "place" | "time" | "host"> &
    Partial<MeetingCard>,
): MeetingCard {
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
// Threats, pornography, doxxing, blasphemy, and headcounts are caught here.
// The steward's hard remove is the real rule.

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
  /** Set when a picture is uploaded, so the post id matches the stored object. */
  postId: string;
  media: SharedMedia[];
  subject: "" | "candidate" | "business";
};

export function blankDraft(room: RoomId): Draft {
  return {
    room,
    type: null,
    claim: "",
    reason: "",
    on: todayIso(),
    next: "",
    came: [],
    named: "",
    pages: "",
    attested: false,
    cardId: "",
    tradeId: "",
    postId: "",
    media: [],
    subject: "",
  };
}

export type ComposerField =
  | "type"
  | "claim"
  | "reason"
  | "on"
  | "next"
  | "card"
  | "trade"
  | "named"
  | "pages"
  | "attest"
  | "form";

export function composerErrorId(field: ComposerField): string {
  return `composer-${field}-error`;
}

/** The plain-language post button for each kind of post. */
export function postButtonLabel(type: PostType): string {
  switch (type) {
    case "asked":
      return "Post question";
    case "did":
      return "Post what you did";
    case "noted":
      return "Post notice";
    case "saw":
      return "Post bulletin";
    case "hosted":
      return "Post meeting";
  }
}

/**
 * Enter posts from a single-line field. A textarea inserts a newline on Enter,
 * and posts on Ctrl+Enter or Cmd+Enter. Shift+Enter never posts.
 */
export function composerSubmitsOnEnter(
  key: string,
  modifiers: { meta: boolean; ctrl: boolean; shift: boolean },
  multiline: boolean,
): boolean {
  if (key !== "Enter" || modifiers.shift) return false;
  return multiline ? modifiers.meta || modifiers.ctrl : true;
}

/** True when Clear would throw away something the person wrote. */
export function draftHasWriting(draft: Draft): boolean {
  const today = todayIso();
  return (
    draft.claim.trim() !== "" ||
    draft.reason.trim() !== "" ||
    draft.pages.trim() !== "" ||
    draft.named !== "" ||
    draft.came.length > 0 ||
    draft.tradeId !== "" ||
    draft.media.length > 0 ||
    draft.postId !== "" ||
    draft.attested ||
    draft.next !== "" ||
    (draft.on !== "" && draft.on !== today)
  );
}

export type Check = {
  ok: boolean;
  stops: string[];
  notes: string[];
  /** Messages for each field, so the form can point aria-describedby at them. */
  fields?: Partial<Record<ComposerField, string[]>>;
};
export type CheckContext = {
  author: string;
  steward: boolean;
  posts: Post[];
  cards: MeetingCard[];
  removals: RemovalRow[];
  bans?: BanRow[];
  appeals?: AppealRow[];
  rooms?: readonly Room[];
  now: number;
};

export function sawLockedFor(author: string, posts: Post[]): boolean {
  const own = posts
    .filter((post) => post.author === author && !post.parentId && !post.removed)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3);
  return own.length === 3 && own.every((post) => post.mark === "sloppy");
}

export type Ban = { until: number; strikes: number; reason: HardRule };

export function banFor(
  author: string,
  removals: RemovalRow[],
  now: number,
  appeals: AppealRow[] = [],
): Ban | null {
  const lifted = new Set(
    appeals
      .filter((row) => row.kind === "removal" && row.decision === "lift")
      .map((row) => row.postId),
  );
  const own = removals
    .filter((row) => row.author === author && (row.reason === "csam" || !lifted.has(row.postId)))
    .sort((a, b) => b.at - a.at);
  if (own.length === 0) return null;
  const csam = own.find((row) => row.reason === "csam");
  if (csam) return { until: csam.at + 100 * 365 * DAY, strikes: own.length, reason: "csam" };
  const until = own[0].at + BAN_DAYS * DAY;
  if (own.length < 2 && until <= now) return null;
  return { until, strikes: own.length, reason: own[0].reason };
}

/** The types this person may file in this room. */
export function typesFor(room: Room, steward: boolean): PostType[] {
  return steward ? [...room.takes, ...room.stewardTakes] : room.takes;
}

export function activeBan(
  author: string,
  removals: RemovalRow[],
  now: number,
  bans: BanRow[] = [],
  appeals: AppealRow[] = [],
): Ban | null {
  const fromRemovals = banFor(author, removals, now, appeals);
  const latest = bans.filter((row) => row.author === author).sort((a, b) => b.at - a.at)[0];
  const fromBan =
    latest && (latest.reason === "csam" || latest.strikes >= 2 || latest.until > now)
      ? { until: latest.until, strikes: latest.strikes, reason: latest.reason }
      : null;
  return (
    [fromRemovals, fromBan]
      .filter((item): item is Ban => item !== null)
      .sort((a, b) => b.strikes - a.strikes || b.until - a.until)[0] ?? null
  );
}

export function composerCheck(draft: Draft, ctx: CheckContext): Check {
  const stops: string[] = [];
  const notes: string[] = [];
  const fields: Partial<Record<ComposerField, string[]>> = {};
  const stop = (field: ComposerField, message: string) => {
    stops.push(message);
    const list = fields[field] ?? [];
    list.push(message);
    fields[field] = list;
  };
  const attach = (field: ComposerField, message: string) => {
    const list = fields[field] ?? [];
    list.push(message);
    fields[field] = list;
  };
  const room = roomById(draft.room, ctx.rooms);

  if (activeBan(ctx.author, ctx.removals, ctx.now, ctx.bans, ctx.appeals)) {
    const message = "This account cannot post right now.";
    return { ok: false, stops: [message], notes, fields: { form: [message] } };
  }
  if (!draft.type) {
    const message = "Choose what kind of post this is.";
    return { ok: false, stops: [message], notes, fields: { type: [message] } };
  }
  const meta = typeMeta(draft.type);
  if (!typesFor(room, ctx.steward).includes(draft.type)) {
    stop(
      "type",
      room.stewardTakes.includes(draft.type)
        ? `Only a steward can post a ${meta.label}.`
        : `${room.name} does not take ${meta.label} posts.`,
    );
  }

  const claim = draft.claim.trim();
  const reason = draft.reason.trim();
  if (!claim) stop("claim", `Missing: ${meta.claimLabel.toLowerCase()}.`);
  if (meta.reasonLabel && !reason) stop("reason", `Missing: ${meta.reasonLabel.toLowerCase()}.`);
  if ((claim && !isEnglish(claim)) || (reason && !isEnglish(reason))) {
    const message = "Write it in English.";
    stops.push(message);
    if (claim && !isEnglish(claim)) attach("claim", message);
    if (reason && !isEnglish(reason)) attach("reason", message);
  }
  if (claim.length > 600) stop("claim", "Keep it under 600 characters.");
  if (meta.dateLabel && !isIsoDate(draft.on)) stop("on", "Add the date.");
  if (meta.closes && draft.next && !isIsoDate(draft.next))
    stop("next", "The next date is not a valid date.");
  if (meta.closable && (claim.match(/\?/g) ?? []).length > 1)
    stop("claim", "One question per post. Ask the second one separately.");

  if (meta.cardPick === "own") {
    const card = ctx.cards.find((item) => item.id === draft.cardId);
    if (!card) stop("card", "Choose which meeting this is about.");
    else if (card.host !== ctx.author) stop("card", "Only the host can write up a meeting.");
    else if (card.room !== draft.room)
      stop("card", `That card lives in ${roomById(card.room, ctx.rooms).name}.`);
    if (hasHeadcount(claim))
      stop("claim", "Leave out the headcount. Say how it went, not how many came.");
    if (card?.book && draft.next && !draft.pages.trim())
      stop("pages", "Say what to read before the next meeting.");
    if (draft.named) {
      if (draft.named === ctx.author) stop("named", "You cannot mention yourself.");
      else if (!draft.came.includes(draft.named))
        stop("named", "You can only mention someone who was there.");
    }
  }
  if (meta.tradePick && draft.tradeId) {
    const trade = ctx.cards.find((item) => item.id === draft.tradeId);
    if (trade && trade.host === ctx.author) stop("trade", "You cannot vouch for your own work.");
  }
  if (meta.attest) {
    if (sawLockedFor(ctx.author, ctx.posts))
      stop(
        "form",
        "Notices are locked until you revise one of your last three posts; all three were marked sloppy.",
      );
    if (!hasClock(reason) && !hasClock(claim)) {
      stop(meta.reasonLabel ? "reason" : "claim", "Include the time.");
    }
    if (hasStreetAddress(claim) || hasStreetAddress(reason)) {
      const message =
        "That looks like a home address. Give the block or the corner, not the house number.";
      stops.push(message);
      if (hasStreetAddress(claim)) attach("claim", message);
      if (hasStreetAddress(reason)) attach("reason", message);
    }
    if (!draft.attested)
      stop("attest", "Tick the box to confirm: no children's faces, no private person named.");
  }

  const text = `${claim}\n${reason}`;
  const refuse = (hit: (value: string) => boolean, message: string) => {
    if (!hit(text)) return;
    stops.push(message);
    if (hit(claim)) attach("claim", message);
    if (hit(reason)) attach("reason", message);
    if (!hit(claim) && !hit(reason)) attach("form", message);
  };
  refuse(looksLikeThreat, "That reads as a threat and will not post.");
  refuse(looksLikePorn, "That will not post.");
  refuse(looksLikeDoxxing, "That reads as doxxing and will not post.");
  refuse(looksLikeBlasphemy, "That mocks God or Christ and will not post.");
  if (meta.reasonLabel && reason && reason.length < 12)
    notes.push("That is a short reason. A steward may mark the post No legs.");
  if (/^https?:\/\/\S+$/i.test(claim))
    notes.push("A link on its own is not a post. Say what is at the link.");
  if (draft.media.length > 1) stop("form", "One picture per post.");

  return { ok: stops.length === 0, stops, notes, fields };
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

export function deskDid(input: DeskContact & { author: string }): Post {
  return newPost({
    room: "county",
    type: "did",
    claim: `${input.waveLabel}: ${input.office}, ${input.role}. ${input.title}.`,
    reason: `Logged on the Avouch desk by ${input.who.trim() || "me"}. Window ${input.window}.`,
    on: todayIso(),
    author: input.author,
    campaignId: input.campaignId,
  });
}

// --- Sort, shelf, week, cards -------------------------------------------------
// A mark dims a post. It does not move it, hide it, or score it.

export function sortRoom(posts: Post[], room: RoomId): Post[] {
  return posts
    .filter((post) => post.room === room && !post.parentId && !post.removed)
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
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
  const hosts = new Map(
    cards.filter((card) => card.kind === "trade").map((card) => [card.id, card.host]),
  );
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

export function shelfFor(
  room: RoomId,
  cards: MeetingCard[],
  witnesses: Map<string, string[]>,
  today: string,
): MeetingCard[] {
  const listed = cards.filter(
    (card) => card.room === room && card.kind !== "trade" && cardListed(card, witnesses),
  );
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

/**
 * The next seven local days that have something on them. Empty days are left
 * out. A named weekday is placed on that weekday. A stored date is a local
 * calendar day, not a UTC instant.
 */
export function weekFor(cards: MeetingCard[], witnesses: Map<string, string[]>, today: string): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const iso = addDays(today, i);
    const dated = cards.filter((card) => {
      const occurs = meetingDates(card.time, card.next, today, {
        paused: card.paused,
        cancelled: card.cancelled,
        until: card.until,
      });
      return occurs.includes(iso) && card.kind !== "trade" && card.kind !== "need" && cardListed(card, witnesses);
    });
    if (dated.length > 0) days.push({ iso, cards: dated });
  }
  return days;
}

export function needsFor(cards: MeetingCard[], room?: RoomId): MeetingCard[] {
  return cards.filter(
    (card) =>
      card.kind === "need" && (!room || card.room === room) && card.slots.some((slot) => !slot.by),
  );
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

/** Everyone `me` has been to a meeting with, or who replied to me. The gate for messages and profiles. */
export function stoodWith(me: string, cards: MeetingCard[], posts: Post[]): Set<string> {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.wentBy.includes(me)) for (const name of card.wentBy) names.add(name);
  }
  const mine = new Set(
    posts.filter((post) => post.author === me && !post.parentId).map((post) => post.id),
  );
  for (const post of posts) if (post.parentId && mine.has(post.parentId)) names.add(post.author);
  names.delete(me);
  return names;
}

/** The last few times a host named this person, newest first. */
export function namedLines(name: string, posts: Post[]): Post[] {
  return posts
    .filter((post) => post.type === "hosted" && post.named === name && !post.removed)
    .sort((a, b) => b.at - a.at)
    .slice(0, NAMED_SHOWN);
}

export function threadIdFor(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function otherIn(thread: DmThread, me: string): string {
  return thread.between.find((name) => name !== me) ?? "";
}
