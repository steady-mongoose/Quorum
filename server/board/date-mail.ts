import type { Db } from "../db.ts";
import { sendTextEmail, type MailDeps, type TextMail } from "./alert-mail.ts";
import { claimFromAddress } from "./claims.ts";
import { actorRole } from "./access.ts";
import { openBan } from "./store.ts";
import { APP_NAME } from "../../src/lib/board/model.ts";
import { gatheringPublicUrl } from "../../src/lib/board/public-gathering.ts";

/**
 * Josh via CoS, Oct 30 2:35 PM ET: "Email the host and everyone going when a
 * steward changes the date". Only when a steward who is not the host changed
 * the date. The host always; members going only on a special event, since
 * RSVPs are hidden while it is not one. One email per person, never a shared
 * To or CC. Sent after the edit is saved, so a failed send never undoes it.
 *
 * It uses the existing Resend setup and nothing new: RESEND_API_KEY and the
 * member-facing sender of claim codes (RESEND_CLAIM_FROM, else its fixed
 * noreply default). The link is the app's public address (gatheringPublicUrl).
 * With no RESEND_API_KEY nothing is sent. The app has no email preference or
 * opt-out to read.
 */

/** One email per gathering per person per hour, however often the date is edited. */
export const DATE_MAIL_WINDOW_MS = 60 * 60 * 1000;
const lastSent = new Map<string, number>();
/** Drop entries past the window once the map grows, so it never holds more than a day's edits. */
function pruneGuard(nowMs: number): void {
  if (lastSent.size < 1000) return;
  for (const [key, at] of lastSent) if (nowMs - at >= DATE_MAIL_WINDOW_MS) lastSent.delete(key);
}
/** Tests only. */
export function resetDateMailGuard(): void {
  lastSent.clear();
}

