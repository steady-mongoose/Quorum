import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DAY,
  DM_RETENTION_DAYS,
  FOUNDER_CODE,
  authorName,
  composerCheck,
  deskDid,
  inviteCode,
  inviteLive,
  newCard,
  newPost,
  stoodWith,
  threadIdFor,
  type Check,
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
  type RoomId,
  type Section,
} from "@/lib/board/model";
import { SEED_CARDS, sampleBoard } from "@/lib/board/sample";

type BoardState = {
  section: Section;
  room: RoomId;
  /** In by a code. Without it, only the door shows. */
  member: boolean;
  me: string;
  profile: Profile;
  /** Whose profile is open. */
  viewing: string | null;
  steward: boolean;
  posts: Post[];
  cards: MeetingCard[];
  invites: Invite[];
  removals: RemovalRow[];
  markLog: MarkRow[];
  threads: DmThread[];
  messages: DmMessage[];
  openThread: string | null;
  lineDismissedAt: number;
  setSection: (section: Section) => void;
  setRoom: (room: RoomId) => void;
  setMe: (me: string) => void;
  setProfile: (patch: Partial<Profile>) => void;
  setSteward: (steward: boolean) => void;
  view: (name: string) => void;
  dismissLine: () => void;
  file: (draft: Draft) => Check;
  fileDeskContact: (input: DeskContact) => void;
  reply: (parentId: string, text: string) => void;
  revise: (id: string, patch: Pick<Post, "claim" | "reason">) => void;
  closeAsked: (id: string) => void;
  mark: (id: string, mark: Mark | null) => void;
  remove: (id: string, reason: HardRule) => void;
  addCard: (card: Parameters<typeof newCard>[0]) => void;
  updateCard: (id: string, patch: Partial<MeetingCard>) => void;
  /** The host closes a date without the composer. "It did not happen" is a Hosted that says so. */
  closeCard: (id: string, happened: boolean, next: string, line: string, came: string[]) => void;
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
  sendDm: (threadId: string, text: string) => void;
  setOpenThread: (id: string | null) => void;
  loadSample: () => void;
  clearBoard: () => void;
};

const EMPTY_PROFILE: Profile = { household: "", parish: "", trade: "" };

function pruneMessages(messages: DmMessage[], now: number): DmMessage[] {
  const cutoff = now - DM_RETENTION_DAYS * DAY;
  return messages.filter((message) => message.at >= cutoff);
}

