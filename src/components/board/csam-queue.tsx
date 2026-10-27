import { useCallback, useEffect, useState } from "react";
import { btnGhost, btnSignal, fieldClass } from "@/components/quorum/bits";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import {
  csamApi,
  type CsamApi,
  type CsamFlagView,
  type CsamHoldView,
  type CsamQueueView,
} from "@/lib/board/csam-api";

/**
 * No person views CSAM in the app. This queue shows metadata only: reporter, reason,
 * time, file hash, uploader and file id. There is no reveal, thumbnail, preview or
 * blurred view, and no link to a file. Every action is blind.
 */
export const NOT_CUSTODIAN =
  "Only a named CSAM custodian can see this queue. Ask the owner if you should be one.";
export const LEGAL_HOLD_OFF_CONFIRM = "Turn off the legal hold? The hold will be purged when its year ends.";
export const LEGAL_HOLD_NOTE_LABEL = "Who asked for the hold, and why";
export const REMOVE_FLAGGED_CONFIRM =
  "Preserve and remove this post? Its files are sealed unopened for NCMEC and the post comes down.";
export const recordConfirm = (id: string) =>
  `Record CyberTipline report ${id}? This starts the one-year hold. Check the number against the NCMEC receipt.`;
export const grantConfirm = (name: string) =>
  `Make ${name} a CSAM custodian? They will be able to see holds, and every view is logged.`;
export const revokeConfirm = (name: string) => `Remove ${name} as a CSAM custodian?`;

type Pending =
  | { kind: "file"; holdId: string; reportId: string }
  | { kind: "hold-off"; holdId: string }
  | { kind: "grant" | "revoke"; userId: string; name: string }
  | { kind: "remove"; flagId: string };

