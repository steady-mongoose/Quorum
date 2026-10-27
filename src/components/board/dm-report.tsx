import { useEffect, useId, useRef, useState } from "react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { formatWhen } from "@/lib/board/model";
import type { HardRuleValue } from "@/lib/board/text";
import {
  DM_REPORT_BUTTON,
  DM_REPORT_CSAM_HINT,
  DM_REPORT_HEADING,
  DM_REPORT_NOTE_MAX,
  DM_REPORT_REASON_ERROR,
  DM_REPORT_REASONS,
  DM_REPORT_SENT,
  DM_REPORT_SHARE_HINT,
  DM_REPORT_SHARE_LABEL,
} from "@/lib/e2ee/dm-report";
import {
  closeDmReport,
  listDmReports,
  reportDmMessage,
  type DmReportRow,
} from "@/lib/e2ee/dm-report-api";

type Send = typeof reportDmMessage;

/** "Report this message" under a message someone else sent. The text is shared only if the reporter ticks the box. */
export function DmReportControl({
  messageId,
  text,
  send = reportDmMessage,
}: {
  messageId: string;
  text: string;
  send?: Send;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HardRuleValue | "">("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstReason = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) firstReason.current?.focus();
  }, [open]);
  useEffect(() => {
    if (done) status.current?.focus();
  }, [done]);

  if (done) {
    return (
      <p ref={status} tabIndex={-1} role="status" className="mt-1 text-sm text-muted">
        {DM_REPORT_SENT}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        ref={toggle}
        type="button"
        className={cn(btnQuiet, "mt-1 min-h-[44px] self-start px-0 text-sm")}
        onClick={() => setOpen(true)}
      >
        {DM_REPORT_BUTTON}
      </button>
    );
  }
  const csam = reason === "csam";
  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (!reason) {
          setError(DM_REPORT_REASON_ERROR);
          firstReason.current?.focus();
          return;
        }
        setBusy(true);
        setError("");
        void send(messageId, { reason, note: note.trim(), sharedText: share && !csam ? text : "" }).then(
          (result) => {
            setBusy(false);
            if (result.ok) setDone(true);
            else setError(result.error);
          },
        );
      }}
    >
      <h3 id={`${id}-heading`} className="text-base text-fg">
        {DM_REPORT_HEADING}
      </h3>
      <fieldset
        className="flex flex-col gap-1"
        aria-invalid={error === DM_REPORT_REASON_ERROR ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <legend className="text-sm text-muted">Why are you reporting it?</legend>
        {DM_REPORT_REASONS.map((item, index) => (
          <label key={item.value} className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
            <input
              ref={index === 0 ? firstReason : undefined}
              type="radio"
              name={`${id}-reason`}
              value={item.value}
              checked={reason === item.value}
              onChange={() => {
                setReason(item.value);
                if (item.value === "csam") setShare(false);
                if (error === DM_REPORT_REASON_ERROR) setError("");
              }}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      {csam ? (
        <p className="text-sm text-muted">{DM_REPORT_CSAM_HINT}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={share}
              aria-describedby={`${id}-share-hint`}
              onChange={(event) => setShare(event.target.checked)}
            />
            {DM_REPORT_SHARE_LABEL}
          </label>
          <p id={`${id}-share-hint`} className="text-sm text-muted">
            {DM_REPORT_SHARE_HINT}
          </p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm text-muted">
        Anything else an admin should know (optional)
        <textarea
          className={fieldClass}
          maxLength={DM_REPORT_NOTE_MAX}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          Cancel
        </button>
        <button type="submit" className={btnSignal} disabled={busy} aria-busy={busy || undefined}>
          Send the report
        </button>
      </div>
    </form>
  );
}

const REASON_LABEL = new Map(DM_REPORT_REASONS.map((item) => [item.value, item.label]));

/** Admins only: open DM reports, most severe first. */
export function DmReportQueue({
  load = listDmReports,
  close = closeDmReport,
}: {
  load?: typeof listDmReports;
  close?: typeof closeDmReport;
}) {
  const [rows, setRows] = useState<DmReportRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void load().then((result) => {
      if (!live) return;
      if (result.ok) setRows(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [load]);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-lg text-fg">Message reports</h3>
      <p className="max-w-prose text-sm text-muted">
        Messages are encrypted. You see only the text a reporter chose to share, as they shared it.
        A reported message is kept until you close the report.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {rows === null && !error ? <p className="text-sm text-muted">Loading.</p> : null}
      {rows && rows.length === 0 ? <p className="text-sm text-muted">No open message reports.</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <p className="text-sm font-semibold text-fg">{REASON_LABEL.get(row.reason) ?? row.reason}</p>
              <p className="text-sm text-muted">
                {row.reporterName} reported a message from {row.reportedName} ·{" "}
                <When at={row.at} format={formatWhen} />
                {row.messageKept ? "" : " · The message has been deleted."}
              </p>
              {row.sharedText ? (
                <blockquote className="border-l-2 border-line pl-3 text-sm text-fg">{row.sharedText}</blockquote>
              ) : row.reason === "csam" ? null : (
                <p className="text-sm text-muted">The reporter did not share the text.</p>
              )}
              {row.note ? <p className="text-sm text-fg">Note: {row.note}</p> : null}
              <div className="flex flex-wrap gap-2">
                {(["resolved", "dismissed"] as const).map((resolution) => (
                  <button
                    key={resolution}
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      void close(row.id, resolution).then((result) => {
                        if (!result.ok) setError(result.error);
                        else setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
                      });
                    }}
                  >
                    {resolution === "resolved" ? "Mark resolved" : "Dismiss"}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
