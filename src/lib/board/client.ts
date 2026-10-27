import type { BrowseRoom, RoomCategory } from "./categories.ts";
import type { HomePayload } from "./home.ts";
import type {
  AppealRow,
  BanRow,
  CsamReport,
  Draft,
  HardRule,
  Mark,
  MarkRow,
  Post,
  RemovalRow,
  Room,
} from "./model.ts";

export type BoardMe = {
  member: boolean;
  steward: boolean;
  admin: boolean;
  council: boolean;
  councilChair: boolean;
  /** Rooms with a live steward grant. An admin is not listed here. */
  stewardRooms: string[];
  ban: { until: number; strikes: number; reason: HardRule } | null;
  gender: "man" | "woman" | null;
  genderConfirmed: boolean;
};

export type GenderPolicyInfo = {
  setBy: "self" | "inviter" | "steward";
  requiresConfirmation: boolean;
  changeBy: "admin" | "steward";
};

export type PlaceInput = { zip: string; congregationId: string };

export type RoomRequestInput = {
  kind: "town" | "congregation" | "region";
  name: string;
  state: string;
};

export type RoomDecisionInput = {
  decision: "approved" | "refused";
  note: string;
  stewardEmail?: string;
  inviterEmail?: string;
};

export type ZipCorrectionInput = { zip: string; name: string; state: string; clear?: boolean };

export type AccessInput = {
  action: "grant-member" | "grant-steward" | "grant-admin" | "revoke";
  email: string;
  roomId?: string;
  inviterEmail?: string;
  stewardEmail?: string;
  role?: "member" | "steward" | "admin";
  /** A new steward named in the same step, when the last steward leaves a room. */
  replacementEmail?: string;
};

export type CouncilInput = {
  action: "approve" | "revoke";
  reason: string;
  checklist: string[];
};

export type BoardPage = { room: string; next: string | null };

export type BoardSnapshot = {
  me: BoardMe;
  genderPolicy: GenderPolicyInfo;
  rooms: Room[];
  posts: Post[];
  marks: MarkRow[];
  removals: RemovalRow[];
  bans: BanRow[];
  appeals: AppealRow[];
  csamReports: CsamReport[];
  pages: BoardPage[];
};

export type BoardFailure = {
  ok: false;
  error: string;
  stops?: string[];
  code?: "gender-unstated" | "gender-unconfirmed";
  audience?: "men" | "women";
};

export type BoardClient = {
  load: (query?: {
    room?: string;
    cursor?: string;
  }) => Promise<{ ok: true; board: BoardSnapshot } | BoardFailure>;
  createPost: (
    draft: Draft,
    extra?: { campaignId?: string },
  ) => Promise<{ ok: true; post: Post } | BoardFailure>;
  reply: (parentId: string, text: string) => Promise<{ ok: true; post: Post } | BoardFailure>;
  revise: (
    id: string,
    patch: { claim: string; reason: string },
  ) => Promise<{ ok: true; post: Post; mark: MarkRow | null } | BoardFailure>;
  closeAsked: (id: string) => Promise<{ ok: true; post: Post } | BoardFailure>;
  mark: (
    id: string,
    mark: Mark | null,
    reason: string,
  ) => Promise<{ ok: true; post: Post; row: MarkRow } | BoardFailure>;
  remove: (
    id: string,
    reason: HardRule,
  ) => Promise<{ ok: true; removal: RemovalRow; ban: BanRow } | BoardFailure>;
  createRoom: (input: {
    id: string;
    name: string;
    what: string;
    categoryIds: string[];
    audience?: "all" | "men" | "women";
    stewardEmail?: string;
    inviterEmail?: string;
  }) => Promise<{ ok: true; room: Room } | BoardFailure>;
  updateRoom: (
    id: string,
    input: { categoryIds?: string[]; name?: string; what?: string; pinOrder?: number | null },
  ) => Promise<{ ok: true; room: Room } | BoardFailure>;
  listCategories: () => Promise<{ ok: true; categories: RoomCategory[] } | BoardFailure>;
  readCategory: (
    slug: string,
  ) => Promise<{ ok: true; category: RoomCategory; rooms: BrowseRoom[] } | BoardFailure>;
  createCategory: (input: {
    slug: string;
    name: string;
  }) => Promise<{ ok: true; category: RoomCategory } | BoardFailure>;
  updateCategory: (
    slug: string,
    input: { name?: string; sortOrder?: number },
  ) => Promise<{ ok: true; category: RoomCategory } | BoardFailure>;
  deleteCategory: (slug: string) => Promise<{ ok: true } | BoardFailure>;
  setRoomAudience: (
    roomId: string,
    audience: "all" | "men" | "women",
  ) => Promise<{ ok: true } | BoardFailure>;
  setGender: (input: {
    gender: "man" | "woman";
    email?: string;
  }) => Promise<{ ok: true } | BoardFailure>;
  confirmGender: (email: string) => Promise<{ ok: true } | BoardFailure>;
  appointSteward: (input: {
    email: string;
    action: "grant" | "revoke";
    note: string;
  }) => Promise<{ ok: true } | BoardFailure>;
  appeal: (
    postId: string,
    kind: "mark" | "removal",
    reason: string,
  ) => Promise<{ ok: true; appeal: AppealRow } | BoardFailure>;
  /** The signed-in member's own appeals. A bar does not hide this. */
  listAppeals: () => Promise<{ ok: true; appeals: AppealRow[] } | BoardFailure>;
  decideAppeal: (
    id: string,
    decision: "uphold" | "lift",
    reason: string,
  ) => Promise<{ ok: true; appeal: AppealRow; posts: Post[] } | BoardFailure>;
  loadHome: () => Promise<{ ok: true; home: HomePayload } | BoardFailure>;
  savePlace: (input: PlaceInput) => Promise<{ ok: true } | BoardFailure>;
  joinRoom: (roomId: string) => Promise<{ ok: true } | BoardFailure>;
  leaveRoom: (roomId: string) => Promise<{ ok: true } | BoardFailure>;
  requestRoom: (input: RoomRequestInput) => Promise<{ ok: true } | BoardFailure>;
  decideRoom: (id: string, input: RoomDecisionInput) => Promise<{ ok: true } | BoardFailure>;
  correctZip: (input: ZipCorrectionInput) => Promise<{ ok: true } | BoardFailure>;
  changeAccess: (input: AccessInput) => Promise<{ ok: true } | BoardFailure>;
  setCouncil: (id: string, input: CouncilInput) => Promise<{ ok: true } | BoardFailure>;
};

let override: BoardClient | null = null;

/** Tests inject a client. The app uses the HTTP client when this is unset. */
export function setBoardClient(next: BoardClient | null) {
  override = next;
}

export async function getBoardClient(): Promise<BoardClient> {
  if (override) return override;
  const mod = await import("./api.ts");
  return mod.apiBoardClient;
}
