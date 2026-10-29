import { apiFetch } from "../api-base";
import type { HardRuleValue } from "../board/text";
import {
  PANEL_LOAD_FAILED,
  PANEL_SAVE_FAILED,
  PANEL_UNREACHABLE,
  panelFailure,
  type PanelFailure,
} from "../board/load-failure";

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

type Outcome<T> = { ok: true; value: T } | ({ ok: false } & PanelFailure);

/** A member's report keeps its own wording; the admin queue's loads and saves use the panel's. */
const REPORT_FAILED = "That did not go through.";

async function call<T>(
  path: string,
  method: "GET" | "POST",
  body: unknown,
  fallback: string,
): Promise<Outcome<T>> {
  try {
    const response = await apiFetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      // A bare code such as mfa_required never reaches the page.
      return { ok: false, ...panelFailure(json, fallback) };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, error: PANEL_UNREACHABLE };
  }
}

export function reportDmMessage(
  messageId: string,
  input: { reason: HardRuleValue; note: string; sharedText: string },
): Promise<Outcome<{ id: string }>> {
  return call(`/api/dm/messages/${encodeURIComponent(messageId)}/report`, "POST", input, REPORT_FAILED);
}

export async function listDmReports(): Promise<Outcome<DmReportRow[]>> {
  const result = await call<{ reports: DmReportRow[] }>("/api/admin/dm-reports", "GET", undefined, PANEL_LOAD_FAILED);
  return result.ok ? { ok: true, value: result.value.reports } : result;
}

export function closeDmReport(id: string, resolution: "resolved" | "dismissed"): Promise<Outcome<{ ok: true }>> {
  return call(`/api/admin/dm-reports/${encodeURIComponent(id)}/close`, "POST", { resolution }, PANEL_SAVE_FAILED);
}
