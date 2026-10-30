import { create } from "zustand";
import { persist } from "zustand/middleware";
import { readDemoFlag } from "../api-mode.ts";
import { roleCounts } from "./rsvp-rules.ts";
import {
  getBoardClient,
  type AccessInput,
  type BoardPage,
  type BoardSnapshot,
  type CouncilInput,
  type PlaceInput,
  type RoomDecisionInput,
  type RoomRequestInput,
  type ZipCorrectionInput,
} from "./client.ts";
import type { HomePayload } from "./home.ts";
import type { RoomOption } from "./room-options.ts";
import { removalFailedCopy } from "./errors.ts";

/**
 * A close that saved on the server while its write-up did not: the roll call
 * it sent, for this card AND this date. The going rows are gone after that
 * close, so the refreshed list is empty; a retry of the same date reuses
 * these instead of closing again with no picks (QA S3 #2). Keyed by date so
 * next week's close of a repeating gathering calls attendance fresh, and
 * cleared on Cancel, sign-out, or another account (QA S3 #1).
 */
let rsvpViewer: string | null = null;
type SavedClose = { date: string; sent: string[]; names: string[]; happened: boolean };
const closedUnfiled = new Map<string, SavedClose>();
/**
 * The saved close for this card and date (who it marked and whether it
 * happened), or null. A retry files that outcome, never a new one (Design #126 M1).
 */
export function savedClose(cardId: string, date: string): SavedClose | null {
  const kept = closedUnfiled.get(cardId);
  return kept && kept.date === date ? { ...kept, sent: [...kept.sent], names: [...kept.names] } : null;
}
/**
 * The names a saved close marked, for this card and date, or null when none
 * is saved. The form locks to these, and the retry's write-up names them,
 * even after a remount or an empty re-read list (Design #126 M1).
 */
export function savedCloseNames(cardId: string, date: string): string[] | null {
  const kept = closedUnfiled.get(cardId);
  return kept && kept.date === date ? [...kept.names] : null;
}
/** True while this card's close for `date` saved and its write-up is not filed yet. */
export function closeSavedFor(cardId: string, date?: string): boolean {
  const kept = closedUnfiled.get(cardId);
  return !!kept && (date === undefined || kept.date === date);
}
/** Cancel on the close form, or a composer cleared: the next close calls attendance again. */
export function forgetSavedClose(cardId?: string): void {
  if (cardId === undefined) closedUnfiled.clear();
  else closedUnfiled.delete(cardId);
}
/** Close once per date; a retry after a failed write-up reuses that close's roll call. */
async function closeOnce(
  close: () => Promise<{ stop: string | null; sent: string[] }>,
  cardId: string,
  date: string,
  names: string[],
  happened = true,
): Promise<{ stop: string | null; sent: string[] }> {
  const kept = closedUnfiled.get(cardId);
  if (kept && kept.date === date) return { stop: null, sent: kept.sent };
  closedUnfiled.delete(cardId);
  const closed = await close();
  if (!closed.stop) closedUnfiled.set(cardId, { date, sent: closed.sent, names: [...names], happened });
  return closed;
}

/** How long Find offers Undo before the DELETE is sent. */
export const REMOVAL_UNDO_MS = 5000;
import {
  loadGatherings,
  removeGathering,
  removeGatheringKeepalive,
  saveGathering,
  type StoredGathering,
} from "./gathering-public.ts";
import { isGatheringId } from "./public-gathering.ts";
import {
  applyServerRsvps,
  CAME_NOT_SAVED,
  ROLL_CALL_STALE,
  cameIdsFor,
  deviceRsvpMoves,
  loadRsvps,
  moveRsvps,
  rollCallPeople,
  keptOnDevice,
  RSVP_NOT_SAVED,
  saveAttendance,
  saveMyRsvp,
  type RollPerson,
  type RsvpFail,
} from "./rsvp-api.ts";
import {
  APP_NAME,
  DAY,
  DM_RETENTION_DAYS,
  dmTextError,
  FOUNDER_CODE,
  ROOMS,
  authorName,
  blankDraft,
  composerCheck,
  deskDid,
  inviteCode,
  inviteLive,
  newCard,
  newPost,
  setRoomCatalog,
  messageableNames,
  threadIdFor,
  todayIso,
  type AppealDecision,
  type AppealKind,
  type AppealRow,
  type BanRow,
  type Check,
  type CsamReport,
  type DeskContact,
  type DmMessage,
  type DmThread,
  type Draft,
  type HardRule,
  type Invite,
  type Mark,
  type MarkRow,
  type MeetingCard,
  type Post,
  type Profile,
  type RemovalRow,
  type Room,
  type RoomId,
  type Section,
  type SharedMedia,
} from "./model.ts";
import { SENTENCE_ERROR, oneSentence } from "./text.ts";

