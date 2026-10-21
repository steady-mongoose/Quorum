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

/**
 * The field error for an empty code, or for a server refusal that is about
 * the code. A refusal about some other field returns null.
 */
export function inviteCodeError(code: string, serverMessage?: string | null): string | null {
  if (!code.trim()) return INVITE_CODE_ERROR;
  if (serverMessage && /code/i.test(serverMessage)) return INVITE_CODE_ERROR;
  return null;
}
