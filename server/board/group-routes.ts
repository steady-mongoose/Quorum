import { limitBoard, type BoardDeps } from "./routes.ts";
import type { Result } from "./store.ts";
import {
  appealGroupPost,
  createGroupPost,
  decideGroupAppeal,
  decideGroupRequest,
  inviteToGroup,
  listGroupInvites,
  revokeGroupInvite,
  joinGroup,
  leaveGroup,
  listGroup,
  listGroupAppeals,
  listGroupLog,
  listGroupRequests,
  listGroups,
  markGroupPost,
  removeGroupPost,
  requestGroup,
  setGroupAdmin,
  setGroupSteward,
} from "./groups.ts";
import { setGroupAudience } from "./audience.ts";

function json(status: number, body: unknown, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > 65_536)
    throw new HttpError(413, "That request is too large.");
  const text = await request.text();
  if (text.length > 65_536) throw new HttpError(413, "That request is too large.");
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

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function fromResult(status: number, result: Result<unknown>): Response {
  if (!result.ok) {
    return json(result.status, {
      error: result.error,
      ...(result.stops ? { stops: result.stops } : {}),
      ...(result.ban ? { ban: result.ban } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.audience === "men" || result.audience === "women" ? { audience: result.audience } : {}),
    });
  }
  return json(status, result.value);
}

/**
 * Theme groups share the board read and write limits.
 * A member cannot get around the board cap by posting here.
 */
