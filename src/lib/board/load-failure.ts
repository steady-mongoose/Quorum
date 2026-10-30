import { userFacingError } from "../user-facing-error.ts";

/**
 * Why an admin panel on About did not load or save, in words for a person.
 *
 * This mirrors `groupFailure` in group-client.ts (PR #114). It is copied here
 * rather than imported so this fix does not depend on that branch; once both
 * are in, the two can share one helper.
 *
 * `mfa` is set when the server refused because of the authenticator gate.
 * "enroll": no authenticator is on yet (mfa_required, step enroll). The panel
 * says what is waiting and offers the way to turn it on.
 * "verify": a code is needed or attempts are locked (mfa_step_up, mfa_locked,
 * the sign-in challenge). The server's own sentence is shown.
 */
export type PanelMfa = "enroll" | "verify";
export type PanelFailure = { error: string; mfa?: PanelMfa };

export const PANEL_LOAD_FAILED = "That did not load.";
export const PANEL_SAVE_FAILED = "That did not save.";
/** The server's own enroll wording, used when its 403 carries no message. */
export const PANEL_MFA_NEEDED = "Turn on an authenticator before using this.";
export const PANEL_SET_UP = "Turn it on under You";

/** What waits on the authenticator, per panel on About. */
export const DELETION_REQUESTS_WAIT =
  "Account deletion requests wait until you turn on an authenticator.";
export const ROOMS_WAIT = "The room list waits until you turn on an authenticator.";
export const DM_REPORTS_WAIT = "Message reports wait until you turn on an authenticator.";
export const INVITES_WAIT = "The invite list waits until you turn on an authenticator.";
export const MFA_RESETS_WAIT = "Authenticator resets wait until you turn on an authenticator.";

const MFA_CODES = new Set(["mfa_required", "mfa_step_up", "mfa_locked"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * The server's own sentence when it sent one: `error` for most routes,
 * `message` for the authenticator gate. A bare code never reaches the page.
 */
export function panelFailure(json: unknown, fallback: string): PanelFailure {
  const row = record(json);
  const error = row && typeof row.error === "string" ? row.error.trim() : "";
  const message = row && typeof row.message === "string" ? row.message.trim() : "";
  const step = row && typeof row.step === "string" ? row.step : "";
  if (MFA_CODES.has(error)) {
    const enroll =
      error === "mfa_required" &&
      (step === "enroll" || (!step && (!message || message === PANEL_MFA_NEEDED)));
    return {
      error: userFacingError(message, PANEL_MFA_NEEDED),
      mfa: enroll ? "enroll" : "verify",
    };
  }
  const said = userFacingError(error, "");
  if (said) return { error: said };
  return { error: userFacingError(message, fallback) };
}
