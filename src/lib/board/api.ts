import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";
import { isHardRule, isMarkValue } from "./text.ts";
import type {
  AppealRow,
  BanRow,
  CsamReport,
  Draft,
  MarkRow,
  Post,
  RemovalRow,
  Room,
  RoomId,
  SharedMedia,
} from "./model.ts";
import type { BoardClient, BoardFailure, BoardSnapshot } from "./client.ts";
import { parseHomePayload } from "./home.ts";

const POST_TYPES = new Set(["did", "asked", "noted", "saw", "hosted"]);
const NOUNS = new Set(["Meeting", "Service", "Reading", "Debate"]);

function failure(json: unknown, fallback: string): BoardFailure {
  if (!json || typeof json !== "object") return { ok: false, error: fallback };
  const record = json as { error?: unknown; stops?: unknown; code?: unknown; audience?: unknown };
  const raw = typeof record.error === "string" && record.error ? record.error : fallback;
  // "banned" stays a code so the board can swap in the barred-account sentence.
  const error = raw === "banned" ? raw : userFacingError(raw, fallback);
  const stops = Array.isArray(record.stops)
    ? record.stops
        .filter((item): item is string => typeof item === "string")
        .map((item) => userFacingError(item, fallback))
    : undefined;
  const code =
    record.code === "gender-unstated" || record.code === "gender-unconfirmed" ? record.code : undefined;
  const audience = record.audience === "men" || record.audience === "women" ? record.audience : undefined;
  return {
    ok: false,
    error,
    ...(stops && stops.length > 0 ? { stops } : {}),
    ...(code ? { code } : {}),
    ...(audience ? { audience } : {}),
  };
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
  const mark = isMarkValue(row.mark) ? row.mark : null;
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
    ...(row.subject === "candidate" || row.subject === "business" ? { subject: row.subject } : {}),
    ...(councilFrom(row.council) ? { council: councilFrom(row.council) } : {}),
    media,
  };
}

function councilFrom(value: unknown): Post["council"] {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.label !== "Council-approved" || typeof row.reason !== "string" || !row.reason.trim())
    return undefined;
  if (typeof row.approvalId !== "string") return undefined;
  const checklist = strings(row.checklist);
  if (checklist.length === 0) return undefined;
  return {
    label: "Council-approved",
    reason: row.reason,
    checklist,
    approvalId: row.approvalId,
  };
}

