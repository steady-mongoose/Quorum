import { apiFetch } from "../api-base.ts";

export type InviteRow = {
  id: string;
  note: string;
  room: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number;
  redeemed: boolean;
  redeemedAt: number | null;
  redeemedBy: string;
  memberEmail: string;
  lastSignIn: number | null;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Keeps only known fields, so nothing extra (like a hash) can reach the page. */
export function parseInvites(json: unknown): InviteRow[] {
  const list = json && typeof json === "object" ? (json as { invites?: unknown }).invites : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      id: str(row.id),
      note: str(row.note),
      room: str(row.room),
      createdBy: str(row.createdBy),
      createdAt: num(row.createdAt) ?? 0,
      expiresAt: num(row.expiresAt) ?? 0,
      uses: num(row.uses) ?? 0,
      maxUses: num(row.maxUses) ?? 0,
      redeemed: row.redeemed === true,
      redeemedAt: num(row.redeemedAt),
      redeemedBy: str(row.redeemedBy),
      memberEmail: str(row.memberEmail),
      lastSignIn: num(row.lastSignIn),
    }));
}

export async function loadInvites(): Promise<{ ok: true; rows: InviteRow[] } | { ok: false; error: string }> {
  const response = await apiFetch("/api/admin/invites", { credentials: "include" });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json && typeof json === "object" ? str((json as { error?: unknown }).error) : "";
    return { ok: false, error: error || "The invite tracker could not load." };
  }
  return { ok: true, rows: parseInvites(json) };
}
