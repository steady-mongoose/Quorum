import type { BanRow, Draft, HardRule, Mark, MarkRow, Post, RemovalRow, Room } from "./model.ts";

export type BoardMe = {
  member: boolean;
  steward: boolean;
  admin: boolean;
  ban: { until: number; strikes: number; reason: HardRule } | null;
};

export type BoardSnapshot = {
  me: BoardMe;
  rooms: Room[];
  posts: Post[];
  marks: MarkRow[];
  removals: RemovalRow[];
  bans: BanRow[];
};

export type BoardFailure = { ok: false; error: string; stops?: string[] };

export type BoardClient = {
  load: () => Promise<{ ok: true; board: BoardSnapshot } | BoardFailure>;
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
  }) => Promise<{ ok: true; room: Room } | BoardFailure>;
  appointSteward: (input: {
    email: string;
    action: "grant" | "revoke";
    note: string;
  }) => Promise<{ ok: true } | BoardFailure>;
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
