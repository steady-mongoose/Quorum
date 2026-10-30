import { apiFetch } from "./api-base";

export type MfaStatus = {
  required: boolean;
  enrolled: boolean;
  pending: boolean;
  recoveryRemaining: number;
  mfa: "ok" | "challenge" | "enroll";
};

export type MfaResult<T> = { ok: true; value: T } | { ok: false; message: string; error?: string };

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await apiFetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

function messageOf(json: unknown, fallback: string): { message: string; error?: string } {
  if (!json || typeof json !== "object") return { message: fallback };
  const record = json as { error?: unknown; message?: unknown };
  const error = typeof record.error === "string" ? record.error : undefined;
  const message = typeof record.message === "string" && record.message ? record.message : error || fallback;
  return error ? { message, error } : { message };
}

export async function readMfaStatus(): Promise<MfaStatus | null> {
  const response = await apiFetch("/api/mfa/status", { credentials: "include" });
  const json = (await response.json().catch(() => null)) as MfaStatus | null;
  if (!response.ok || !json || typeof json.mfa !== "string") return null;
  return json;
}

export async function startMfaEnroll(): Promise<
  MfaResult<{ secret: string; otpauth: string; modules: number[][] }>
> {
  const response = await post("/api/mfa/enroll/start", { kind: "totp" });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "Enrollment did not start.") };
  }
  const body = response.json as { secret?: unknown; otpauth?: unknown; modules?: unknown };
  if (typeof body.secret !== "string" || typeof body.otpauth !== "string" || !Array.isArray(body.modules)) {
    return { ok: false, message: "Enrollment did not start." };
  }
  const modules = body.modules.filter((row): row is number[] => Array.isArray(row));
  return { ok: true, value: { secret: body.secret, otpauth: body.otpauth, modules } };
}

export async function confirmMfaEnroll(code: string): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const response = await post("/api/mfa/enroll/confirm", { code });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That code is not valid.") };
  }
  const codes = (response.json as { recoveryCodes?: unknown }).recoveryCodes;
  if (!Array.isArray(codes) || codes.some((item) => typeof item !== "string")) {
    return { ok: false, message: "The recovery codes were not returned." };
  }
  return { ok: true, value: { recoveryCodes: codes as string[] } };
}

export async function submitMfaChallenge(code: string): Promise<MfaResult<{ ok: true }>> {
  const response = await post("/api/mfa/challenge", { code });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That code is not valid.") };
  }
  return { ok: true, value: { ok: true } };
}

export async function stepUpMfa(
  action: "role-grant" | "mfa-reset" | "claim-approval" | "data-export",
  code: string,
): Promise<MfaResult<{ ok: true }>> {
  const response = await post("/api/mfa/step-up", { action, code });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That code is not valid.") };
  }
  return { ok: true, value: { ok: true } };
}

export async function disableMfa(code: string): Promise<MfaResult<{ ok: true }>> {
  const response = await post("/api/mfa/disable", { code });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That did not turn the authenticator off.") };
  }
  return { ok: true, value: { ok: true } };
}

export type MfaResetRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedBy: string;
  requesterName: string;
  approvals: { approverId: string; approverName: string; at: string }[];
};

/**
 * The reset list's own words for "did not load". The panel on About says the
 * same sentence as the other four admin lists ("That did not load.") for every
 * failure that is not the authenticator gate, so this is never shown as is.
 */
export const MFA_RESETS_LOAD_FAILED = "The reset queue did not load.";

export async function listMfaResets(): Promise<MfaResult<{ resets: MfaResetRow[] }>> {
  const response = await apiFetch("/api/mfa/reset", { credentials: "include" });
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, ...messageOf(json, MFA_RESETS_LOAD_FAILED) };
  // A 2xx that is not JSON (an HTML page, say) is null here: it did not load.
  const resets = (json as { resets?: unknown } | null)?.resets;
  if (!Array.isArray(resets)) return { ok: false, message: MFA_RESETS_LOAD_FAILED };
  return { ok: true, value: { resets: resets as MfaResetRow[] } };
}

export async function requestMfaReset(userId: string): Promise<MfaResult<{ id: string }>> {
  const response = await post("/api/mfa/reset/request", { userId });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That reset was not asked for.") };
  }
  const id = (response.json as { id?: unknown }).id;
  if (typeof id !== "string") return { ok: false, message: "That reset was not asked for." };
  return { ok: true, value: { id } };
}

export async function approveMfaReset(id: string): Promise<MfaResult<{ completed: boolean }>> {
  const response = await post(`/api/mfa/reset/${encodeURIComponent(id)}/approve`, {});
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, ...messageOf(response.json, "That approval was not saved.") };
  }
  return { ok: true, value: { completed: (response.json as { completed?: unknown }).completed === true } };
}

export async function fetchAccountExport(): Promise<MfaResult<unknown>> {
  const response = await apiFetch("/api/admin/export", { credentials: "include" });
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, ...messageOf(json, "The export was not made.") };
  return { ok: true, value: json };
}
