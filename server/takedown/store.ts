import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { actorRole } from "../board/access.ts";
import { openBan } from "../board/store.ts";
import { sendTextEmail, type MailDeps } from "../board/alert-mail.ts";

/** The TAKE IT DOWN Act gives a platform 48 hours from a valid request. */
export const TAKEDOWN_WINDOW_MS = 48 * 60 * 60 * 1000;

export const BANNED_ADMIN = "This account is banned and cannot act as an admin right now.";

export type TakedownField =
  "name" | "email" | "phone" | "contentUrl" | "description" | "goodFaith" | "signature";
export type TakedownResult<T> =
  { ok: true; value: T } | { ok: false; status: number; error: string; field?: TakedownField };

const fail = (status: number, error: string, field?: TakedownField) =>
  field ? { ok: false as const, status, error, field } : { ok: false as const, status, error };

export type TakedownInput = {
  name: string;
  email: string;
  phone?: string;
  contentUrl?: string;
  description?: string;
  goodFaith: boolean;
  signature: string;
};

export type TakedownRow = {
  id: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  contentUrl: string;
  description: string;
  signature: string;
  status: "open" | "removed" | "declined";
  removedCount: number;
  decisionNote: string;
  createdAt: number;
  dueAt: number;
  decidedAt: number | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** TD- plus 10 characters people can read aloud: no 0/O or 1/I/L. */
export function newRequestId(bytes: Uint8Array = randomBytes(10)): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `TD-${out}`;
}

export function validateTakedown(input: TakedownInput): TakedownResult<Required<TakedownInput>> {
  const name = input.name.trim();
  const email = input.email.trim();
  const phone = (input.phone ?? "").trim();
  const contentUrl = (input.contentUrl ?? "").trim();
  const description = (input.description ?? "").trim();
  const signature = input.signature.trim();
  if (!name || name.length > 120) return fail(400, "Enter your name.", "name");
  if (!EMAIL.test(email) || email.length > 254)
    return fail(400, "Enter an email address we can reply to.", "email");
  if (phone.length > 40) return fail(400, "That phone number is too long.", "phone");
  if (!contentUrl && !description) {
    return fail(
      400,
      "Give the link to the image, or describe where it is on Avouch.",
      "contentUrl",
    );
  }
  if (contentUrl.length > 2000) return fail(400, "That link is too long.", "contentUrl");
  if (description.length > 4000)
    return fail(400, "Keep the description under 4,000 characters.", "description");
  if (input.goodFaith !== true) {
    return fail(
      400,
      "Confirm the statement that the image was shared without consent.",
      "goodFaith",
    );
  }
  if (!signature || signature.length > 120)
    return fail(400, "Type your full name as your signature.", "signature");
  return {
    ok: true,
    value: { name, email, phone, contentUrl, description, goodFaith: true, signature },
  };
}

