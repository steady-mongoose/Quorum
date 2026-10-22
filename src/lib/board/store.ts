import { create } from "zustand";
import { persist } from "zustand/middleware";
import { readDemoFlag } from "../api-mode.ts";
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
import {
  DAY,
  DM_RETENTION_DAYS,
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
  stoodWith,
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
import { SAMPLE_VERSION, SEED_CARDS, sampleBoard } from "./sample.ts";
import { SENTENCE_ERROR, oneSentence } from "./text.ts";

type BoardState = {
  section: Section;
  room: RoomId;
  /** In by a code. Without it, only the door shows. */
  member: boolean;
  /** The founder code has been used on this box. */
  founded: boolean;
  /** The board is the invented sample week, not real members. */
  sample: boolean;
  /** Which version of the sample was loaded, so a stale one is reloaded. */
  sampleVersion: number;
  me: string;
  profile: Profile;
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
  /** Server Home. Null in the sample week. The array order is the server's. */
  home: HomePayload | null;
  /** True while this browser is writing rooms and posts to the API. */
  remote: boolean;
  boardError: string;
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
  lineDismissedAt: number;
  setSection: (section: Section) => void;
  setRoom: (room: RoomId) => void;
  setMe: (me: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  view: (name: string) => void;
  dismissLine: () => void;
  file: (draft: Draft) => Promise<Check>;
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
  }) => Promise<{ ok: boolean; error?: string }>;
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
  ) => Promise<Check>;
  /** "I'll be there." Names, never a count. */
  rsvp: (id: string) => void;
  visited: (id: string) => void;
  removeCard: (id: string) => void;
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
  sendDm: (threadId: string, text: string, media?: SharedMedia) => void;
  setOpenThread: (id: string | null) => void;
  loadSample: () => void;
  clearBoard: () => void;
  /**
   * Wipes the local board after the person confirms, stays on This week,
   * and keeps a one-step undo. A remote board is left alone.
   */
  clearLocalBoard: () => void;
  undoClearBoard: () => void;
  /** One-step undo of the last confirmed clear. Persisted until it expires. */
  undoClear: BoardUndo | null;
  /** Keeps a cleared sample inside the app on a live server. Not persisted. */
  localEntry: boolean;
};

/** The undo bar hides itself. The snapshot stays until `UNDO_TTL_MS`. */
export const UNDO_BAR_MS = 10_000;
/** A reload inside this window can still put the cleared board back. */
export const UNDO_TTL_MS = 10 * 60 * 1000;

