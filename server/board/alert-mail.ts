import type { HoldAlert } from "./csam.ts";

/** A few seconds. The removal does not wait on this. */
export const ALERT_EMAIL_TIMEOUT_MS = 4_000;

/**
 * Admin alert email. Sends only when Resend and an admin address are configured.
 * A missing setting is quiet. The message has no post text and no held bytes.
 * A slow Resend call stops at `ALERT_EMAIL_TIMEOUT_MS`.
 */
export async function sendHoldAlert(
  alert: HoldAlert,
  deps: {
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<void> {
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
  const send = deps.fetch ?? fetch;
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(deps.timeoutMs ?? ALERT_EMAIL_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": `csam-admin-alert/${alert.id}`,
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "csam-alert-email-failed",
          holdId: alert.holdId,
          status: response.status,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "csam-alert-email-failed",
        holdId: alert.holdId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