function addName(list: string[], name: string): string[] {
  return list.includes(name) ? list : [...list, name];
}

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => {
      const me = () => authorName(get().me);
      const markRow = (post: Post, mark: Mark | null): MarkRow => ({
        id: crypto.randomUUID(),
        room: post.room,
        postId: post.id,
        author: post.author,
        by: me(),
        mark,
        at: Date.now(),
      });
      /** The one way a date closes. Who came joins wentBy; the going list resets. */
      const hosted = (card: MeetingCard, input: { happened: boolean; next: string; line: string; on: string; came: string[]; named: string; pages?: string }) => {
        const post = newPost({ room: card.room, type: "hosted", claim: input.line, on: input.on, next: input.next, came: input.came, named: input.named, author: me(), cardId: card.id });
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
        set({ posts: [post, ...get().posts], cards: get().cards.map((item) => (item.id === card.id ? closed : item)) });
      };
      const patchCard = (id: string, fn: (card: MeetingCard) => MeetingCard) =>
        set({ cards: get().cards.map((card) => (card.id === id ? fn(card) : card)) });

      return {
        section: "week",
        room: "county",
        member: false,
        me: "",
        profile: EMPTY_PROFILE,
        viewing: null,
        steward: false,
        posts: [],
        cards: SEED_CARDS,
        invites: [],
        removals: [],
        markLog: [],
        threads: [],
        messages: [],
        openThread: null,
        lineDismissedAt: 0,
        setSection: (section) => set({ section }),
        setRoom: (room) => set({ room, section: "rooms" }),
        setMe: (me) => set({ me }),
        setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
        setSteward: (steward) => set({ steward }),
        view: (viewing) => set({ viewing, section: "profile" }),
        dismissLine: () => set({ lineDismissedAt: Date.now() }),
        file: (draft) => {
          const { posts, cards, removals, steward } = get();
          const check = composerCheck(draft, { author: me(), steward, posts, cards, removals, now: Date.now() });
          if (!check.ok || !draft.type) return check;
          if (draft.type === "hosted") {
            const card = cards.find((item) => item.id === draft.cardId);
            if (card) hosted(card, { happened: true, next: draft.next, line: draft.claim.trim(), on: draft.on, came: draft.came, named: draft.named, pages: draft.pages });
            return check;
          }
          const post = newPost({
            room: draft.room,
            type: draft.type,
            claim: draft.claim.trim(),
            reason: draft.reason.trim(),
            on: draft.on,
            author: me(),
            ...(draft.cardId ? { cardId: draft.cardId } : {}),
            ...(draft.tradeId ? { tradeId: draft.tradeId } : {}),
          });
          set({ posts: [post, ...posts] });
          return check;
        },
        fileDeskContact: (input) => set({ posts: [deskDid({ ...input, author: me() }), ...get().posts] }),
        reply: (parentId, text) => {
          const body = text.trim();
          const parent = get().posts.find((post) => post.id === parentId);
          if (!body || !parent) return;
          set({ posts: [newPost({ room: parent.room, type: parent.type, claim: body, author: me(), parentId }), ...get().posts] });
        },
        revise: (id, patch) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          set({
            posts: get().posts.map((item) => (item.id === id ? { ...item, claim: patch.claim.trim(), reason: patch.reason.trim(), mark: null } : item)),
            markLog: post.mark ? [markRow(post, null), ...get().markLog] : get().markLog,
          });
        },
        closeAsked: (id) => set({ posts: get().posts.map((post) => (post.id === id ? { ...post, closed: true } : post)) }),
        mark: (id, mark) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          set({ posts: get().posts.map((item) => (item.id === id ? { ...item, mark } : item)), markLog: [markRow(post, mark), ...get().markLog] });
        },
        remove: (id, reason) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          set({
            posts: get().posts.map((item) => (item.id === id || item.parentId === id ? { ...item, removed: true } : item)),
            removals: [{ id: crypto.randomUUID(), postId: id, author: post.author, reason, at: Date.now() }, ...get().removals],
          });
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
        closeCard: (id, happened, next, line, came) => {
          const card = get().cards.find((item) => item.id === id);
          if (card) hosted(card, { happened, next, line: line.trim() || (happened ? "It happened." : "It did not happen."), on: card.next, came, named: "" });
        },
        rsvp: (id) => patchCard(id, (card) => ({ ...card, going: card.going.includes(me()) ? card.going.filter((n) => n !== me()) : [...card.going, me()] })),
        visited: (id) => patchCard(id, (card) => ({ ...card, unverified: false, wentBy: addName(card.wentBy, me()) })),
        removeCard: (id) => set({ cards: get().cards.filter((card) => card.id !== id) }),
        createInvite: (cardId) => {
          const card = get().cards.find((item) => item.id === cardId);
          if (!card || card.host !== me()) return null;
          const invite: Invite = { code: inviteCode(), cardId, by: me(), at: Date.now(), redeemedBy: "" };
          set({ invites: [invite, ...get().invites] });
          return invite.code;
        },
        redeemInvite: (code, name) => {
          const who = name.trim();
          if (!who) return null;
          const typed = code.trim().toUpperCase();
          if (typed === FOUNDER_CODE) {
            set({ me: who, member: true, steward: true });
            return "founder";
          }
          const invite = get().invites.find((item) => item.code === typed);
          if (!invite || !inviteLive(invite, Date.now())) return null;
          const card = get().cards.find((item) => item.id === invite.cardId);
          if (!card) return null;
          set({
            me: who,
            member: true,
            invites: get().invites.map((item) => (item.code === invite.code ? { ...item, redeemedBy: who } : item)),
            cards: get().cards.map((item) => (item.id === card.id ? { ...item, going: addName(item.going, who) } : item)),
          });
          return card;
        },
        takeSlot: (cardId, day) =>
          patchCard(cardId, (card) => ({ ...card, slots: card.slots.map((slot) => (slot.day === day && !slot.by ? { ...slot, by: me() } : slot)) })),
        openDm: (other) => {
          const name = other.trim();
          if (!stoodWith(me(), get().cards, get().posts).has(name)) return;
          const id = threadIdFor(me(), name);
          const threads = get().threads.some((thread) => thread.id === id) ? get().threads : [{ id, between: [me(), name].sort() as [string, string] }, ...get().threads];
          set({ threads, openThread: id, section: "messages" });
        },
        sendDm: (threadId, text) => {
          const body = text.trim();
          const thread = get().threads.find((item) => item.id === threadId);
          if (!body || !thread?.between.includes(me())) return;
          set({ messages: [...pruneMessages(get().messages, Date.now()), { id: crypto.randomUUID(), threadId, from: me(), text: body, at: Date.now() }] });
        },
        setOpenThread: (openThread) => set({ openThread }),
        loadSample: () => set({ ...sampleBoard(), member: true, invites: [], removals: [], openThread: null, viewing: null, section: "week" }),
        clearBoard: () => set({ posts: [], cards: SEED_CARDS, invites: [], markLog: [], threads: [], messages: [], removals: [], openThread: null, viewing: null }),
      };
    },
    {
      name: "the-board-v1",
      version: 4,
      skipHydration: true,
      partialize: (state) => ({
        room: state.room,
        member: state.member,
        me: state.me,
        profile: state.profile,
        steward: state.steward,
        lineDismissedAt: state.lineDismissedAt,
        posts: state.posts,
        cards: state.cards,
        invites: state.invites,
        removals: state.removals,
        markLog: state.markLog,
        threads: state.threads,
        messages: state.messages,
      }),
      // Earlier versions have different room ids and card fields. Pre-release; start clean.
      migrate: (persisted, version) => (version < 4 ? {} : (persisted as object)),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BoardState>;
        return { ...current, ...saved, messages: pruneMessages(saved.messages ?? [], Date.now()) };
      },
    },
  ),
);
