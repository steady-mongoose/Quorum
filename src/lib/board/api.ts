import { apiFetch } from "../api-base.ts";
import type {
  BanRow,
  Draft,
  HardRule,
  Mark,
  MarkRow,
  Post,
  RemovalRow,
  Room,
  RoomId,
  SharedMedia,
} from "./model.ts";
import type { BoardClient, BoardFailure, BoardSnapshot } from "./client.ts";

const POST_TYPES = new Set(["did", "asked", "noted", "saw", "hosted"]);
const MARKS = new Set(["sloppy", "unsupported"]);
const RULES = new Set(["threat", "porn", "csam"]);
const NOUNS = new Set(["Meeting", "Service", "Reading", "Debate"]);

function failure(json: unknown, fallback: string): BoardFailure {
  if (!json || typeof json !== "object") return { ok: false, error: fallback };
  const record = json as { error?: unknown; stops?: unknown };
  const error = typeof record.error === "string" && record.error ? record.error : fallback;
  const stops = Array.isArray(record.stops)
    ? record.stops.filter((item): item is string => typeof item === "string")
    : undefined;
  return stops && stops.length > 0 ? { ok: false, error, stops } : { ok: false, error };
}

async function send(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await apiFetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function postFrom(value: unknown): Post | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.room !== "string" || typeof row.claim !== "string")
    return null;
  if (typeof row.type !== "string" || !POST_TYPES.has(row.type)) return null;
  if (typeof row.author !== "string" || typeof row.at !== "number") return null;
  const mark = row.mark === "sloppy" || row.mark === "unsupported" ? row.mark : null;
  const media: SharedMedia[] = [];
  if (Array.isArray(row.media)) {
    for (const item of row.media) {
      if (!item || typeof item !== "object") continue;
      const mediaRow = item as { id?: unknown; kind?: unknown };
      if (typeof mediaRow.id !== "string") continue;
      if (mediaRow.kind !== "image" && mediaRow.kind !== "video") continue;
      media.push({ id: mediaRow.id, kind: mediaRow.kind });
    }
  }
  return {
    id: row.id,
    room: row.room,
    type: row.type as Post["type"],
    claim: row.claim,
    reason: typeof row.reason === "string" ? row.reason : "",
    on: typeof row.on === "string" ? row.on : "",
    next: typeof row.next === "string" ? row.next : "",
    came: strings(row.came),
    named: typeof row.named === "string" ? row.named : "",
    author: row.author,
    at: row.at,
    parentId: typeof row.parentId === "string" ? row.parentId : null,
    closed: row.closed === true,
    mark,
    removed: row.removed === true,
    ...(typeof row.cardId === "string" && row.cardId ? { cardId: row.cardId } : {}),
    ...(typeof row.tradeId === "string" && row.tradeId ? { tradeId: row.tradeId } : {}),
    ...(typeof row.campaignId === "string" && row.campaignId ? { campaignId: row.campaignId } : {}),
    media,
  };
}

function roomFrom(value: unknown): Room | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.what !== "string")
    return null;
  const cardNoun =
    typeof row.cardNoun === "string" && NOUNS.has(row.cardNoun) ? row.cardNoun : "Meeting";
  return {
    id: row.id,
    name: row.name,
    what: row.what,
    takes: strings(row.takes).filter((item): item is Room["takes"][number] => POST_TYPES.has(item)),
    stewardTakes: strings(row.stewardTakes).filter((item): item is Room["stewardTakes"][number] =>
      POST_TYPES.has(item),
    ),
    cardKinds: strings(row.cardKinds).filter(
      (item): item is Room["cardKinds"][number] =>
        item === "meeting" || item === "candidate" || item === "trade" || item === "need",
    ),
    cardNoun: cardNoun as Room["cardNoun"],
    requiresNextDate: row.requiresNextDate === true,
    parish: row.parish === true,
  };
}

