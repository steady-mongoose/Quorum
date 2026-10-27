import { listAdminRooms, moveRoom } from "./rooms-admin.ts";
import { BOARD_READ_LIMIT, BOARD_WRITE_LIMIT, consumeLimit } from "../rate-limit.ts";
import { CLIENT_IP_HEADER, rateLimitIp } from "../proxy.ts";
import type { Db } from "../db.ts";
import type { ObjectStore } from "../media/s3.ts";
import { fileCsamReport } from "./csam.ts";
import {
  correctZip,
  decideRoom,
  grantAccess,
  joinRoom,
  listHome,
  requestRoom,
  savePlace,
  setCouncil,
} from "./places-store.ts";
import {
  listGatheringsFor,
  readGatheringFor,
  removeGathering,
  saveGathering,
} from "./gathering-record.ts";
import { confirmMemberGender, setMemberGender, setRoomAudience } from "./audience.ts";
import { actorRole } from "./access.ts";
import { mayNameAnotherGender } from "../gender-policy.ts";
import {
  createCategory,
  deleteCategory,
  listCategories,
  readCategory,
  updateCategory,
  type CategoryResult,
} from "./categories.ts";
import {
  checkSiteCode,
  decideClaim,
  importListings,
  listClaims,
  requestClaim,
  confirmClaimCode,
} from "./claims.ts";
import {
  banMember,
  closeAsked,
  createRoom,
  decideAppeal,
  decideBanReview,
  listBanReviews,
  ownSuspension,
  fileAppeal,
  listBoard,
  listOwnAppeals,
  markPost,
  openBan,
  removePost,
  replyToPost,
  revisePost,
  updateRoom,
  type Result,
} from "./store.ts";

type SessionUser = { id: string; name: string; email: string };

export type BoardDeps = {
  db: Db;
  readSession: (headers: Headers) => Promise<SessionUser | null>;
  now: () => Date;
  /** Present when picture storage is on. A CSAM removal moves files through it. */
  store?: ObjectStore | null;
};

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { error: "Too many attempts. Wait and try again." },
    new Headers({ "retry-after": String(retryAfter) }),
  );
}

function clientIp(request: Request): string {
  const value = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return rateLimitIp(value || "local");
}

export async function limitBoard(
  db: Db,
  request: Request,
  userId: string,
  kind: "read" | "write",
): Promise<Response | null> {
  const rule = kind === "read" ? BOARD_READ_LIMIT : BOARD_WRITE_LIMIT;
  const ipHit = await consumeLimit(db, `board-${kind}:ip:${clientIp(request)}`, rule, Date.now());
  if (!ipHit.allowed) return tooMany(ipHit.retryAfter);
  const userHit = await consumeLimit(db, `board-${kind}:user:${userId}`, rule, Date.now());
  if (!userHit.allowed) return tooMany(userHit.retryAfter);
  return null;
}

/** Used by the picture registration route when the body is a real post. */
export async function limitBoardWrite(
  db: Db,
  request: Request,
  userId: string,
): Promise<Response | null> {
  return limitBoard(db, request, userId, "write");
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: Request, max = 65_536): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > max)
    throw new HttpError(413, "That request is too large.");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "That request is too large.");
  if (!text) return {};
  try {
    const body = JSON.parse(text) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "Send a JSON object.");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Send JSON.");
  }
}

