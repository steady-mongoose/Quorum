import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";

export type AccountCreateReason = "invite" | "bootstrap";

const storage = new AsyncLocalStorage<{ reason: AccountCreateReason }>();

/** True only while seed or invite redemption is creating the account. */
export function accountCreateAllowed(): boolean {
  return storage.getStore() != null;
}

export function runAccountCreate<T>(reason: AccountCreateReason, fn: () => Promise<T>): Promise<T> {
  return storage.run({ reason }, fn);
}

/**
 * Better Auth calls this before inserting a user. Open signup never sets the
 * store, so the insert is refused even if the HTTP route is reached.
 */
export function assertAccountCreateAllowed(): void {
  if (!accountCreateAllowed()) {
    throw APIError.from("FORBIDDEN", {
      message: "An invite code is required.",
      code: "INVITE_REQUIRED",
    });
  }
}
