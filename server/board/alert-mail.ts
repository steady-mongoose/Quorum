import type { HoldAlert } from "./csam.ts";

/** A few seconds. The removal does not wait on this. */
export const ALERT_EMAIL_TIMEOUT_MS = 4_000;

export type TextMail = {
  to: string | string[];
  subject: string;
  text: string;
  idempotencyKey: string;
};

export type MailDeps = {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/**
 * The one outbound mail path. Resend is already how the box sends mail.
 * A missing key or from-address does not call out. This does not add a
 * second mail vendor.
 */
export async function sendTextEmail(
  message: TextMail,
  deps: MailDeps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = deps.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const from = env.RESEND_FROM?.trim() ?? "";
  const to = (Array.isArray(message.to) ? message.to : [message.to])
    .map((item) => item.trim())
    .filter(Boolean);
  if (!apiKey || !from || to.length === 0) return { ok: false, error: "Mail is not set up." };
  const send = deps.fetch ?? fetch;
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? ALERT_EMAIL_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": message.idempotencyKey,
      },
      body: JSON.stringify({ from, to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) return { ok: false, error: `mail ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * Admin alert email. Sends only when Resend and an admin address are configured.
 * A missing setting is quiet. The message has no post text and no held bytes.
 * A slow Resend call stops at `ALERT_EMAIL_TIMEOUT_MS`.
 */
export async function sendHoldAlert(alert: HoldAlert, deps: MailDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const to = env.ADMIN_ALERT_EMAIL?.trim() ?? "";
  const from = env.RESEND_FROM?.trim() ?? "";
  if (!apiKey || !to || !from) return;
  const sealed = alert.kind === "csam_hold";
  const subject = sealed
    ? "Avouch: a CSAM hold is ready for the CyberTipline"
    : "Avouch: a CSAM hold is waiting for an encryption key";
  const text = [
    "A CSAM hold was recorded.",
    `Hold: ${alert.holdId}`,
    `Room: ${alert.roomId}`,
    `Post: ${alert.postId}`,
    sealed
      ? "The text and files are encrypted. Josh files the CyberTipline report by hand."
      : "The text and files are held unencrypted until CSAM_HOLD_KEY is set. The board does not serve them.",
    "This message does not include the content.",
  ].join("\n");
  const sent = await sendTextEmail(
    { to, subject, text, idempotencyKey: `csam-admin-alert/${alert.id}` },
    deps,
  );
  if (sent.ok) return;
  const status = /^mail (\d+)$/.exec(sent.error);
  console.error(
    JSON.stringify(
      status
        ? { event: "csam-alert-email-failed", holdId: alert.holdId, status: Number(status[1]) }
        : { event: "csam-alert-email-failed", holdId: alert.holdId, message: sent.error },
    ),
  );
}
