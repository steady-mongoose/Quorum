// The Board: a town board with a lock on the feed.
// Every rule from the design handoff lives here, not in the views, so the
// composer, the sort, and the steward tools cannot drift from the brief.

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

export type Room = {
  id: RoomId;
  name: string;
  what: string;
  /** Post types the composer will accept here. Dispatch is Saw only. */
  takes: PostType[];
  /** True for rooms whose Find cards are a service time, not a meeting. */
  service: boolean;
};

export type Post = {
  id: string;
  room: RoomId;
  type: PostType;
  /** The act, the question, the passage, or the scene. One claim. */
  claim: string;
  /** The proof, what was tried, the source, or the clock and place. */
  reason: string;
  /** ISO date (yyyy-mm-dd) for Did and Saw. */
  on: string;
  author: string;
  at: number;
  /** Replies are threaded one level. No reshare, no quote. */
  parentId: string | null;
  /** Asked closes when the author marks an answer. */
  closed: boolean;
  mark: Mark | null;
  /** Set by a steward. Removed posts leave the feed; the log keeps the row. */
  removed: boolean;
  /** Links a Civic Did to the Quorum campaign that produced it. */
  campaignId?: string;
  /** Hosted: the card it closes. Did: the card it was about, if any. */
  cardId?: string;
  /** Did: the trade card for whoever did the work. Two witnesses list a trade. */
  tradeId?: string;
};

/** A trade card is a business. It cannot list itself; two members' Dids do. */
export type CardKind = "meeting" | "candidate" | "trade";