export async function handleGroups(
  deps: BoardDeps,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const groupAction =
    /^\/api\/groups\/([a-z0-9-]{1,32})\/(join|leave|posts|admins|stewards|log|audience|invites)$/.exec(
      url.pathname,
    );
  const groupOne = /^\/api\/groups\/([a-z0-9-]{1,32})$/.exec(url.pathname);
  const requestOne = /^\/api\/group-requests\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
  const postAction = /^\/api\/group-posts\/([A-Za-z0-9_-]{1,80})\/(mark|remove|appeal)$/.exec(
    url.pathname,
  );
  const inviteOne = /^\/api\/groups\/([a-z0-9-]{1,32})\/invites\/([A-Za-z0-9_-]{1,80})\/revoke$/.exec(
    url.pathname,
  );
  const appealOne = /^\/api\/group-appeals\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname);
  const action = groupAction?.[2];
  const matched =
    (url.pathname === "/api/groups" && request.method === "GET") ||
    (url.pathname === "/api/group-requests" &&
      (request.method === "GET" || request.method === "POST")) ||
    (url.pathname === "/api/group-appeals" && request.method === "GET") ||
    (groupOne !== null && request.method === "GET") ||
    (action === "log" && request.method === "GET") ||
    (action === "invites" && (request.method === "GET" || request.method === "POST")) ||
    (inviteOne !== null && request.method === "POST") ||
    ((action === "join" ||
      action === "leave" ||
      action === "posts" ||
      action === "admins" ||
      action === "stewards" ||
      action === "audience") &&
      request.method === "POST") ||
    (requestOne !== null && request.method === "POST") ||
    (postAction !== null && request.method === "POST") ||
    (appealOne !== null && request.method === "POST");
  if (!matched) return null;

  try {
    const session = await deps.readSession(request.headers);
    if (!session) return json(401, { error: "Sign in first." });
    const kind = request.method === "GET" ? "read" : "write";
    const blocked = await limitBoard(deps.db, request, session.id, kind);
    if (blocked) return blocked;
    const now = deps.now();
    const who = { userId: session.id, name: session.name, now };

    if (url.pathname === "/api/groups")
      return fromResult(200, await listGroups(deps.db, session.id, now));

    if (url.pathname === "/api/group-requests" && request.method === "GET") {
      return fromResult(200, await listGroupRequests(deps.db, session.id, now));
    }
    if (url.pathname === "/api/group-appeals") {
      return fromResult(200, await listGroupAppeals(deps.db, session.id, now));
    }

    if (groupOne && request.method === "GET") {
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw === null ? undefined : Number(limitRaw);
      const cursor = url.searchParams.get("cursor") ?? "";
      return fromResult(
        200,
        await listGroup(deps.db, session.id, groupOne[1] ?? "", now, {
          ...(cursor ? { cursor } : {}),
          ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        }),
      );
    }

    if (groupAction?.[1] && action === "log") {
      return fromResult(200, await listGroupLog(deps.db, session.id, groupAction[1], now));
    }

    const body = request.method === "GET" ? {} : await readJson(request);

    if (groupAction?.[1] && action === "invites" && request.method === "GET") {
      return fromResult(200, await listGroupInvites(deps.db, session.id, groupAction[1], now));
    }
    if (inviteOne?.[1] && inviteOne[2]) {
      return fromResult(
        200,
        await revokeGroupInvite(deps.db, { ...who, groupId: inviteOne[1], inviteId: inviteOne[2] }),
      );
    }
    if (groupAction?.[1] && action === "invites") {
      return fromResult(
        201,
        await inviteToGroup(deps.db, {
          ...who,
          groupId: groupAction[1],
          email: stringField(body, "email"),
        }),
      );
    }
    if (groupAction?.[1] && action === "join") {
      return fromResult(200, await joinGroup(deps.db, { ...who, groupId: groupAction[1] }));
    }
    if (groupAction?.[1] && action === "leave") {
      return fromResult(200, await leaveGroup(deps.db, { ...who, groupId: groupAction[1] }));
    }
    if (groupAction?.[1] && action === "posts") {
      return fromResult(
        201,
        await createGroupPost(deps.db, {
          ...who,
          groupId: groupAction[1],
          body: stringField(body, "body"),
          on: stringField(body, "on"),
        }),
      );
    }
    if (groupAction?.[1] && action === "admins") {
      return fromResult(
        200,
        await setGroupAdmin(deps.db, {
          ...who,
          groupId: groupAction[1],
          email: stringField(body, "email"),
          action: stringField(body, "action"),
        }),
      );
    }
    if (groupAction?.[1] && action === "audience") {
      const saved = await setGroupAudience(deps.db, {
        userId: session.id,
        groupId: groupAction[1],
        audience: body.audience,
        now,
      });
      if (!saved.ok) return json(saved.status, { error: saved.error });
      return json(200, saved.value);
    }
    if (groupAction?.[1] && action === "stewards") {
      return fromResult(
        200,
        await setGroupSteward(deps.db, {
          ...who,
          groupId: groupAction[1],
          email: stringField(body, "email"),
          action: stringField(body, "action"),
        }),
      );
    }

    if (url.pathname === "/api/group-requests" && request.method === "POST") {
      return fromResult(
        201,
        await requestGroup(deps.db, {
          ...who,
          roomId: stringField(body, "roomId"),
          groupName: stringField(body, "name"),
          about: stringField(body, "about"),
        }),
      );
    }
    if (requestOne?.[1]) {
      return fromResult(
        200,
        await decideGroupRequest(deps.db, {
          ...who,
          requestId: requestOne[1],
          decision: stringField(body, "decision"),
          note: stringField(body, "note"),
        }),
      );
    }
    if (postAction?.[1] && postAction[2] === "mark") {
      return fromResult(
        200,
        await markGroupPost(deps.db, {
          ...who,
          postId: postAction[1],
          mark: body.mark === null ? null : body.mark,
          reason: stringField(body, "reason"),
        }),
      );
    }
    if (postAction?.[1] && postAction[2] === "remove") {
      return fromResult(
        200,
        await removeGroupPost(deps.db, {
          ...who,
          postId: postAction[1],
          reason: stringField(body, "reason"),
        }),
      );
    }
    if (postAction?.[1] && postAction[2] === "appeal") {
      return fromResult(
        201,
        await appealGroupPost(deps.db, {
          ...who,
          postId: postAction[1],
          text: stringField(body, "text"),
        }),
      );
    }
    if (appealOne?.[1]) {
      return fromResult(
        200,
        await decideGroupAppeal(deps.db, {
          ...who,
          appealId: appealOne[1],
          decision: stringField(body, "decision"),
        }),
      );
    }
    return json(404, { error: "Not found." });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    throw error;
  }
}
