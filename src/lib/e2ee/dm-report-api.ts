import { apiFetch } from "../api-base";
import type { HardRuleValue } from "../board/text";

export type DmReportRow = {
  id: string;
  reason: HardRuleValue;
  note: string;
  sharedText: string;
  reporterName: string;
  reportedName: string;
  messageSentAt: number | null;
  messageKept: boolean;
  at: number;
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<Outcome<T>> {
  try {
    const response = await apiFetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return { ok: false, error: typeof json?.error === "string" ? json.error : "That did not go through." };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, error: "The server could not be reached." };
  }
}

export function reportDmMessage(
  messageId: string,
  input: { reason: HardRuleValue; note: string; sharedText: string },
): Promise<Outcome<{ id: string }>> {
  return call(`/api/dm/messages/${encodeURIComponent(messageId)}/report`, "POST", input);
}

export async function listDmReports(): Promise<Outcome<DmReportRow[]>> {
  const result = await call<{ reports: DmReportRow[] }>("/api/admin/dm-reports", "GET");
  return result.ok ? { ok: true, value: result.value.reports } : result;
}

export function closeDmReport(id: string, resolution: "resolved" | "dismissed"): Promise<Outcome<{ ok: true }>> {
  return call(`/api/admin/dm-reports/${encodeURIComponent(id)}/close`, "POST", { resolution });
}