async function audit(
  db: Db,
  requestId: string,
  action: "received" | "mailed" | "removed" | "declined",
  actorUserId: string,
  detail: string,
  now: Date,
): Promise<void> {
  await db.query(
    `insert into takedown_audit (id, request_id, action, actor_user_id, detail, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), requestId, action, actorUserId || null, detail.slice(0, 2000), now],
  );
}

export function confirmationMail(id: string, dueAt: Date): { subject: string; text: string } {
  return {
    subject: `Avouch removal request ${id}`,
    text: [
      `We received your request to remove an intimate image. Your request ID is ${id}.`,
      `We will act on it by ${dueAt.toUTCString()}, within 48 hours of receiving it.`,
      "If we find the image, we remove it and every identical copy on Avouch, and block it from being uploaded again.",
      "Reply to this email with your request ID if you have more to tell us.",
    ].join("\n\n"),
  };
}

/** Where the admin alert goes. safety@ forwards to Josh. ADMIN_ALERT_EMAIL overrides it. */
export const TAKEDOWN_ALERT_DEFAULT_TO = "safety@avouchsocial.com";

export const DEFAULT_ADMIN_TIMEZONE = "America/New_York";
export const DEFAULT_APP_URL = "https://avouchsocial.com";

type AlertEnv = Record<string, string | undefined>;

/** ADMIN_TIMEZONE when it is a real IANA zone, else America/New_York. */
export function adminTimeZone(env: AlertEnv = process.env): string {
  const zone = env.ADMIN_TIMEZONE?.trim();
  if (!zone) return DEFAULT_ADMIN_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_ADMIN_TIMEZONE;
  }
}

/** The web app: the first WEB_ORIGINS entry (the client origin), else https://avouchsocial.com. */
export function appUrl(env: AlertEnv = process.env): string {
  const first = (env.WEB_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .find((item) => /^https?:\/\//.test(item));
  return (first ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** "Thu, Oct 29, 8:00 AM EDT" in the given zone. */
export function formatLocal(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
}

/** "2026-10-29 12:00" in UTC. */
export function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** The admin alert. Metadata only: never the requester's description, link, or the image. */
export function takedownAlertMail(
  id: string,
  receivedAt: Date,
  dueAt: Date,
  env: AlertEnv = process.env,
): { subject: string; text: string } {
  const zone = adminTimeZone(env);
  const due = formatLocal(dueAt, zone);
  return {
    subject: `Avouch: removal request due by ${due}`,
    text: [
      "A new removal request for an intimate image was filed. By law we must act within 48 hours.",
      "",
      `Act by: ${due} (${formatUtc(dueAt)} UTC)`,
      `Received: ${formatLocal(receivedAt, zone)}`,
      `Request: ${id}`,
      "",
      `Review it: ${appUrl(env)}/  (admin Home, Removal requests)`,
      "",
      "This email leaves out the request's content on purpose.",
    ].join("\n"),
  };
}

/** Best effort. A failure is logged and never stops the request. */
export async function sendTakedownAlert(
  id: string,
  receivedAt: Date,
  dueAt: Date,
  mail: MailDeps = {},
): Promise<boolean> {
  try {
    const env = mail.env ?? process.env;
    const to = env.ADMIN_ALERT_EMAIL?.trim() || TAKEDOWN_ALERT_DEFAULT_TO;
    const letter = takedownAlertMail(id, receivedAt, dueAt, env);
    const sent = await sendTextEmail(
      {
        to,
        subject: letter.subject,
        text: letter.text,
        idempotencyKey: `takedown-admin-alert/${id}`,
      },
      mail,
    );
    if (!sent.ok) {
      console.error(
        JSON.stringify({ event: "takedown-alert-email-failed", id, message: sent.error }),
      );
    }
    return sent.ok;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "takedown-alert-email-failed",
        id,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return false;
  }
}

export function takedownLogLine(id: string, dueAt: Date, mailed: boolean): string {
  return JSON.stringify({
    level: "alert",
    event: "takedown-received",
    id,
    dueAt: dueAt.toISOString(),
    mailed,
    message: `New intimate image removal request ${id}. Act by ${dueAt.toISOString()} (48 hours).`,
  });
}

/** A public request. No account. Returns the request ID and whether the confirmation was mailed. */
export async function submitTakedown(
  db: Db,
  input: TakedownInput,
  now: Date,
  mail: MailDeps = {},
): Promise<TakedownResult<{ id: string; dueAt: number; mailed: boolean }>> {
  const valid = validateTakedown(input);
  if (!valid.ok) return valid;
  const v = valid.value;
  const dueAt = new Date(now.getTime() + TAKEDOWN_WINDOW_MS);
  let id = "";
  for (let attempt = 0; attempt < 5 && !id; attempt += 1) {
    const candidate = newRequestId();
    const rows = await db.query<{ id: string }>(
      `insert into takedown_request
         (id, requester_name, requester_email, requester_phone, content_url, description,
          good_faith, signature, created_at, due_at)
       values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
       on conflict (id) do nothing
       returning id`,
      [candidate, v.name, v.email, v.phone, v.contentUrl, v.description, v.signature, now, dueAt],
    );
    if (rows[0]) id = candidate;
  }
  if (!id) return fail(500, "The request was not saved. Try again.");
  await audit(db, id, "received", "", "", now);
  const letter = confirmationMail(id, dueAt);
  const sent = await sendTextEmail(
    { to: v.email, subject: letter.subject, text: letter.text, idempotencyKey: `takedown/${id}` },
    mail,
  );
  await audit(db, id, "mailed", "", sent.ok ? "sent" : `not sent: ${sent.error}`, now);
  // Admins see it in the app: the open request heads their Home with its 48-hour deadline.
  // They are also emailed (best effort), and this line goes to the server log.
  await sendTakedownAlert(id, now, dueAt, mail);
  console.log(takedownLogLine(id, dueAt, sent.ok));
  return { ok: true, value: { id, dueAt: dueAt.getTime(), mailed: sent.ok } };
}

type RequestRecord = {
  id: string;
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  content_url: string;
  description: string;
  signature: string;
  status: string;
  removed_count: number;
  decision_note: string;
  created_at: Date | string;
  due_at: Date | string;
  decided_at: Date | string | null;
};

const ms = (value: Date | string) => new Date(value).getTime();

function rowFrom(row: RequestRecord): TakedownRow {
  return {
    id: row.id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    requesterPhone: row.requester_phone,
    contentUrl: row.content_url,
    description: row.description,
    signature: row.signature,
    status: row.status === "removed" || row.status === "declined" ? row.status : "open",
    removedCount: Number(row.removed_count),
    decisionNote: row.decision_note,
    createdAt: ms(row.created_at),
    dueAt: ms(row.due_at),
    decidedAt: row.decided_at ? ms(row.decided_at) : null,
  };
}

/** Admins only. Open requests first, soonest due first. */
export async function listTakedowns(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<TakedownResult<TakedownRow[]>> {
  const actor = await actorRole(db, userId);
  if (!actor.admin) return fail(403, "Only an admin can see removal requests.");
  if (await openBan(db, userId, now)) return fail(403, BANNED_ADMIN);
  const rows = await db.query<RequestRecord>(
    `select * from takedown_request
     order by (status = 'open') desc, due_at asc
     limit 200`,
  );
  return { ok: true, value: rows.map(rowFrom) };
}

/** Pull a media id out of a pasted link or id. */
export function mediaIdFrom(text: string): string {
  const trimmed = text.trim();
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(trimmed);
  return match ? match[1]!.toLowerCase() : trimmed;
}

/**
 * Removes the named files and every identical copy (same SHA-256 of the uploaded bytes), blocks
 * those hashes from new uploads, and closes the request. Admins only.
 */
export async function removeForTakedown(
  db: Db,
  input: { userId: string; requestId: string; media: string[]; note: string; now: Date },
): Promise<TakedownResult<{ request: TakedownRow; removedIds: string[] }>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can remove under a request.");
  if (await openBan(db, input.userId, input.now)) return fail(403, BANNED_ADMIN);
  const ids = [...new Set(input.media.map(mediaIdFrom).filter(Boolean))];
  if (ids.length === 0) return fail(400, "Name at least one file to remove.");
  const note = input.note.trim();
  if (note.length < 4 || note.length > 500) return fail(400, "Say briefly what you removed.");
  return db.transaction(async (tx) => {
    const open = await tx.query<{ status: string }>(
      `select status from takedown_request where id = $1 for update`,
      [input.requestId],
    );
    if (!open[0]) return fail(404, "That request is not here.");
    if (open[0].status !== "open") return fail(409, "That request is already closed.");
    const named = await tx.query<{ id: string; source_sha256: string }>(
      `select id, source_sha256 from media_object where id = any($1::text[])`,
      [ids],
    );
    if (named.length === 0) return fail(404, "None of those files are here.");
    const hashes = [...new Set(named.map((row) => row.source_sha256).filter(Boolean))];
    const removed = await tx.query<{ id: string }>(
      `update media_object set deleted_at = coalesce(deleted_at, $3)
       where id = any($1::text[]) or (source_sha256 <> '' and source_sha256 = any($2::text[]))
       returning id`,
      [named.map((row) => row.id), hashes, input.now],
    );
    for (const hash of hashes) {
      await tx.query(
        `insert into media_block_hash (sha256, request_id, created_at) values ($1, $2, $3)
         on conflict (sha256) do nothing`,
        [hash, input.requestId, input.now],
      );
    }
    const removedIds = removed.map((row) => row.id).sort();
    const saved = await tx.query<RequestRecord>(
      `update takedown_request
       set status = 'removed', removed_count = $2, decision_note = $3, decided_by_user_id = $4, decided_at = $5
       where id = $1 returning *`,
      [input.requestId, removedIds.length, note, input.userId, input.now],
    );
    await audit(
      tx,
      input.requestId,
      "removed",
      input.userId,
      `files=${removedIds.join(",")} hashes=${hashes.length} note=${note}`,
      input.now,
    );
    return { ok: true as const, value: { request: rowFrom(saved[0]!), removedIds } };
  });
}

/** Closes a request without removing anything, with the reason. Admins only. */
export async function declineTakedown(
  db: Db,
  input: { userId: string; requestId: string; note: string; now: Date },
): Promise<TakedownResult<TakedownRow>> {
  const actor = await actorRole(db, input.userId);
  if (!actor.admin) return fail(403, "Only an admin can close a request.");
  if (await openBan(db, input.userId, input.now)) return fail(403, BANNED_ADMIN);
  const note = input.note.trim();
  if (note.length < 4 || note.length > 500) return fail(400, "Say why nothing was removed.");
  const saved = await db.query<RequestRecord>(
    `update takedown_request
     set status = 'declined', decision_note = $2, decided_by_user_id = $3, decided_at = $4
     where id = $1 and status = 'open' returning *`,
    [input.requestId, note, input.userId, input.now],
  );
  if (!saved[0]) return fail(404, "That request is not open.");
  await audit(db, input.requestId, "declined", input.userId, note, input.now);
  return { ok: true, value: rowFrom(saved[0]) };
}

export { isBlockedHash } from "./block.ts";
