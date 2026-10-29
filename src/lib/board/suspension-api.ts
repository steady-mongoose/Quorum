import { apiFetch } from "../api-base.ts";

/** The signed-in member's own suspension. Never the post, its text, the strikes or the steward. */
export type OwnSuspension =
  | { suspended: false }
  | { suspended: true; reason: string; postId: string | null; appealable: boolean };

export type BanReviewView = {
  id: string;
  userId: string | null;
  name: string;
  reason: string;
  requestedBy: string;
  roomId: string;
  own: boolean;
  at: number;
};

export type SuspensionDone = { ok: true } | { ok: false; error: string };

export type SuspensionApi = {
  own: () => Promise<OwnSuspension>;
  appeal: (postId: string, reason: string, evidence: string, compromise: boolean) => Promise<SuspensionDone>;
  reviews: () => Promise<{ reviews: BanReviewView[] } | { error: string }>;
  decide: (id: string, decision: "closed" | "cleared") => Promise<SuspensionDone>;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function post(path: string, body: unknown): Promise<SuspensionDone> {
  try {
    const response = await apiFetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, error: str(json?.error) || "That did not go through. Please try again." };
  } catch {
    return { ok: false, error: "That did not go through. Please try again." };
  }
}

export const suspensionApi: SuspensionApi = {
  async own() {
    try {
      const response = await apiFetch("/api/suspension", { credentials: "include" });
      if (!response.ok) return { suspended: false };
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || json.suspended !== true) return { suspended: false };
      return {
        suspended: true,
        reason: str(json.reason),
        postId: str(json.postId) || null,
        appealable: json.appealable === true,
      };
    } catch {
      return { suspended: false };
    }
  },
  appeal: (postId, reason, evidence, compromise) =>
    post(`/api/posts/${encodeURIComponent(postId)}/appeal`, {
      kind: "removal",
      reason,
      ...(compromise ? { ground: "account_compromise", evidence } : {}),
    }),
  async reviews() {
    try {
      const response = await apiFetch("/api/admin/ban-reviews", { credentials: "include" });
      const json = (await response.json().catch(() => null)) as { reviews?: unknown; error?: unknown } | null;
      if (!response.ok) return { error: str(json?.error) || "The suspensions did not load." };
      const rows = Array.isArray(json?.reviews) ? (json.reviews as Record<string, unknown>[]) : [];
      return {
        reviews: rows.map((row) => ({
          id: str(row.id),
          userId: str(row.userId) || null,
          name: str(row.name),
          reason: str(row.reason),
          requestedBy: str(row.requestedBy),
          roomId: str(row.roomId),
          own: row.own === true,
          at: typeof row.at === "number" ? row.at : 0,
        })),
      };
    } catch {
      return { error: "The suspensions did not load." };
    }
  },
  decide: (id, decision) => post(`/api/admin/ban-reviews/${encodeURIComponent(id)}/decide`, { decision }),
};
