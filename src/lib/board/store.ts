import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DAY,
  DM_RETENTION_DAYS,
  FOUNDER_CODE,
  authorName,
  blankDraft,
  composerCheck,
  deskDid,
  inviteCode,
  inviteLive,
  newCard,
  newPost,
  stoodWith,
  threadIdFor,
  todayIso,
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
import {
  founderNameFromEnv,
  grantAdmin,
  grantMember,
  grantSteward,
  revokeAccess,
  stewardRooms,
  seatFounder,
  type AccessResult,
  type AccessRole,
  type AccessRow,
} from "@/lib/board/access";
import { congregationIdForParish, type CouncilApproval, type HomePlace } from "@/lib/board/home";
import { CONGREGATIONS, directoryRooms, type LocalRoom } from "@/lib/board/places";
import {
  SEED_GROUPS,
  appealGroupNote,
  createGroup,
  decideGroupAppeal,
  fileGroupNote,
  markGroupNote,
  removeGroupNote,
  type GroupAppeal,
  type GroupModerationRow,
  type GroupNote,
  type GroupResult,
  type ThemeGroup,
} from "@/lib/board/groups";
import { addCouncilApproval, proposeZipClear, proposeZipCorrection, revokeCouncilApproval, type GateResult } from "@/lib/board/roles";
import { SAMPLE_VERSION, SEED_CARDS, sampleBoard } from "@/lib/board/sample";
import { decideTownRoom, requestTownRoom, type TownRoomRequest } from "@/lib/board/town-rooms";
import type { ZipCorrection } from "@/lib/board/zcta";

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
  /** Rooms and, later, theme groups the member has joined. Same list Home reads. */
  joined: HomePlace[];
  /** Guard rail 7. The log is the only Home override. */
  councilApprovals: CouncilApproval[];
  /** May add a council approval. Not granted by the founder code. */
  council: boolean;
  /** May revoke a council approval and correct a ZIP. Not granted by the founder code. */
  admin: boolean;
  /** The one-time founding seat. Josh, admin and council chair. */
  councilChair: boolean;
  /** True after the bootstrap has seated Josh. It does not run again. */
  bootstrapped: boolean;
  /** Charter rule 9. Grants and revocations. Newest row wins. */
  accessLog: AccessRow[];
  /** Town rooms created only after an admin or steward approves a request. */
  extraTownRooms: LocalRoom[];
  townRoomRequests: TownRoomRequest[];
  /** Admin overlays on the census ZIP seed. Newest row for a ZIP wins. */
  zipCorrections: ZipCorrection[];
  /** Interest groups. Seeded, and a member may add one and become its admin. */
  groups: ThemeGroup[];
  groupNotes: GroupNote[];
  groupLog: GroupModerationRow[];
  groupAppeals: GroupAppeal[];
  openGroup: string | null;
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
  joinPlace: (place: HomePlace) => void;
  leavePlace: (place: HomePlace) => void;
  approveForHome: (entryId: string, reason: string) => GateResult<CouncilApproval>;
  revokeApproval: (entryId: string) => GateResult<CouncilApproval>;
  correctZip: (zip: string, name: string, state: string) => GateResult<ZipCorrection>;
  clearZip: (zip: string) => GateResult<ZipCorrection>;
  setOpenGroup: (id: string | null) => void;
  createGroup: (name: string, about: string) => GroupResult<ThemeGroup>;
  fileGroupNote: (groupId: string, body: string, on: string) => GroupResult<GroupNote>;
  markGroupNote: (noteId: string, mark: Mark | null) => GroupResult<{ note: GroupNote; row: GroupModerationRow }>;
  removeGroupNote: (noteId: string, reason: HardRule) => GroupResult<{ note: GroupNote; row: GroupModerationRow }>;
  appealGroupNote: (noteId: string, text: string) => GroupResult<GroupAppeal>;
  decideGroupAppeal: (appealId: string, decision: "upheld" | "lifted") => GroupResult<{ appeal: GroupAppeal; note: GroupNote }>;
  /** Env var path. No-ops when the var is unset. Refuses after the first seat. */
  bootstrapFromEnv: () => AccessResult<unknown> | { ok: false; error: string };
  /** Door command. Seats Josh once. */
  seatFoundingAdmin: () => AccessResult<unknown>;
  vouchMember: (name: string, roomId: string) => AccessResult<AccessRow>;
  appointSteward: (name: string, roomId: string, inviter: string) => AccessResult<AccessRow>;
  appointAdmin: (name: string, stewardApprover: string) => AccessResult<AccessRow>;
  revokeRole: (name: string, role: AccessRole, roomId: string) => AccessResult<AccessRow>;
  requestTownRoom: (name: string, state: string) => { ok: true } | { ok: false; error: string };
  decideTownRoom: (id: string, decision: "approved" | "refused", note: string) => { ok: true } | { ok: false; error: string };
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
  /** The host closes a date without the composer. Runs the same check. "It did not happen" is a Hosted that says so. */
  closeCard: (id: string, happened: boolean, next: string, line: string, came: string[], pages?: string) => Check;
  /** "I'll be there." Names, never a count. */
  rsvp: (id: string) => void;
  visited: (id: string) => void;
  removeCard: (id: string) => void;
  /** A host makes a one-use code for one card. The card shows only after a name redeems it. */
  createInvite: (cardId: string) => string | null;
  /**
   * The door. A host's code opens its card, sets the name, marks going, and
   * makes a member and logs the voucher. The founding admin is seated once,
   * not by this code.
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

const EMPTY_PROFILE: Profile = { household: "", parish: "", trade: "", zip: "", congregationId: "" };

function samePlace(a: HomePlace, b: HomePlace): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function addPlace(list: HomePlace[], place: HomePlace): HomePlace[] {
  if (!place.id || list.some((item) => samePlace(item, place))) return list;
  return [...list, place];
}

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
        const post = newPost({ room: card.room, type: "hosted", claim: input.line, on: input.on, next: input.next, came: input.came, named: input.named, author: me(), cardId: card.id, localRoomId: card.localRoomId });
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
        founded: false,
        sample: false,
        sampleVersion: 0,
        me: "",
        profile: EMPTY_PROFILE,
        joined: [],
        councilApprovals: [],
        council: false,
        admin: false,
        councilChair: false,
        bootstrapped: false,
        accessLog: [],
        extraTownRooms: [],
        townRoomRequests: [],
        zipCorrections: [],
        groups: SEED_GROUPS.map((group) => ({ ...group })),
        groupNotes: [],
        groupLog: [],
        groupAppeals: [],
        openGroup: null,
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
        setProfile: (patch) => {
          const profile = { ...get().profile, ...patch };
          if ("parish" in patch && !("congregationId" in patch)) profile.congregationId = congregationIdForParish(profile.parish, CONGREGATIONS);
          set({ profile });
        },
        joinPlace: (place) => set({ joined: addPlace(get().joined, place) }),
        leavePlace: (place) => set({ joined: get().joined.filter((item) => !samePlace(item, place)) }),
        approveForHome: (entryId, reason) => {
          const post = get().posts.find((item) => item.id === entryId && !item.removed && !item.parentId);
          const result = addCouncilApproval({ council: get().council }, me(), { entryId, reason }, Date.now(), crypto.randomUUID(), Boolean(post));
          if (result.ok) set({ councilApprovals: [...get().councilApprovals, result.row] });
          return result;
        },
        revokeApproval: (entryId) => {
          const result = revokeCouncilApproval({ admin: get().admin }, me(), get().councilApprovals, entryId, Date.now(), crypto.randomUUID());
          if (result.ok) set({ councilApprovals: [...get().councilApprovals, result.row] });
          return result;
        },
        correctZip: (zip, name, state) => {
          const result = proposeZipCorrection(get().admin, me(), { zip, name, state }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ zipCorrections: [...get().zipCorrections, result.row] });
          return result;
        },
        clearZip: (zip) => {
          const result = proposeZipClear(get().admin, me(), zip, Date.now(), crypto.randomUUID());
          if (result.ok) set({ zipCorrections: [...get().zipCorrections, result.row] });
          return result;
        },
        setOpenGroup: (openGroup) => set({ openGroup, section: openGroup ? "groups" : get().section }),
        createGroup: (name, about) => {
          const result = createGroup(me(), name, about, get().groups, Date.now());
          if (result.ok) set({ groups: [...get().groups, result.value], openGroup: result.value.id });
          return result;
        },
        fileGroupNote: (groupId, body, on) => {
          const group = get().groups.find((item) => item.id === groupId);
          const joined = get().joined.some((place) => place.kind === "group" && place.id === groupId);
          const result = fileGroupNote(me(), group, joined, { body, on }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ groupNotes: [result.value, ...get().groupNotes] });
          return result;
        },
        markGroupNote: (noteId, mark) => {
          const note = get().groupNotes.find((item) => item.id === noteId);
          const group = get().groups.find((item) => item.id === note?.groupId);
          const result = markGroupNote(me(), group, note, mark, Date.now(), crypto.randomUUID());
          if (result.ok) {
            set({
              groupNotes: get().groupNotes.map((item) => (item.id === noteId ? result.value.note : item)),
              groupLog: [result.value.row, ...get().groupLog],
            });
          }
          return result;
        },
        removeGroupNote: (noteId, reason) => {
          const note = get().groupNotes.find((item) => item.id === noteId);
          const group = get().groups.find((item) => item.id === note?.groupId);
          const result = removeGroupNote(me(), group, note, reason, Date.now(), crypto.randomUUID());
          if (result.ok) {
            set({
              groupNotes: get().groupNotes.map((item) => (item.id === noteId ? result.value.note : item)),
              groupLog: [result.value.row, ...get().groupLog],
            });
          }
          return result;
        },
        appealGroupNote: (noteId, text) => {
          const note = get().groupNotes.find((item) => item.id === noteId);
          const result = appealGroupNote(me(), note, get().groupAppeals, text, Date.now(), crypto.randomUUID());
          if (result.ok) set({ groupAppeals: [result.value, ...get().groupAppeals] });
          return result;
        },
        decideGroupAppeal: (appealId, decision) => {
          const appeal = get().groupAppeals.find((item) => item.id === appealId);
          const note = get().groupNotes.find((item) => item.id === appeal?.noteId);
          const result = decideGroupAppeal(me(), get().steward, appeal, note, decision, Date.now());
          if (result.ok) {
            set({
              groupAppeals: get().groupAppeals.map((item) => (item.id === appealId ? result.value.appeal : item)),
              groupNotes: get().groupNotes.map((item) => (item.id === result.value.note.id ? result.value.note : item)),
              groupLog: [
                {
                  id: crypto.randomUUID(),
                  noteId: result.value.note.id,
                  groupId: result.value.note.groupId,
                  by: me(),
                  action: decision === "lifted" ? "clear" : "mark",
                  mark: result.value.note.mark,
                  reason: decision,
                  at: Date.now(),
                },
                ...get().groupLog,
              ],
            });
          }
          return result;
        },
        bootstrapFromEnv: () => {
          const envName = (import.meta.env.VITE_BOOTSTRAP_OWNER as string | undefined) ?? "";
          if (!founderNameFromEnv(envName)) return { ok: false, error: "" };
          const result = seatFounder({
            bootstrapped: get().bootstrapped,
            currentMember: get().member ? get().me : "",
            envName,
            command: false,
            now: Date.now(),
            memberId: crypto.randomUUID(),
            adminId: crypto.randomUUID(),
          });
          if (!result.ok) return result;
          set({
            me: result.row.name,
            member: true,
            founded: true,
            bootstrapped: true,
            admin: true,
            council: true,
            councilChair: true,
            accessLog: [...get().accessLog, ...result.row.rows],
            section: "week",
          });
          return result;
        },
        seatFoundingAdmin: () => {
          const result = seatFounder({
            bootstrapped: get().bootstrapped,
            currentMember: get().member ? get().me : "",
            envName: "",
            command: true,
            now: Date.now(),
            memberId: crypto.randomUUID(),
            adminId: crypto.randomUUID(),
          });
          if (!result.ok) return result;
          set({
            me: result.row.name,
            member: true,
            founded: true,
            bootstrapped: true,
            admin: true,
            council: true,
            councilChair: true,
            accessLog: [...get().accessLog, ...result.row.rows],
            section: "week",
          });
          return result;
        },
        vouchMember: (name, roomId) => {
          const result = grantMember(get().accessLog, me(), { name, roomId }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ accessLog: [...get().accessLog, result.row] });
          return result;
        },
        appointSteward: (name, roomId, inviter) => {
          const result = grantSteward(get().accessLog, me(), get().councilChair, { name, roomId, inviter }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ accessLog: [...get().accessLog, result.row], steward: result.row.name === me() ? true : get().steward });
          return result;
        },
        appointAdmin: (name, stewardApprover) => {
          const result = grantAdmin(get().accessLog, me(), { name, stewardApprover }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ accessLog: [...get().accessLog, result.row], admin: result.row.name === me() ? true : get().admin });
          return result;
        },
        revokeRole: (name, role, roomId) => {
          const result = revokeAccess(get().accessLog, me(), { name, role, roomId }, Date.now(), crypto.randomUUID());
          if (result.ok) {
            const log = [...get().accessLog, result.row];
            set({ accessLog: log, steward: name === me() && role === "steward" ? stewardRooms(log, me()).length > 0 : get().steward });
          }
          return result;
        },
        requestTownRoom: (name, state) => {
          const result = requestTownRoom(me(), directoryRooms(get().extraTownRooms), get().townRoomRequests, { name, state }, Date.now(), crypto.randomUUID());
          if (result.ok) set({ townRoomRequests: [...get().townRoomRequests, result.value] });
          return result.ok ? { ok: true } : result;
        },
        decideTownRoom: (id, decision, note) => {
          const request = get().townRoomRequests.find((row) => row.id === id);
          const result = decideTownRoom(me(), { admin: get().admin, steward: get().steward }, directoryRooms(get().extraTownRooms), request, decision, note, Date.now());
          if (!result.ok) return result;
          set({
            townRoomRequests: get().townRoomRequests.map((row) => (row.id === id ? result.value.request : row)),
            extraTownRooms: result.value.room ? [...get().extraTownRooms, result.value.room] : get().extraTownRooms,
          });
          return { ok: true };
        },
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
          const linked = cards.find((item) => item.id === (draft.cardId || draft.tradeId));
          const post = newPost({
            room: draft.room,
            type: draft.type,
            claim: draft.claim.trim(),
            reason: draft.reason.trim(),
            on: draft.on,
            author: me(),
            localRoomId: linked?.localRoomId ?? "",
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
          set({ posts: [newPost({ room: parent.room, type: parent.type, claim: body, author: me(), parentId, localRoomId: parent.localRoomId }), ...get().posts] });
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
        closeCard: (id, happened, next, line, came, pages = "") => {
          const { posts, cards, removals, steward } = get();
          const card = cards.find((item) => item.id === id);
          if (!card) return { ok: false, stops: ["That card is gone."], notes: [] };
          const claim = line.trim() || (happened ? "It happened." : "It did not happen.");
          const draft: Draft = { ...blankDraft(card.room), type: "hosted", claim, on: card.next || todayIso(), next, came, pages, cardId: card.id };
          const check = composerCheck(draft, { author: me(), steward, posts, cards, removals, now: Date.now() });
          if (check.ok) hosted(card, { happened, next, line: claim, on: draft.on, came, named: "", pages });
          return check;
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
          if (get().member) return null;
          if (typed === FOUNDER_CODE) {
            // The founding admin is seated by the bootstrap, once. The founder
            // code no longer grants a steward. Charter rule 9 does that.
            return null;
          }
          const invite = get().invites.find((item) => item.code === typed);
          if (!invite || !inviteLive(invite, Date.now())) return null;
          const card = get().cards.find((item) => item.id === invite.cardId);
          if (!card) return null;
          const roomId = card.localRoomId || card.room;
          const vouched = grantMember(get().accessLog, invite.by, { name: who, roomId }, Date.now(), crypto.randomUUID());
          if (!vouched.ok) return null;
          set({
            me: who,
            member: true,
            invites: get().invites.map((item) => (item.code === invite.code ? { ...item, redeemedBy: who } : item)),
            cards: get().cards.map((item) => (item.id === card.id ? { ...item, going: addName(item.going, who) } : item)),
            joined: card.localRoomId ? addPlace(get().joined, { kind: "room", id: card.localRoomId }) : get().joined,
            accessLog: [...get().accessLog, vouched.row],
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
        loadSample: () =>
          set({
            ...sampleBoard(),
            sample: true,
            sampleVersion: SAMPLE_VERSION,
            member: true,
            steward: true,
            council: true,
            admin: true,
            councilChair: true,
            bootstrapped: true,
            zipCorrections: [],
            groupAppeals: [],
            openGroup: null,
            extraTownRooms: [],
            invites: [],
            removals: [],
            openThread: null,
            viewing: null,
            section: "week",
          }),
        clearBoard: () =>
          set({
            sample: false,
            posts: [],
            cards: SEED_CARDS,
            invites: [],
            markLog: [],
            threads: [],
            messages: [],
            removals: [],
            openThread: null,
            viewing: null,
            joined: [],
            councilApprovals: [],
            zipCorrections: [],
            groups: SEED_GROUPS.map((group) => ({ ...group })),
            groupNotes: [],
            groupLog: [],
            groupAppeals: [],
            openGroup: null,
            townRoomRequests: [],
            extraTownRooms: [],
          }),
      };
    },
    {
      name: "the-board-v1",
      version: 5,
      skipHydration: true,
      partialize: (state) => ({
        room: state.room,
        member: state.member,
        founded: state.founded,
        sample: state.sample,
        sampleVersion: state.sampleVersion,
        me: state.me,
        profile: state.profile,
        joined: state.joined,
        councilApprovals: state.councilApprovals,
        council: state.council,
        admin: state.admin,
        councilChair: state.councilChair,
        bootstrapped: state.bootstrapped,
        accessLog: state.accessLog,
        extraTownRooms: state.extraTownRooms,
        townRoomRequests: state.townRoomRequests,
        zipCorrections: state.zipCorrections,
        groups: state.groups,
        groupNotes: state.groupNotes,
        groupLog: state.groupLog,
        groupAppeals: state.groupAppeals,
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
      migrate: (persisted, version) => (version < 5 ? {} : (persisted as object)),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<BoardState>;
        // A saved sample older than the current one is replaced, so the demo
        // never shows yesterday's placeholders.
        const isSample = saved.sample === true || (saved.cards?.some((card) => card.id === "s-framing") ?? false);
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
            council: true,
            admin: true,
            councilChair: true,
            bootstrapped: true,
            zipCorrections: [],
            extraTownRooms: [],
            messages: pruneMessages(fresh.messages, Date.now()),
          };
        }
        return {
          ...current,
          ...saved,
          profile: { ...EMPTY_PROFILE, ...saved.profile },
          joined: Array.isArray(saved.joined) ? saved.joined : [],
          councilApprovals: Array.isArray(saved.councilApprovals) ? saved.councilApprovals : [],
          council: saved.council === true,
          admin: saved.admin === true,
          councilChair: saved.councilChair === true,
          bootstrapped: saved.bootstrapped === true,
          accessLog: Array.isArray(saved.accessLog) ? saved.accessLog : [],
          extraTownRooms: Array.isArray(saved.extraTownRooms) ? saved.extraTownRooms : [],
          townRoomRequests: Array.isArray(saved.townRoomRequests) ? saved.townRoomRequests : [],
          zipCorrections: Array.isArray(saved.zipCorrections) ? saved.zipCorrections : [],
          groups: Array.isArray(saved.groups) && saved.groups.length > 0 ? saved.groups : SEED_GROUPS.map((group) => ({ ...group })),
          groupNotes: Array.isArray(saved.groupNotes) ? saved.groupNotes : [],
          groupLog: Array.isArray(saved.groupLog) ? saved.groupLog : [],
          groupAppeals: Array.isArray(saved.groupAppeals) ? saved.groupAppeals : [],
          messages: pruneMessages(saved.messages ?? [], Date.now()),
        };
      },
    },
  ),
);
