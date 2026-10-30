import { apiFetch } from "../api-base.ts";
import { PANEL_LOAD_FAILED, panelFailure, type PanelFailure } from "./load-failure.ts";

export type AccountState = {
  deactivated: boolean;
  deletionRequested: boolean;
};

export type DeletionRequest = {
  id: string;
  userId: string;
  name: string;
  note: string;
  at: number;
};

type Failure = { ok: false; error: string };

async function send(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; json: unknown }> {
  const response = await apiFetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, json };
}

function errorOf(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "error" in json && typeof json.error === "string" && json.error) {
    return json.error;
  }
  return fallback;
}

export async function deleteOwnPost(id: string): Promise<{ ok: true } | Failure> {
  const sent = await send(`/api/posts/${encodeURIComponent(id)}/delete`, {});
  if (!sent.ok) return { ok: false, error: errorOf(sent.json, "That post was not deleted.") };
  return { ok: true };
}

export async function readAccount(): Promise<{ ok: true; value: AccountState } | Failure> {
  const sent = await send("/api/account");
  if (!sent.ok || !sent.json || typeof sent.json !== "object") {
    return { ok: false, error: errorOf(sent.json, "The account could not be read.") };
  }
  const row = sent.json as { deactivated?: unknown; deletionRequested?: unknown };
  return {
    ok: true,
    value: {
      deactivated: row.deactivated === true,
      deletionRequested: row.deletionRequested === true,
    },
  };
}

export async function deactivateAccount(): Promise<{ ok: true } | Failure> {
  const sent = await send("/api/account/deactivate", {});
  if (!sent.ok) return { ok: false, error: errorOf(sent.json, "The account was not deactivated.") };
  return { ok: true };
}

export async function reactivateAccount(): Promise<{ ok: true } | Failure> {
  const sent = await send("/api/account/reactivate", {});
  if (!sent.ok) return { ok: false, error: errorOf(sent.json, "The account was not reactivated.") };
  return { ok: true };
}

export async function requestAccountDeletion(note: string): Promise<{ ok: true } | Failure> {
  const sent = await send("/api/account/deletion-request", { note });
  if (!sent.ok) return { ok: false, error: errorOf(sent.json, "The deletion request was not filed.") };
  return { ok: true };
}

export async function loadDeletionRequests(): Promise<
  { ok: true; requests: DeletionRequest[] } | ({ ok: false } & PanelFailure)
> {
  // apiFetch never throws: a transport failure comes back as a 503 api-unavailable.
  const sent = await send("/api/account/deletion-requests");
  if (!sent.ok || !sent.json || typeof sent.json !== "object") {
    return { ok: false, ...panelFailure(sent.json, PANEL_LOAD_FAILED) };
  }
  const raw = (sent.json as { requests?: unknown }).requests;
  const requests: DeletionRequest[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: unknown; userId?: unknown; name?: unknown; note?: unknown; at?: unknown };
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.at !== "number") continue;
      requests.push({
        id: row.id,
        userId: typeof row.userId === "string" ? row.userId : "",
        name: row.name,
        note: typeof row.note === "string" ? row.note : "",
        at: row.at,
      });
    }
  }
  return { ok: true, requests };
}
