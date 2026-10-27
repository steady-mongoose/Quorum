import { useEffect, useState } from "react";
import { btnGhost, Kicker } from "@/components/quorum/bits";
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
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const close = (id: string, resolution: "resolved" | "dismissed") => {
    if (busy) return;
    setBusy(id);
    void closeReport({ id, resolution }).then((result) => {
      setBusy("");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError("");
      setReports((rows) => rows.filter((row) => row.id !== id));
    });
  };

  useEffect(() => {
    if (!canSee) return;
    let stopped = false;
    void loadReportQueue(roomId).then((result) => {
      if (stopped) return;
      if (!result.ok) {
        setError(result.error);
        setReports([]);
        return;
      }
      setError("");
      setReports([...result.reports].sort(compareReports));
    });
    return () => {
      stopped = true;
    };
  }, [canSee, roomId]);

  if (!canSee) return null;

  return (
    <section className="mt-4 flex flex-col gap-2 border-t border-line pt-3" aria-label="Reports">
      <Kicker>Reports</Kicker>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {reports.length === 0 && !error ? (
        <p className="text-sm text-muted">No open reports.</p>
      ) : (
        <ol className="flex flex-col gap-2">
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
                  onClick={() => close(report.id, "resolved")}
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy === report.id}
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