export function parseBoard(json: unknown): BoardSnapshot | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const me = body.me;
  if (!me || typeof me !== "object") return null;
  const who = me as Record<string, unknown>;
  const rooms = Array.isArray(body.rooms)
    ? body.rooms.map(roomFrom).filter((room): room is Room => room !== null)
    : [];
  const posts = Array.isArray(body.posts)
    ? body.posts.map(postFrom).filter((post): post is Post => post !== null)
    : [];
  const marks: MarkRow[] = [];
  if (Array.isArray(body.marks)) {
    for (const item of body.marks) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== "string" ||
        typeof row.postId !== "string" ||
        typeof row.author !== "string"
      )
        continue;
      if (typeof row.by !== "string" || typeof row.room !== "string" || typeof row.at !== "number")
        continue;
      const mark = row.mark === "sloppy" || row.mark === "unsupported" ? row.mark : null;
      if (row.mark !== null && row.mark !== undefined && !mark) continue;
      marks.push({
        id: row.id,
        room: row.room as RoomId,
        postId: row.postId,
        author: row.author,
        by: row.by,
        mark,
        reason: typeof row.reason === "string" ? row.reason : "",
        at: row.at,
      });
    }
  }
  const removals: RemovalRow[] = [];
  if (Array.isArray(body.removals)) {
    for (const item of body.removals) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== "string" ||
        typeof row.postId !== "string" ||
        typeof row.author !== "string"
      )
        continue;
      if (typeof row.reason !== "string" || !RULES.has(row.reason) || typeof row.at !== "number")
        continue;
      removals.push({
        id: row.id,
        postId: row.postId,
        author: row.author,
        reason: row.reason as RemovalRow["reason"],
        at: row.at,
      });
    }
  }
  const bans: BanRow[] = [];
  if (Array.isArray(body.bans)) {
    for (const item of body.bans) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (
        typeof row.id !== "string" ||
        typeof row.author !== "string" ||
        typeof row.at !== "number"
      )
        continue;
      if (typeof row.reason !== "string" || !RULES.has(row.reason) || typeof row.until !== "number")
        continue;
      if (typeof row.strikes !== "number") continue;
      bans.push({
        id: row.id,
        author: row.author,
        reason: row.reason as BanRow["reason"],
        until: row.until,
        strikes: row.strikes,
        at: row.at,
      });
    }
  }
  const banRaw = who.ban;
  let ban: BoardSnapshot["me"]["ban"] = null;
  if (banRaw && typeof banRaw === "object") {
    const row = banRaw as Record<string, unknown>;
    if (
      typeof row.until === "number" &&
      typeof row.strikes === "number" &&
      typeof row.reason === "string" &&
      RULES.has(row.reason)
    ) {
      ban = { until: row.until, strikes: row.strikes, reason: row.reason as HardRule };
    }
  }
  return {
    me: {
      member: who.member === true,
      steward: who.steward === true,
      admin: who.admin === true,
      ban,
    },
    rooms,
    posts,
    marks,
    removals,
    bans,
  };
}

function draftBody(draft: Draft, extra?: { campaignId?: string }): Record<string, unknown> {
  return {
    ...(draft.postId ? { id: draft.postId } : {}),
    type: draft.type,
    claim: draft.claim,
    reason: draft.reason,
    on: draft.on,
    next: draft.next,
    came: draft.came,
    named: draft.named,
    cardId: draft.cardId,
    tradeId: draft.tradeId,
    attested: draft.attested,
    mediaCount: draft.media.length,
    ...(extra?.campaignId ? { campaignId: extra.campaignId } : {}),
  };
}