export type MeetingCard = {
  id: string;
  room: RoomId;
  kind: CardKind;
  name: string;
  place: string;
  /** Free text: "First Monday 7:30 p.m." or "Sunday 7, 9, 11". */
  time: string;
  host: string;
  /** Next occurrence, ISO date. Guilds need one or they are not listed. */
  next: string;
  /** Oldest first, up to four. true = it happened. */
  lastFour: boolean[];
  /** How many times the person who listed it has been. Two to list. */
  visits: number;
  /** Pinned in its room until the hour. */
  pinned: boolean;
  /** From the brief: checked once, still to be visited before it stays. */
  unverified: boolean;
  addedBy: string;
  /** Names who marked "I went". Two people on one list may message each other. */
  wentBy: string[];
  /** The host will take a first-timer. Opens a message to the host. */
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

export type DmThread = {
  id: string;
  /** Two names, sorted. No groups. */
  between: [string, string];
};

export type DmMessage = {
  id: string;
  threadId: string;
  from: string;
  text: string;
  at: number;
};

/** Messages are plain and kept 30 days. Say so on the about page. */
export const DM_RETENTION_DAYS = 30;
/** A room opens on its shelf only when a card has a date this close. */
export const SHELF_DAYS = 14;
export const SHELF_MAX = 2;

export type Ban = {
  author: string;
  until: number;
  reason: string;
  strikes: number;
};

export type RemovalRow = {
  id: string;
  postId: string;
  author: string;
  reason: HardRule;
  at: number;
};

export type HardRule = "threat" | "porn" | "csam";

export const HARD_RULES: { id: HardRule; label: string; why: string }[] = [
  { id: "threat", label: "Threat of violence", why: "Hard remove. 30-day filing ban. Second time, the account closes." },
  { id: "porn", label: "Pornography", why: "Hard remove. 30-day filing ban. Second time, the account closes." },
  {
    id: "csam",
    label: "Child sexual abuse material",
    why: "Hard remove. The host will cut the box off whether the rules mention it or not.",
  },
];

export const BAN_DAYS = 30;
export const SESSION_LINE_MINUTES = 20;

export const ROOMS: Room[] = [
  {
    id: "civic",
    name: "Civic",
    what: "Hearings, bills, labeled candidate cards. The Quorum desk files its calls here.",
    takes: ["did", "asked", "noted", "hosted"],
    service: false,
  },
  {
    id: "hall",
    name: "Public hall",
    what: "One question, a Christian host, chairs open to anyone. A brewery or a hall.",
    takes: ["did", "asked", "noted", "hosted"],
    service: false,
  },
  {
    id: "skills",
    name: "Skills",
    what: "Carpentry, gardening, fishing, baking, radio, lawful gunsmithing as a bench log. No build instructions. A tradesman is listed by the people he worked for.",
    takes: ["did", "asked", "noted", "hosted"],
    service: false,
  },
  {
    id: "guilds",
    name: "Guilds",
    what: "Apprentice night, men's gym hour, women's gym hour. A next date or it is not listed.",
    takes: ["did", "asked", "noted", "hosted"],
    service: false,
  },
  {
    id: "school",
    name: "School",
    what: "Classical Christian and homeschool chapter logs. Not curriculum ads.",
    takes: ["did", "asked", "noted", "hosted"],
    service: false,
  },
  {
    id: "reformed",
    name: "Reformed",
    what: "Service time only.",
    takes: ["noted", "hosted"],
    service: true,
  },
  {
    id: "latin",
    name: "Latin Mass",
    what: "Service time only.",
    takes: ["noted", "hosted"],
    service: true,
  },
  {
    id: "orthodox",
    name: "Greek Orthodox",
    what: "Service time only.",
    takes: ["noted", "hosted"],
    service: true,
  },
  {
    id: "dispatch",
    name: "Dispatch",
    what: "Saw posts only. A public scene, a clock, a clip. No home addresses, no children's faces, no naming a private person.",
    takes: ["saw"],
    service: false,
  },
];

export const POST_TYPES: {
  id: PostType;
  label: string;
  what: string;
  claimLabel: string;
  reasonLabel: string;
  needsDate: boolean;
}[] = [
  {
    id: "did",
    label: "Did",
    what: "An act, a date, one proof. No verdict.",
    claimLabel: "What you did",
    reasonLabel: "One proof (a photo you took, a receipt, who was there)",
    needsDate: true,
  },
  {
    id: "asked",
    label: "Asked",
    what: "One question, and what was already tried. Closes when answered.",
    claimLabel: "The question",
    reasonLabel: "What you already tried",
    needsDate: false,
  },
  {
    id: "noted",
    label: "Noted",
    what: "A passage, a measurement, a date. No ask.",
    claimLabel: "The passage, measurement, or date",
    reasonLabel: "Where it comes from",
    needsDate: false,
  },
  {
    id: "saw",
    label: "Saw",
    what: "Public scene, clock, clip. Dispatch room only.",
    claimLabel: "What you saw, in public",
    reasonLabel: "The clock and the street or block",
    needsDate: true,
  },
  {
    id: "hosted",
    label: "Hosted",
    what: "The host says it happened and names the next date. No headcount. The record is the ad.",
    claimLabel: "How it went (a line, not a number)",
    reasonLabel: "Next date (yyyy-mm-dd), or 'none'",
    needsDate: true,
  },
];

export function roomById(id: RoomId): Room {
  return ROOMS.find((room) => room.id === id) ?? ROOMS[0];
}

export function typeMeta(type: PostType) {
  return POST_TYPES.find((item) => item.id === type) ?? POST_TYPES[0];
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A clock: "7:30", "7:30 p.m.", "19:05", "noon", "7pm".
const CLOCK = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;
// A home address: a house number followed by a street word.
const STREET_ADDRESS =
  /\b\d{2,6}\s+[A-Za-z0-9.'-]+(\s+[A-Za-z0-9.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace)\b\.?/i;
const THREAT =
  /\b(i('| wi)ll|we('| wi)ll|gonna|going to|should|let's|lets)\s+(kill|shoot|stab|hang|burn|beat|hurt|bomb|lynch)\b|\b(kill|shoot|hang|burn)\s+(him|her|them|you|that)\b/i;
const PORN = /\b(porn|pornograph|xxx|onlyfans|nsfw)\b/i;
// A headcount in a Hosted: "14 came", "about 20 people", "turnout of 30".
const HEADCOUNT = /\b\d+\s*(people|folks|came|showed|attended|turned out|of us|guys|men|women)\b|\b(turnout|headcount|attendance)\b/i;

export type Check = {
  ok: boolean;
  /** Blocking problems. The post does not send. */
  stops: string[];
  /** What the steward will see. Not blocking. */
  notes: string[];
};

export type Draft = {
  room: RoomId;
  type: PostType | null;
  claim: string;
  reason: string;
  on: string;
  /** Saw only: the author attests no child's face and no private person named. */
  attested: boolean;
  /** Hosted: the card it closes. Did: the card it was about. */
  cardId: string;
  /** Did: who did the work, as a trade card. */
  tradeId: string;
};

/**
 * The composer check before send: one claim and the reason, no threat,
 * not pornography. Plus the room and type locks from the brief.
 */
export function composerCheck(
  draft: Draft,
  sawLocked: boolean,
  me = "",
  cards: MeetingCard[] = [],
): Check {
  const stops: string[] = [];
  const notes: string[] = [];
  const room = roomById(draft.room);

  if (!draft.type) {
    stops.push("Pick a type. A post with no type does not send.");
    return { ok: false, stops, notes };
  }
  if (!room.takes.includes(draft.type)) {
    if (draft.room === "dispatch") stops.push("Dispatch takes Saw only. It cannot take a Did.");
    else if (draft.type === "saw") stops.push("A street note cannot be filed here. Saw goes in Dispatch.");
    else if (room.service) stops.push(`${room.name} holds service times. File a Noted or nothing.`);
    else stops.push(`${room.name} does not take ${typeMeta(draft.type).label}.`);
  }

  const claim = draft.claim.trim();
  const reason = draft.reason.trim();
  const meta = typeMeta(draft.type);

  if (!claim) stops.push(`Say the one thing: ${meta.claimLabel.toLowerCase()}.`);
  if (!reason) stops.push(`Name the reason: ${meta.reasonLabel.toLowerCase()}.`);
  if (claim.length > 600) stops.push("One claim. Cut it under 600 characters.");
  if (meta.needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.on)) stops.push("A date, or it is not a record.");

  if (draft.type === "asked" && (claim.match(/\?/g) ?? []).length > 1) {
    stops.push("One question. Split the second one into its own Asked.");
  }

  if (draft.type === "saw") {
    if (sawLocked) stops.push("Saw is locked: three sloppy posts in a row. Revise one and it reopens.");
    if (!CLOCK.test(reason) && !CLOCK.test(claim)) stops.push("A Saw wants a clock in the proof.");
    if (STREET_ADDRESS.test(claim) || STREET_ADDRESS.test(reason)) {
      stops.push("That reads as a home address. Say the block or the corner, not the house.");
    }
    if (!draft.attested) stops.push("Attest: no child's face, no private person named who was not acting in public.");
  }

  if (draft.type === "hosted") {
    const card = cards.find((item) => item.id === draft.cardId);
    if (!card) stops.push("Name the card this closes. A Hosted without a card is a Did.");
    else if (card.host !== (me.trim() || "You")) stops.push("Only the host files a Hosted. You can file a Did that names the card.");
    else if (card.room !== draft.room) stops.push(`That card lives in ${roomById(card.room).name}. File it there.`);
    if (HEADCOUNT.test(claim)) stops.push("No headcount. Say how it went, not how many.");
    if (reason && reason.toLowerCase() !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(reason)) {
      stops.push("Next date as yyyy-mm-dd, or the word none.");
    }
  }

  if (draft.type === "did" && draft.tradeId) {
    const trade = cards.find((item) => item.id === draft.tradeId);
    if (trade && trade.host === (me.trim() || "You")) stops.push("You cannot witness your own work. Someone you worked for files this.");
  }

  const text = `${claim}\n${reason}`;
  if (THREAT.test(text)) stops.push("That reads as a threat. It does not send.");
  if (PORN.test(text)) stops.push("Not here.");

  // Quality notes, not blocks. The steward mark is about the missing reason.
  if (reason && reason.length < 12) notes.push("Thin reason. A steward can mark this unsupported.");
  if (/^https?:\/\/\S+$/i.test(claim)) notes.push("A bare link is a repost. Say what you opened.");

  return { ok: stops.length === 0, stops, notes };
}

/** Three sloppy posts in a row by this author locks Saw until one is revised. */
export function sawLockedFor(author: string, posts: Post[]): boolean {
  const own = posts
    .filter((post) => post.author === author && !post.parentId && !post.removed)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3);
  return own.length === 3 && own.every((post) => post.mark === "sloppy");
}

export function banFor(author: string, bans: Ban[], now: number): Ban | null {
  const ban = bans.find((item) => item.author === author);
  if (!ban) return null;
  if (ban.strikes >= 2) return ban;
  return ban.until > now ? ban : null;
}

function tier(post: Post): number {
  // Lower sorts first. Sloppy files at the bottom. Unsupported sorts under
  // posts that named a reason. Hosted and a Did that names a card lead;
  // other Dids and open Asked next. Noted sits under those.
  if (post.mark === "sloppy") return 5;
  if (post.mark === "unsupported") return 4;
  if (post.type === "noted") return 3;
  if (post.type === "asked" && post.closed) return 3;
  if (post.type === "hosted" || (post.type === "did" && post.cardId)) return 1;
  return 2;
}

/** Chronological inside the room, grouped by the brief's sort tiers. */
export function sortRoom(posts: Post[], room: RoomId): Post[] {
  return posts
    .filter((post) => post.room === room && !post.parentId && !post.removed)
    .sort((a, b) => tier(a) - tier(b) || b.at - a.at);
}

export function repliesTo(posts: Post[], parentId: string): Post[] {
  return posts.filter((post) => post.parentId === parentId && !post.removed).sort((a, b) => a.at - b.at);
}

/** Named members, other than the tradesman, whose Dids name this trade. */
export function tradeWitnesses(card: MeetingCard, posts: Post[]): string[] {
  const names = new Set<string>();
  for (const post of posts) {
    if (post.type === "did" && post.tradeId === card.id && !post.removed && post.author !== card.host) {
      names.add(post.author);
    }
  }
  return [...names];
}

/**
 * Unvisited cards stay off. A card hides after two missed meetings.
 * A trade card lists only when two other members have named it in a Did.
 */
export function cardListed(card: MeetingCard, posts: Post[] = []): boolean {
  if (card.kind === "trade") return tradeWitnesses(card, posts).length >= 2;
  if (card.visits < 2) return false;
  const recent = card.lastFour.slice(-2);
  if (recent.length === 2 && recent.every((went) => !went)) return false;
  if (card.room === "guilds" && !card.next) return false;
  return true;
}

function daysUntil(iso: string, now: Date): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return Number.POSITIVE_INFINITY;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - start) / 86400000);
}