export type DateMailDeps = MailDeps & {
  /** Tests: a mock transport. Never a real send. */
  send?: (mail: TextMail) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export type DateChange = {
  gatheringId: string;
  title: string;
  oldDate: string;
  newDate: string;
  roomId: string;
  movedFrom: string[];
  hostId: string;
  stewardId: string;
  shared: boolean;
  /** Special event: members going are told too. Otherwise only the host. */
  special: boolean;
  now: Date;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Saturday, November 7, 2026"; anything else as it was typed, or "no date". */
export function mailDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value.trim() || "no date";
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${DAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
}

/** The link: the public page when it is shared, otherwise the app, where it sits on the card. */
export function dateMailLink(change: Pick<DateChange, "gatheringId" | "shared">): string {
  const page = gatheringPublicUrl(change.gatheringId);
  return change.shared ? page : `${new URL(page).origin}/`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The draft copy (for Design): the title, both dates and a link. No names. Plain text plus a simple HTML part. */
export function dateMail(
  change: Pick<DateChange, "title" | "oldDate" | "newDate">,
  link: string,
): { subject: string; text: string; html: string } {
  const title = change.title.replace(/[\r\n]+/g, " ").trim() || "your gathering";
  const was = mailDate(change.oldDate);
  const now = mailDate(change.newDate);
  const why = "You're getting this because you're hosting it or said you're going. We hope to see you there.";
  const t = escapeHtml(title);
  return {
    subject: `New date for ${title}`,
    text: [
      "Hello,",
      "",
      `The date for ${title} has changed.`,
      "",
      `It was: ${was}`,
      `It's now: ${now}`,
      "",
      ...(link ? [`See it here: ${link}`, ""] : []),
      why,
      "",
      APP_NAME,
    ].join("\n"),
    html: [
      "<p>Hello,</p>",
      `<p>The date for <strong>${t}</strong> has changed.</p>`,
      `<p>It was: ${escapeHtml(was)}<br>It's now: <strong>${escapeHtml(now)}</strong></p>`,
      ...(link ? [`<p><a href="${escapeHtml(link)}">See it here</a></p>`] : []),
      `<p>${escapeHtml(why)}</p>`,
      `<p>${escapeHtml(APP_NAME)}</p>`,
    ].join("\n"),
  };
}

/** Who gets it: the host, and everyone going on a special event, less the steward, barred, banned or removed members, and anyone with no verified email. */
export async function dateMailRecipients(db: Db, change: DateChange): Promise<{ userId: string; email: string }[]> {
  const ready = await db.query<{ rsvp: string | null }>(`select to_regclass('public.gathering_rsvp')::text as rsvp`);
  // Not a special event: its RSVPs are hidden, so nobody counts as going.
  const going = change.special && ready[0]?.rsvp
    ? await db.query<{ user_id: string }>(`select user_id from gathering_rsvp where gathering_id = $1 and going`, [change.gatheringId])
    : [];
  const ids = [...new Set([change.hostId, ...going.map((row) => row.user_id)])].filter((id) => id && id !== change.stewardId);
  if (ids.length === 0) return [];
  const rows = await db.query<{ id: string; email: string }>(
    `select id, email from "user" where id = any ($1::text[]) and "emailVerified" = true and coalesce(email, '') <> ''`,
    [ids],
  );
  const rooms = [...new Set([change.roomId, ...change.movedFrom])];
  const out: { userId: string; email: string }[] = [];
  for (const row of rows) {
    let barred = false;
    // openBan reads site-wide bans too (room_id = '').
    for (const room of rooms) {
      if (await openBan(db, row.id, change.now, room)) {
        barred = true;
        break;
      }
    }
    if (barred) continue;
    // Still a member of the site (access not revoked, account not closed).
    const actor = await actorRole(db, row.id);
    if (!actor.member && !actor.steward) continue;
    out.push({ userId: row.id, email: row.email });
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
}

/** Error text from the provider may echo an address; never log one. */
function noAddresses(text: string): string {
  return text.replace(/[^\s<>"']+@[^\s<>"']+/g, "[address]");
}

/** Sends the emails. Never throws; failures are logged without addresses. Returns how many were sent. */
export async function sendDateChangeMail(db: Db, change: DateChange, deps: DateMailDeps = {}): Promise<number> {
  try {
    const env = deps.env ?? process.env;
    const recipients = await dateMailRecipients(db, change);
    const { subject, text, html } = dateMail(change, dateMailLink(change));
    const nowMs = change.now.getTime();
    const hour = Math.floor(nowMs / DATE_MAIL_WINDOW_MS);
    let sent = 0;
    let failed = 0;
    for (const person of recipients) {
      const key = `${change.gatheringId}/${person.userId}`;
      const last = lastSent.get(key);
      if (last !== undefined && nowMs - last < DATE_MAIL_WINDOW_MS) continue;
      pruneGuard(nowMs);
      lastSent.set(key, nowMs);
      const mail: TextMail = {
        to: person.email,
        subject,
        text,
        html,
        idempotencyKey: `gathering-date/${change.gatheringId}/${person.userId}/${hour}`,
      };
      // Under `node --test` only a mock transport is used: never a real send.
      let result: { ok: true } | { ok: false; error: string };
      try {
        result = deps.send
          ? await deps.send(mail)
          : process.env.NODE_TEST_CONTEXT
            ? { ok: false, error: "Mail is not set up." }
            : await sendTextEmail(mail, deps, claimFromAddress(env));
      } catch (error) {
        // One person's failed send never stops the others.
        result = { ok: false, error: error instanceof Error ? error.message : "unknown" };
      }
      if (result.ok) sent += 1;
      else {
        failed += 1;
        // Not set up: quiet, as the CSAM alert. Let a later edit try again.
        lastSent.delete(key);
        if (result.error === "Mail is not set up.") continue;
        const status = /^mail (\d+)$/.exec(result.error);
        console.error(
          JSON.stringify({
            event: "gathering-date-mail-failed",
            gatheringId: change.gatheringId,
            ...(status ? { status: Number(status[1]) } : { message: noAddresses(result.error).slice(0, 120) }),
          }),
        );
      }
    }
    return sent;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gathering-date-mail-failed",
        gatheringId: change.gatheringId,
        message: error instanceof Error ? noAddresses(error.message).slice(0, 120) : "unknown",
      }),
    );
    return 0;
  }
}
