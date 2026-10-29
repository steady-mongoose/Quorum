import { apiFetch } from "../api-base.ts";

/** Metadata only. The CSAM queue never fetches, shows or links a held or flagged file. */
export type CsamHoldView = {
  id: string;
  postId: string;
  author: string;
  accountId: string;
  incidentAt: number;
  retainUntil: number;
  mediaCount: number;
  byteSize: number;
  mediaTypes: string[];
  status: "prepared" | "pending_seal" | "filed";
  reportId: string;
  legalHold: boolean;
  legalHoldNote: string;
  fileIds: string[];
  fileHashes: string[];
  reporter: string;
  reportReason: string;
  /** Released only with a recorded lawyer sign-off. */
  releasedAt: number | null;
  releaseLawyer: string;
  releaseReference: string;
};

export type CsamFlagView = {
  id: string;
  postId: string;
  source: "report" | "scanner";
  reporter: string;
  reason: string;
  uploader: string;
  fileIds: string[];
  at: number;
};

export type CsamPersonView = { id: string; name: string; custodian: boolean };

export type CsamQueueView = {
  custodian: boolean;
  owner: boolean;
  reports: CsamHoldView[];
  flags: CsamFlagView[];
  admins: CsamPersonView[];
};

export type CsamDone = { ok: true } | { ok: false; error: string };

export type CsamApi = {
  load: () => Promise<CsamQueueView | { error: string }>;
  file: (holdId: string, reportId: string) => Promise<CsamDone>;
  legalHold: (holdId: string, on: boolean, note: string) => Promise<CsamDone>;
  custodian: (userId: string, grant: boolean) => Promise<CsamDone>;
  removeFlagged: (flagId: string) => Promise<CsamDone>;
  releaseHold: (holdId: string, lawyerName: string, lawyerReference: string) => Promise<CsamDone>;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const strs = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const rows = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

export function queueFrom(value: unknown): CsamQueueView {
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    custodian: body.custodian === true,
    owner: body.owner === true,
    reports: rows(body.reports).map((row) => ({
      id: str(row.id),
      postId: str(row.postId),
      author: str(row.author),
      accountId: str(row.accountId),
      incidentAt: num(row.incidentAt),
      retainUntil: num(row.retainUntil),
      mediaCount: num(row.mediaCount),
      byteSize: num(row.byteSize),
      mediaTypes: strs(row.mediaTypes),
      status: row.status === "filed" || row.status === "pending_seal" ? row.status : "prepared",
      reportId: str(row.reportId),
      legalHold: row.legalHold === true,
      legalHoldNote: str(row.legalHoldNote),
      fileIds: strs(row.fileIds),
      fileHashes: strs(row.fileHashes),
      reporter: str(row.reporter),
      reportReason: str(row.reportReason),
      releasedAt: typeof row.releasedAt === "number" ? row.releasedAt : null,
      releaseLawyer: str(row.releaseLawyer),
      releaseReference: str(row.releaseReference),
    })),
    flags: rows(body.flags).map((row) => ({
      id: str(row.id),
      postId: str(row.postId),
      source: row.source === "scanner" ? "scanner" : "report",
      reporter: str(row.reporter),
      reason: str(row.reason),
      uploader: str(row.uploader),
      fileIds: strs(row.fileIds),
      at: num(row.at),
    })),
    admins: rows(body.admins).map((row) => ({
      id: str(row.id),
      name: str(row.name),
      custodian: row.custodian === true,
    })),
  };
}

async function post(path: string, body: unknown): Promise<CsamDone> {
  try {
    const response = await apiFetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, error: str(json?.error) || "That did not save. Try again." };
  } catch {
    return { ok: false, error: "That did not save. Check your connection and try again." };
  }
}

export const csamApi: CsamApi = {
  async load() {
    try {
      const response = await apiFetch("/api/csam-queue", { credentials: "include" });
      const json = await response.json().catch(() => null);
      if (!response.ok) return { error: str((json as { error?: unknown } | null)?.error) || "The queue did not load." };
      return queueFrom(json);
    } catch {
      return { error: "The queue did not load. Check your connection and try again." };
    }
  },
  file: (holdId, reportId) => post(`/api/csam-holds/${encodeURIComponent(holdId)}/filed`, { reportId }),
  legalHold: (holdId, on, note) =>
    post(`/api/csam-holds/${encodeURIComponent(holdId)}/legal-hold`, { on, note }),
  custodian: (userId, grant) => post("/api/csam-custodians", { userId, grant }),
  removeFlagged: (flagId) => post(`/api/csam-flags/${encodeURIComponent(flagId)}/remove`, {}),
  releaseHold: (holdId, lawyerName, lawyerReference) =>
    post(`/api/csam-holds/${encodeURIComponent(holdId)}/release`, { lawyerName, lawyerReference }),
};