/**
 * The shelf a room opens on: pinned cards, then cards with a date inside
 * SHELF_DAYS, at most SHELF_MAX. Empty when nothing is near, so the room
 * opens on its feed instead of an empty shelf.
 */
export function shelfFor(room: RoomId, cards: MeetingCard[], posts: Post[], now: Date): MeetingCard[] {
  const listed = cards.filter((card) => card.room === room && card.kind !== "trade" && cardListed(card, posts));
  const pinned = listed.filter((card) => card.pinned);
  const soon = listed
    .filter((card) => !card.pinned && card.next)
    .map((card) => ({ card, days: daysUntil(card.next, now) }))
    .filter((item) => item.days >= 0 && item.days <= SHELF_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((item) => item.card);
  return [...pinned, ...soon].slice(0, SHELF_MAX);
}

/**
 * Who may message whom. Both on one card's "I went" list, or the other
 * person replied to one of your posts. Strangers do not get a line in.
 */
export function canDm(me: string, other: string, cards: MeetingCard[], posts: Post[]): boolean {
  if (!me || !other || me === other) return false;
  if (cards.some((card) => card.wentBy.includes(me) && card.wentBy.includes(other))) return true;
  const mine = new Set(posts.filter((post) => post.author === me && !post.parentId).map((post) => post.id));
  return posts.some((post) => post.author === other && post.parentId !== null && mine.has(post.parentId));
}

export function threadIdFor(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

export function cardCanPin(card: MeetingCard, posts: Post[]): boolean {
  // A card cannot be held by a post the steward marked. The card is the ad
  // for the next date, so the host's last note must have named a reason.
  const hostNote = posts
    .filter((post) => post.author === card.host && post.room === card.room && !post.removed)
    .sort((a, b) => b.at - a.at)[0];
  return !hostNote || hostNote.mark === null;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatWhen(at: number, now: number): string {
  const mins = Math.round(Math.max(0, now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString();
}

/** Cards from the brief, checked once, still to be visited before they stay. */
export const SEED_CARDS: MeetingCard[] = [
  {
    id: "latin-epiphany",
    room: "latin",
    kind: "meeting",
    name: "Epiphany of Our Lord Shrine",
    place: "2510 E Hanna Ave, Tampa",
    time: "Sunday Low Mass 7 and 9, High Mass 11",
    host: "Institute of Christ the King",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "orthodox-stjohn",
    room: "orthodox",
    kind: "meeting",
    name: "St. John the Baptist",
    place: "2418 W Swann Ave, Tampa",
    time: "Confirm in person",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "reformed-redeemer",
    room: "reformed",
    kind: "meeting",
    name: "Redeemer Presbyterian",
    place: "Boyette Road, Riverview",
    time: "Confirm in person",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "reformed-first",
    room: "reformed",
    kind: "meeting",
    name: "First Reformed",
    place: "W Hillsborough Ave, Tampa",
    time: "Confirm in person",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "skills-ham",
    room: "skills",
    kind: "meeting",
    name: "Tampa Amateur Radio Club",
    place: "7801 N 22nd St, Tampa",
    time: "First Monday 7:30 p.m. Tuesday net 147.105 at 8 p.m.",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "skills-garden",
    room: "skills",
    kind: "meeting",
    name: "Hillsborough Master Gardener desk",
    place: "(813) 744-5519 ext. 54102",
    time: "Office hours",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "skills-stoics",
    room: "skills",
    kind: "meeting",
    name: "Tampa Stoics",
    place: "Tampa",
    time: "Confirm in person",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
  {
    id: "guilds-shapes",
    room: "guilds",
    kind: "meeting",
    name: "Shapes, women's gym hour",
    place: "731 W Lumsden, Brandon",
    time: "Confirm in person",
    host: "",
    next: "",
    lastFour: [],
    visits: 1,
    pinned: false,
    unverified: true,
    addedBy: "brief",
    wentBy: [],
    firstTimer: false,
  },
];

export function blankDraft(room: RoomId): Draft {
  return { room, type: null, claim: "", reason: "", on: todayIso(), attested: false, cardId: "", tradeId: "" };
}
