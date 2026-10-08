import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  BAN_DAYS,
  DM_RETENTION_DAYS,
  SEED_CARDS,
  canDm,
  threadIdFor,
  type Ban,
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
import { sampleBoard } from "@/lib/board/sample";

type BoardState = {
  section: Section;
  room: RoomId;
  /** The name on your posts. Login replaces this on the VPS. */
  me: string;
  /** Steward tools show only when this is on. One name holds it. */
  steward: boolean;
  posts: Post[];
  cards: MeetingCard[];
  bans: Ban[];
  removals: RemovalRow[];
  /** Every steward mark, readable by every member of the room. */
  markLog: MarkRow[];
  threads: DmThread[];
  messages: DmMessage[];
  /** The thread open in Messages. */
  openThread: string | null;
  /** When the 20-minute line was last dismissed, so it does not nag twice. */
  lineDismissedAt: number;
  /** Whether this user asked for reply notifications. Off by default. */
  replyNotify: boolean;
  setSection: (section: Section) => void;
  setRoom: (room: RoomId) => void;
  setMe: (me: string) => void;
  setSteward: (steward: boolean) => void;
  setReplyNotify: (on: boolean) => void;
  dismissLine: () => void;
  /** Files a checked draft. The caller runs composerCheck first. */
  file: (draft: Draft, extra?: Partial<Post>) => void;
  reply: (parentId: string, text: string) => void;
  revise: (id: string, patch: Pick<Post, "claim" | "reason">) => void;
  closeAsked: (id: string) => void;
  mark: (id: string, mark: Mark | null) => void;
  remove: (id: string, reason: HardRule) => void;
  addCard: (card: Omit<MeetingCard, "id" | "lastFour" | "pinned" | "unverified" | "wentBy">) => void;
  updateCard: (id: string, patch: Partial<MeetingCard>) => void;
  /** The host marks that it happened. That note is the ad for the next date. */
  markHappened: (id: string, happened: boolean, next: string) => void;
  /** Someone who went. Two visits before their listing counts. */
  visited: (id: string) => void;
  removeCard: (id: string) => void;
  /** Opens or returns the thread with `other`, if the rules allow it. */
  openDm: (other: string) => string | null;
  sendDm: (threadId: string, text: string) => void;
  setOpenThread: (id: string | null) => void;
  /** Replaces the board with the sample week. For trying the product. */
  loadSample: () => void;
  /** Wipes everything but your name. */
  clearBoard: () => void;
};

const DAY = 24 * 60 * 60 * 1000;

function isPost(value: unknown): value is Post {
  if (!value || typeof value !== "object") return false;
  const item = value as Post;
  return (
    typeof item.id === "string" &&
    typeof item.room === "string" &&
    typeof item.type === "string" &&
    typeof item.claim === "string" &&
    typeof item.at === "number"
  );
}

function isCard(value: unknown): value is MeetingCard {
  if (!value || typeof value !== "object") return false;
  const item = value as MeetingCard;
  return typeof item.id === "string" && typeof item.room === "string" && Array.isArray(item.lastFour);
}

/** Older saves lack the fields added for messages and trade cards. */
function upgradeCard(card: MeetingCard): MeetingCard {
  return {
    ...card,
    kind: card.kind ?? "meeting",
    wentBy: Array.isArray(card.wentBy) ? card.wentBy : [],
    firstTimer: card.firstTimer === true,
  };
}

function mergeSeedCards(saved: MeetingCard[]): MeetingCard[] {
  const ids = new Set(saved.map((item) => item.id));
  return [...saved.map(upgradeCard), ...SEED_CARDS.filter((item) => !ids.has(item.id))];
}

