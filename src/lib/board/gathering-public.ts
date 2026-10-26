import { apiFetch } from "../api-base.ts";
import { isGatheringId, readPublicGathering, type PublicGathering } from "./public-gathering.ts";

export type { PublicGathering };

export type StoredGathering = {
  id: string;
  roomId: string;
  title: string;
  date: string;
  time: string;
  town: string;
  place: string;
  shared: boolean;
  mine: boolean;
};

const LOAD_MS = 8000;

function failure(json: unknown, fallback: string): { ok: false; error: string } {
  const error =
    json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : fallback;
  return { ok: false, error };
}

function storedFrom(value: unknown): StoredGathering | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !isGatheringId(row.id)) return null;
  if (typeof row.title !== "string" || typeof row.roomId !== "string") return null;
  return {
    id: row.id,
    roomId: row.roomId,
    title: row.title,
    date: typeof row.date === "string" ? row.date : "",
    time: typeof row.time === "string" ? row.time : "",
    town: typeof row.town === "string" ? row.town : "",
    place: typeof row.place === "string" ? row.place : "",
    shared: row.shared === true,
    mine: row.mine === true,
  };
}

/** The public page. A 404, a bad id, or a timeout is an unshared gathering. */
export async function loadPublicGathering(id: string): Promise<PublicGathering | null> {
  if (!isGatheringId(id)) return null;
  const response = await apiFetch(`/api/e/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(LOAD_MS),
  });
  if (!response.ok) return null;
  return readPublicGathering(await response.json().catch(() => null));
}

/** The organizer turns sharing on or off. The body carries nothing else. */
export async function setGatheringShare(input: {
  id: string;
  shared: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/e/${encodeURIComponent(input.id)}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shared: input.shared }),
  });
  if (response.ok) return { ok: true };
  return failure(await response.json().catch(() => null), "Sharing was not saved.");
}

export async function saveGathering(input: {
  id: string;
  roomId: string;
  title: string;
  date: string;
  time: string;
  place: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch("/api/gatherings", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: input.id,
      roomId: input.roomId,
      title: input.title,
      date: input.date,
      time: input.time,
      place: input.place,
    }),
  });
  if (response.ok) return { ok: true };
  return failure(await response.json().catch(() => null), "The gathering was not saved.");
}

export async function removeGathering(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/gatherings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (response.ok) return { ok: true };
  return failure(await response.json().catch(() => null), "The gathering was not removed.");
}

export async function loadGathering(id: string): Promise<StoredGathering | null> {
  if (!isGatheringId(id)) return null;
  const response = await apiFetch(`/api/gatherings/${encodeURIComponent(id)}`, {
    credentials: "include",
    signal: AbortSignal.timeout(LOAD_MS),
  });
  if (!response.ok) return null;
  const json = (await response.json().catch(() => null)) as { gathering?: unknown } | null;
  return storedFrom(json?.gathering);
}

export async function loadGatherings(): Promise<
  { ok: true; gatherings: StoredGathering[] } | { ok: false; error: string }
> {
  const response = await apiFetch("/api/gatherings", {
    credentials: "include",
    signal: AbortSignal.timeout(LOAD_MS),
  });
  if (!response.ok) return failure(await response.json().catch(() => null), "Gatherings did not load.");
  const json = (await response.json().catch(() => null)) as { gatherings?: unknown } | null;
  const gatherings = Array.isArray(json?.gatherings)
    ? json.gatherings.map(storedFrom).filter((row): row is StoredGathering => row !== null)
    : [];
  return { ok: true, gatherings };
}
