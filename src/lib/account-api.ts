import { apiFetch, apiUrl } from "./api-base";
import {
  inviteLimitMessage,
  parseAccountResult,
  parseSessionBody,
  type AccountResult,
  type AccountUser,
} from "./account-result";

export type { AccountResult, AccountUser };
export { parseAccountResult, parseSessionBody };

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown; retryAfter: number | null }> {
  const response = await apiFetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  const retry = Number(response.headers?.get?.("retry-after") ?? "");
  return {
    status: response.status,
    json,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

export async function signUpWithInvite(input: {
  name: string;
  email: string;
  password: string;
  inviteCode: string;
}): Promise<AccountResult> {
  const response = await postJson("/api/signup", input);
  return parseAccountResult(response.status, response.json);
}

export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<AccountResult> {
  const response = await postJson("/api/auth/sign-in/email", input);
  return parseAccountResult(response.status, response.json);
}

export async function readServerSession(): Promise<AccountUser | null> {
  const response = await apiFetch("/api/auth/get-session", { credentials: "include" });
  const body = await response.json().catch(() => null);
  return parseSessionBody(response.status, body);
}

export async function signOutServer(): Promise<void> {
  await apiFetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
}

export async function createServerInvite(input: {
  maxUses?: number;
}): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const response = await postJson("/api/invites", input);
  if (response.status === 429)
    return { ok: false, message: inviteLimitMessage(response.retryAfter) };
  if (response.status < 200 || response.status >= 300) {
    const parsed = parseAccountResult(response.status, response.json);
    return { ok: false, message: parsed.ok ? "The code was not created." : parsed.message };
  }
  const code =
    response.json && typeof response.json === "object"
      ? (response.json as { code?: unknown }).code
      : undefined;
  if (typeof code !== "string" || !code) return { ok: false, message: "The code was not created." };
  return { ok: true, code };
}

/** Exposed for tests that check the request stays on the configured API origin. */
export function accountUrl(path: string): string {
  return apiUrl(path);
}
