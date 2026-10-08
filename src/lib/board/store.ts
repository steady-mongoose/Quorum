import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DAY,
  DM_RETENTION_DAYS,
  authorName,
  composerCheck,
  deskDid,
  messageable,
  newPost,
  threadIdFor,
  type Check,
  type DeskContact,
  type DmMessage,
  type DmThread,
  type Draft,
  type HardRule,
  type Mark,
  type MarkRow,
  type MeetingCard,
  type Post,
  type RemovalRow,
  type RoomId,
  type Section,
} from "@/lib/board/model";
import { SEED_CARDS, sampleBoard } from "@/lib/board/sample";

type BoardState = {
  section: Section;
  room: RoomId;
  me: string;
  /** Steward tools show only when this is on. One name holds it. */
  steward: boolean;
  posts: Post[];
  cards: MeetingCard[];
  removals: RemovalRow[];
  /** Every steward mark, readable by every member of the room. */
  markLog: MarkRow[];
  threads: DmThread[];
  messages: DmMessage[];
  openThread: string | null;
  lineDismissedAt: number;
  setSection: (section: Section) => void;
  setRoom: (room: RoomId) => void;
  setMe: (me: string) => void;
  setSteward: (steward: boolean) => void;
  dismissLine: () => void;
  /** Runs the composer check and files the draft if it passes. */
  file: (draft: Draft) => Check;
  /** Files the Did a logged Quorum contact becomes. */
  fileDeskContact: (input: DeskContact) => void;
  reply: (parentId: string, text: string) => void;
  revise: (id: string, patch: Pick<Post, "claim" | "reason">) => void;
  closeAsked: (id: string) => void;
  mark: (id: string, mark: Mark | null) => void;
  remove: (id: string, reason: HardRule) => void;
  addCard: (card: Omit<MeetingCard, "id" | "lastFour" | "pinned" | "unverified" | "wentBy">) => void;
  updateCard: (id: string, patch: Partial<MeetingCard>) => void;
  /**
   * The one way a date closes: the host files a Hosted. "It did not happen"
   * is a Hosted that says so. The record is the ad for the next date.
   */
  closeCard: (id: string, happened: boolean, next: string, line: string) => void;
  visited: (id: string) => void;
  removeCard: (id: string) => void;
  openDm: (other: string) => void;
  sendDm: (threadId: string, text: string) => void;
  setOpenThread: (id: string | null) => void;
  loadSample: () => void;
  clearBoard: () => void;
};

