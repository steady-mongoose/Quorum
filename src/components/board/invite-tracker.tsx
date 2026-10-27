import { useEffect, useState } from "react";
import { loadInvites, type InviteRow } from "@/lib/admin/invite-tracker";

function day(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Admin only. Read only: no buttons that change anything. */
export function InviteTrackerTable({ rows }: { rows: InviteRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No invites yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th scope="col">Note</th>
            <th scope="col">Created</th>
            <th scope="col">Expires</th>
            <th scope="col">Redeemed</th>
            <th scope="col">By</th>
            <th scope="col">Email</th>
            <th scope="col">Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id}-${index}`} className="border-t border-line">
              <td>{row.note || "—"}</td>
              <td>{day(row.createdAt)}</td>
              <td>{day(row.expiresAt)}</td>
              <td>{row.redeemed ? day(row.redeemedAt) : "No"}</td>
              <td>{row.redeemedBy || "—"}</td>
              <td>{row.memberEmail || "—"}</td>
              <td>{day(row.lastSignIn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InviteTracker() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void loadInvites().then((result) => {
      if (result.ok) setRows(result.rows);
      else setError(result.error);
    });
  }, []);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-2xl text-fg">Invites</h2>
      {error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : rows ? (
        <InviteTrackerTable rows={rows} />
      ) : (
        <p className="text-sm text-muted">Loading.</p>
      )}
    </section>
  );
}