function fromResult(status: number, result: Result<unknown> | CategoryResult<unknown>): Response {
  if (!result.ok) {
    return json(result.status, {
      error: result.error,
      ...("stops" in result && result.stops ? { stops: result.stops } : {}),
      ...(result.ban ? { ban: result.ban } : {}),
      ...("code" in result && result.code ? { code: result.code } : {}),
      ...("audience" in result && (result.audience === "men" || result.audience === "women")
        ? { audience: result.audience }
        : {}),
    });
  }
  return json(status, result.value);
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function categoryIdsField(body: Record<string, unknown>): { categoryIds?: string[] } {
  if (Array.isArray(body.categoryIds)) return { categoryIds: stringList(body, "categoryIds") };
  if ("categoryId" in body) {
    const one = stringField(body, "categoryId").trim();
    return { categoryIds: one ? [one] : [] };
  }
  return {};
}

function pinField(
  body: Record<string, unknown>,
): { pinOrder: number | null } | Record<string, never> {
  if (!("pinOrder" in body)) return {};
  const value = body.pinOrder;
  if (value === null) return { pinOrder: null };
  if (typeof value === "number" && Number.isInteger(value)) return { pinOrder: value };
  return { pinOrder: Number.NaN };
}

function optionalInt(body: Record<string, unknown>, key: string): number | undefined | null {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function stringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function handleBoard(
  deps: BoardDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const postAction =
    /^\/api\/posts\/([A-Za-z0-9_-]{1,80})\/(replies|revise|close|mark|remove|appeal|council)$/.exec(
      url.pathname,
    );
  const banReview = /^\/api\/admin\/ban-reviews\/([A-Za-z0-9_-]{1,80})\/decide$/.exec(url.pathname);
  const appealAction = /^\/api\/appeals\/([A-Za-z0-9_-]{1,80})\/decide$/.exec(url.pathname);
  const fileHold = /^\/api\/csam-holds\/([A-Za-z0-9_-]{1,80})\/filed$/.exec(url.pathname);
  const roomJoin = /^\/api\/rooms\/([a-z0-9-]{1,32})\/(join|leave)$/.exec(url.pathname);
  const claimAction =
    /^\/api\/claims\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(confirm|check|decide)$/i.exec(
      url.pathname,
    );
  const roomAudience = /^\/api\/rooms\/([a-z0-9-]{1,32})\/audience$/.exec(url.pathname);
  const roomOne = /^\/api\/rooms\/([a-z0-9-]{1,32})$/.exec(url.pathname);
  const adminRoomMove = /^\/api\/admin\/rooms\/([a-z0-9-]{1,32})\/categories$/.exec(url.pathname);
  const categoryOne = /^\/api\/categories\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname);
  const decide = /^\/api\/room-requests\/([A-Za-z0-9_-]{1,80})\/decide$/.exec(url.pathname);
  const gatheringOne =
    /^\/api\/gatherings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      url.pathname,
    );
  const matched =
    (url.pathname === "/api/gatherings" &&
      (request.method === "GET" || request.method === "POST")) ||
    (gatheringOne !== null &&
      (request.method === "GET" || request.method === "DELETE" || request.method === "POST")) ||
    (url.pathname === "/api/board" && request.method === "GET") ||
    (url.pathname === "/api/admin/rooms" && request.method === "GET") ||
    Boolean(adminRoomMove && request.method === "POST") ||
    (url.pathname === "/api/appeals" && request.method === "GET") ||
    (url.pathname === "/api/home" && request.method === "GET") ||
    (url.pathname === "/api/rooms" && request.method === "POST") ||
    (url.pathname === "/api/categories" &&
      (request.method === "GET" || request.method === "POST")) ||
    (categoryOne !== null &&
      (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) ||
    (roomOne !== null && request.method === "PATCH") ||
    (url.pathname === "/api/rooms/seed" && request.method === "POST") ||
    (url.pathname === "/api/claims" && (request.method === "GET" || request.method === "POST")) ||
    Boolean(claimAction && request.method === "POST") ||
    (url.pathname === "/api/gender" && request.method === "POST") ||
    (url.pathname === "/api/gender/confirm" && request.method === "POST") ||
    Boolean(roomAudience && request.method === "POST") ||
    (url.pathname === "/api/place" && request.method === "POST") ||
    (url.pathname === "/api/room-requests" && request.method === "POST") ||
    (url.pathname === "/api/zips" && request.method === "POST") ||
    (url.pathname === "/api/access" && request.method === "POST") ||
    (url.pathname === "/api/bans" && request.method === "POST") ||
    Boolean(roomJoin && (request.method === "POST" || request.method === "DELETE")) ||
    Boolean(decide && request.method === "POST") ||
    Boolean(postAction && request.method === "POST") ||
    Boolean(appealAction && request.method === "POST") ||
    Boolean(fileHold && request.method === "POST") ||
    (url.pathname === "/api/admin/ban-reviews" && request.method === "GET") ||
    (url.pathname === "/api/suspension" && request.method === "GET") ||
    Boolean(banReview && request.method === "POST");
  if (!matched) return null;

  try {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const kind = request.method === "GET" ? "read" : "write";
    const blocked = await limitBoard(deps.db, request, session.id, kind);
    if (blocked) return blocked;
    const now = deps.now();

    if (url.pathname === "/api/claims" && request.method === "GET") {
      return fromResult(200, await listClaims(deps.db, { userId: session.id, now }));
    }

    if (url.pathname === "/api/suspension" && request.method === "GET") {
      return json(200, await ownSuspension(deps.db, session.id, now));
    }
    if (url.pathname === "/api/admin/ban-reviews" && request.method === "GET") {
      const listed = await listBanReviews(deps.db, session.id, now);
      if (!listed.ok) return json(listed.status, { error: listed.error });
      return json(200, { reviews: listed.value });
    }
    if (banReview && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
      return fromResult(
        200,
        await decideBanReview(deps.db, {
          userId: session.id,
          name: session.name,
          reviewId: banReview[1] ?? "",
          decision: typeof body.decision === "string" ? body.decision : "",
          now,
        }),
      );
    }

    if (url.pathname === "/api/appeals" && request.method === "GET") {
      const appeals = await listOwnAppeals(deps.db, session.id);
      return json(200, { appeals });
    }

    if (url.pathname === "/api/gatherings" && request.method === "GET") {
      const gatherings = await listGatheringsFor(deps.db, { userId: session.id, now });
      return json(200, { gatherings });
    }

    if (gatheringOne && request.method === "GET") {
      const one = await readGatheringFor(deps.db, {
        userId: session.id,
        id: gatheringOne[1] ?? "",
        now,
      });
      if (!one.ok) return json(one.status, { error: one.error });
      return json(200, { gathering: one.gathering });
    }

    if (gatheringOne && request.method === "DELETE") {
      const removed = await removeGathering(deps.db, {
        userId: session.id,
        id: gatheringOne[1] ?? "",
        now,
      });
      if (!removed.ok) return json(removed.status, { error: removed.error });
      return json(200, { ok: true });
    }

    if (url.pathname === "/api/board") {
      const room = url.searchParams.get("room") ?? "";
      const cursor = url.searchParams.get("cursor") ?? "";
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw === null ? undefined : Number(limitRaw);
      return fromResult(
        200,
        await listBoard(deps.db, session.id, now, {
          ...(room ? { room } : {}),
          ...(cursor ? { cursor } : {}),
          ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        }),
      );
    }

    if (url.pathname === "/api/home") {
      const ban = await openBan(deps.db, session.id, now);
      if (ban) return json(403, { error: "banned", ban });
      return fromResult(200, await listHome(deps.db, session.id, now));
    }

    if (url.pathname === "/api/admin/rooms" && request.method === "GET") {
      return fromResult(200, await listAdminRooms(deps.db, session.id, now));
    }

    if (url.pathname === "/api/categories" && request.method === "GET") {
      return fromResult(200, await listCategories(deps.db, session.id, now));
    }

    if (categoryOne && request.method === "GET") {
      return fromResult(200, await readCategory(deps.db, session.id, categoryOne[1] ?? "", now));
    }

    if (categoryOne && request.method === "DELETE") {
      return fromResult(
        200,
        await deleteCategory(deps.db, { userId: session.id, slug: categoryOne[1] ?? "", now }),
      );
    }

    if (roomJoin && request.method === "DELETE") {
      return fromResult(
        200,
        await joinRoom(deps.db, {
          userId: session.id,
          roomId: roomJoin[1] ?? "",
          now,
          leave: true,
        }),
      );
    }

    if (url.pathname === "/api/rooms/seed" && request.method === "POST") {
      const seeded = await importListings(deps.db, {
        userId: session.id,
        body: await readJson(request, 262_144),
        now,
      });
      return fromResult(201, seeded);
    }

    const body = await readJson(request);

    if (url.pathname === "/api/claims" && request.method === "POST") {
      return fromResult(
        201,
        await requestClaim(
          deps.db,
          {
            userId: session.id,
            roomKey: stringField(body, "roomId") || stringField(body, "name"),
            method: stringField(body, "method"),
            email: stringField(body, "email"),
            now,
          },
          {},
        ),
      );
    }

    if (claimAction && claimAction[2] === "confirm") {
      return fromResult(
        200,
        await confirmClaimCode(deps.db, {
          userId: session.id,
          claimId: claimAction[1] ?? "",
          code: stringField(body, "code"),
          now,
        }),
      );
    }

    if (claimAction && claimAction[2] === "check") {
      return fromResult(
        200,
        await checkSiteCode(deps.db, {
          userId: session.id,
          claimId: claimAction[1] ?? "",
          now,
        }),
      );
    }

    if (claimAction && claimAction[2] === "decide") {
      return fromResult(
        200,
        await decideClaim(deps.db, {
          userId: session.id,
          claimId: claimAction[1] ?? "",
          decision: stringField(body, "decision"),
          note: stringField(body, "note"),
          now,
        }),
      );
    }

    if ((url.pathname === "/api/gatherings" || gatheringOne) && request.method === "POST") {
      const saved = await saveGathering(deps.db, {
        userId: session.id,
        id: gatheringOne ? (gatheringOne[1] ?? "") : stringField(body, "id"),
        roomId: stringField(body, "roomId"),
        title: body.title,
        date: body.date,
        time: body.time,
        place: body.place,
        now,
      });
      if (!saved.ok) return json(saved.status, { error: saved.error });
      return json(200, { gathering: saved.gathering });
    }

    if (url.pathname === "/api/rooms") {
      const created = await createRoom(deps.db, {
        userId: session.id,
        id: stringField(body, "id"),
        name: stringField(body, "name"),
        what: stringField(body, "what"),
        categoryIds: categoryIdsField(body).categoryIds ?? [],
        audience: body.audience,
        now,
      });
      return fromResult(201, created);
    }

    if (adminRoomMove) {
      return fromResult(
        200,
        await moveRoom(deps.db, {
          userId: session.id,
          userName: session.name,
          id: adminRoomMove[1] ?? "",
          categoryIds: categoryIdsField(body).categoryIds ?? [],
          ...(Array.isArray(body.expectedBefore)
            ? { expectedBefore: stringList(body, "expectedBefore") }
            : {}),
          now,
        }),
      );
    }

    if (roomOne && request.method === "PATCH") {
      return fromResult(
        200,
        await updateRoom(deps.db, {
          userId: session.id,
          id: roomOne[1] ?? "",
          ...categoryIdsField(body),
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.what === "string" ? { what: body.what } : {}),
          ...pinField(body),
          now,
        }),
      );
    }

    if (url.pathname === "/api/categories" && request.method === "POST") {
      return fromResult(
        201,
        await createCategory(deps.db, {
          userId: session.id,
          slug: stringField(body, "slug"),
          name: stringField(body, "name"),
          now,
        }),
      );
    }

    if (categoryOne && request.method === "PATCH") {
      const sortOrder = optionalInt(body, "sortOrder");
      if (sortOrder === null) return json(400, { error: "Give the category a place in the list." });
      return fromResult(
        200,
        await updateCategory(deps.db, {
          userId: session.id,
          slug: categoryOne[1] ?? "",
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          now,
        }),
      );
    }

    if (roomAudience && request.method === "POST") {
      const saved = await setRoomAudience(deps.db, {
        userId: session.id,
        roomId: roomAudience[1] ?? "",
        audience: body.audience,
        now,
      });
      if (!saved.ok) return json(saved.status, { error: saved.error });
      return json(200, saved.value);
    }

    if (url.pathname === "/api/gender" && request.method === "POST") {
      const email = stringField(body, "email").trim().toLowerCase();
      let subjectUserId = session.id;
      if (email) {
        const actor = await actorRole(deps.db, session.id);
        if (
          !mayNameAnotherGender({
            actorIsAdmin: actor.admin,
            actorIsSteward: actor.admin || actor.stewardRooms.length > 0,
          })
        ) {
          return json(403, { error: "You set this once, yourself." });
        }
        const people = await deps.db.query<{ id: string }>(
          `select id from "user" where lower(email) = $1`,
          [email],
        );
        const person = people[0];
        if (!person) return json(404, { error: "No member has that email." });
        subjectUserId = person.id;
      }
      const saved = await setMemberGender(deps.db, {
        actorUserId: session.id,
        subjectUserId,
        gender: body.gender,
        now,
      });
      if (!saved.ok) return json(saved.status, { error: saved.error });
      return json(200, saved.value);
    }

    if (url.pathname === "/api/gender/confirm" && request.method === "POST") {
      const email = stringField(body, "email").trim().toLowerCase();
      if (!email) return json(400, { error: "Name the member." });
      const people = await deps.db.query<{ id: string }>(
        `select id from "user" where lower(email) = $1`,
        [email],
      );
      const person = people[0];
      if (!person) return json(404, { error: "No member has that email." });
      const saved = await confirmMemberGender(deps.db, {
        actorUserId: session.id,
        subjectUserId: person.id,
        now,
      });
      if (!saved.ok) return json(saved.status, { error: saved.error });
      return json(200, saved.value);
    }

    if (url.pathname === "/api/place") {
      return fromResult(
        200,
        await savePlace(deps.db, {
          userId: session.id,
          zip: stringField(body, "zip"),
          congregationId: stringField(body, "congregationId"),
          now,
        }),
      );
    }

    if (url.pathname === "/api/room-requests") {
      return fromResult(
        201,
        await requestRoom(deps.db, {
          userId: session.id,
          kind: stringField(body, "kind"),
          name: stringField(body, "name"),
          state: stringField(body, "state"),
          now,
        }),
      );
    }

    if (decide) {
      return fromResult(
        200,
        await decideRoom(deps.db, {
          userId: session.id,
          requestId: decide[1] ?? "",
          decision: stringField(body, "decision"),
          note: stringField(body, "note"),
          now,
        }),
      );
    }

    if (url.pathname === "/api/zips") {
      return fromResult(
        201,
        await correctZip(deps.db, {
          userId: session.id,
          zip: stringField(body, "zip"),
          name: stringField(body, "name"),
          state: stringField(body, "state"),
          clear: body.clear === true,
          now,
        }),
      );
    }

    if (roomJoin) {
      return fromResult(
        200,
        await joinRoom(deps.db, {
          userId: session.id,
          roomId: roomJoin[1] ?? "",
          now,
          leave: roomJoin[2] === "leave",
        }),
      );
    }

    if (url.pathname === "/api/access") {
      const changed = await grantAccess(deps.db, {
        userId: session.id,
        action: stringField(body, "action"),
        email: stringField(body, "email"),
        roomId: stringField(body, "roomId"),
        inviterEmail: stringField(body, "inviterEmail"),
        stewardEmail: stringField(body, "stewardEmail"),
        role: stringField(body, "role"),
        now,
      });
      return fromResult(200, changed);
    }

    if (url.pathname === "/api/bans") {
      const banned = await banMember(deps.db, {
        userId: session.id,
        name: session.name,
        email: stringField(body, "email"),
        reason: stringField(body, "reason"),
        roomId: stringField(body, "roomId"),
        now,
      });
      return fromResult(201, banned);
    }

    if (fileHold) {
      return fromResult(
        200,
        await fileCsamReport(deps.db, {
          userId: session.id,
          name: session.name,
          holdId: fileHold[1] ?? "",
          reportId: stringField(body, "reportId"),
          now,
        }),
      );
    }

    if (appealAction) {
      return fromResult(
        200,
        await decideAppeal(deps.db, {
          userId: session.id,
          name: session.name,
          appealId: appealAction[1] ?? "",
          decision: stringField(body, "decision"),
          reason: stringField(body, "reason"),
          now,
        }),
      );
    }

    if (!postAction) return json(404, { error: "Not found." });
    const postId = postAction[1] ?? "";
    const action = postAction[2];
    if (action === "replies") {
      return fromResult(
        201,
        await replyToPost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          claim: stringField(body, "claim"),
          now,
        }),
      );
    }
    if (action === "revise") {
      return fromResult(
        200,
        await revisePost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          claim: stringField(body, "claim"),
          reason: stringField(body, "reason"),
          now,
        }),
      );
    }
    if (action === "close") {
      return fromResult(200, await closeAsked(deps.db, { userId: session.id, postId, now }));
    }
    if (action === "council") {
      const result = await setCouncil(deps.db, {
        userId: session.id,
        postId,
        action: stringField(body, "action"),
        reason: stringField(body, "reason"),
        checklist: stringList(body, "checklist"),
        now,
      });
      return fromResult(200, result);
    }
    if (action === "mark") {
      return fromResult(
        200,
        await markPost(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          mark: body.mark === null ? null : body.mark,
          reason: stringField(body, "reason"),
          now,
        }),
      );
    }
    if (action === "appeal") {
      return fromResult(
        201,
        await fileAppeal(deps.db, {
          userId: session.id,
          name: session.name,
          postId,
          kind: stringField(body, "kind"),
          reason: stringField(body, "reason"),
          ground: stringField(body, "ground"),
          evidence: stringField(body, "evidence"),
          now,
        }),
      );
    }
    return fromResult(
      200,
      await removePost(deps.db, {
        userId: session.id,
        name: session.name,
        postId,
        reason: stringField(body, "reason"),
        now,
        store: deps.store ?? null,
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    throw error;
  }
}