function pruneMessages(messages: DmMessage[], now: number): DmMessage[] {
  const cutoff = now - DM_RETENTION_DAYS * DAY;
  return messages.filter((message) => message.at >= cutoff);
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
      const hosted = (card: MeetingCard, happened: boolean, next: string, line: string, on: string) => {
        const post = newPost({ room: card.room, type: "hosted", claim: line, on, next, author: me(), cardId: card.id });
        const closed: MeetingCard = {
          ...card,
          lastFour: [...card.lastFour, happened].slice(-4),
          next,
          pinned: false,
          unverified: card.unverified && !happened,
        };
        set({
          posts: [post, ...get().posts],
          cards: get().cards.map((item) => (item.id === card.id ? closed : item)),
        });
      };

      return {
        section: "rooms",
        room: "civic",
        me: "",
        steward: false,
        posts: [],
        cards: SEED_CARDS,
        removals: [],
        markLog: [],
        threads: [],
        messages: [],
        openThread: null,
        lineDismissedAt: 0,
        setSection: (section) => set({ section }),
        setRoom: (room) => set({ room, section: "rooms" }),
        setMe: (me) => set({ me }),
        setSteward: (steward) => set({ steward }),
        dismissLine: () => set({ lineDismissedAt: Date.now() }),
        file: (draft) => {
          const { posts, cards, removals } = get();
          const check = composerCheck(draft, { author: me(), posts, cards, removals, now: Date.now() });
          if (!check.ok || !draft.type) return check;
          if (draft.type === "hosted") {
            const card = cards.find((item) => item.id === draft.cardId);
            if (card) hosted(card, true, draft.next, draft.claim.trim(), draft.on);
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
          const post = newPost({ room: parent.room, type: parent.type, claim: body, author: me(), parentId });
          set({ posts: [post, ...get().posts] });
        },
        revise: (id, patch) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          const revised = { ...post, claim: patch.claim.trim(), reason: patch.reason.trim(), mark: null };
          set({
            posts: get().posts.map((item) => (item.id === id ? revised : item)),
            markLog: post.mark ? [markRow(post, null), ...get().markLog] : get().markLog,
          });
        },
        closeAsked: (id) =>
          set({ posts: get().posts.map((post) => (post.id === id ? { ...post, closed: true } : post)) }),
        mark: (id, mark) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          set({
            posts: get().posts.map((item) => (item.id === id ? { ...item, mark } : item)),
            markLog: [markRow(post, mark), ...get().markLog],
          });
        },
        remove: (id, reason) => {
          const post = get().posts.find((item) => item.id === id);
          if (!post) return;
          set({
            posts: get().posts.map((item) => (item.id === id || item.parentId === id ? { ...item, removed: true } : item)),
            removals: [{ id: crypto.randomUUID(), postId: id, author: post.author, reason, at: Date.now() }, ...get().removals],
          });
        },
        addCard: (card) => {
          if (!card.name.trim() || !card.place.trim() || !card.time.trim()) return;
          const listed: MeetingCard = {
            ...card,
            id: crypto.randomUUID(),
            name: card.name.trim(),
            place: card.place.trim(),
            time: card.time.trim(),
            host: card.host.trim(),
            lastFour: [],
            pinned: false,
            unverified: false,
            wentBy: card.kind === "trade" ? [] : [me()],
          };
          set({ cards: [listed, ...get().cards] });
        },
        updateCard: (id, patch) =>
          set({ cards: get().cards.map((card) => (card.id === id ? { ...card, ...patch, id } : card)) }),
        closeCard: (id, happened, next, line) => {
          const card = get().cards.find((item) => item.id === id);
          if (card) hosted(card, happened, next, line.trim() || (happened ? "It happened." : "It did not happen."), card.next);
        },
        visited: (id) =>
          set({
            cards: get().cards.map((card) =>
              card.id === id && !card.wentBy.includes(me())
                ? { ...card, unverified: false, wentBy: [...card.wentBy, me()] }
                : card,
            ),
          }),
        removeCard: (id) => set({ cards: get().cards.filter((card) => card.id !== id) }),
        openDm: (other) => {
          const name = other.trim();
          if (!messageable(me(), get().cards, get().posts).has(name)) return;
          const id = threadIdFor(me(), name);
          const threads = get().threads.some((thread) => thread.id === id)
            ? get().threads
            : [{ id, between: [me(), name].sort() as [string, string] }, ...get().threads];
          set({ threads, openThread: id, section: "messages" });
        },
        sendDm: (threadId, text) => {
          const body = text.trim();
          const thread = get().threads.find((item) => item.id === threadId);
          if (!body || !thread?.between.includes(me())) return;
          set({
            messages: [
              ...pruneMessages(get().messages, Date.now()),
              { id: crypto.randomUUID(), threadId, from: me(), text: body, at: Date.now() },
            ],
          });
        },
        setOpenThread: (openThread) => set({ openThread }),
        loadSample: () => set({ ...sampleBoard(), removals: [], openThread: null, section: "rooms", room: "guilds" }),
        clearBoard: () =>
          set({ posts: [], cards: SEED_CARDS, markLog: [], threads: [], messages: [], removals: [], openThread: null }),
      };
    },
    {
      name: "the-board-v1",
      version: 2,
      skipHydration: true,
      partialize: (state) => ({
        room: state.room,
        me: state.me,
        steward: state.steward,
        lineDismissedAt: state.lineDismissedAt,
        posts: state.posts,
        cards: state.cards,
        removals: state.removals,
        markLog: state.markLog,
        threads: state.threads,
        messages: state.messages,
      }),
      // Version 1 saves predate the typed Hosted date and the wentBy list.
      // A pre-release board is not worth migrating; start clean.
      migrate: (persisted, version) => (version < 2 ? {} : (persisted as object)),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BoardState>;
        return {
          ...current,
          ...saved,
          messages: pruneMessages(saved.messages ?? [], Date.now()),
        };
      },
    },
  ),
);
