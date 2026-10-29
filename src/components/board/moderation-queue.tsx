import { useEffect, useRef, useState } from "react";
import { btnGhost } from "@/components/quorum/bits";
import { RULE_LABEL } from "@/lib/board/model";
import { compareReports } from "@/lib/board/reports";
import { closeReport, loadReportQueue, type ReportRow } from "@/lib/board/report-api";
import { useBoard } from "@/lib/board/store";
import { useServerSession } from "@/lib/server-session-state";

/** Open reports for this room, highest severity first. Stewards and admins only. */
export function ModerationQueue({ roomId }: { roomId: string }) {
  const server = useServerSession();
  const admin = useBoard((state) => state.admin);
  const stewardRooms = useBoard((state) => state.stewardRooms);
  const remote = useBoard((state) => state.remote);
  const canSee = remote && server.mode === "live" && (admin || stewardRooms.includes(roomId));
  const [loaded, setLoaded] = useState<{ reports: ReportRow[]; error: string; at: number }>({
    reports: [],
    error: "",
    at: 0,
  });

  useEffect(() => {
    if (!canSee) return;
    let stopped = false;
    void loadReportQueue(roomId).then((result) => {
      if (stopped) return;
      if (!result.ok) setLoaded({ reports: [], error: result.error, at: Date.now() });
      else setLoaded({ reports: [...result.reports].sort(compareReports), error: "", at: Date.now() });
    });
    return () => {
      stopped = true;
    };
  }, [canSee, roomId]);

  if (!canSee) return null;
  return (
    <ReportQueueList
      key={loaded.at}
      initial={loaded.reports}
      loadError={loaded.error}
      onClose={async (id, resolution) => {
        const result = await closeReport({ id, resolution });
        return result.ok ? "" : result.error;
      }}
    />
  );
}

/**
 * The open reports with their two actions. After a close, focus moves to the next row's first
 * action, or to the Reports heading when none are left, and a status line says what happened.
 */
export function ReportQueueList({
  initial,
  loadError = "",
  onClose,
}: {
  initial: ReportRow[];
  loadError?: string;
  /** Resolves to "" on success, or the error to show. */
  onClose: (id: string, resolution: "resolved" | "dismissed") => Promise<string>;
}) {
  const [reports, setReports] = useState<ReportRow[]>(initial);
  const [error, setError] = useState(loadError);
  const [busy, setBusy] = useState("");
  const [announce, setAnnounce] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<number | null>(null);

  useEffect(() => {
    const index = focusAfter.current;
    if (index === null) return;
    focusAfter.current = null;
    const firsts = listRef.current?.querySelectorAll<HTMLButtonElement>("li [data-first-action]");
    const next = firsts && firsts.length > 0 ? firsts[Math.min(index, firsts.length - 1)] : null;
    if (next) next.focus();
    else headingRef.current?.focus();
  }, [reports]);

  const close = (id: string, resolution: "resolved" | "dismissed") => {
    if (busy) return;
    setBusy(id);
    void onClose(id, resolution).then((failure) => {
      setBusy("");
      if (failure) {
        setError(failure);
        return;
      }
      setError("");
      setAnnounce(resolution === "resolved" ? "Report marked resolved." : "Report dismissed.");
      focusAfter.current = Math.max(0, reports.findIndex((row) => row.id === id));
      setReports((rows) => rows.filter((row) => row.id !== id));
    });
  };

  return (
    <section className="mt-4 flex flex-col gap-2 border-t border-line pt-3" aria-label="Reports">
      <h2 ref={headingRef} tabIndex={-1} className="kicker">
        Reports
      </h2>
      <p role="status" className="sr-only">
        {announce}
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {reports.length === 0 && !error ? (
        <p className="text-sm text-muted">No open reports.</p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-2">
          {reports.map((report) => (
            <li key={report.id} className="text-sm text-fg">
              <span className="font-semibold">{RULE_LABEL[report.reason]}</span>
              {report.reporterName ? <span className="text-muted"> · {report.reporterName}</span> : null}
              {report.note ? <span className="text-muted"> · {report.note}</span> : null}
              {report.excerpt ? <p className="text-muted">{report.excerpt}</p> : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy === report.id}
                  data-first-action=""
                  aria-label={`Mark resolved: ${rowLabel(report)}`}
                  onClick={() => close(report.id, "resolved")}
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy === report.id}
                  aria-label={`Dismiss: ${rowLabel(report)}`}
                  onClick={() => close(report.id, "dismissed")}
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The reason, plus the reporter when this viewer may see the name. */
export function rowLabel(report: Pick<ReportRow, "reason" | "reporterName">): string {
  const reason = RULE_LABEL[report.reason];
  return report.reporterName ? `${reason}, reported by ${report.reporterName}` : reason;
}