function genderPolicyFrom(value: unknown): BoardSnapshot["genderPolicy"] {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const setBy = row.setBy === "inviter" || row.setBy === "steward" ? row.setBy : "self";
  return {
    setBy,
    requiresConfirmation: row.requiresConfirmation === true,
    changeBy: row.changeBy === "steward" ? "steward" : "admin",
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
    ...(row.status === "draft" || row.status === "unclaimed" || row.status === "active"
      ? { status: row.status }
      : {}),
    ...(typeof row.town === "string" && row.town ? { town: row.town } : {}),
    ...(typeof row.county === "string" && row.county ? { county: row.county } : {}),
    ...(typeof row.category === "string" && row.category ? { category: row.category } : {}),
    ...(typeof row.sourceUrl === "string" && row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    ...(row.audience === "men" || row.audience === "women" || row.audience === "all"
      ? { audience: row.audience }
      : {}),
    ...(row.host === true ? { host: true } : {}),
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
      const mark = isMarkValue(row.mark) ? row.mark : null;
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
      if (typeof row.reason !== "string" || !isHardRule(row.reason) || typeof row.at !== "number")
        continue;
      removals.push({
        id: row.id,
        postId: row.postId,
        author: row.author,
        reason: row.reason as RemovalRow["reason"],
        at: row.at,
        ...(row.roomChat === true ? { roomChat: true } : {}),
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
      if (
        typeof row.reason !== "string" ||
        !isHardRule(row.reason) ||
        typeof row.until !== "number"
      )
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
      isHardRule(row.reason)
    ) {
      ban = { until: row.until, strikes: row.strikes, reason: row.reason };
    }
  }
  const pages: BoardSnapshot["pages"] = [];
  if (Array.isArray(body.pages)) {
    for (const item of body.pages) {
      if (!item || typeof item !== "object") continue;
      const row = item as { room?: unknown; next?: unknown };
      if (typeof row.room !== "string" || !row.room) continue;
      pages.push({
        room: row.room,
        next: typeof row.next === "string" && row.next ? row.next : null,
      });
    }
  }
  return {
    me: {
      member: who.member === true,
      steward: who.steward === true,
      admin: who.admin === true,
      council: who.council === true,
      councilChair: who.councilChair === true,
      stewardRooms: Array.isArray(who.stewardRooms)
        ? who.stewardRooms.filter((item): item is string => typeof item === "string" && item !== "")
        : [],
      ban,
      gender: who.gender === "man" || who.gender === "woman" ? who.gender : null,
      genderConfirmed: who.genderConfirmed === true,
    },
    genderPolicy: genderPolicyFrom(body.genderPolicy),
    rooms,
    posts,
    marks,
    removals,
    bans,
    appeals: appealsFrom(body.appeals),
    csamReports: who.admin === true ? reportsFrom(body.csamReports) : [],
    pages,
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
    ...(draft.subject === "candidate" || draft.subject === "business"
      ? { subject: draft.subject }
      : {}),
    ...(extra?.campaignId ? { campaignId: extra.campaignId } : {}),
  };
}

export const apiBoardClient: BoardClient = {
  async listAppeals() {
    const response = await send("/api/appeals");
    if (!response.ok) return failure(response.json, "Those appeals did not load.");
    const body = response.json as { appeals?: unknown } | null;
    return { ok: true, appeals: appealsFrom(body?.appeals) };
  },
  async load(query) {
    const params = new URLSearchParams();
    if (query?.room) params.set("room", query.room);
    if (query?.cursor) params.set("cursor", query.cursor);
    const search = params.toString();
    const response = await send(search ? `/api/board?${search}` : "/api/board");
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
  async setRoomAudience(roomId, audience) {
    const response = await send(`/api/rooms/${encodeURIComponent(roomId)}/audience`, { audience });
    if (!response.ok) return failure(response.json, "That was not saved.");
    return { ok: true };
  },
  async setGender(input) {
    const response = await send("/api/gender", input);
    if (!response.ok) return failure(response.json, "That was not saved.");
    return { ok: true };
  },
  async confirmGender(email) {
    const response = await send("/api/gender/confirm", { email });
    if (!response.ok) return failure(response.json, "That was not confirmed.");
    return { ok: true };
  },
  async appointSteward(input) {
    const response = await send("/api/access", input);
    if (!response.ok) return failure(response.json, "That role was not changed.");
    return { ok: true };
  },
  async appeal(postId, kind, reason) {
    const response = await send(`/api/posts/${encodeURIComponent(postId)}/appeal`, {
      kind,
      reason,
    });
    if (!response.ok) return failure(response.json, "That appeal was not filed.");
    const appeal = appealFrom(response.json);
    if (!appeal) return { ok: false, error: "That appeal was not filed." };
    return { ok: true, appeal };
  },
  async decideAppeal(id, decision, reason) {
    const response = await send(`/api/appeals/${encodeURIComponent(id)}/decide`, {
      decision,
      reason,
    });
    if (!response.ok) return failure(response.json, "That decision was not saved.");
    const body = response.json as { appeal?: unknown; posts?: unknown } | null;
    const appeal = appealFrom(body?.appeal);
    if (!appeal) return { ok: false, error: "That decision was not saved." };
    const posts = Array.isArray(body?.posts)
      ? body.posts.map(postFrom).filter((post): post is Post => post !== null)
      : [];
    return { ok: true, appeal, posts };
  },
  async loadHome() {
    const response = await send("/api/home");
    if (!response.ok) return failure(response.json, "Home did not load.");
    const home = parseHomePayload(response.json);
    if (!home) return { ok: false, error: "Home did not load." };
    return { ok: true, home };
  },
  async savePlace(input) {
    const response = await send("/api/place", input);
    if (!response.ok) return failure(response.json, "That place was not saved.");
    return { ok: true };
  },
  async joinRoom(roomId) {
    const response = await send(`/api/rooms/${encodeURIComponent(roomId)}/join`, {});
    if (!response.ok) return failure(response.json, "That room was not joined.");
    return { ok: true };
  },
  async leaveRoom(roomId) {
    const response = await send(`/api/rooms/${encodeURIComponent(roomId)}/leave`, {});
    if (!response.ok) return failure(response.json, "That room was not left.");
    return { ok: true };
  },
  async requestRoom(input) {
    const response = await send("/api/room-requests", input);
    if (!response.ok) return failure(response.json, "That request was not saved.");
    return { ok: true };
  },
  async decideRoom(id, input) {
    const response = await send(`/api/room-requests/${encodeURIComponent(id)}/decide`, input);
    if (!response.ok) return failure(response.json, "That decision was not saved.");
    return { ok: true };
  },
  async correctZip(input) {
    const response = await send("/api/zips", input);
    if (!response.ok) return failure(response.json, "That ZIP was not corrected.");
    return { ok: true };
  },
  async changeAccess(input) {
    const response = await send("/api/access", input);
    if (!response.ok) return failure(response.json, "That role was not changed.");
    return { ok: true };
  },
  async setCouncil(id, input) {
    const response = await send(`/api/posts/${encodeURIComponent(id)}/council`, input);
    if (!response.ok) return failure(response.json, "That approval was not saved.");
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
  if (row.mark !== null && row.mark !== undefined && !isMarkValue(row.mark)) return null;
  const mark = isMarkValue(row.mark) ? row.mark : null;
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
  if (typeof row.reason !== "string" || !isHardRule(row.reason) || typeof row.at !== "number")
    return null;
  return {
    id: row.id,
    postId: row.postId,
    author: row.author,
    reason: row.reason,
    at: row.at,
  };
}

function banFrom(value: unknown): BanRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.author !== "string" || typeof row.at !== "number")
    return null;
  if (typeof row.reason !== "string" || !isHardRule(row.reason)) return null;
  if (typeof row.until !== "number" || typeof row.strikes !== "number") return null;
  return {
    id: row.id,
    author: row.author,
    reason: row.reason,
    until: row.until,
    strikes: row.strikes,
    at: row.at,
  };
}

function appealFrom(value: unknown): AppealRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.postId !== "string" || typeof row.room !== "string")
    return null;
  if (typeof row.author !== "string" || typeof row.at !== "number") return null;
  if (row.kind !== "mark" && row.kind !== "removal") return null;
  if (typeof row.reason !== "string") return null;
  const decision = row.decision === "uphold" || row.decision === "lift" ? row.decision : null;
  if (row.decision !== null && row.decision !== undefined && !decision) return null;
  return {
    id: row.id,
    room: row.room as RoomId,
    postId: row.postId,
    author: row.author,
    kind: row.kind,
    reason: row.reason,
    decision,
    decisionNote: typeof row.decisionNote === "string" ? row.decisionNote : "",
    decidedBy: typeof row.decidedBy === "string" ? row.decidedBy : "",
    at: row.at,
    decidedAt: typeof row.decidedAt === "number" ? row.decidedAt : null,
    rule: isHardRule(row.rule) ? row.rule : null,
  };
}

