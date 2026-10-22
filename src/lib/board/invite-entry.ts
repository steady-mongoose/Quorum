export const INVITE_CODE_ERROR =
  "That code didn't work. Check it with the person who gave it to you; codes are for one meeting.";

export const INVITE_CODE_ERROR_ID = "invite-code-error";

/** The `code` query on an invite link, or empty when the URL does not carry one. */
export function codeFromSearch(search: string): string {
  return (new URLSearchParams(search).get("code") ?? "").trim();
}

/** A link with `?code=` opens the code form and fills the field. */
export function entryFromSearch(search: string): { mode: "sign-in" | "sign-up"; code: string } {
  const code = codeFromSearch(search);
  if (!code) return { mode: "sign-in", code: "" };
  return { mode: "sign-up", code };
}

/** Server error type for a missing, unknown, used, or expired invite code. */
export const INVITE_INVALID = "invite_invalid";

/**
 * The field error for an empty code, or for a refusal whose type is the
 * invite code. Any other server message, including one that merely contains
 * the word "code", returns null.
 */
export function inviteCodeError(
  code: string,
  failure?: { code?: string | null; message?: string | null } | null,
): string | null {
  if (!code.trim()) return INVITE_CODE_ERROR;
  if (failure?.code === INVITE_INVALID) return INVITE_CODE_ERROR;
  return null;
}