/** Messages older than the retention window are gone. Less to leak. */
function pruneMessages(messages: DmMessage[], now: number): DmMessage[] {
  const cutoff = now - DM_RETENTION_DAYS * DAY;
  return messages.filter((message) => message.at >= cutoff);
}

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => ({
      section: "rooms",
      room: "civic",
      me: "",
      steward: false,
      posts: [],
      cards: SEED_CARDS,
      bans: [],
      removals: [],
      markLog: [],
      threads: [],
      messages: [],
      openThread: null,
      lineDismissedAt: 0,
      replyNotify: false,
      setSection: (section) => set({ section }),
      setRoom: (room) => set({ room, section: "rooms" }),
      setMe: (me) => set({ me }),
      setSteward: (steward) => set({ steward }),
      setReplyNotify: (replyNotify) => set({ replyNotify }),
      dismissLine: () => set({ lineDismissedAt: Date.now() }),
      file: (draft, extra = {}) => {
        if (!draft.type) return;
        const post: Post = {
          id: crypto.randomUUID(),
          room: draft.room,
          type: draft.type,
          claim: draft.claim.trim(),
          reason: draft.reason.trim(),
          on: draft.on,
          author: get().me.trim() || "You",
          at: Date.now(),
          parentId: null,
          closed: false,
          mark: null,
          removed: false,
          ...(draft.cardId ? { cardId: draft.cardId } : {}),
          ...(draft.tradeId ? { tradeId: draft.tradeId } : {}),
          ...extra,
        };
        set({ posts: [post, ...get().posts] });
        // A Hosted closes the card: it happened, and here is the next date.
        if (draft.type === "hosted" && draft.cardId) {
          const next = /^\d{4}-\d{2}-\d{2}$/.test(post.reason) ? post.reason : "";
          get().markHappened(draft.cardId, true, next);
        }
      },
      reply: (parentId, text) => {
        const body = text.trim();
        const parent = get().posts.find((post) => post.id === parentId);
        if (!body || !parent) return;
        set({
          posts: [
            {
              id: crypto.randomUUID(),
              room: parent.room,
              type: parent.type,
              claim: body,
              reason: "",
              on: "",
              author: get().me.trim() || "You",
              at: Date.now(),
              parentId,
              closed: false,
              mark: null,
              removed: false,
            },
            ...get().posts,
          ],
        });
      },
      revise: (id, patch) =>
        set({
          posts: get().posts.map((post) =>
            post.id === id
              ? { ...post, claim: patch.claim.trim(), reason: patch.reason.trim(), mark: null }
              : post,
          ),
        }),
      closeAsked: (id) =>
        set({ posts: get().posts.map((post) => (post.id === id ? { ...post, closed: true } : post)) }),
      mark: (id, mark) => {
        const post = get().posts.find((item) => item.id === id);
        if (!post) return;
        set({
          posts: get().posts.map((item) => (item.id === id ? { ...item, mark } : item)),
          markLog: [
            {
              id: crypto.randomUUID(),
              room: post.room,
              postId: id,
              author: post.author,
              by: get().me.trim() || "You",
              mark,
              at: Date.now(),
            },
            ...get().markLog,
          ],
        });
      },
      remove: (id, reason) => {
        const post = get().posts.find((item) => item.id === id);
        if (!post) return;
        const existing = get().bans.find((ban) => ban.author === post.author);
        const strikes = (existing?.strikes ?? 0) + 1;
        const ban: Ban = {
          author: post.author,
          until: Date.now() + BAN_DAYS * DAY,
          reason,
          strikes,
        };
        set({
          posts: get().posts.map((item) =>
            item.id === id || item.parentId === id ? { ...item, removed: true } : item,
          ),
          bans: [ban, ...get().bans.filter((item) => item.author !== post.author)],
          removals: [
            { id: crypto.randomUUID(), postId: id, author: post.author, reason, at: Date.now() },
            ...get().removals,
          ],
        });
      },
      addCard: (card) => {
        if (!card.name.trim() || !card.place.trim() || !card.time.trim()) return;
        set({
          cards: [
            {
              ...card,
              id: crypto.randomUUID(),
              name: card.name.trim(),
              place: card.place.trim(),
              time: card.time.trim(),
              host: card.host.trim(),
              lastFour: [],
              pinned: false,
              unverified: false,
              wentBy: [],
            },
            ...get().cards,
          ],
        });
      },
      updateCard: (id, patch) =>
        set({ cards: get().cards.map((card) => (card.id === id ? { ...card, ...patch, id } : card)) }),
      markHappened: (id, happened, next) =>
        set({
          cards: get().cards.map((card) =>
            card.id === id
              ? {
                  ...card,
                  lastFour: [...card.lastFour, happened].slice(-4),
                  next,
                  pinned: false,
                  unverified: card.unverified && !happened,
                }
              : card,
          ),
        }),
      visited: (id) => {
        const me = get().me.trim() || "You";
        set({
          cards: get().cards.map((card) =>
            card.id === id
              ? {
                  ...card,
                  visits: card.visits + 1,
                  unverified: false,
                  wentBy: card.wentBy.includes(me) ? card.wentBy : [...card.wentBy, me],
                }
              : card,
          ),
        });
      },
      removeCard: (id) => set({ cards: get().cards.filter((card) => card.id !== id) }),
      openDm: (other) => {
        const me = get().me.trim();
        const name = other.trim();
        if (!canDm(me, name, get().cards, get().posts)) return null;
        const id = threadIdFor(me, name);
        if (!get().threads.some((thread) => thread.id === id)) {
          const between = [me, name].sort() as [string, string];
          set({ threads: [{ id, between }, ...get().threads] });
        }
        set({ openThread: id, section: "messages" });
        return id;
      },
      sendDm: (threadId, text) => {
        const body = text.trim();
        const thread = get().threads.find((item) => item.id === threadId);
        const me = get().me.trim();
        if (!body || !thread || !thread.between.includes(me)) return;
        set({
          messages: [
            ...pruneMessages(get().messages, Date.now()),
            { id: crypto.randomUUID(), threadId, from: me, text: body, at: Date.now() },
          ],
        });
      },
      setOpenThread: (openThread) => set({ openThread }),
      loadSample: () => {
        const sample = sampleBoard();
        set({
          me: sample.me,
          posts: sample.posts,
          cards: sample.cards,
          markLog: sample.markLog,
          threads: sample.threads,
          messages: sample.messages,
          bans: [],
          removals: [],
          openThread: null,
          section: "rooms",
          room: "guilds",
        });
      },
      clearBoard: () =>
        set({
          posts: [],
          cards: SEED_CARDS,
          markLog: [],
          threads: [],
          messages: [],
          bans: [],
          removals: [],
          openThread: null,
        }),
    }),
    {
      name: "the-board-v1",
      skipHydration: true,
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const saved = persisted as Partial<BoardState>;
        const now = Date.now();
        return {
          ...current,
          section: saved.section ?? current.section,
          room: saved.room ?? current.room,
          me: typeof saved.me === "string" ? saved.me : current.me,
          steward: saved.steward === true,
          replyNotify: saved.replyNotify === true,
          lineDismissedAt: typeof saved.lineDismissedAt === "number" ? saved.lineDismissedAt : 0,
          posts: Array.isArray(saved.posts) && saved.posts.every(isPost) ? saved.posts : current.posts,
          cards: mergeSeedCards(
            Array.isArray(saved.cards) && saved.cards.every(isCard) ? saved.cards : current.cards,
          ),
          bans: Array.isArray(saved.bans) ? (saved.bans as Ban[]) : current.bans,
          removals: Array.isArray(saved.removals) ? (saved.removals as RemovalRow[]) : current.removals,
          markLog: Array.isArray(saved.markLog) ? (saved.markLog as MarkRow[]) : current.markLog,
          threads: Array.isArray(saved.threads) ? (saved.threads as DmThread[]) : current.threads,
          messages: Array.isArray(saved.messages)
            ? pruneMessages(saved.messages as DmMessage[], now)
            : current.messages,
          openThread: typeof saved.openThread === "string" ? saved.openThread : null,
        };
      },
      partialize: (state) => ({
        section: state.section,
        room: state.room,
        me: state.me,
        steward: state.steward,
        replyNotify: state.replyNotify,
        lineDismissedAt: state.lineDismissedAt,
        posts: state.posts,
        cards: state.cards,
        bans: state.bans,
        removals: state.removals,
        markLog: state.markLog,
        threads: state.threads,
        messages: state.messages,
        openThread: state.openThread,
      }),
    },
  ),
);