function appealsFrom(value: unknown): AppealRow[] {
  if (!Array.isArray(value)) return [];
  return value.map(appealFrom).filter((row): row is AppealRow => row !== null);
}

function reportFrom(value: unknown): CsamReport | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status =
    row.status === "prepared" || row.status === "pending_seal" || row.status === "filed"
      ? row.status
      : null;
  if (!status) return null;
  if (typeof row.id !== "string" || typeof row.postId !== "string" || typeof row.room !== "string")
    return null;
  if (typeof row.author !== "string" || typeof row.accountId !== "string") return null;
  if (typeof row.incidentAt !== "number" || typeof row.retainUntil !== "number") return null;
  if (typeof row.mediaCount !== "number" || typeof row.byteSize !== "number") return null;
  return {
    id: row.id,
    postId: row.postId,
    room: row.room,
    author: row.author,
    accountId: row.accountId,
    incidentAt: row.incidentAt,
    retainUntil: row.retainUntil,
    mediaCount: row.mediaCount,
    byteSize: row.byteSize,
    mediaTypes: strings(row.mediaTypes),
    status,
    reportId: typeof row.reportId === "string" ? row.reportId : "",
    filedAt: typeof row.filedAt === "number" ? row.filedAt : null,
    filedBy: typeof row.filedBy === "string" ? row.filedBy : "",
  };
}

function reportsFrom(value: unknown): CsamReport[] {
  if (!Array.isArray(value)) return [];
  return value.map(reportFrom).filter((row): row is CsamReport => row !== null);
}
