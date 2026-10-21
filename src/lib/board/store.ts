import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiBaseUrl } from "../api-base.ts";
import { getBoardClient, type BoardPage } from "./client.ts";
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
  type BanRow,
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
  /** Founding admin. Room creation and steward appointment. */
  admin: boolean;
  /** True while this browser is writing rooms and posts to the API. */
  remote: boolean;
  boardError: string;
  rooms: Room[];
  posts: Post[];
  cards: MeetingCard[];
  invites: Invite[];
  removals: RemovalRow[];
  bans: BanRow[];
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
        const { posts, cards, removals, bans, rooms, steward } = get();
        return composerCheck(draft, {
          author: me(),
          steward,
          posts,
          cards,
          removals,
          bans,
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
        remote: false,
        boardError: "",
        rooms: ROOMS,
        posts: [],
        cards: SEED_CARDS,
        invites: [],
        removals: [],
        bans: [],
        markLog: [],
        roomPages: [],
        threads: [],
        messages: [],
        openThread: null,
        lineDismissedAt: 0,
        setSection: (section) => set({ section }),
        setRoom: (room) => set({ room, section: "rooms" }),
        setMe: (me) => set({ me }),
        setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
        view: (viewing) => set({ viewing, section: "profile" }),
        dismissLine: () => set({ lineDismissedAt: Date.now() }),
        file: async (draft) => {
          const { posts, cards } = get();
          const check = checkNow(draft);
          if (!check.ok || !draft.type) return check;
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
          if (get().remote) {
            const saved = await (await getBoardClient()).remove(id, reason);
            if (!saved.ok) return { ok: false, error: saved.error };
            set({
              posts: get().posts.map((item) =>
                item.id === id || item.parentId === id ? { ...item, removed: true } : item,
              ),
              removals: [saved.removal, ...get().removals],
              bans: [saved.ban, ...get().bans],
            });
            return { ok: true };
          }
          set({
            posts: get().posts.map((item) =>
              item.id === id || item.parentId === id ? { ...item, removed: true } : item,
            ),
            removals: [
              { id: crypto.randomUUID(), postId: id, author: post.author, reason, at: Date.now() },
              ...get().removals,
            ],
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
        connectRemote: async () => {
          if (!apiBaseUrl()) return;
          set({ remote: true, sample: false, boardError: "" });
          const loaded = await (await getBoardClient()).load();
          if (!loaded.ok) {
            set({
              remote: true,
              boardError: loaded.error,
              posts: [],
              markLog: [],
              removals: [],
              bans: [],
              roomPages: [],
            });
            return;
          }
          const rooms = loaded.board.rooms.length > 0 ? loaded.board.rooms : ROOMS;
          setRoomCatalog(rooms);
          set({
            remote: true,
            sample: false,
            boardError: "",
            rooms,
            posts: loaded.board.posts,
            markLog: loaded.board.marks,
            removals: loaded.board.removals,
            bans: loaded.board.bans,
            roomPages: loaded.board.pages,
            steward: loaded.board.me.steward,
            admin: loaded.board.me.admin,
            member: true,
          });
        },
        loadOlder: async (room) => {
          if (!get().remote) return;
          const page = get().roomPages.find((item) => item.room === room);
          if (!page?.next) return;
          const loaded = await (await getBoardClient()).load({ room, cursor: page.next });
          if (!loaded.ok) {
            set({ boardError: loaded.error });
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
            member: false,
            boardError: "",
            rooms: ROOMS,
            posts: [],
            markLog: [],
            removals: [],
            bans: [],
            roomPages: [],
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
            boardError: "",
            sample: true,
            sampleVersion: SAMPLE_VERSION,
            member: true,
            steward: true,
            invites: [],
            removals: [],
            openThread: null,
            viewing: null,
            section: "week",
          });
        },
        clearBoard: () => {
          setRoomCatalog(ROOMS);
          set({
            sample: false,
            posts: [],
            cards: SEED_CARDS,
            invites: [],
            markLog: [],
            bans: [],
            threads: [],
            messages: [],
            removals: [],
            openThread: null,
            viewing: null,
            rooms: get().remote ? get().rooms : ROOMS,
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
        markLog: state.remote ? [] : state.markLog,
        threads: state.threads,
        messages: state.messages,
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
            messages: pruneMessages(fresh.messages, Date.now()),
          };
        }
        return { ...current, ...saved, messages: pruneMessages(saved.messages ?? [], Date.now()) };
      },
    },
  ),
);