type BoardUndo = {
  at: number;
  sample: boolean;
  sampleVersion: number;
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
    sample: false,
    posts: [] as Post[],
    cards: SEED_CARDS,
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
  sample: boolean;
  sampleVersion: number;
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
    sample: state.sample,
    sampleVersion: state.sampleVersion,
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
      const patchCard = (id: string, fn: (card: MeetingCard) => MeetingCard) =>
        set({ cards: get().cards.map((card) => (card.id === id ? fn(card) : card)) });
      let posting = false;

      const applySnapshot = (board: BoardSnapshot) => {
        const rooms = board.rooms.length > 0 ? board.rooms : ROOMS;
        setRoomCatalog(rooms);
        set({
          remote: true,
          sample: false,
          boardError: "",
          rooms,
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
        });
      };

      const pullHome = async () => {
        const loaded = await (await getBoardClient()).loadHome();
        if (loaded.ok) set({ home: loaded.home });
      };

      const placeCall = async (
        run: (client: Awaited<ReturnType<typeof getBoardClient>>) => Promise<{ ok: true } | { ok: false; error: string }>,
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

      return {
        section: "week",
        room: "county",
        member: false,
        founded: false,
        sample: false,
        sampleVersion: 0,
        me: "",
        profile: EMPTY_PROFILE,
        viewing: null,
        steward: false,
        admin: false,
        council: false,
        councilChair: false,
        stewardRooms: [],
        home: null,
        remote: false,
        boardError: "",
        rooms: ROOMS,
        posts: [],
        cards: SEED_CARDS,
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
        undoClear: null,
        localEntry: false,
        setSection: (section) => set({ section }),
        setRoom: (room) => set({ room, section: "rooms" }),
        setMe: (me) => set({ me }),
        setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
        view: (viewing) => set({ viewing, section: "profile" }),
        dismissLine: () => set({ lineDismissedAt: Date.now() }),
        file: async (draft) => {
          if (posting) return { ok: false, stops: [], notes: [] };
          const { posts, cards } = get();
          const check = checkNow(draft);
          if (!check.ok || !draft.type) return check;
          posting = true;
          try {
            if (get().remote) {
              const saved = await (await getBoardClient()).createPost(draft);
              if (!saved.ok)
                return { ok: false, stops: saved.stops ?? [saved.error], notes: check.notes };
              if (draft.type === "hosted") {
                const card = cards.find((item) => item.id === draft.cardId);
                if (card) {
                  hosted(card, {
                    happened: true,
                    next: draft.next,
                    line: draft.claim.trim(),
                    on: draft.on,
                    came: draft.came,
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
        },
        updateCard: (id, patch) => patchCard(id, (card) => ({ ...card, ...patch, id })),
        closeCard: async (id, happened, next, line, came, pages = "") => {
          const { cards } = get();
          const card = cards.find((item) => item.id === id);
          if (!card) return { ok: false, stops: ["That card is gone."], notes: [] };
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
          };
          const check = checkNow(draft);
          if (!check.ok) return check;
          if (get().remote) {
            const saved = await (await getBoardClient()).createPost(draft);
            if (!saved.ok) return { ok: false, stops: saved.stops ?? [saved.error], notes: [] };
            hosted(card, {
              happened,
              next,
              line: claim,
              on: draft.on,
              came,
              named: "",
              pages,
              post: saved.post,
            });
            return check;
          }
          hosted(card, { happened, next, line: claim, on: draft.on, came, named: "", pages });
          return check;
        },
        rsvp: (id) =>
          patchCard(id, (card) => ({
            ...card,
            going: card.going.includes(me())
              ? card.going.filter((n) => n !== me())
              : [...card.going, me()],
          })),
        visited: (id) =>
          patchCard(id, (card) => ({
            ...card,
            unverified: false,
            wentBy: addName(card.wentBy, me()),
          })),
        removeCard: (id) => set({ cards: get().cards.filter((card) => card.id !== id) }),
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
          if (!stoodWith(me(), get().cards, get().posts).has(name)) return;
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
          if ((!body && attachment.length === 0) || !thread?.between.includes(me())) return;
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
        setOpenThread: (openThread) => set({ openThread }),
        createRoom: async (input) => {
          if (!get().remote) return { ok: false, error: "Rooms are added on the server." };
          const saved = await (await getBoardClient()).createRoom(input);
          if (!saved.ok) return { ok: false, error: saved.error };
          const rooms = get().rooms.some((room) => room.id === saved.room.id)
            ? get().rooms
            : [...get().rooms, saved.room];
          setRoomCatalog(rooms);
          set({ rooms });
          return { ok: true };
        },
        appointSteward: async (input) => {
          if (!get().remote) return { ok: false, error: "Stewards are appointed on the server." };
          const saved = await (await getBoardClient()).appointSteward(input);
          if (!saved.ok) return { ok: false, error: saved.error };
          return { ok: true };
        },
        savePlace: (input) => placeCall((client) => client.savePlace(input), false),
        joinRoom: (roomId) => placeCall((client) => client.joinRoom(roomId), false),
        leaveRoom: (roomId) => placeCall((client) => client.leaveRoom(roomId), false),
        requestRoom: (input) => placeCall((client) => client.requestRoom(input), false),
        decideRoom: (id, input) => placeCall((client) => client.decideRoom(id, input), true),
        correctZip: (input) => placeCall((client) => client.correctZip(input), false),
        changeAccess: (input) => placeCall((client) => client.changeAccess(input), true),
        setCouncil: (id, input) => placeCall((client) => client.setCouncil(id, input), true),
        connectRemote: async () => {
          if (readDemoFlag()) return;
          set({ remote: true, sample: false, boardError: "", undoClear: null });
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
          setRoomCatalog(ROOMS);
          set({
            remote: false,
            admin: false,
            steward: false,
            council: false,
            councilChair: false,
            stewardRooms: [],
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
            undoClear: null,
            localEntry: false,
          });
        },
        loadSample: () => {
          if (get().remote) return;
          setRoomCatalog(ROOMS);
          set({
            ...sampleBoard(),
            rooms: ROOMS,
            bans: [],
            remote: false,
            admin: false,
            council: false,
            councilChair: false,
            stewardRooms: [],
            home: null,
            boardError: "",
            sample: true,
            sampleVersion: SAMPLE_VERSION,
            member: true,
            steward: true,
            invites: [],
            removals: [],
            appeals: [],
            csamReports: [],
            openThread: null,
            viewing: null,
            section: "week",
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
            sample: undo.sample,
            sampleVersion: undo.sampleVersion,
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
      version: 6,
      skipHydration: true,
      partialize: (state) => ({
        room: state.room,
        member: state.member,
        founded: state.founded,
        sample: state.sample,
        sampleVersion: state.sampleVersion,
        me: state.me,
        profile: state.profile,
        steward: state.steward,
        lineDismissedAt: state.lineDismissedAt,
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
      migrate: (persisted, version) => {
        if (version < 5) return {};
        if (version < 6 && persisted && typeof persisted === "object") {
          const saved = persisted as { markLog?: MarkRow[] };
          return {
            ...saved,
            markLog: (saved.markLog ?? []).map((row) => ({ ...row, reason: row.reason ?? "" })),
          };
        }
        return persisted as object;
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BoardState>;
        // A saved sample older than the current one is replaced, so the demo
        // never shows yesterday's placeholders.
        const isSample =
          saved.sample === true || (saved.cards?.some((card) => card.id === "s-framing") ?? false);
        if (isSample && (saved.sampleVersion ?? 0) < SAMPLE_VERSION) {
          const fresh = sampleBoard();
          return {
            ...current,
            ...saved,
            ...fresh,
            sample: true,
            sampleVersion: SAMPLE_VERSION,
            member: true,
            steward: true,
            undoClear: null,
            messages: pruneMessages(fresh.messages, Date.now()),
          };
        }
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
