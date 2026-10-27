import { apiFetch } from "../api-base.ts";
import { userFacingError } from "../user-facing-error.ts";

/** How often a signed-in member asks the server for new lines. */
export const CHAT_POLL_MS = 4_000;

export type RoomChatMessage = {
  id: string;
  author: string;
  text: string;
  at: number;
  seq: number;
};

export type RoomChatPage = {
  messages: RoomChatMessage[];
  hidden: string[];
  older: number | null;
};

/** Time order, then the server sequence, so a tie cannot flip. */
export function orderChat(messages: RoomChatMessage[]): RoomChatMessage[] {
  return [...messages].sort((a, b) => a.at - b.at || a.seq - b.seq || (a.id < b.id ? -1 : 1));
}

export function parseChatMessage(value: unknown): RoomChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.author !== "string" ||
    typeof row.text !== "string"
  ) {
    return null;
  }
  if (typeof row.at !== "number" || typeof row.seq !== "number") return null;
  if (!Number.isSafeInteger(row.seq) || row.seq < 1) return null;
  return { id: row.id, author: row.author, text: row.text, at: row.at, seq: row.seq };
}

export function parseChatPage(json: unknown): RoomChatPage | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  if (!Array.isArray(body.messages)) return null;
  const messages: RoomChatMessage[] = [];
  for (const item of body.messages) {
    const message = parseChatMessage(item);
    if (message) messages.push(message);
  }
  const hidden = Array.isArray(body.hidden)
    ? body.hidden.filter((item): item is string => typeof item === "string")
    : [];
  const older =
    typeof body.older === "number" && Number.isSafeInteger(body.older) ? body.older : null;
  return { messages: orderChat(messages), hidden, older };
}

export type ChatFailure = { ok: false; status: number; error: string };

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

function failure(status: number, json: unknown, fallback: string): ChatFailure {
  const raw =
    json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : fallback;
  return { ok: false, status, error: raw === "banned" ? raw : userFacingError(raw, fallback) };
}

export async function loadRoomChat(
  roomId: string,
  query?: { after?: number; before?: number },
): Promise<{ ok: true; page: RoomChatPage } | ChatFailure> {
  const params = new URLSearchParams();
  if (query?.after != null) params.set("after", String(query.after));
  if (query?.before != null) params.set("before", String(query.before));
  const search = params.toString();
  const path = `/api/rooms/${encodeURIComponent(roomId)}/chat${search ? `?${search}` : ""}`;
  const response = await send(path);
  if (!response.ok) return failure(response.status, response.json, "The room chat did not load.");
  const page = parseChatPage(response.json);
  if (!page) return { ok: false, status: response.status, error: "The room chat did not load." };
  return { ok: true, page };
}

export async function sendRoomChat(
  roomId: string,
  text: string,
): Promise<{ ok: true; message: RoomChatMessage } | ChatFailure> {
  const response = await send(`/api/rooms/${encodeURIComponent(roomId)}/chat`, { text });
  if (!response.ok) return failure(response.status, response.json, "That message was not sent.");
  const message = parseChatMessage(
    response.json && typeof response.json === "object"
      ? (response.json as { message?: unknown }).message
      : null,
  );
  if (!message) return { ok: false, status: response.status, error: "That message was not sent." };
  return { ok: true, message };
}

export async function removeRoomChat(
  roomId: string,
  messageId: string,
  reason: string,
): Promise<
  | {
      ok: true;
      removal: { id: string; author: string; reason: string; at: number };
      ban: { until: number; strikes: number; reason: string } | null;
    }
  | ChatFailure
> {
  const response = await send(
    `/api/rooms/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}/remove`,
    { reason },
  );
  if (!response.ok) return failure(response.status, response.json, "That message was not removed.");
  const body = response.json as { removal?: unknown; ban?: unknown } | null;
  if (!body?.removal || typeof body.removal !== "object") {
    return { ok: false, status: response.status, error: "That message was not removed." };
  }
  const row = body.removal as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.author !== "string" || typeof row.at !== "number") {
    return { ok: false, status: response.status, error: "That message was not removed." };
  }
  if (typeof row.reason !== "string") {
    return { ok: false, status: response.status, error: "That message was not removed." };
  }
  let ban: { until: number; strikes: number; reason: string } | null = null;
  if (body.ban && typeof body.ban === "object") {
    const banRow = body.ban as Record<string, unknown>;
    if (
      typeof banRow.until === "number" &&
      typeof banRow.strikes === "number" &&
      typeof banRow.reason === "string"
    ) {
      ban = { until: banRow.until, strikes: banRow.strikes, reason: banRow.reason };
    }
  }
  return {
    ok: true,
    removal: { id: row.id, author: row.author, reason: row.reason, at: row.at },
    ban,
  };
}
