import { apiFetch } from "../api-base.ts";
import { isHardRule, type HardRuleValue } from "./text.ts";

export type ReportRow = {
  id: string;
  roomId: string;
  subjectKind: "post" | "chat";
  subjectId: string;
  reason: HardRuleValue;
  note: string;
  at: number;
  reporterName: string;
  excerpt: string;
};

function errorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const error = (json as { error?: unknown }).error;
  return typeof error === "string" && error ? error : fallback;
}

export async function sendReport(input: {
  roomId: string;
  subjectKind: "post" | "chat";
  subjectId: string;
  reason: HardRuleValue;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch("/api/reports", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: errorMessage(json, "That report was not sent.") };
  return { ok: true };
}

export async function loadReportQueue(
  roomId: string,
): Promise<{ ok: true; reports: ReportRow[] } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/reports?room=${encodeURIComponent(roomId)}`, {
    credentials: "include",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: errorMessage(json, "The reports did not load.") };
  const rows =
    json && typeof json === "object" && Array.isArray((json as { reports?: unknown }).reports)
      ? (json as { reports: unknown[] }).reports
      : [];
  const reports: ReportRow[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !isHardRule(row.reason)) continue;
    if (row.subjectKind !== "post" && row.subjectKind !== "chat") continue;
    if (typeof row.subjectId !== "string" || typeof row.at !== "number") continue;
    reports.push({
      id: row.id,
      roomId: typeof row.roomId === "string" ? row.roomId : roomId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      reason: row.reason,
      note: typeof row.note === "string" ? row.note : "",
      at: row.at,
      reporterName: typeof row.reporterName === "string" ? row.reporterName : "",
      excerpt: typeof row.excerpt === "string" ? row.excerpt : "",
    });
  }
  return { ok: true, reports };
}

/** A steward of the room or an admin closes a report as resolved or dismissed. */
export async function closeReport(input: {
  id: string;
  resolution: "resolved" | "dismissed";
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await apiFetch(`/api/reports/${encodeURIComponent(input.id)}/close`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resolution: input.resolution, note: input.note ?? "" }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: errorMessage(json, "That report was not closed.") };
  return { ok: true };
}