export const apiBoardClient: BoardClient = {
  async load() {
    const response = await send("/api/board");
    if (!response.ok) return failure(response.json, "The board did not load.");
    const board = parseBoard(response.json);
    if (!board) return { ok: false, error: "The board did not load." };
    return { ok: true, board };
  },
  async createPost(draft, extra) {
    const response = await send(
      `/api/rooms/${encodeURIComponent(draft.room)}/posts`,
      draftBody(draft, extra),
    );
    if (!response.ok) return failure(response.json, "That post was not filed.");
    const post = postFrom(
      response.json && typeof response.json === "object"
        ? (response.json as { post?: unknown }).post
        : null,
    );
    if (!post) return { ok: false, error: "That post was not filed." };
    return {
      ok: true,
      post: { ...post, media: post.media && post.media.length > 0 ? post.media : draft.media },
    };
  },
  async reply(parentId, text) {
    const response = await send(`/api/posts/${encodeURIComponent(parentId)}/replies`, {
      claim: text,
    });
    if (!response.ok) return failure(response.json, "That reply was not filed.");
    const post = postFrom(response.json);
    if (!post) return { ok: false, error: "That reply was not filed." };
    return { ok: true, post };
  },
  async revise(id, patch) {
    const response = await send(`/api/posts/${encodeURIComponent(id)}/revise`, patch);
    if (!response.ok) return failure(response.json, "That revision was not saved.");
    const body = response.json as { post?: unknown; mark?: unknown } | null;
    const post = postFrom(body?.post);
    if (!post) return { ok: false, error: "That revision was not saved." };
    const mark = body?.mark && typeof body.mark === "object" ? markRow(body.mark) : null;
    return { ok: true, post, mark };
  },
  async closeAsked(id) {
    const response = await send(`/api/posts/${encodeURIComponent(id)}/close`, {});
    if (!response.ok) return failure(response.json, "That question is not here.");
    const post = postFrom(response.json);
    if (!post) return { ok: false, error: "That question is not here." };
    return { ok: true, post };
  },
  async mark(id, mark, reason) {
    const response = await send(`/api/posts/${encodeURIComponent(id)}/mark`, { mark, reason });
    if (!response.ok) return failure(response.json, "That mark was not saved.");
    const body = response.json as { post?: unknown; row?: unknown } | null;
    const post = postFrom(body?.post);
    const row = body?.row ? markRow(body.row) : null;
    if (!post || !row) return { ok: false, error: "That mark was not saved." };
    return { ok: true, post, row };
  },
  async remove(id, reason) {
    const response = await send(`/api/posts/${encodeURIComponent(id)}/remove`, { reason });
    if (!response.ok) return failure(response.json, "That post was not removed.");
    const body = response.json as { removal?: unknown; ban?: unknown } | null;
    const removal = removalFrom(body?.removal);
    const ban = banFrom(body?.ban);
    if (!removal || !ban) return { ok: false, error: "That post was not removed." };
    return { ok: true, removal, ban };
  },
  async createRoom(input) {
    const response = await send("/api/rooms", input);
    if (!response.ok) return failure(response.json, "The room was not added.");
    const room = roomFrom(response.json);
    if (!room) return { ok: false, error: "The room was not added." };
    return { ok: true, room };
  },
  async appointSteward(input) {
    const response = await send("/api/access", input);
    if (!response.ok) return failure(response.json, "That role was not changed.");
    return { ok: true };
  },
};

function markRow(value: unknown): MarkRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.postId !== "string" || typeof row.room !== "string")
    return null;
  if (typeof row.author !== "string" || typeof row.by !== "string" || typeof row.at !== "number")
    return null;
  if (row.mark !== null && row.mark !== undefined && !MARKS.has(String(row.mark))) return null;
  const mark = row.mark === "sloppy" || row.mark === "unsupported" ? (row.mark as Mark) : null;
  return {
    id: row.id,
    room: row.room as RoomId,
    postId: row.postId,
    author: row.author,
    by: row.by,
    mark,
    reason: typeof row.reason === "string" ? row.reason : "",
    at: row.at,
  };
}

function removalFrom(value: unknown): RemovalRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.postId !== "string" ||
    typeof row.author !== "string"
  )
    return null;
  if (typeof row.reason !== "string" || !RULES.has(row.reason) || typeof row.at !== "number")
    return null;
  return {
    id: row.id,
    postId: row.postId,
    author: row.author,
    reason: row.reason as HardRule,
    at: row.at,
  };
}

function banFrom(value: unknown): BanRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.author !== "string" || typeof row.at !== "number")
    return null;
  if (typeof row.reason !== "string" || !RULES.has(row.reason)) return null;
  if (typeof row.until !== "number" || typeof row.strikes !== "number") return null;
  return {
    id: row.id,
    author: row.author,
    reason: row.reason as HardRule,
    until: row.until,
    strikes: row.strikes,
    at: row.at,
  };
}
