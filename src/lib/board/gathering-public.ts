import { apiFetch } from "../api-base.ts";
import { readPublicGathering, type PublicGathering } from "./public-gathering.ts";

export type { PublicGathering };

/** The public page. A 404, or any other failure, is an unshared gathering. */
export async function loadPublicGathering(id: string): Promise<PublicGathering | null> {
  const response = await apiFetch(`/api/e/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  return readPublicGathering(await response.json().catch(() => null));
}

/** The organizer turns sharing on or off. Extra card fields are not sent. */
export async function setGatheringShare(input: {
  id: string;
  shared: boolean;
  title: string;
  date: string;
  town: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/e/${encodeURIComponent(input.id)}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shared: input.shared,
      title: input.title,
      date: input.date,
      town: input.town,
    }),
  });
  if (response.ok) return { ok: true };
  const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const error = json && typeof json.error === "string" ? json.error : "Sharing was not saved.";
  return { ok: false, error };
}