type BoardState = {
  section: Section;
  room: RoomId;
  /** The Rooms tab is the category browse. A room page sets this off. */
  browsing: boolean;
  /** In by a code. Without it, only the door shows. */
  member: boolean;
  /** The founder code has been used on this box. */
  founded: boolean;
  me: string;
  profile: Profile;
  /** The desk is opt-in. Off until this member turns it on. */
  deskOn: boolean;
  /** Whose profile is open. */
  viewing: string | null;
  steward: boolean;
  /** Founding admin. Room creation and the role owner's sign-off. */
  admin: boolean;
  /** A council member can label a candidate or business post, once. */
  council: boolean;
  councilChair: boolean;
  /** Rooms this person stewards. An admin is not listed; they can moderate every room. */
  stewardRooms: string[];
  /** Null until this member states it. The server is the record. */
  gender: "man" | "woman" | null;
  genderConfirmed: boolean;
  genderSetBy: "self" | "inviter" | "steward";
  genderNeedsConfirmation: boolean;
  /** Set when a restricted room cannot be opened. Not stored. */
  roomHold: {
    roomId: string;
    code: "gender-unstated" | "gender-unconfirmed" | "missing";
    audience?: "men" | "women";
  } | null;
  roomHoldBack: { section: Section; room: RoomId } | null;
  dismissRoomHold: () => void;
  /** Server Home. Null on a local board. The array order is the server's. */
  home: HomePayload | null;
  /** True while this browser is writing rooms and posts to the API. */
  remote: boolean;
  boardError: string;
  /** Names in the current removal failure, oldest first. Not stored. */
  failedRemovalNames: string[];
  /** Removals still inside the undo window, oldest first. Not stored. */
  undoQueue: MeetingCard[];
  /** A card just put back after a failed removal. Find scrolls it into view. Not stored. */
  scrollCardId: string | null;
  rooms: Room[];
  posts: Post[];
  cards: MeetingCard[];
  invites: Invite[];
  removals: RemovalRow[];
  bans: BanRow[];
  appeals: AppealRow[];
  csamReports: CsamReport[];
  markLog: MarkRow[];
  /** Per-room cursor. A null next means that room has no older page. */
  roomPages: BoardPage[];
  threads: DmThread[];
  messages: DmMessage[];
  openThread: string | null;
  /** Set when Message in a room's member list opened the conversation; Back returns there. */
  dmFrom: { room: RoomId; memberId: string; name: string; userId: string | null } | null;
  /** The member row whose Message button takes focus when its room shows again. */
  focusMember: string | null;
  lineDismissedAt: number;
  /**
   * Server user ids whose RSVPs this browser has already moved to the server
   * (migration 0049). The move runs once per member per browser.
   */
  rsvpMovedFor: string[];
  /** Gathering ids this member hosts, from /api/rsvps. forViewer reads it. */
  rsvpHosts: string[];
  /** Roll call by member id, for gatherings this member hosts (or every one, for an admin). */
  rollCall: Record<string, RollPerson[]>;
  /** Cards whose RSVP is being saved. The button is aria-busy until it lands. */
  rsvpPending: string[];
  /** Cards whose last RSVP save failed. A "Not saved" line shows under the button. */
  rsvpFailed: string[];
  setSection: (section: Section) => void;
  setRoom: (room: RoomId) => void;
  setMe: (me: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  setDeskOn: (on: boolean) => void;
  view: (name: string) => void;
  dismissLine: () => void;
  /** `cameIds`: the roll call's member ids, when the server gave one. */
  file: (draft: Draft, options?: { cameIds?: string[] }) => Promise<Check>;
  fileDeskContact: (input: DeskContact) => Promise<void>;
  reply: (parentId: string, text: string) => Promise<void>;
  revise: (id: string, patch: Pick<Post, "claim" | "reason">) => Promise<void>;
  closeAsked: (id: string) => Promise<void>;
  mark: (id: string, mark: Mark | null, reason: string) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string, reason: HardRule) => Promise<{ ok: boolean; error?: string }>;
  appeal: (
    postId: string,
    kind: AppealKind,
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  decideAppeal: (
    id: string,
    decision: AppealDecision,
    reason: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  createRoom: (input: {
    id: string;
    name: string;
    what: string;
    categoryIds: string[];
    audience?: "all" | "men" | "women";
    stewardEmail?: string;
    inviterEmail?: string;
    options?: RoomOption[];
  }) => Promise<{ ok: boolean; error?: string }>;
  updateRoom: (input: {
    id: string;
    categoryIds?: string[];
    name?: string;
    what?: string;
    pinOrder?: number | null;
    options?: RoomOption[];
  }) => Promise<{ ok: boolean; error?: string }>;
  setRoomAudience: (
    roomId: string,
    audience: "all" | "men" | "women",
  ) => Promise<{ ok: boolean; error?: string }>;
  setGender: (gender: "man" | "woman") => Promise<{ ok: boolean; error?: string }>;
  confirmGender: (email: string) => Promise<{ ok: boolean; error?: string }>;
  appointSteward: (input: {
    email: string;
    action: "grant" | "revoke";
    note: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  savePlace: (input: PlaceInput) => Promise<{ ok: boolean; error?: string }>;
  joinRoom: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  leaveRoom: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  requestRoom: (input: RoomRequestInput) => Promise<{ ok: boolean; error?: string }>;
  decideRoom: (id: string, input: RoomDecisionInput) => Promise<{ ok: boolean; error?: string }>;
  correctZip: (input: ZipCorrectionInput) => Promise<{ ok: boolean; error?: string }>;
  changeAccess: (input: AccessInput) => Promise<{ ok: boolean; error?: string }>;
  setCouncil: (id: string, input: CouncilInput) => Promise<{ ok: boolean; error?: string }>;
  connectRemote: () => Promise<void>;
  loadOlder: (room: RoomId) => Promise<void>;
  disconnectRemote: () => void;
  addCard: (card: Parameters<typeof newCard>[0]) => void;
  updateCard: (id: string, patch: Partial<MeetingCard>) => void;
  /** The host closes a date without the composer. Runs the same check. "It did not happen" is a Hosted that says so. */
  closeCard: (
    id: string,
    happened: boolean,
    next: string,
    line: string,
    came: string[],
    pages?: string,
    cameIds?: string[],
  ) => Promise<Check>;
  /** Read the RSVPs and roll calls again (the Reload next to a stale roll call). */
  reloadRsvps: () => Promise<void>;
  /** "I'll be there." Names, never a count. */
  rsvp: (id: string) => void;
  /** "I've been": only the card's host or an admin. Anyone else's tap does nothing. */
  visited: (id: string) => void;
  removeCard: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Cancel a removal that has not been sent yet and put the card back. */
  undoRemoveCard: (id: string) => boolean;
  /**
   * Send removals that are still inside the undo window.
   * `keepalive` is for the document going away; `now` is for leaving Find.
   */
  commitPendingRemovals: (mode: "now" | "keepalive") => void;
  /** A host makes a one-use code for one card. The card shows only after a name redeems it. */
  createInvite: (cardId: string) => string | null;
  /**
   * The door. A host's code opens its card, sets the name, marks going, and
   * makes a member. The founder code makes the first member a steward.
   * Returns the card, "founder", or null if the code is spent or stale.
   */
  redeemInvite: (code: string, name: string) => MeetingCard | "founder" | null;
  /** Put your name on a day of a need. Nothing enforces it. */
  takeSlot: (cardId: string, day: string) => void;
  openDm: (other: string) => void;
  /** Message from a room's member list. On the server the list already checked; the server checks again. */
  messageMember: (room: RoomId, member: { id: string; name: string; userId: string | null }) => void;
  backToRoom: () => void;
  clearFocusMember: () => void;
  sendDm: (threadId: string, text: string, media?: SharedMedia) => void;
  setOpenThread: (id: string | null) => void;
  clearBoard: () => void;
  /**
   * Wipes the local board after the person confirms, stays on This week,
   * and keeps a one-step undo. A remote board is left alone.
   */
  clearLocalBoard: () => void;
  undoClearBoard: () => void;
  /** One-step undo of the last confirmed clear. Persisted until it expires. */
  undoClear: BoardUndo | null;
  /** Keeps a cleared local board inside the app on a live server. Not persisted. */
  localEntry: boolean;
};

/** The undo bar hides itself. The snapshot stays until `UNDO_TTL_MS`. */
/**
 * A rooms page (/rooms, /rooms/<category>) can show this board without leaving:
 * Rooms itself, or a conversation opened from a room's member list.
 */
export function keepsRoomsPage(state: { section: Section; dmFrom: unknown }): boolean {
  return state.section === "rooms" || (state.section === "messages" && state.dmFrom != null);
}

export const UNDO_BAR_MS = 10_000;
/** A reload inside this window can still put the cleared board back. */
export const UNDO_TTL_MS = 10 * 60 * 1000;

type BoardUndo = {
  at: number;
  me: string;
  profile: Profile;
  steward: boolean;
  member: boolean;
  founded: boolean;
  posts: Post[];
  cards: MeetingCard[];
  invites: Invite[];
  markLog: MarkRow[];
  bans: BanRow[];
  threads: DmThread[];
  messages: DmMessage[];
  removals: RemovalRow[];
  appeals: AppealRow[];
  csamReports: CsamReport[];
  rooms: Room[];
  room: RoomId;
  section: Section;
  viewing: string | null;
  openThread: string | null;
};

export function undoSnapshotLive(
  undo: BoardUndo | null | undefined,
  now = Date.now(),
): undo is BoardUndo {
  return !!undo && typeof undo.at === "number" && now - undo.at < UNDO_TTL_MS;
}

/** Admins and owners are the only people who can wipe the local board. */
export function canClearBoard(actor: { admin: boolean; owner: boolean }): boolean {
  return actor.admin === true || actor.owner === true;
}

/** The founder owns this box. */
export function localBoardOwner(state: { founded: boolean }): boolean {
  return state.founded === true;
}

/** The confirm button stays off until the board name or CLEAR is typed. */
export function clearPhraseMatches(typed: string, boardName: string): boolean {
  const value = typed.trim();
  if (!value) return false;
  if (value.toUpperCase() === "CLEAR") return true;
  const name = boardName.trim();
  return name.length > 0 && value.localeCompare(name, "en", { sensitivity: "accent" }) === 0;
}

/** A JSON snapshot of the local board. No likes, reshares, or scores. */
export function boardExportDocument(input: {
  me: string;
  profile: Profile;
  rooms: { id: string; name: string }[];
  posts: Post[];
  cards: MeetingCard[];
  threads: DmThread[];
  messages: DmMessage[];
  invites: Invite[];
  bans: BanRow[];
  markLog: MarkRow[];
  removals: RemovalRow[];
  appeals: AppealRow[];
  reports: CsamReport[];
}): string {
  return JSON.stringify({
    name: APP_NAME,
    me: input.me,
    profile: input.profile,
    rooms: input.rooms,
    posts: input.posts,
    cards: input.cards,
    threads: input.threads,
    messages: input.messages,
    invites: input.invites,
    bans: input.bans,
    markLog: input.markLog,
    removals: input.removals,
    appeals: input.appeals,
    reports: input.reports,
  });
}

/**
 * Boards saved before v7 may hold the invented sample week (six made-up
 * members, posts, and threads). It is gone from the app, so a saved copy is
 * dropped on load and the person lands back at the door.
 */
export function dropSampleWeek(saved: Record<string, unknown>): Record<string, unknown> {
  const cards = Array.isArray(saved.cards) ? (saved.cards as { id?: string }[]) : [];
  const isSample = saved.sample === true || cards.some((card) => card?.id === "s-framing");
  const rest = { ...saved };
  delete rest.sample;
  delete rest.sampleVersion;
  if (!isSample) return rest;
  return { room: rest.room, deskOn: rest.deskOn, lineDismissedAt: rest.lineDismissedAt };
}

/**
 * Steps run in order and fall through, so an old save picks up every later
 * step. Before v5 the room ids and card fields differ: pre-release, start clean.
 */
export function migrateBoardStorage(persisted: unknown, version: number): object {
  if (version < 5 || !persisted || typeof persisted !== "object") return {};
  let saved = persisted as Record<string, unknown>;
  if (version < 6) {
    const markLog = Array.isArray(saved.markLog) ? (saved.markLog as MarkRow[]) : [];
    saved = { ...saved, markLog: markLog.map((row) => ({ ...row, reason: row.reason ?? "" })) };
  }
  if (version < 7) saved = dropSampleWeek(saved);
  return saved;
}

const EMPTY_PROFILE: Profile = { household: "", parish: "", trade: "" };

function pruneMessages(messages: DmMessage[], now: number): DmMessage[] {
  const cutoff = now - DM_RETENTION_DAYS * DAY;
  return messages.filter((message) => message.at >= cutoff);
}

function addName(list: string[], name: string): string[] {
  return list.includes(name) ? list : [...list, name];
}

function emptyLocalBoard(remote: boolean, rooms: Room[]) {
  return {
    posts: [] as Post[],
    cards: [] as MeetingCard[],
    invites: [] as Invite[],
    markLog: [] as MarkRow[],
    bans: [] as BanRow[],
    threads: [] as DmThread[],
    messages: [] as DmMessage[],
    removals: [] as RemovalRow[],
    appeals: [] as AppealRow[],
    csamReports: [] as CsamReport[],
    openThread: null,
    viewing: null,
    rooms: remote ? rooms : ROOMS,
  };
}

function snapshotBoard(state: {
  me: string;
  profile: Profile;
  steward: boolean;
  member: boolean;
  founded: boolean;
  posts: Post[];
  cards: MeetingCard[];
  invites: Invite[];
  markLog: MarkRow[];
  bans: BanRow[];
  threads: DmThread[];
  messages: DmMessage[];
  removals: RemovalRow[];
  appeals: AppealRow[];
  csamReports: CsamReport[];
  rooms: Room[];
  room: RoomId;
  section: Section;
  viewing: string | null;
  openThread: string | null;
}): BoardUndo {
  return structuredClone({
    at: Date.now(),
    me: state.me,
    profile: state.profile,
    steward: state.steward,
    member: state.member,
    founded: state.founded,
    posts: state.posts,
    cards: state.cards,
    invites: state.invites,
    markLog: state.markLog,
    bans: state.bans,
    threads: state.threads,
    messages: state.messages,
    removals: state.removals,
    appeals: state.appeals,
    csamReports: state.csamReports,
    rooms: state.rooms,
    room: state.room,
    section: state.section,
    viewing: state.viewing,
    openThread: state.openThread,
  });
}

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => {
      const me = () => authorName(get().me);
      const markRow = (post: Post, mark: Mark | null, reason: string): MarkRow => ({
        id: crypto.randomUUID(),
        room: post.room,
        postId: post.id,
        author: post.author,
        by: me(),
        mark,
        reason,
        at: Date.now(),
      });
      const checkNow = (draft: Draft) => {
        const { posts, cards, removals, bans, appeals, rooms, steward } = get();
        return composerCheck(draft, {
          author: me(),
          steward,
          posts,
          cards,
          removals,
          bans,
          appeals,
          rooms,
          now: Date.now(),
        });
      };
      /** The one way a date closes. Who came joins wentBy; the going list resets. */
      const hosted = (
        card: MeetingCard,
        input: {
          happened: boolean;
          next: string;
          line: string;
          on: string;
          came: string[];
          /** Member ids from the roll call pills, when the server gave a roll call. */
          cameIds?: string[];
          named: string;
          pages?: string;
          postId?: string;
          media?: Draft["media"];
          post?: Post;
        },
      ) => {
        const post =
          input.post ??
          newPost({
            room: card.room,
            type: "hosted",
            claim: input.line,
            on: input.on,
            next: input.next,
            came: input.came,
            named: input.named,
            author: me(),
            cardId: card.id,
            ...(input.postId ? { id: input.postId } : {}),
            media: input.media ?? [],
          });
        const closed: MeetingCard = {
          ...card,
          lastFour: [...card.lastFour, input.happened].slice(-4),
          next: input.next,
          pages: input.pages?.trim() || card.pages,
          wentBy: input.came.reduce(addName, card.wentBy),
          going: [],
          pinned: false,
          unverified: card.unverified && !input.happened,
        };
        set({
          posts: [post, ...get().posts.filter((item) => item.id !== post.id)],
          cards: get().cards.map((item) => (item.id === card.id ? closed : item)),
        });
      };
      /**
       * Before a signed-in host's write-up is filed: the server ends the date
       * and records who came, by member id (the host reads their own roll
       * call, so has the ids). This runs first. If it fails, nothing closes:
       * the card, its going list and the write-up stay, and the host can try
       * again. Only rsvp-not-ready (or an API from before 0049) carries on.
       */
      /**
       * stop: null when saved (or kept on this device); otherwise the one line
       * to show the host. sent: the roll call this close sent, which the
       * write-up carries so the server links exactly these people (QA S4 2).
       */
      const closeOnServer = async (
        card: MeetingCard,
        came: string[],
        cameIds?: string[],
        happened = true,
      ): Promise<{ stop: string | null; sent: string[] }> => {
        if (!get().remote || !isGatheringId(card.id) || !marksCame(card)) return { stop: null, sent: [] };
        const roll = get().rollCall[card.id.toLowerCase()] ?? [];
        // "It did not": nobody is marked, whatever the form held (QA S2).
        const userIds = happened
          ? cameIdsFor(roll, {
              ...(cameIds ? { picked: cameIds } : {}),
              names: came,
            })
          : [];
        try {
          // `seen`: everyone this list showed, so a close cannot clear a
          // "going" the host never saw (QA S3).
          const result = await saveAttendance(card.id, {
            userIds,
            close: true,
            happened,
            seen: roll.map((person) => person.userId),
          });
          if (savedOrLocal(result, CAME_NOT_SAVED, { banner: false })) return { stop: null, sent: userIds };
          if (!result.ok && result.code === ROLL_CALL_STALE) {
            // Read the list again before answering, so the form can reset its picks to it.
            await refreshRsvps();
            return { stop: ROLL_CALL_STALE, sent: [] };
          }
          return { stop: CAME_NOT_SAVED, sent: [] };
        } catch {
          return { stop: CAME_NOT_SAVED, sent: [] };
        }
      };
      const patchCard = (id: string, fn: (card: MeetingCard) => MeetingCard) =>
        set({ cards: get().cards.map((card) => (card.id === id ? fn(card) : card)) });
      const rememberGathering = (card: MeetingCard) => {
        void saveGathering({
          id: card.id,
          roomId: card.room,
          title: card.name,
          date: card.next,
          time: card.time,
          place: card.place,
        }).then((result) => {
          if (!result.ok) {
            set({ boardError: result.error });
            return;
          }
          // The server now knows me as this gathering's host, by id.
          const gid = card.id.toLowerCase();
          if (card.host === me() && !get().rsvpHosts.includes(gid)) {
            set({ rsvpHosts: [...get().rsvpHosts, gid] });
          }
          // The lister (the host) has been, as on the device. Only my own name is sent.
          if (card.wentBy.includes(me()) && marksCame(card)) {
            void saveMyRsvp(card.id, { attended: true }).then((saved) =>
              savedOrLocal(saved, RSVP_NOT_SAVED),
            );
          }
        });
      };
      const mergeGatherings = (rows: StoredGathering[]) => {
        const byId = new Map(rows.map((row) => [row.id, row]));
        const mine = authorName(get().me);
        const seen = new Set<string>();
        const cards = get().cards.map((card) => {
          const row = byId.get(card.id);
          if (!row) return card;
          seen.add(card.id);
          return {
            ...card,
            name: row.title,
            next: row.date,
            time: row.time,
            place: row.place || card.place,
            room: row.roomId,
            sharePublic: row.shared,
          };
        });
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          cards.unshift(
            newCard({
              id: row.id,
              room: row.roomId,
              kind: "meeting",
              name: row.title,
              place: row.place,
              time: row.time,
              host: row.mine ? mine : "",
              next: row.date,
              sharePublic: row.shared,
            }),
          );
        }
        set({ cards });
      };
      /**
       * The host of this card, or a steward of its room: the only people who
       * mark who came (Oct 30). An admin as an admin does not.
       */
      const marksCame = (card: MeetingCard) =>
        roleCounts(get().admin) &&
        (get().stewardRooms.includes(card.room) ||
        // Signed in: the host is known by id, from the server (a member who
        // shares the host's name is not the host). On this device only, by name.
        (get().remote && isGatheringId(card.id)
          ? get().rsvpHosts.includes(card.id.toLowerCase())
          : card.host === me()));
      /** One RSVP save per card at a time. A second tap while one is out does nothing. */
      const rsvpInFlight = new Set<string>();
      /**
       * After sign-in: move this browser's own RSVPs to the server once, then
       * read the server's, filtered by role on the server: an admin gets every
       * row, a host every row for their own gatherings, a steward every row
       * in the rooms they steward, anyone else only their own. Before 0049 is
       * applied (503) the device keeps its own.
       */
      const syncRsvps = async (gatheringIds: ReadonlySet<string>) => {
        let list = await loadRsvps();
        if (!list.ok) return;
        // Another account in this tab: forget the last one's saved closes (QA S3 #1).
        if (rsvpViewer !== null && rsvpViewer !== list.viewer) forgetSavedClose();
        rsvpViewer = list.viewer;
        if (!get().rsvpMovedFor.includes(list.viewer)) {
          const moves = deviceRsvpMoves(get().cards, me());
          const moved = moves.length > 0 ? await moveRsvps(moves) : { ok: true as const };
          if (!moved.ok) return;
          set({ rsvpMovedFor: [...get().rsvpMovedFor, list.viewer] });
          if (moves.length > 0) {
            list = await loadRsvps();
            if (!list.ok) return;
          }
        }
        set({
          rsvpHosts: list.hosts,
          rollCall: rollCallPeople(list, me()),
          cards: applyServerRsvps(get().cards, list, { me: me(), gatheringIds }),
        });
      };
      const refreshRsvps = async () => {
        try {
          const ids = get()
            .cards.filter((item) => isGatheringId(item.id))
            .map((item) => item.id.toLowerCase());
          await syncRsvps(new Set(ids));
        } catch {
          // The next board load reads them again.
        }
      };
      /**
       * Only the server's rsvp-not-ready (0049 not applied yet), or a 404 from
       * an API that predates the RSVP routes, keeps a change on this device. Anything else, a dropped connection included, is a
       * failure: the screen does not change and the member is told. The RSVP
       * button passes banner: false, because its own line says it (one message,
       * not two); "I went" and the close have no line, so they use the banner.
       */
      const savedOrLocal = (
        result: { ok: true } | RsvpFail,
        message: string,
        options: { banner?: boolean } = {},
      ) => {
        if (keptOnDevice(result)) return true;
        if (options.banner !== false) set({ boardError: message });
        return false;
      };
      /** One "I went" save per card at a time. */
      const visitInFlight = new Set<string>();
      let posting = false;

      const applySnapshot = (board: BoardSnapshot) => {
        const rooms = board.rooms.length > 0 ? board.rooms : ROOMS;
        setRoomCatalog(rooms);
        set({
          remote: true,
          boardError: "",
          rooms,
          // RSVPs come from /api/rsvps (syncRsvps), filtered on the server by
          // role (admin, host, steward, member). The views still apply forViewer.
          posts: board.posts,
          markLog: board.marks,
          removals: board.removals,
          bans: board.bans,
          appeals: board.appeals,
          csamReports: board.csamReports,
          roomPages: board.pages,
          steward: board.me.steward,
          admin: board.me.admin,
          council: board.me.council,
          councilChair: board.me.councilChair,
          stewardRooms: board.me.stewardRooms,
          member: true,
          gender: board.me.gender,
          genderConfirmed: board.me.genderConfirmed,
          genderSetBy: board.genderPolicy.setBy,
          genderNeedsConfirmation: board.genderPolicy.requiresConfirmation,
        });
      };

      const pullHome = async () => {
        const loaded = await (await getBoardClient()).loadHome();
        if (loaded.ok) set({ home: loaded.home });
      };

      const placeCall = async (
        run: (
          client: Awaited<ReturnType<typeof getBoardClient>>,
        ) => Promise<{ ok: true } | { ok: false; error: string }>,
        reloadBoard: boolean,
      ): Promise<{ ok: boolean; error?: string }> => {
        if (!get().remote) return { ok: false, error: "That is saved on the server." };
        const saved = await run(await getBoardClient());
        if (!saved.ok) return { ok: false, error: saved.error };
        if (reloadBoard) {
          const loaded = await (await getBoardClient()).load();
          if (loaded.ok) applySnapshot(loaded.board);
        }
        await pullHome();
        return { ok: true };
      };

      type PendingRemoval = {
        card: MeetingCard;
        timer: ReturnType<typeof setTimeout>;
        remote: boolean;
      };
      const pendingRemovals = new Map<string, PendingRemoval>();
      let removalOrder: string[] = [];
      const syncRemovalOrder = (cards: MeetingCard[]) => {
        const seen = new Set(removalOrder);
        for (const card of cards) {
          if (seen.has(card.id)) continue;
          removalOrder.push(card.id);
          seen.add(card.id);
        }
      };
      const placeRemovedCard = (cards: MeetingCard[], card: MeetingCard) => {
        if (cards.some((item) => item.id === card.id)) return cards;
        syncRemovalOrder(cards);
        if (!removalOrder.includes(card.id)) removalOrder.push(card.id);
        const byId = new Map(cards.map((item) => [item.id, item]));
        byId.set(card.id, card);
        const used = new Set<string>();
        const next: MeetingCard[] = [];
        for (const id of removalOrder) {
          const item = byId.get(id);
          if (!item || used.has(id)) continue;
          next.push(item);
          used.add(id);
        }
        for (const item of cards) {
          if (!used.has(item.id)) next.push(item);
        }
        return next;
      };
      const settleRemoval = async (pending: PendingRemoval) => {
        let failed = false;
        try {
          const result = await removeGathering(pending.card.id);
          failed = !result.ok;
        } catch {
          failed = true;
        }
        if (!failed) return;
        set((state) => {
          const prior =
            state.boardError && state.failedRemovalNames.length > 0 ? state.failedRemovalNames : [];
          const names = prior.includes(pending.card.name)
            ? prior
            : [...prior, pending.card.name];
          return {
            cards: placeRemovedCard(state.cards, pending.card),
            failedRemovalNames: names,
            boardError: removalFailedCopy(names),
            scrollCardId: pending.card.id,
            undoQueue: state.undoQueue.filter((item) => item.id !== pending.card.id),
          };
        });
      };

      return {
        section: "week",
        room: "county",
        browsing: true,
        member: false,
        founded: false,
        me: "",
        profile: EMPTY_PROFILE,
        deskOn: false,
        viewing: null,
        steward: false,
        admin: false,
        council: false,
        councilChair: false,
        stewardRooms: [],
        gender: null,
        genderConfirmed: false,
        genderSetBy: "self",
        genderNeedsConfirmation: false,
        roomHold: null,
        roomHoldBack: null,
        dmFrom: null,
        focusMember: null,
        home: null,
        remote: false,
        boardError: "",
        failedRemovalNames: [],
        undoQueue: [],
        scrollCardId: null,
        rooms: ROOMS,
        posts: [],
        cards: [],
        invites: [],
        removals: [],
        bans: [],
        appeals: [],
        csamReports: [],
        markLog: [],
        roomPages: [],
        threads: [],
        messages: [],
        openThread: null,
        lineDismissedAt: 0,
        rsvpMovedFor: [],
        rsvpHosts: [],
        rollCall: {},
        rsvpPending: [],
        rsvpFailed: [],
        undoClear: null,
        localEntry: false,
        setSection: (section) => {
          if (section === "civic" && !get().deskOn) return;
          set(section === "rooms" ? { section, browsing: true, dmFrom: null } : { section, dmFrom: null });
        },
        dismissRoomHold: () => {
          const back = get().roomHoldBack;
          set({ roomHold: null, roomHoldBack: null, ...(back ?? {}) });
        },
        setRoom: (room) => {
          const previous = { section: get().section, room: get().room };
          set({ room, section: "rooms", browsing: false });
          if (!get().remote) return;
          void (async () => {
            const loaded = await (await getBoardClient()).load({ room });
            if (get().room !== room) return;
            if (loaded.ok) {
              set({ roomHold: null, roomHoldBack: null, boardError: "" });
              return;
            }
            if (loaded.code === "gender-unstated" || loaded.code === "gender-unconfirmed") {
              set({
                roomHold: { roomId: room, code: loaded.code, audience: loaded.audience },
                roomHoldBack: previous,
                boardError: "",
              });
              return;
            }
            if (loaded.error === "That room is not here.") {
              set({
                roomHold: { roomId: room, code: "missing" },
                roomHoldBack: previous,
                boardError: "",
              });
              return;
            }
            set({ boardError: loaded.error, roomHold: null, roomHoldBack: null });
          })();
        },
        setMe: (me) => set({ me }),
        setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
        setDeskOn: (deskOn) =>
          set({
            deskOn,
            section: !deskOn && get().section === "civic" ? "week" : get().section,
          }),
        view: (viewing) => set({ viewing, section: "profile" }),
        dismissLine: () => set({ lineDismissedAt: Date.now() }),
        file: async (draft, options) => {
          if (posting) return { ok: false, stops: [], notes: [] };
          const { posts, cards } = get();
          const check = checkNow(draft);
          if (!check.ok || !draft.type) return check;
          posting = true;
          try {
            if (get().remote) {
              if (draft.type === "hosted") {
                const closing = cards.find((item) => item.id === draft.cardId);
                if (closing) {
                  const kept = savedCloseNames(closing.id, closing.next || todayIso());
                  const keptClose = savedClose(closing.id, closing.next || todayIso());
                  if (draft.happened === false || keptClose?.happened === false) {
                    // Did not happen: no names, no handles, kept or not (QA S2).
                    draft = { ...draft, happened: false, came: [], named: "", cameIds: [] };
                  } else if (kept) {
                    // Only someone the saved close marked can be named (Design #126 L1).
                    draft = { ...draft, came: kept, named: kept.includes(draft.named) ? draft.named : "" };
                  }
                  const went = draft.happened !== false;
                  const closed = await closeOnce(
                    () => closeOnServer(closing, draft.came, went ? options?.cameIds : [], went),
                    closing.id,
                    closing.next || todayIso(),
                    draft.came,
                    went,
                  );
                  if (closed.stop) return { ok: false, stops: [closed.stop], notes: check.notes };
                  if (went && closed.sent.length > 0) draft = { ...draft, cameIds: closed.sent };
                }
              }
              const saved = await (await getBoardClient()).createPost(draft);
              if (!saved.ok) {
                // The close may have saved on the server (going cleared) while the
                // write-up did not: read the RSVPs again so the card matches (QA S4).
                if (draft.type === "hosted") void refreshRsvps();
                return { ok: false, stops: saved.stops ?? [saved.error], notes: check.notes };
              }
              if (draft.type === "hosted") {
                if (draft.cardId) closedUnfiled.delete(draft.cardId);
                const card = cards.find((item) => item.id === draft.cardId);
                if (card) {
                  hosted(card, {
                    happened: draft.happened !== false,
                    next: draft.next,
                    line: draft.claim.trim(),
                    on: draft.on,
                    came: draft.came,
                    ...(options?.cameIds ? { cameIds: options.cameIds } : {}),
                    named: draft.named,
                    pages: draft.pages,
                    post: saved.post,
                  });
                } else {
                  set({
                    posts: [saved.post, ...get().posts.filter((item) => item.id !== saved.post.id)],
                  });
                }
              } else {
                set({ posts: [saved.post, ...posts.filter((item) => item.id !== saved.post.id)] });
              }
              return check;
            }
            if (draft.type === "hosted") {
              const card = cards.find((item) => item.id === draft.cardId);
              if (card)
                hosted(card, {
                  happened: true,
                  next: draft.next,
                  line: draft.claim.trim(),
                  on: draft.on,
                  came: draft.came,
                  named: draft.named,
                  pages: draft.pages,
                  postId: draft.postId,
                  media: draft.media.slice(0, 1),
                });
              return check;
            }
            const post = newPost({
              room: draft.room,
              type: draft.type,
              claim: draft.claim.trim(),
              reason: draft.reason.trim(),
              on: draft.on,
              author: me(),
              media: draft.media.slice(0, 1),
              ...(draft.postId ? { id: draft.postId } : {}),
              ...(draft.cardId ? { cardId: draft.cardId } : {}),
              ...(draft.tradeId ? { tradeId: draft.tradeId } : {}),
            });
            set({ posts: [post, ...posts] });
            return check;
          } finally {
            // The flag stays set through the rest of this turn, so a second
            // click in the same turn cannot file another post. It drops before
            // the next turn, once this one has settled.
            queueMicrotask(() => {
              posting = false;
            });
          }
        },
        fileDeskContact: async (input) => {
          const post = deskDid({ ...input, author: me() });
          if (!get().remote) {
            set({ posts: [post, ...get().posts] });
            return;
          }
          const saved = await (
            await getBoardClient()
          ).createPost(
            {
              ...blankDraft("county"),
              type: "did",
              claim: post.claim,
              reason: post.reason,
              on: post.on,
            },
            { campaignId: input.campaignId },
          );
          if (saved.ok)
            set({
              posts: [saved.post, ...get().posts.filter((item) => item.id !== saved.post.id)],
            });
        },
        reply: async (parentId, text) => {
          const body = text.trim();
          const parent = get().posts.find((post) => post.id === parentId);
          if (!body || !parent) return;
          if (get().remote) {
            const saved = await (await getBoardClient()).reply(parentId, body);
            if (!saved.ok) {
              set({ boardError: saved.error });
              return;
            }
            set({
              posts: [saved.post, ...get().posts.filter((item) => item.id !== saved.post.id)],
              boardError: "",
            });
            return;
          }
          set({
            posts: [
              newPost({
                room: parent.room,
                type: parent.type,
                claim: body,
                author: me(),
                parentId,
              }),
              ...get().posts,
            ],
          });
        },
        revise: async (id, patch) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          if (get().remote) {
            const saved = await (
              await getBoardClient()
            ).revise(id, { claim: patch.claim.trim(), reason: patch.reason.trim() });
            if (!saved.ok) {
              set({ boardError: saved.error });
              return;
            }
            set({
              posts: get().posts.map((item) => (item.id === id ? saved.post : item)),
              markLog: saved.mark ? [saved.mark, ...get().markLog] : get().markLog,
              boardError: "",
            });
            return;
          }
          set({
            posts: get().posts.map((item) =>
              item.id === id
                ? { ...item, claim: patch.claim.trim(), reason: patch.reason.trim() }
                : item,
            ),
          });
        },
        closeAsked: async (id) => {
          if (get().remote) {
            const saved = await (await getBoardClient()).closeAsked(id);
            if (!saved.ok) {
              set({ boardError: saved.error });
              return;
            }
            set({
              posts: get().posts.map((post) => (post.id === id ? saved.post : post)),
              boardError: "",
            });
            return;
          }
          set({
            posts: get().posts.map((post) => (post.id === id ? { ...post, closed: true } : post)),
          });
        },
        mark: async (id, mark, reason) => {
          const sentence = oneSentence(reason);
          if (!sentence) return { ok: false, error: SENTENCE_ERROR };
          const post = get().posts.find((item) => item.id === id);
          if (!post) return { ok: false, error: "That post is not here." };
          if (get().remote) {
            const saved = await (await getBoardClient()).mark(id, mark, sentence);
            if (!saved.ok) return { ok: false, error: saved.error };
            set({
              posts: get().posts.map((item) =>
                item.id === id ? { ...saved.post, removed: false } : item,
              ),
              markLog: [saved.row, ...get().markLog],
            });
            return { ok: true };
          }
          set({
            posts: get().posts.map((item) => (item.id === id ? { ...item, mark } : item)),
            markLog: [markRow(post, mark, sentence), ...get().markLog],
          });
          return { ok: true };
        },
        remove: async (id, reason) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return { ok: false, error: "That post is not here." };
          const blank = (item: Post): Post =>
            reason === "csam"
              ? { ...item, removed: true, claim: "[removed]", reason: "", media: [] }
              : { ...item, removed: true };
          if (get().remote) {
            const saved = await (await getBoardClient()).remove(id, reason);
            if (!saved.ok) return { ok: false, error: saved.error };
            set({
              posts: get().posts.map((item) =>
                item.id === id || item.parentId === id ? blank(item) : item,
              ),
              removals: [saved.removal, ...get().removals],
              bans: [saved.ban, ...get().bans],
            });
            return { ok: true };
          }
          const removal = {
            id: crypto.randomUUID(),
            postId: id,
            author: post.author,
            reason,
            at: Date.now(),
          };
          set({
            posts: get().posts.map((item) =>
              item.id === id || item.parentId === id ? blank(item) : item,
            ),
            removals: [removal, ...get().removals],
            bans:
              reason === "csam"
                ? [
                    {
                      id: crypto.randomUUID(),
                      author: post.author,
                      reason: "csam",
                      until: Date.now() + 100 * 365 * DAY,
                      strikes: 1,
                      at: Date.now(),
                    },
                    ...get().bans,
                  ]
                : get().bans,
          });
          return { ok: true };
        },
        appeal: async (postId, kind, reason) => {
          const sentence = oneSentence(reason);
          if (!sentence) return { ok: false, error: SENTENCE_ERROR };
          const post = get().posts.find((item) => item.id === postId);
          if (get().remote) {
            const saved = await (await getBoardClient()).appeal(postId, kind, sentence);
            if (!saved.ok) return { ok: false, error: saved.error };
            set({
              appeals: [saved.appeal, ...get().appeals.filter((row) => row.id !== saved.appeal.id)],
            });
            return { ok: true };
          }
          if (!post) return { ok: false, error: "That post is not here." };
          if (post.author !== me()) return { ok: false, error: "Only the author can appeal." };
          if (kind === "mark" && (post.removed || !post.mark))
            return { ok: false, error: "That mark is not here." };
          const removal = get().removals.find((row) => row.postId === postId);
          if (kind === "removal" && !removal)
            return { ok: false, error: "That removal is not here." };
          if (
            get().appeals.some(
              (row) => row.postId === postId && row.kind === kind && row.decision === null,
            )
          ) {
            return { ok: false, error: "That appeal is already filed." };
          }
          const row: AppealRow = {
            id: crypto.randomUUID(),
            room: post.room,
            postId,
            author: post.author,
            kind,
            reason: sentence,
            decision: null,
            decisionNote: "",
            decidedBy: "",
            at: Date.now(),
            decidedAt: null,
            rule: kind === "removal" ? (removal?.reason ?? null) : null,
          };
          set({ appeals: [row, ...get().appeals] });
          return { ok: true };
        },
        decideAppeal: async (id, decision, reason) => {
          const sentence = oneSentence(reason);
          if (!sentence) return { ok: false, error: SENTENCE_ERROR };
          if (!get().steward) return { ok: false, error: "Only a steward can decide an appeal." };
          const appeal = get().appeals.find((row) => row.id === id);
          if (!appeal || appeal.decision) return { ok: false, error: "That appeal is not open." };
          if (appeal.author === me())
            return { ok: false, error: "A steward does not decide their own appeal." };
          if (decision !== "uphold" && decision !== "lift")
            return { ok: false, error: "Uphold or lift the appeal." };
          if (get().remote) {
            const saved = await (await getBoardClient()).decideAppeal(id, decision, sentence);
            if (!saved.ok) return { ok: false, error: saved.error };
            const posts = get().posts.map((item) => {
              const next = saved.posts.find((post) => post.id === item.id);
              return next ?? item;
            });
            for (const post of saved.posts) {
              if (!posts.some((item) => item.id === post.id)) posts.unshift(post);
            }
            set({
              posts,
              appeals: get().appeals.map((row) => (row.id === id ? saved.appeal : row)),
              bans:
                decision === "lift" &&
                saved.appeal.kind === "removal" &&
                saved.appeal.rule !== "csam"
                  ? get().bans.map((row) =>
                      row.author === saved.appeal.author && row.strikes < 2
                        ? { ...row, until: Date.now() }
                        : row,
                    )
                  : get().bans,
            });
            return { ok: true };
          }
          if (decision === "lift" && appeal.kind === "removal" && appeal.rule === "csam") {
            return {
              ok: false,
              error: "That removal stays. Child sexual abuse material is not put back.",
            };
          }
          set({
            appeals: get().appeals.map((row) =>
              row.id === id
                ? {
                    ...row,
                    decision,
                    decisionNote: sentence,
                    decidedBy: me(),
                    decidedAt: Date.now(),
                  }
                : row,
            ),
            posts:
              decision === "lift"
                ? get().posts.map((item) => {
                    if (appeal.kind === "mark" && item.id === appeal.postId)
                      return { ...item, mark: null };
                    if (
                      appeal.kind === "removal" &&
                      (item.id === appeal.postId || item.parentId === appeal.postId)
                    )
                      return { ...item, removed: false };
                    return item;
                  })
                : get().posts,
            bans:
              decision === "lift" && appeal.kind === "removal"
                ? get().bans.map((row) =>
                    row.author === appeal.author && row.strikes < 2 && row.reason !== "csam"
                      ? { ...row, until: Date.now() }
                      : row,
                  )
                : get().bans,
          });
          return { ok: true };
        },
        addCard: (fields) => {
          if (!fields.name.trim() || !fields.place.trim() || !fields.time.trim()) return;
          const card = newCard({
            ...fields,
            name: fields.name.trim(),
            place: fields.place.trim(),
            time: fields.time.trim(),
            host: fields.host.trim() || me(),
            wentBy: fields.kind === "meeting" || fields.kind === "candidate" ? [me()] : [],
          });
          set({ cards: [card, ...get().cards] });
          if (get().remote) rememberGathering(card);
        },
        updateCard: (id, patch) => {
          patchCard(id, (card) => ({ ...card, ...patch, id }));
          if (!get().remote) return;
          if (!(
            "name" in patch ||
            "place" in patch ||
            "time" in patch ||
            "next" in patch ||
            "room" in patch
          )) {
            return;
          }
          const card = get().cards.find((item) => item.id === id);
          if (card) rememberGathering(card);
        },
        closeCard: async (id, happened, next, line, came, pages = "", cameIds) => {
          const { cards } = get();
          const card = cards.find((item) => item.id === id);
          if (!card) return { ok: false, stops: ["That card is gone."], notes: [] };
          // A saved close's outcome and names win: the retry files what that close
          // saved, so "It did not" never names who came (Design #126 M1).
          const saved0 = savedClose(card.id, card.next || todayIso());
          // A saved "It did not" stays did-not; "It did not" chosen now drops the
          // kept names and handles too (Design #126 M1, QA S2).
          if (saved0 && !saved0.happened) happened = false;
          if (!happened) {
            came = [];
            cameIds = [];
          } else if (saved0) {
            came = saved0.names;
          }
          const claim = line.trim() || (happened ? "It happened." : "It did not happen.");
          const draft: Draft = {
            ...blankDraft(card.room),
            type: "hosted",
            claim,
            on: card.next || todayIso(),
            next,
            came,
            pages,
            cardId: card.id,
            happened,
          };
          const check = checkNow(draft);
          if (!check.ok) return check;
          if (get().remote) {
            const closed = await closeOnce(() => closeOnServer(card, came, cameIds, happened), card.id, draft.on, came, happened);
            if (closed.stop) return { ok: false, stops: [closed.stop], notes: [] };
            const saved = await (await getBoardClient()).createPost(
              happened && closed.sent.length > 0 ? { ...draft, cameIds: closed.sent } : draft,
            );
            if (!saved.ok) {
              // Same as post(): the close may have saved, so read the RSVPs again (QA S4).
              void refreshRsvps();
              return { ok: false, stops: saved.stops ?? [saved.error], notes: [] };
            }
            closedUnfiled.delete(card.id);
            hosted(card, {
              happened,
              next,
              line: claim,
              on: draft.on,
              came,
              ...(cameIds ? { cameIds } : {}),
              named: "",
              pages,
              post: saved.post,
            });
            return check;
          }
          hosted(card, { happened, next, line: claim, on: draft.on, came, named: "", pages });
          return check;
        },
        reloadRsvps: () => refreshRsvps(),
        rsvp: (id) => {
          const card = get().cards.find((item) => item.id === id);
          if (!card) return;
          /** Set the value that was sent, never a blind toggle. */
          const put = (going: boolean) =>
            patchCard(id, (item) => ({
              ...item,
              going: going ? addName(item.going, me()) : item.going.filter((name) => name !== me()),
            }));
          const going = !card.going.includes(me());
          if (!get().remote) {
            put(going);
            return;
          }
          if (rsvpInFlight.has(id)) return;
          rsvpInFlight.add(id);
          set({
            rsvpPending: [...get().rsvpPending.filter((item) => item !== id), id],
            rsvpFailed: get().rsvpFailed.filter((item) => item !== id),
          });
          const failed = () => set({ rsvpFailed: [...get().rsvpFailed.filter((item) => item !== id), id] });
          void (async () => {
            try {
              const loaded = await (await getBoardClient()).load({ room: card.room });
              if (!loaded.ok) {
                if (loaded.code === "gender-unstated" || loaded.code === "gender-unconfirmed") {
                  set({
                    room: card.room,
                    section: "rooms",
                    roomHold: { roomId: card.room, code: loaded.code, audience: loaded.audience },
                    roomHoldBack: { section: get().section, room: get().room },
                    boardError: "",
                  });
                } else {
                  // The board did not load: nothing was sent, and the line says so.
                  failed();
                }
                return;
              }
              if (!isGatheringId(card.id)) {
                put(going);
                return;
              }
              if (savedOrLocal(await saveMyRsvp(card.id, { going }), RSVP_NOT_SAVED, { banner: false })) {
                put(going);
              } else {
                failed();
              }
            } catch {
              failed();
            } finally {
              rsvpInFlight.delete(id);
              set({ rsvpPending: get().rsvpPending.filter((item) => item !== id) });
            }
          })();
        },
        visited: (id) => {
          const card = get().cards.find((item) => item.id === id);
          // Only the host or an admin marks who came (Josh, Oct 29).
          if (!card || !marksCame(card)) return;
          const mark = () =>
            patchCard(id, (item) => ({
              ...item,
              unverified: false,
              wentBy: addName(item.wentBy, me()),
            }));
          if (!get().remote || !isGatheringId(id)) {
            mark();
            return;
          }
          // Save first. The card changes only when the server has it, or when
          // 0049 is not applied yet (kept on this device). Any other failure
          // leaves the card as it was and says so.
          if (visitInFlight.has(id)) return;
          visitInFlight.add(id);
          void (async () => {
            try {
              if (savedOrLocal(await saveMyRsvp(id, { attended: true }), RSVP_NOT_SAVED)) mark();
            } catch {
              set({ boardError: RSVP_NOT_SAVED });
            } finally {
              visitInFlight.delete(id);
            }
          })();
        },
        removeCard: async (id) => {
          const cards = get().cards;
          const index = cards.findIndex((card) => card.id === id);
          if (index < 0) return { ok: true };
          const card = cards[index];
          if (!card) return { ok: true };
          if (pendingRemovals.size === 0) removalOrder = [];
          syncRemovalOrder(cards);
          const remote = get().remote;
          set({
            cards: cards.filter((item) => item.id !== id),
            boardError: "",
            failedRemovalNames: [],
            undoQueue: [...get().undoQueue.filter((item) => item.id !== id), card],
          });
          const timer = setTimeout(() => {
            const pending = pendingRemovals.get(id);
            if (!pending) return;
            pendingRemovals.delete(id);
            set((state) => ({
              undoQueue: state.undoQueue.filter((item) => item.id !== id),
            }));
            if (pending.remote) void settleRemoval(pending);
          }, REMOVAL_UNDO_MS);
          pendingRemovals.set(id, { card, timer, remote });
          return { ok: true };
        },
        undoRemoveCard: (id) => {
          const pending = pendingRemovals.get(id);
          if (!pending) return false;
          clearTimeout(pending.timer);
          pendingRemovals.delete(id);
          set((state) => ({
            cards: placeRemovedCard(state.cards, pending.card),
            boardError: "",
            failedRemovalNames: [],
            undoQueue: state.undoQueue.filter((item) => item.id !== id),
          }));
          return true;
        },
        commitPendingRemovals: (mode) => {
          const waiting = [...pendingRemovals.values()];
          pendingRemovals.clear();
          const ids = new Set(waiting.map((pending) => pending.card.id));
          set((state) => ({
            undoQueue: state.undoQueue.filter((item) => !ids.has(item.id)),
          }));
          for (const pending of waiting) {
            clearTimeout(pending.timer);
            if (!pending.remote) continue;
            if (mode === "keepalive") removeGatheringKeepalive(pending.card.id);
            else void settleRemoval(pending);
          }
        },
        createInvite: (cardId) => {
          const card = get().cards.find((item) => item.id === cardId);
          if (!card || card.host !== me()) return null;
          const invite: Invite = {
            code: inviteCode(),
            cardId,
            by: me(),
            at: Date.now(),
            redeemedBy: "",
          };
          set({ invites: [invite, ...get().invites] });
          return invite.code;
        },
        redeemInvite: (code, name) => {
          const who = name.trim();
          if (!who) return null;
          const typed = code.trim().toUpperCase();
          if (get().member) return null;
          if (typed === FOUNDER_CODE) {
            // The founder code opens a box once. After that, the box has a steward
            // and everyone else comes in by a host's code.
            if (get().founded) return null;
            set({ me: who, member: true, steward: true, founded: true });
            return "founder";
          }
          const invite = get().invites.find((item) => item.code === typed);
          if (!invite || !inviteLive(invite, Date.now())) return null;
          const card = get().cards.find((item) => item.id === invite.cardId);
          if (!card) return null;
          set({
            me: who,
            member: true,
            invites: get().invites.map((item) =>
              item.code === invite.code ? { ...item, redeemedBy: who } : item,
            ),
            cards: get().cards.map((item) =>
              item.id === card.id ? { ...item, going: addName(item.going, who) } : item,
            ),
          });
          return card;
        },
        takeSlot: (cardId, day) =>
          patchCard(cardId, (card) => ({
            ...card,
            slots: card.slots.map((slot) =>
              slot.day === day && !slot.by ? { ...slot, by: me() } : slot,
            ),
          })),
        openDm: (other) => {
          const name = other.trim();
          if (!messageableNames(me(), get().cards, get().posts, get().rooms).has(name)) return;
          const id = threadIdFor(me(), name);
          const threads = get().threads.some((thread) => thread.id === id)
            ? get().threads
            : [{ id, between: [me(), name].sort() as [string, string] }, ...get().threads];
          set({ threads, openThread: id, section: "messages" });
        },
        sendDm: (threadId, text, media) => {
          const body = text.trim();
          const thread = get().threads.find((item) => item.id === threadId);
          const attachment = media ? [media] : [];
          if ((dmTextError(text) && attachment.length === 0) || !thread?.between.includes(me()))
            return;
          if (!body && attachment.length === 0) return;
          set({
            messages: [
              ...pruneMessages(get().messages, Date.now()),
              {
                id: crypto.randomUUID(),
                threadId,
                from: me(),
                text: body,
                at: Date.now(),
                media: attachment,
              },
            ],
          });
        },
        setOpenThread: (openThread) => set({ openThread, dmFrom: null }),
        messageMember: (room, member) => {
          const name = member.name.trim();
          if (!name || name === me()) return;
          // On this device the room's posts decide who you may write to.
          if (!get().remote && !messageableNames(me(), get().cards, get().posts, get().rooms).has(name))
            return;
          const id = threadIdFor(me(), name);
          const threads = get().threads.some((thread) => thread.id === id)
            ? get().threads
            : [{ id, between: [me(), name].sort() as [string, string] }, ...get().threads];
          set({
            threads,
            openThread: id,
            section: "messages",
            dmFrom: { room, memberId: member.id, name, userId: member.userId },
            focusMember: null,
          });
        },
        backToRoom: () => {
          const from = get().dmFrom;
          if (!from) return;
          // dmFrom clears last, so a rooms page never sees the board leave it on the way back.
          set({ openThread: null, focusMember: from.memberId });
          get().setRoom(from.room);
          set({ dmFrom: null });
        },
        clearFocusMember: () => set({ focusMember: null }),
        createRoom: async (input) => {
          if (!get().remote) return { ok: false, error: "Rooms are added on the server." };
          const saved = await (await getBoardClient()).createRoom(input);
          if (!saved.ok) return { ok: false, error: saved.error };
          const rooms = get().rooms.some((room) => room.id === saved.room.id)
            ? get().rooms.map((room) => (room.id === saved.room.id ? saved.room : room))
            : [...get().rooms, saved.room];
          setRoomCatalog(rooms);
          set({ rooms });
          return { ok: true };
        },
        updateRoom: async (input) => {
          const allowed =
            get().admin || get().stewardRooms.includes(input.id) || (get().steward && !get().remote);
          if (!allowed) return { ok: false, error: "That room is not here." };
          if (input.categoryIds && input.categoryIds.length === 0)
            return { ok: false, error: "Choose a category." };
          if (input.options && !get().admin)
            return { ok: false, error: "Only an admin can change what a room includes." };
          if (!get().remote) {
            if (input.name || input.what)
              return { ok: false, error: "Rooms are edited on the server." };
            const rooms = get().rooms.map((room) =>
              room.id === input.id
                ? {
                    ...room,
                    ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
                    ...(input.pinOrder !== undefined ? { pinOrder: input.pinOrder } : {}),
                    ...(input.options && get().admin ? { options: input.options } : {}),
                  }
                : room,
            );
            setRoomCatalog(rooms);
            set({ rooms });
            return { ok: true };
          }
          const saved = await (
            await getBoardClient()
          ).updateRoom(input.id, {
            ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.what !== undefined ? { what: input.what } : {}),
            ...(input.pinOrder !== undefined ? { pinOrder: input.pinOrder } : {}),
            ...(input.options !== undefined ? { options: input.options } : {}),
          });
          if (!saved.ok) return { ok: false, error: saved.error };
          const rooms = get().rooms.map((room) => (room.id === saved.room.id ? saved.room : room));
          setRoomCatalog(rooms);
          set({ rooms });
          return { ok: true };
        },
        setRoomAudience: async (roomId, audience) => {
          if (!get().remote) return { ok: false, error: "That is saved on the server." };
          const saved = await (await getBoardClient()).setRoomAudience(roomId, audience);
          if (!saved.ok) return { ok: false, error: saved.error };
          const loaded = await (await getBoardClient()).load();
          if (loaded.ok) applySnapshot(loaded.board);
          await pullHome();
          return { ok: true };
        },
        setGender: async (gender) => {
          if (!get().remote) return { ok: false, error: "That is saved on the server." };
          const saved = await (await getBoardClient()).setGender({ gender });
          if (!saved.ok) return { ok: false, error: saved.error };
          const loaded = await (await getBoardClient()).load();
          if (loaded.ok) applySnapshot(loaded.board);
          else set({ gender });
          const hold = get().roomHold;
          if (hold && hold.code !== "missing") {
            const again = await (await getBoardClient()).load({ room: hold.roomId });
            if (again.ok) set({ roomHold: null, roomHoldBack: null });
            else if (again.code === "gender-unstated" || again.code === "gender-unconfirmed") {
              set({
                roomHold: { roomId: hold.roomId, code: again.code, audience: again.audience },
              });
            } else set({ roomHold: null, roomHoldBack: null });
          }
          await pullHome();
          return { ok: true };
        },
        confirmGender: async (email) => {
          if (!get().remote) return { ok: false, error: "That is saved on the server." };
          const saved = await (await getBoardClient()).confirmGender(email);
          if (!saved.ok) return { ok: false, error: saved.error };
          return { ok: true };
        },
        appointSteward: async (input) => {
          if (!get().remote) return { ok: false, error: "Stewards are appointed on the server." };
          const saved = await (await getBoardClient()).appointSteward(input);
          if (!saved.ok) return { ok: false, error: saved.error };
          return { ok: true };
        },
        savePlace: (input) => placeCall((client) => client.savePlace(input), false),
        joinRoom: async (roomId) => {
          if (!get().remote) return { ok: false, error: "That is saved on the server." };
          const saved = await (await getBoardClient()).joinRoom(roomId);
          if (!saved.ok) {
            if (saved.code === "gender-unstated" || saved.code === "gender-unconfirmed") {
              const previous = { section: get().section, room: get().room };
              set({
                room: roomId,
                section: "rooms",
                browsing: false,
                roomHold: { roomId, code: saved.code, audience: saved.audience },
                roomHoldBack: previous,
                boardError: "",
              });
            }
            return { ok: false, error: saved.error };
          }
          set({
            rooms: get().rooms.map((room) => (room.id === roomId ? { ...room, joined: true, member: true } : room)),
          });
          await pullHome();
          return { ok: true };
        },
        leaveRoom: async (roomId) => {
          const saved = await placeCall((client) => client.leaveRoom(roomId), false);
          if (!saved.ok) return saved;
          set({
            rooms: get().rooms.map((room) =>
              room.id === roomId ? { ...room, joined: false, member: false } : room,
            ),
          });
          return saved;
        },
        requestRoom: (input) => placeCall((client) => client.requestRoom(input), false),
        decideRoom: (id, input) => placeCall((client) => client.decideRoom(id, input), true),
        correctZip: (input) => placeCall((client) => client.correctZip(input), false),
        changeAccess: (input) => placeCall((client) => client.changeAccess(input), true),
        setCouncil: (id, input) => placeCall((client) => client.setCouncil(id, input), true),
        connectRemote: async () => {
          if (readDemoFlag()) return;
          set({ remote: true, boardError: "", undoClear: null });
          const client = await getBoardClient();
          const loaded = await client.load();
          if (!loaded.ok) {
            const own =
              loaded.error === "banned" ? await client.listAppeals() : { ok: false as const };
            set({
              remote: true,
              boardError:
                loaded.error === "banned" ? "This account is barred from the board." : loaded.error,
              posts: [],
              markLog: [],
              removals: [],
              bans: [],
              appeals: own.ok ? own.appeals : [],
              csamReports: [],
              roomPages: [],
              home: null,
              council: false,
              councilChair: false,
              stewardRooms: [],
            });
            return;
          }
          applySnapshot(loaded.board);
          await pullHome();
          const listed = await loadGatherings();
          if (listed.ok) {
            mergeGatherings(listed.gatherings);
            await syncRsvps(new Set(listed.gatherings.map((row) => row.id.toLowerCase())));
          }
        },
        loadOlder: async (room) => {
          if (!get().remote) return;
          const page = get().roomPages.find((item) => item.room === room);
          if (!page?.next) return;
          const loaded = await (await getBoardClient()).load({ room, cursor: page.next });
          if (!loaded.ok) {
            set({
              boardError:
                loaded.error === "banned" ? "This account is barred from the board." : loaded.error,
            });
            return;
          }
          const seen = new Set(get().posts.map((post) => post.id));
          const posts = [...get().posts];
          for (const post of loaded.board.posts) {
            if (!seen.has(post.id)) posts.push(post);
          }
          const seenMarks = new Set(get().markLog.map((row) => row.id));
          const markLog = [...get().markLog];
          for (const row of loaded.board.marks) {
            if (!seenMarks.has(row.id)) markLog.push(row);
          }
          const nextPage = loaded.board.pages.find((item) => item.room === room) ?? {
            room,
            next: null,
          };
          set({
            posts,
            markLog,
            roomPages: get().roomPages.map((item) => (item.room === room ? nextPage : item)),
            boardError: "",
          });
        },
        disconnectRemote: () => {
          // Signed out: no saved close carries into the next account (QA S3 #1).
          forgetSavedClose();
          setRoomCatalog(ROOMS);
          set({
            remote: false,
            admin: false,
            steward: false,
            council: false,
            councilChair: false,
            stewardRooms: [],
            gender: null,
            genderConfirmed: false,
            genderSetBy: "self",
            genderNeedsConfirmation: false,
            roomHold: null,
            roomHoldBack: null,
            home: null,
            member: false,
            boardError: "",
            rooms: ROOMS,
            posts: [],
            markLog: [],
            removals: [],
            bans: [],
            appeals: [],
            csamReports: [],
            roomPages: [],
            rsvpHosts: [],
            rollCall: {},
            rsvpPending: [],
            rsvpFailed: [],
            undoClear: null,
            localEntry: false,
          });
        },
        clearBoard: () => {
          const state = get();
          setRoomCatalog(state.remote ? state.rooms : ROOMS);
          set({
            ...emptyLocalBoard(state.remote, state.rooms),
            undoClear: null,
          });
        },
        clearLocalBoard: () => {
          const state = get();
          if (state.remote) return;
          const undo = snapshotBoard(state);
          setRoomCatalog(ROOMS);
          set({
            ...emptyLocalBoard(false, state.rooms),
            undoClear: undo,
            localEntry: true,
            section: "week",
          });
        },
        undoClearBoard: () => {
          const undo = get().undoClear;
          if (!undo || get().remote) return;
          setRoomCatalog(undo.rooms);
          set({
            me: undo.me,
            profile: undo.profile,
            steward: undo.steward,
            member: undo.member,
            founded: undo.founded,
            posts: undo.posts,
            cards: undo.cards,
            invites: undo.invites,
            markLog: undo.markLog,
            bans: undo.bans,
            threads: undo.threads,
            messages: undo.messages,
            removals: undo.removals,
            appeals: undo.appeals ?? [],
            csamReports: undo.csamReports ?? [],
            rooms: undo.rooms,
            room: undo.room,
            section: undo.section,
            viewing: undo.viewing,
            openThread: undo.openThread,
            undoClear: null,
            localEntry: true,
          });
        },
      };
    },
    {
      name: "the-board-v1",
      version: 7,
      skipHydration: true,
      partialize: (state) => ({
        room: state.room,
        member: state.member,
        founded: state.founded,
        me: state.me,
        profile: state.profile,
        deskOn: state.deskOn,
        steward: state.steward,
        lineDismissedAt: state.lineDismissedAt,
        rsvpMovedFor: state.rsvpMovedFor,
        posts: state.remote ? [] : state.posts,
        cards: state.cards,
        invites: state.invites,
        removals: state.remote ? [] : state.removals,
        appeals: state.remote ? [] : state.appeals,
        markLog: state.remote ? [] : state.markLog,
        threads: state.threads,
        messages: state.messages,
        undoClear: state.remote ? null : state.undoClear,
      }),
      // Earlier versions have different room ids and card fields. Pre-release; start clean.
      migrate: (persisted, version) => migrateBoardStorage(persisted, version),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BoardState>;
        return {
          ...current,
          ...saved,
          undoClear: undoSnapshotLive(saved.undoClear) ? saved.undoClear : null,
          messages: pruneMessages(saved.messages ?? [], Date.now()),
        };
      },
    },
  ),
);

useBoard.subscribe((state, previous) => {
  if (previous.section === "find" && state.section !== "find") {
    state.commitPendingRemovals("now");
  }
});

const leaveTarget = globalThis as typeof globalThis & {
  addEventListener?: (type: string, listener: () => void) => void;
};
if (typeof leaveTarget.addEventListener === "function") {
  const sendPending = () => useBoard.getState().commitPendingRemovals("keepalive");
  leaveTarget.addEventListener("pagehide", sendPending);
  leaveTarget.addEventListener("beforeunload", sendPending);
}