function when(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function CsamQueue({ api = csamApi }: { api?: CsamApi }) {
  const [view, setView] = useState<CsamQueueView | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await api.load();
    if ("error" in next) setError(next.error);
    else {
      setView(next);
      setError("");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) setError(result.error);
      else await load();
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "file") void run(() => api.file(pending.holdId, pending.reportId));
    else if (pending.kind === "hold-off") void run(() => api.legalHold(pending.holdId, false, ""));
    else if (pending.kind === "remove") void run(() => api.removeFlagged(pending.flagId));
    else void run(() => api.custodian(pending.userId, pending.kind === "grant"));
  };

  const dialog =
    pending?.kind === "file"
      ? { title: "Record filing", text: recordConfirm(pending.reportId), label: "Record filing" }
      : pending?.kind === "hold-off"
        ? { title: "Legal hold", text: LEGAL_HOLD_OFF_CONFIRM, label: "Turn it off" }
        : pending?.kind === "grant"
          ? { title: "CSAM custodian", text: grantConfirm(pending.name), label: "Make custodian" }
          : pending?.kind === "revoke"
            ? { title: "CSAM custodian", text: revokeConfirm(pending.name), label: "Remove custodian" }
            : pending?.kind === "remove"
              ? { title: "Preserve and remove", text: REMOVE_FLAGGED_CONFIRM, label: "Preserve and remove" }
              : null;

  return (
    <section
      aria-labelledby="csam-queue-heading"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="csam-queue-heading" className="text-2xl text-fg">
        CyberTipline queue
      </h2>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {view && !view.custodian ? <p className="max-w-prose text-sm text-muted">{NOT_CUSTODIAN}</p> : null}
      {view?.custodian ? (
        <>
          <p className="max-w-prose text-sm text-muted">
            Nobody looks at these files, here or anywhere else in the app. You see who reported it, why,
            when, who uploaded it, and each file's id and SHA-256 hash. A report or a flag is enough to
            preserve and remove. File with the NCMEC CyberTipline by hand, then record the report number
            here. The files go to NCMEC unopened.
          </p>
          <h3 className="text-lg text-fg">Reports and flags</h3>
          {view.flags.length === 0 ? (
            <p className="text-sm text-muted">No report or flag is open.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.flags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  busy={busy}
                  onRemove={() => setPending({ kind: "remove", flagId: flag.id })}
                />
              ))}
            </ul>
          )}
          <h3 className="text-lg text-fg">Holds</h3>
          {view.reports.length === 0 ? (
            <p className="text-sm text-muted">No hold is waiting.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {view.reports.map((hold) => (
                <HoldRow
                  key={hold.id}
                  hold={hold}
                  busy={busy}
                  onFile={(reportId) => setPending({ kind: "file", holdId: hold.id, reportId })}
                  onHoldOn={(note) => void run(() => api.legalHold(hold.id, true, note))}
                  onHoldOff={() => setPending({ kind: "hold-off", holdId: hold.id })}
                />
              ))}
            </ul>
          )}
          {view.owner ? (
            <>
              <h3 className="text-lg text-fg">Custodians</h3>
              <p className="max-w-prose text-sm text-muted">
                You and at most three admins. Every view of this queue is logged.
              </p>
              {view.admins.length === 0 ? (
                <p className="text-sm text-muted">There are no other admins.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {view.admins.map((person) => (
                    <li key={person.id} className="flex flex-wrap items-center gap-2 text-sm text-fg">
                      <span>
                        {person.name}
                        {person.custodian ? " · custodian" : ""}
                      </span>
                      <button
                        type="button"
                        className={btnGhost}
                        aria-disabled={busy || undefined}
                        onClick={() =>
                          !busy &&
                          setPending({
                            kind: person.custodian ? "revoke" : "grant",
                            userId: person.id,
                            name: person.name,
                          })
                        }
                      >
                        {person.custodian ? "Remove as custodian" : "Make custodian"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </>
      ) : null}
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.text ?? ""}
        confirmLabel={dialog?.label ?? "Confirm"}
        cancelLabel="Cancel"
        tone={pending?.kind === "file" || pending?.kind === "grant" ? "neutral" : "danger"}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

function Files({ ids, hashes }: { ids: string[]; hashes?: string[] }) {
  if (ids.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
      {ids.map((id, index) => (
        <li key={id}>
          file {id}
          {hashes?.[index] ? ` · sha256 ${hashes[index]}` : ""}
        </li>
      ))}
    </ul>
  );
}

function FlagRow({ flag, busy, onRemove }: { flag: CsamFlagView; busy: boolean; onRemove: () => void }) {
  return (
    <li className="rounded-md border border-line px-3 py-2 text-sm text-muted">
      <p>
        {flag.source === "scanner" ? "Scanner flag" : `Reported by ${flag.reporter || "a member"}`} ·{" "}
        {when(flag.at)} · uploaded by {flag.uploader || "unknown"} · post {flag.postId}
      </p>
      {flag.reason ? <p>Reason: {flag.reason}</p> : null}
      <Files ids={flag.fileIds} />
      <button
        type="button"
        className={`${btnSignal} mt-2`}
        aria-disabled={busy || undefined}
        onClick={() => !busy && onRemove()}
      >
        Preserve and remove
      </button>
    </li>
  );
}

function HoldRow({
  hold,
  busy,
  onFile,
  onHoldOn,
  onHoldOff,
}: {
  hold: CsamHoldView;
  busy: boolean;
  onFile: (reportId: string) => void;
  onHoldOn: (note: string) => void;
  onHoldOff: () => void;
}) {
  const [reportId, setReportId] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState("");
  const reportField = `csam-report-${hold.id}`;
  const noteField = `csam-note-${hold.id}`;
  const errorId = `csam-error-${hold.id}`;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
      <p>
        {hold.status === "filed"
          ? `Filed · CyberTipline report ${hold.reportId}`
          : hold.status === "pending_seal"
            ? "Not sealed"
            : "Not filed"}{" "}
        · {when(hold.incidentAt)} · uploaded by {hold.author} · account {hold.accountId} · post{" "}
        {hold.postId} · {hold.mediaCount} {hold.mediaCount === 1 ? "file" : "files"}, {hold.byteSize}{" "}
        bytes · hold until {new Date(hold.retainUntil).toLocaleDateString()}
      </p>
      {hold.reporter ? (
        <p>
          Reported by {hold.reporter}
          {hold.reportReason ? `: ${hold.reportReason}` : ""}
        </p>
      ) : null}
      <Files ids={hold.fileIds} hashes={hold.fileHashes} />
      {fieldError ? (
        <p id={errorId} role="alert" className="text-danger">
          {fieldError}
        </p>
      ) : null}
      {hold.status !== "filed" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={reportField} className="flex flex-col gap-1 text-fg">
            CyberTipline report number
            <input
              id={reportField}
              className={fieldClass}
              value={reportId}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={fieldError && !reportId.trim() ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              onChange={(event) => {
                setReportId(event.target.value);
                setFieldError("");
              }}
            />
          </label>
          <button
            type="button"
            className={btnSignal}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              const typed = reportId.trim();
              if (!typed) {
                setFieldError("Enter the report number from the NCMEC receipt.");
                return;
              }
              onFile(typed);
            }}
          >
            Record filing
          </button>
        </div>
      ) : null}
      {hold.legalHold ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-fg">Legal hold on: {hold.legalHoldNote}</p>
          <button
            type="button"
            className={btnGhost}
            aria-disabled={busy || undefined}
            onClick={() => !busy && onHoldOff()}
          >
            Turn off legal hold
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={noteField} className="flex flex-col gap-1 text-fg">
            {LEGAL_HOLD_NOTE_LABEL}
            <input
              id={noteField}
              className={fieldClass}
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={btnGhost}
            aria-disabled={busy || undefined}
            onClick={() => !busy && onHoldOn(note)}
          >
            Turn on legal hold
          </button>
        </div>
      )}
    </li>
  );
}
